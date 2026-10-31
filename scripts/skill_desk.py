"""Runs the day-trader-skill (vendor/day-trader-skill, unmodified) and assembles
the Day Trader desk the site shows. Used by the snapshot job (build_data.py)
and the live API (server/live_api.py).

Every number on the desk comes from the skill's own tools, called the way its
README does, with --json:

    scanner  scan.py orb    opening-range breakouts (+ scan.py daily: pre-market setups)
    entry    entry.py check  triggered / waiting / expired, per breakout
    exit     exit.py plan    stop (or-mid) and target (2R) before the entry
    replay   timemachine.py  10,000 replays + the same rule on every past session
    news     news.py         Yahoo headlines + SEC 8-Ks + today's move
    analyst  facts.py        quarters from SEC XBRL, what changed
    congress ptr.py          House PTR index, and the trades inside the newest PTRs
    clock    alerts.py clock is the NYSE open
    sizing   size.py + check.py, on demand with the user's budget (size_and_check)

One Yahoo request per symbol (60 days of 5-minute bars) feeds the scanner, the
entry timer and the Time Machine through their --offline option, so they all
see the same bars; the browser gets a compact copy for the chart.
"""
import gzip
import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILL = os.path.join(ROOT, 'vendor', 'day-trader-skill')
ET = ZoneInfo('America/New_York')

# Liquid US names the desk scans (DT_WATCHLIST overrides). The skill can scan its
# whole ~5,900-stock universe, but every 15 minutes that is too many requests.
WATCHLIST = [s.strip().upper() for s in os.environ.get('DT_WATCHLIST', ','.join([
    'NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMD', 'AMZN', 'GOOGL', 'NFLX', 'AVGO',
    'PLTR', 'COIN', 'MSTR', 'SMCI', 'MU', 'INTC', 'UBER', 'SHOP', 'CRWD', 'SNOW',
    'BA', 'JPM', 'XOM', 'LLY', 'UNH', 'COST', 'WMT', 'DIS', 'NKE', 'SOFI',
    'RIVN', 'HOOD', 'ARM', 'PYPL', 'ABNB', 'MRVL', 'ORCL', 'CRM', 'ADBE', 'QCOM',
])).split(',') if s.strip()]
MAX_PLANS = int(os.environ.get('DT_MAX_PLANS', 8))      # breakouts carried through entry → exit → Time Machine
TARGET = os.environ.get('DT_TARGET', '2R')              # the skill's default target
STOP = os.environ.get('DT_STOP', 'or-mid')              # the skill's default stop for an orb entry
PTR_DETAIL = int(os.environ.get('DT_PTR_DETAIL', 8))    # newest House PTRs read row by row

DEFAULT_CONFIG = {
    'budget': 5000, 'cash_buffer_pct': 10, 'max_position_pct': 75, 'max_order_usd': 4000, 'min_order_usd': 5,
    'max_loss_per_trade_usd': 50, 'max_daily_loss_usd': 150, 'max_trades_per_day': 3, 'max_orders_per_day': 10,
    'min_reward_risk': 1.0, 'require_stop': True, 'no_entries_before': '09:45', 'no_entries_after': '15:30',
    'flat_by': '15:55', 'fractional': False, 'broker': 'alpaca', 'paper': True, 'blocked': [],
    'allow_options': False, 'allow_margin': False, 'allow_short': False, 'pdt_guard': False,
}


class ToolError(RuntimeError):
    pass


def sec_user_agent():
    return os.environ.get('SEC_USER_AGENT', 'FinEngine data job admin@example.com')


def run_tool(tool, args, cwd, timeout=240):
    """Run one skill tool with --json and return its parsed output. Exit code 1
    means "nothing found" for several tools, so the JSON on stdout decides."""
    # UTF-8 mode: on Windows the default code page (cp1252) can't hold every headline
    env = dict(os.environ, SEC_USER_AGENT=sec_user_agent(), PYTHONIOENCODING='utf-8', PYTHONUTF8='1')
    p = subprocess.run([sys.executable, os.path.join(SKILL, tool), *args, '--json'], cwd=cwd, env=env,
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    try:
        return json.loads(p.stdout)
    except ValueError:
        err = (p.stderr or p.stdout or '').strip().splitlines()
        raise ToolError(f'{tool}: {err[-1] if err else f"exit {p.returncode}"}')


def write_config(cwd, overrides=None):
    os.makedirs(os.path.join(cwd, 'trader', 'state'), exist_ok=True)
    cfg = dict(DEFAULT_CONFIG, sec_user_agent=sec_user_agent(), **(overrides or {}))
    with open(os.path.join(cwd, 'trader', 'config.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f)
    return cfg


# ── data ──────────────────────────────────────────────────────────────────────

_tm = None


def _timemachine_module():
    """The skill's own Yahoo client (query2 → query1 fallback, polite retry)."""
    global _tm
    if _tm is None:
        spec = importlib.util.spec_from_file_location('dts_timemachine', os.path.join(SKILL, 'trader-timemachine', 'timemachine.py'))
        _tm = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_tm)
    return _tm


def fetch_chart(sym):
    """Yahoo v8 chart JSON text, 60 days of 5-minute bars."""
    return _timemachine_module().fetch_chart(sym)


def read_chart(path):
    with (gzip.open if path.endswith('.gz') else open)(path, 'rt', encoding='utf-8') as f:
        return f.read()


def compact_bars(chart_text):
    """[[epoch, o, h, l, c, v], ...] from a Yahoo chart, regular-session bars only."""
    res = json.loads(chart_text)['chart']['result'][0]
    q = res['indicators']['quote'][0]
    out = []
    for i, t in enumerate(res.get('timestamp') or []):
        o, h, l, c, v = (q[k][i] for k in ('open', 'high', 'low', 'close', 'volume'))
        if c is None or o is None:
            continue
        et = datetime.fromtimestamp(t, ET)
        m = et.hour * 60 + et.minute
        if 570 <= m < 960 and m % 5 == 0:
            out.append([t, round(o, 4), round(h, 4), round(l, 4), round(c, 4), int(v or 0)])
    return out


def last_bar_close(bar_sets):
    """New York time of the newest COMPLETE 5-minute bar across the charts."""
    newest = max((b[-1][0] for b in bar_sets if b), default=None)
    if newest is None:
        return None
    close = datetime.fromtimestamp(newest, ET) + timedelta(minutes=5)
    now = datetime.now(ET)
    return min(close, now) if close.date() == now.date() else close


SCAN_FROM, SCAN_UNTIL = (9, 50), (15, 30)   # first bar after the 15-minute range closes; no_entries_after


def desk_clock(when, bar_sets):
    """The skill's scanner only runs between 9:50 AM (the first bar after the
    opening range) and 3:30 PM ET (the last time for new entries). Outside that
    window, replay a session as of 3:30 PM, as its error message suggests:
    the same day after 3:30, the previous session before 9:50.
    → (clock for the tools, note for the page or None)"""
    t = (when.hour, when.minute)
    if SCAN_FROM <= t <= SCAN_UNTIL:
        return when, None
    if t > SCAN_UNTIL:
        day, why = when.date(), 'after 3:30 PM ET (no new entries)'
    else:
        days = sorted({datetime.fromtimestamp(b[0], ET).date() for bars in bar_sets for b in bars})
        earlier = [d for d in days if d < when.date()]
        if not earlier:
            return when, None
        day, why = earlier[-1], 'before 9:50 AM ET (the opening range is still forming)'
    replay = datetime(day.year, day.month, day.day, *SCAN_UNTIL, tzinfo=ET)
    return replay, f"It's {why}: showing {day:%a %d %b}'s session as of 3:30 PM ET."


# ── the desk ──────────────────────────────────────────────────────────────────

def _lean_tm(doc):
    """Drop the per-path samples (large); keep the bands for the fan chart."""
    mc = dict(doc.get('mc') or {})
    mc.pop('sample_paths', None)
    return dict(doc, mc=mc)


def plan_symbol(cwd, sym, chart_path, now_txt, target=TARGET, stop=STOP):
    """entry → exit → Time Machine for one symbol, as the skill chains them."""
    out = {'symbol': sym}
    entry = run_tool('trader-entry/entry.py', ['check', sym, '--offline', chart_path, '--now', now_txt], cwd)
    out['entry'] = entry
    if entry.get('status') != 'triggered':
        return out
    rng, trig = entry['opening_range'], entry['trigger']
    plan = run_tool('trader-exit/exit.py', ['plan', '--symbol', sym, '--entry', str(trig['price']),
                                            '--or-high', str(rng['high']), '--or-low', str(rng['low']),
                                            '--setup', 'orb', '--date', entry['date'], '--stop', stop, '--target', target,
                                            '--now', now_txt], cwd)
    if plan.get('stop') is None:
        out['plan'] = plan
        return out
    # Given prices on the command line, exit.py doesn't know the entry bar; carry it
    # over from the entry check, as exit.py does itself when it reads trader/entry.json
    plan['entry_time'] = plan.get('entry_time') or trig['time']
    if plan.get('entry_bar') is None:
        plan['entry_bar'] = trig.get('bar_index')
    out['plan'] = plan
    out['timemachine'] = _lean_tm(run_tool('trader-timemachine/timemachine.py', [
        'run', '--symbol', sym, '--date', plan.get('date') or entry['date'], '--entry', str(plan['entry']),
        '--stop', str(plan['stop']), '--target', str(plan['target']),
        '--entry-time', plan['entry_time'], '--offline', chart_path, '--now', now_txt], cwd))
    return out


def congress(cwd, offline_index=None, detail=PTR_DETAIL):
    year = datetime.now(ET).year
    args = ['index', '--year', str(year), '--limit', '40'] + (['--offline', offline_index] if offline_index else [])
    filings = run_tool('trader-pelosi/ptr.py', args, cwd)
    reports = []
    if not offline_index:
        for f in filings[:detail]:              # read the newest PTRs row by row (needs pdftotext)
            try:
                reports.append(run_tool('trader-pelosi/ptr.py', ['fetch', f['doc_id'], '--year', str(f['year']), '--filed', f['filed']], cwd))
            except ToolError as e:
                reports.append({'doc_id': f['doc_id'], 'name': f['name'], 'error': str(e)})
    return {'filings': filings, 'reports': reports}


def build_desk(cwd, symbols=None, charts=None, now=None, live_sources=True, offline=None, log=print):
    """→ (desk dict, {symbol: compact bars}).

    charts: {symbol: chart JSON text}; fetched from Yahoo when None.
    now: New York datetime to pin the clock (default: the newest complete bar).
    offline: {'news': DIR, 'analyst': DIR, 'pelosi': FILE} for tests (skips the network).
    """
    symbols = symbols or WATCHLIST
    offline = offline or {}
    write_config(cwd)
    chart_dir = os.path.join(cwd, 'charts')
    os.makedirs(chart_dir, exist_ok=True)
    errors, bars = [], {}
    for sym in symbols:
        try:
            text = charts[sym] if charts is not None else fetch_chart(sym)
            with open(os.path.join(chart_dir, f'{sym}.json'), 'w', encoding='utf-8') as f:
                f.write(text)
            bars[sym] = compact_bars(text)
        except Exception as e:
            errors.append(f'chart {sym}: {e}')
    if not bars:
        raise ToolError('no charts: ' + '; '.join(errors[:3]))
    when = now or last_bar_close(bars.values())
    clock_at, replay_note = desk_clock(when, bars.values())
    now_txt = clock_at.strftime('%Y-%m-%d %H:%M')
    have = [s for s in symbols if s in bars]
    log(f'desk: {len(have)} charts, data to {when:%Y-%m-%d %H:%M} ET, desk clock {now_txt} ET')

    desk = {'as_of': now_txt, 'data_as_of': when.strftime('%Y-%m-%d %H:%M'), 'replay_note': replay_note, 'symbols': have, 'target_rule': TARGET, 'stop_rule': STOP,
            'config': dict(DEFAULT_CONFIG), 'plans': {}, 'errors': errors}
    try:
        desk['clock'] = run_tool('trader-alerts/alerts.py', ['clock', '--now', when.strftime('%Y-%m-%d %H:%M')], cwd)
    except ToolError as e:
        errors.append(f'clock: {e}')
    try:    # one failing tool must not blank the whole desk
        desk['scan'] = run_tool('trader-scanner/scan.py', ['orb', '--offline', chart_dir, '--symbols', ','.join(have),
                                                           '--now', now_txt, '--out', 'trader/watchlist.json'], cwd)
    except ToolError as e:
        errors.append(f'scanner: {e}')
        desk['scan'] = {'hits': [], 'scanned': 0, 'note': str(e)}
    try:
        args = ['daily', '--symbols', ','.join(have), '--out', 'trader/daily.json']
        desk['daily'] = run_tool('trader-scanner/scan.py', args + ([] if live_sources else ['--offline', chart_dir, '--now', now_txt]), cwd)
    except ToolError as e:
        errors.append(f'daily scan: {e}')

    hits = [h['symbol'] for h in desk['scan'].get('hits', [])]
    for sym in hits[:MAX_PLANS]:
        try:
            desk['plans'][sym] = plan_symbol(cwd, sym, os.path.join(chart_dir, f'{sym}.json'), now_txt)
        except (ToolError, subprocess.TimeoutExpired) as e:
            errors.append(f'plan {sym}: {e}')

    focus = hits[:MAX_PLANS] or have[:6]
    if live_sources or offline.get('news'):
        try:
            args = ['--tickers', *focus, '--all', '--hours', '24', '--state', 'trader/state/news.json']
            if offline.get('news'):
                args += ['--offline', offline['news'], '--now', when.astimezone(timezone.utc).isoformat()]
            desk['news'] = run_tool('trader-news/news.py', args, cwd)
        except ToolError as e:
            errors.append(f'news: {e}')
    if live_sources or offline.get('analyst'):
        try:
            desk['analyst'] = run_tool('trader-analyst/facts.py', [*focus, '--quarters', '6']
                                       + (['--offline', offline['analyst']] if offline.get('analyst') else []), cwd)
        except ToolError as e:
            errors.append(f'analyst: {e}')
    if live_sources or offline.get('pelosi'):
        try:
            desk['congress'] = congress(cwd, offline.get('pelosi'))
        except ToolError as e:
            errors.append(f'congress: {e}')
    return desk, {s: bars[s] for s in set(hits[:MAX_PLANS]) | set(have[:6]) if s in bars}


# ── sizing and the risk check, with the user's numbers ───────────────────────

def size_and_check(cwd, plan, settings, now_txt=None):
    """trader-budget then trader-risk on one plan, with the user's budget and
    limits. → {'sizing': ..., 'orders': ..., 'risk': ...}"""
    allowed = {k: settings[k] for k in DEFAULT_CONFIG if k in settings}
    write_config(cwd, allowed)
    with open(os.path.join(cwd, 'trader', 'plan.json'), 'w', encoding='utf-8') as f:
        json.dump(plan, f)
    clock = ['--now', now_txt] if now_txt else []
    sized = run_tool('trader-budget/size.py', ['--write', *clock], cwd)
    out = {'sizing': sized.get('sizing'), 'orders': sized.get('orders')}
    if sized.get('orders'):
        out['risk'] = run_tool('trader-risk/check.py', ['--no-write', *clock], cwd)
    return out
