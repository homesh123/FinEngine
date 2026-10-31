"""The day-trader-skill's rules for any exchange session: used for India (NSE).

The skill (vendor/day-trader-skill) is built for the NYSE: its tools hard-code
9:30-16:00 New York time. For NSE stocks this module applies the same rules
with the session as a parameter, function for function:

    scan / entry   scan.py orb + entry.py check   first completed 5-minute bar after the
                                                  15-minute opening range to CLOSE above its high
    plan           exit.py plan                   or-mid / or-low stop (rounded down to the
                                                  paisa/cent), target = entry + R x risk
    time_machine   timemachine.py                 build_pool / simulate / history_replay / verdict,
                                                  same random draws (random.Random(seed), choice,
                                                  randint) in the same order
    daily_setups   scan.py daily                  20-day breakout, bull flag, reclaim MA20,
                                                  oversold, oversold bounce

scripts/test_market_desk.py runs it with the NYSE session on the skill's recorded
TSLA day and checks it reproduces the skill's own output exactly.
"""
import json
import math
import random
import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BAR_SEC = 300
SAMPLE_PATHS, BAND_PATHS, BAND_Q, HIST_BINS = 160, 2000, (0.05, 0.25, 0.5, 0.75, 0.95), 24
COIN_FLIP, STRONG, MANY_NEITHER, MIN_SESSIONS = 0.05, 0.15, 0.40, 20


@dataclass(frozen=True)
class Session:
    name: str
    tz: str
    open_min: int            # minutes after midnight, local time
    close_min: int
    no_entries_before: str
    no_entries_after: str
    flat_by: str
    currency: str
    or_minutes: int = 15

    @property
    def bars(self):
        return (self.close_min - self.open_min) // 5

    @property
    def zone(self):
        return ZoneInfo(self.tz)


NYSE = Session('NYSE', 'America/New_York', 9 * 60 + 30, 16 * 60, '09:45', '15:30', '15:55', 'USD')
NSE = Session('NSE', 'Asia/Kolkata', 9 * 60 + 15, 15 * 60 + 30, '09:30', '15:00', '15:25', 'INR')


def hhmm(text):
    h, m = text.split(':')
    return int(h) * 60 + int(m)


def clock12(minutes):
    h, m = divmod(minutes, 60)
    return '%d:%02d %s' % ((h - 1) % 12 + 1, m, 'AM' if h < 12 else 'PM')


def clock24(minutes):
    return '%02d:%02d' % divmod(minutes, 60)


# ── bars ──────────────────────────────────────────────────────────────────────

def parse_chart(text, s, now):
    """Yahoo v8 chart JSON → regular-session 5-minute bars complete at `now`
    (aware datetime), oldest first: {date, slot, start, o, h, l, c, v}. As the
    skill's parse_bars: no price, off the grid, outside hours, or not complete → dropped."""
    res = json.loads(text)['chart']['result'][0]
    meta = res.get('meta') or {}
    q = ((res.get('indicators') or {}).get('quote') or [{}])[0] or {}
    cols = [q.get(k) or [] for k in ('open', 'high', 'low', 'close', 'volume')]
    as_of = now.astimezone(timezone.utc)
    rmt = meta.get('regularMarketTime')
    if isinstance(rmt, (int, float)):
        as_of = min(as_of, datetime.fromtimestamp(rmt, timezone.utc))
    out = {}
    for i, ts in enumerate(res.get('timestamp') or []):
        o, h, l, c, v = [col[i] if i < len(col) else None for col in cols]
        if ts is None or None in (o, h, l, c) or int(ts) % BAR_SEC:
            continue
        start = datetime.fromtimestamp(int(ts), timezone.utc)
        local = start.astimezone(s.zone)
        mins = local.hour * 60 + local.minute - s.open_min
        if mins < 0 or mins >= s.bars * 5 or start + timedelta(seconds=BAR_SEC) > as_of:
            continue
        out[int(ts)] = {'date': local.date().isoformat(), 'slot': mins // 5, 'start': local.strftime('%H:%M'),
                        'o': o, 'h': h, 'l': l, 'c': c, 'v': v or 0}
    return [out[t] for t in sorted(out)]


def split_sessions(bars):
    days = {}
    for b in bars:
        days.setdefault(b['date'], {})[b['slot']] = b
    return days


def full_sessions(days, before, s):
    return [(d, [days[d][i] for i in range(s.bars)]) for d in sorted(days)
            if d < before and len(days[d]) == s.bars]


# ── scanner + entry timer (orb) ───────────────────────────────────────────────

def opening_range(D, n):
    rows = [D[i] for i in range(n)]
    return max(b['h'] for b in rows), min(b['l'] for b in rows)


def entry_check(sym, bars, s, now):
    """entry.py check --setup orb, for one symbol at `now` (aware, local time)."""
    local = now.astimezone(s.zone)
    day = local.date().isoformat()
    D = split_sessions(bars).get(day, {})
    n = s.or_minutes // 5
    out = {'symbol': sym, 'setup': 'orb', 'side': 'buy', 'date': day, 'interval': '5m', 'or_minutes': s.or_minutes,
           'now': local.strftime('%Y-%m-%d %H:%M'), 'no_entries_before': s.no_entries_before,
           'no_entries_after': s.no_entries_after, 'opens': clock24(s.open_min), 'closes': clock24(s.close_min)}
    if not D:
        return dict(out, status='no-data', reason='no bars for today: the market is closed or Yahoo sent none')
    if not all(i in D for i in range(n)):
        return dict(out, status='waiting', reason='the opening range is still forming')
    oh, ol = opening_range(D, n)
    out['opening_range'] = {'high': round(oh, 2), 'low': round(ol, 2), 'minutes': s.or_minutes, 'bars': n,
                            'complete': True, 'avg_volume': round(sum(D[i]['v'] for i in range(n)) / n)}
    out['level'] = round(oh, 2)
    last_ok = (hhmm(s.no_entries_after) - s.open_min) // 5 - 1    # the last bar that closes by no_entries_after
    for i in range(n, max(D) + 1):
        b = D.get(i)
        if b is None or i > last_ok:
            break
        if b['c'] > oh:
            close_min = s.open_min + 5 * (i + 1)
            vx = round(b['v'] / out['opening_range']['avg_volume'], 1) if out['opening_range']['avg_volume'] else None
            out['trigger'] = {'time': clock12(close_min), 'close_time': clock24(close_min), 'bar_start': b['start'],
                              'bar_index': i, 'price': round(b['c'], 2), 'close': b['c'], 'volume': b['v'],
                              'volume_x': vx, 'pct_over': round((b['c'] / oh - 1) * 100, 2)}
            return dict(out, status='triggered', reason='the %s bar closed above the range high' % b['start'])
    lb = D[max(D)]
    out['last'] = {'bar_start': lb['start'], 'close': round(lb['c'], 2), 'vs_level_pct': round((lb['c'] / oh - 1) * 100, 2)}
    if local.hour * 60 + local.minute >= hhmm(s.no_entries_after):
        return dict(out, status='expired', reason='no close above the range high by %s' % s.no_entries_after)
    return dict(out, status='waiting', reason='no 5-minute close above the range high yet')


# ── exit planner ──────────────────────────────────────────────────────────────

def cents_away(x, long=True):
    c = round(x * 100, 4)
    return (math.floor(c) if long else math.ceil(c)) / 100.0


def round_half_up(x):
    return math.floor(x * 100 + 0.5 + 1e-9) / 100.0


def plan(entry, s, stop_rule='or-mid', target='2R'):
    """exit.py plan for a triggered orb entry. → plan dict, or {'refused': reason}."""
    t, rng = entry['trigger'], entry['opening_range']
    e, oh, ol = t['price'], rng['high'], rng['low']
    if stop_rule == 'or-low':
        stop, label, detail = cents_away(ol), 'opening-range low', '$%.2f, the range low' % ol
    else:
        stop = cents_away((oh + ol) / 2)
        label, detail = 'opening-range midpoint', '(%.2f + %.2f) / 2 = %.3f, rounded down' % (oh, ol, (oh + ol) / 2)
    risk = round(e - stop, 2)
    if risk <= 0:
        return {'refused': 'the stop %.2f is not below the entry %.2f' % (stop, e)}
    if risk < e * 0.0005:
        return {'refused': 'the stop is %.2f under the entry, less than 0.05%% of the price: too tight' % risk}
    r = float(target.rstrip('R'))
    tgt = round_half_up(e + r * risk)
    return {'created_by': 'finengine market_desk (trader-exit rules)', 'symbol': entry['symbol'], 'side': 'buy',
            'date': entry['date'], 'setup': 'orb', 'entry': e, 'entry_time': t['time'], 'entry_bar': t['bar_index'],
            'interval': '5m', 'opening_range': {'high': oh, 'low': ol, 'minutes': rng['minutes']},
            'stop': stop, 'stop_rule': stop_rule.replace('-', '_'), 'stop_label': label, 'stop_detail': detail,
            'target': tgt, 'target_r': r, 'target_label': '%gR (%g times the risk)' % (r, r),
            'risk_per_share': risk, 'reward_risk': r, 'flat_by': s.flat_by, 'warnings': [],
            'note': 'A stop is a plan, not a guarantee: a gap or a fast market can fill past it.'}


# ── time machine ──────────────────────────────────────────────────────────────

def build_pool(sessions, s):
    pool = [[] for _ in range(s.bars)]
    for _, D in sessions:
        for i in range(1, s.bars):
            pc = D[i - 1]['c']
            pool[i].append((D[i]['o'] / pc, D[i]['h'] / pc, D[i]['l'] / pc, D[i]['c'] / pc))
    return pool


def pct(a, q):
    return a[min(len(a) - 1, int(q * len(a)))]


def simulate(pool, entry, stop, target, k, last, s, replays=10000, seed=19, window=2):
    """timemachine.py simulate() for a long trade, same draws in the same order."""
    nb = s.bars
    risk = entry - stop
    r_target = round((target - entry) / risk, 4)

    def slot(rng, i):
        return i if window == 0 else min(nb - 1, max(1, i + rng.randint(-window, window)))

    rng = random.Random(seed)
    choice = rng.choice
    outcomes, closes = [], []
    for _ in range(replays):
        p, outcome = entry, None
        for i in range(k + 1, last + 1):
            o, h, l, c = choice(pool[slot(rng, i)])
            hi, lo, cl = p * h, p * l, p * c
            if outcome is None:
                if lo <= stop:
                    outcome = 'stop'
                elif hi >= target:
                    outcome = 'target'
            p = cl
        outcomes.append(outcome or 'close')
        closes.append(p)
    cnt = {x: outcomes.count(x) for x in ('target', 'stop', 'close')}
    green = sum(1 for o, p in zip(outcomes, closes) if o == 'target' or (o == 'close' and p > entry))
    Rs = [r_target if o == 'target' else -1.0 if o == 'stop' else (p - entry) / risk for o, p in zip(outcomes, closes)]
    srt = sorted(closes)
    rng = random.Random(seed)       # the fan chart: a second run of 2,000 paths, same seed
    choice = rng.choice
    allp = []
    for _ in range(BAND_PATHS):
        p, path = entry, [entry]
        for i in range(k + 1, last + 1):
            o, h, l, c = choice(pool[slot(rng, i)])
            p = p * c
            path.append(p)
        allp.append(path)
    bands = [[round(pct(sorted(pp[j] for pp in allp), q), 2) for q in BAND_Q] for j in range(last - k + 1)]
    return {
        'replays': replays, 'seed': seed, 'window': window, 'bars_left': last - k,
        'p_target': round(cnt['target'] / replays, 4), 'p_stop': round(cnt['stop'] / replays, 4),
        'p_neither': round(cnt['close'] / replays, 4), 'p_green': round(green / replays, 4),
        'median_close': round(pct(srt, 0.5), 2), 'p5_close': round(pct(srt, 0.05), 2),
        'p95_close': round(pct(srt, 0.95), 2), 'avg_R': round(statistics.mean(Rs), 3),
        'r_at_target': r_target, 'band_paths': BAND_PATHS, 'bands': bands,
    }


def history_replay(sessions, rule, last, s):
    """timemachine.py history_replay() for a long orb rule."""
    n = rule['or_minutes'] // 5
    trades = []
    for d, D in sessions:
        oh, ol = opening_range(D, n)
        kk = next((i for i in range(n, last + 1) if D[i]['c'] > oh), None)
        if kk is None:
            continue
        e = round(D[kk]['c'], 2)
        st = cents_away((oh + ol) / 2) if rule['stop_rule'] == 'or_mid' else cents_away(ol)
        risk = e - st
        if risk <= 0:
            continue
        t = round(e + rule['target_r'] * risk, 2)
        oc = None
        for b in D[kk + 1:last + 1]:
            if b['l'] <= st:
                oc = 'stop'
                break
            if b['h'] >= t:
                oc = 'target'
                break
        cl = D[last]['c']
        R = (t - e) / risk if oc == 'target' else -1.0 if oc == 'stop' else (cl - e) / risk
        trades.append({'date': d, 'time': clock12(s.open_min + 5 * (kk + 1)), 'entry': e, 'stop': st, 'target': t,
                       'outcome': oc or 'close', 'R': round(R, 2)})
    return {
        'sessions': len(sessions), 'triggered': len(trades),
        'target': sum(1 for x in trades if x['outcome'] == 'target'),
        'stop': sum(1 for x in trades if x['outcome'] == 'stop'),
        'close': sum(1 for x in trades if x['outcome'] == 'close'),
        'green': sum(1 for x in trades if x['R'] > 0),
        'avg_R': round(statistics.mean(x['R'] for x in trades), 3) if trades else None,
        'rule': rule, 'trades': trades,
    }


def verdict(mc, until):
    pt, ps = mc['p_target'], mc['p_stop']
    if pt + ps <= 0:
        return 'No replay reached the target or the stop by %s: the price at %s decides every one.' % (until, until)
    r = mc.get('r_at_target') or 1.0
    share, even = pt / (pt + ps), 1.0 / (1.0 + r)
    d = share - even
    one_r = abs(r - 1.0) < 0.005
    if abs(d) < COIN_FLIP:
        head = 'Close to a coin flip' if one_r else 'Close to break-even'
    elif abs(d) < STRONG:
        head = 'Leans toward the target' if d > 0 else 'Leans toward the stop'
    else:
        head = 'Strongly toward the target' if d > 0 else 'Strongly toward the stop'
    odds = 'target first %.1f %% vs stop first %.1f %%' % (100 * pt, 100 * ps)
    if one_r:
        return '%s: %s.' % (head, odds)
    return ('%s: at %gR the target has to come first in %.0f %% of the replays that hit one side; '
            'it did in %.0f %% (%s).' % (head, round(r, 2), 100 * even, 100 * share, odds))


def verdict_notes(mc, until):
    notes = []
    pt, ps = mc['p_target'], mc['p_stop']
    if mc.get('p_neither', 0) > MANY_NEITHER and pt + ps > 0:
        notes.append('%.1f %% of the replays hit neither by %s; the price at %s decides those.'
                     % (100 * mc['p_neither'], until, until))
    if pt + ps > 0:
        r = mc.get('r_at_target') or 1.0
        d = pt / (pt + ps) - 1.0 / (1.0 + r)
        avg = mc.get('avg_R')
        if abs(d) >= COIN_FLIP and avg and (avg > 0) != (d > 0):
            notes.append('Average R is %+.3f all the same: the replays that hit neither pull it the other way.' % avg)
    return notes


def time_machine(bars, p, s, replays=10000, seed=19, window=2):
    """timemachine.py run for a plan from plan(), over the session to the close."""
    days = split_sessions(bars)
    sessions = full_sessions(days, p['date'], s)
    if len(sessions) < MIN_SESSIONS:
        raise ValueError('only %d full sessions before %s; the time machine needs %d' % (len(sessions), p['date'], MIN_SESSIONS))
    k, last = p['entry_bar'], s.bars - 1
    until = clock12(s.close_min)
    mc = simulate(build_pool(sessions, s), p['entry'], p['stop'], p['target'], k, last, s, replays, seed, window)
    mc.update(until=clock24(s.close_min), pool_sessions=len(sessions), pool_from=sessions[0][0], pool_to=sessions[-1][0],
              band_times=[clock24(s.open_min + 5 * (j + 1)) for j in range(k, last + 1)])
    rule = {'setup': 'orb', 'or_minutes': p['opening_range']['minutes'], 'stop_rule': p['stop_rule'], 'target_r': p['target_r']}
    return {'created_by': 'finengine market_desk (trader-timemachine rules)', 'plan': p, 'mc': mc,
            'history': history_replay(sessions, rule, last, s), 'verdict': verdict(mc, until),
            'verdict_notes': verdict_notes(mc, until)}


# ── daily setups (scan.py daily) ──────────────────────────────────────────────

def rsi(closes, n=14):
    """scan.py rsi(): Wilder's RSI on closes, the last value."""
    if len(closes) < n + 1:
        return None
    g = [max(0.0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    lo = [max(0.0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    ag, al = sum(g[:n]) / n, sum(lo[:n]) / n
    for i in range(n, len(g)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + lo[i]) / n
    return 100 - 100 / (1 + ag / al) if al else 100.0


def daily_setups(closes):
    """scan.py find_setups(): daily closes, oldest first, completed sessions only (>= 30)."""
    c = closes
    if len(c) < 30:
        return []
    last = c[-1]
    run = c[-6] / c[-16] - 1
    rng5 = (max(c[-5:]) - min(c[-5:])) / last
    r, r_prev = rsi(c), rsi(c[:-1])
    tags = []
    if last > max(c[-21:-1]):
        tags.append('breakout_20d')
    if run > 0.10 and rng5 < 0.05:
        tags.append('bull_flag')
    if c[-2] < sum(c[-21:-1]) / 20.0 and last > sum(c[-20:]) / 20.0:
        tags.append('reclaim_ma20')
    if r is not None and r < 30:
        tags.append('oversold')
    if r_prev is not None and r_prev < 30 and last > c[-2]:
        tags.append('oversold_bounce')
    return tags


# ── the India desk ────────────────────────────────────────────────────────────

import os  # noqa: E402
import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.parse  # noqa: E402
import urllib.request  # noqa: E402

YAHOO_HOSTS = ('query2', 'query1')
UA = 'Mozilla/5.0 (compatible; FinEngine; +https://github.com/homesh123/FinEngine)'


def chart_url(yahoo_symbol, host='query2'):
    """Like the skill's chart_url, but the symbol is used as given: the skill turns '.'
    into '-' for US class shares (BRK.B → BRK-B), which would break 'RELIANCE.NS'."""
    return 'https://%s.finance.yahoo.com/v8/finance/chart/%s?range=60d&interval=5m' % (
        host, urllib.parse.quote(yahoo_symbol.upper(), safe=''))


def fetch_chart(yahoo_symbol, pause=1.0):
    """60 days of 5-minute bars, as the skill fetches them: query2 first, one retry
    after a 429, then query1 on 429 or 5xx."""
    last = None
    for n, host in enumerate(YAHOO_HOSTS):
        if n:
            time.sleep(pause)
        for attempt in (0, 1):
            req = urllib.request.Request(chart_url(yahoo_symbol, host), headers={'User-Agent': UA, 'Accept': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    return r.read().decode('utf-8', 'replace')
            except urllib.error.HTTPError as e:
                last = e.code
                if e.code == 429 and attempt == 0:
                    time.sleep(pause * 3)
                    continue
                if e.code == 429 or e.code >= 500:
                    break
                raise ValueError('Yahoo answered HTTP %d for %s' % (e.code, yahoo_symbol))
    raise ValueError('Yahoo answered HTTP %s for %s on both hosts' % (last, yahoo_symbol))

# Liquid NIFTY 50 names (NSE symbols; Yahoo adds .NS). DT_WATCHLIST_IN overrides.
IN_WATCHLIST = [x.strip().upper() for x in os.environ.get('DT_WATCHLIST_IN', ','.join([
    'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'BHARTIARTL', 'SBIN', 'ITC', 'LT', 'AXISBANK',
    'KOTAKBANK', 'BAJFINANCE', 'HINDUNILVR', 'MARUTI', 'SUNPHARMA', 'TITAN', 'NTPC', 'M&M', 'TATASTEEL',
    'ADANIENT', 'HCLTECH', 'WIPRO', 'POWERGRID', 'BEL',
])).split(',') if x.strip()]

IN_CONFIG = {   # trader-budget's defaults, scaled to rupees
    'budget': 100000, 'cash_buffer_pct': 10, 'max_position_pct': 75, 'max_order_usd': 80000, 'min_order_usd': 100,
    'max_loss_per_trade_usd': 1000, 'max_daily_loss_usd': 3000, 'max_trades_per_day': 3, 'max_orders_per_day': 10,
    'min_reward_risk': 1.0, 'require_stop': True, 'no_entries_before': NSE.no_entries_before,
    'no_entries_after': NSE.no_entries_after, 'flat_by': NSE.flat_by,
}


def desk_clock(when, days, s):
    """Pin the clock inside the scanner's window (first bar after the range closes →
    no_entries_after); outside it, replay a session as of no_entries_after."""
    first = s.open_min + s.or_minutes + 5
    until = hhmm(s.no_entries_after)
    t = when.hour * 60 + when.minute
    if first <= t <= until:
        return when, None
    if t > until:
        day, why = when.date(), 'after %s %s (no new entries)' % (clock12(until), s.tz.split('/')[-1])
    else:
        earlier = [d for d in sorted(days) if d < when.date().isoformat()]
        if not earlier:
            return when, None
        y, m, dd = map(int, earlier[-1].split('-'))
        day, why = datetime(y, m, dd).date(), 'before %s (the opening range is still forming)' % clock12(first)
    at = datetime(day.year, day.month, day.day, until // 60, until % 60, tzinfo=s.zone)
    return at, "It's %s: showing %s's session as of %s." % (why, day.strftime('%a %d %b'), clock12(until))


def build_india_desk(symbols=None, charts=None, now=None, news=True, log=print, keep_charts=None):
    """→ (desk dict, {symbol: compact bars}) for NSE, in the US desk's shape."""
    import skill_desk
    s = NSE
    symbols = symbols or IN_WATCHLIST
    texts, errors = {}, []
    for sym in symbols:
        try:
            texts[sym] = charts[sym] if charts is not None else fetch_chart(f'{sym}.NS')
        except Exception as e:
            errors.append(f'chart {sym}: {e}')
    if not texts:
        raise ValueError('no charts: ' + '; '.join(errors[:3]))
    if keep_charts is not None:     # the live API re-plans from these without fetching again
        keep_charts.clear()
        keep_charts.update(texts)
    real_now = now or datetime.now(s.zone)
    parsed = {sym: parse_chart(t, s, real_now) for sym, t in texts.items()}
    parsed = {k: v for k, v in parsed.items() if v}
    if not parsed:
        raise ValueError('no complete NSE bars in the charts')
    newest = max(b[-1] for b in parsed.values() if b)
    y, m, d = map(int, newest['date'].split('-'))
    hh, mm = map(int, newest['start'].split(':'))
    when = min(datetime(y, m, d, hh, mm, tzinfo=s.zone) + timedelta(minutes=5), real_now.astimezone(s.zone))
    all_days = {b['date'] for bars in parsed.values() for b in bars}
    at, note = desk_clock(when, all_days, s)
    log(f'india desk: {len(parsed)} charts, data to {when:%Y-%m-%d %H:%M} IST, desk clock {at:%Y-%m-%d %H:%M} IST')

    open_now = when.date().isoformat() in all_days and s.open_min <= when.hour * 60 + when.minute < s.close_min
    desk = {'market': 'IN', 'exchange': 'NSE', 'currency': 'INR', 'tz': s.tz,
            'as_of': at.strftime('%Y-%m-%d %H:%M'), 'data_as_of': when.strftime('%Y-%m-%d %H:%M'), 'replay_note': note,
            'symbols': list(parsed), 'target_rule': '2R', 'stop_rule': 'or-mid', 'config': dict(IN_CONFIG),
            'clock': {'open': open_now, 'reason': 'regular session' if open_now else 'outside NSE hours',
                      'date': when.date().isoformat(), 'opens': clock24(s.open_min), 'closes': clock24(s.close_min)},
            'plans': {}, 'errors': errors,
            'engine': 'FinEngine port of the day-trader-skill rules (NSE session)'}

    hits, daily = [], []
    for sym, bars in parsed.items():
        visible = [b for b in bars if b['date'] < at.date().isoformat()
                   or (b['date'] == at.date().isoformat() and b['start'] < at.strftime('%H:%M'))]
        try:
            e = entry_check(sym, visible, s, at)
        except Exception as ex:
            errors.append(f'entry {sym}: {ex}')
            continue
        if e['status'] == 'triggered':
            t = e['trigger']
            hits.append({'symbol': sym, 'setups': ['orb'], 'price': t['price'], 'at': t['time'], 'bar_start': t['bar_start'],
                         'bar_index': t['bar_index'], 'or_high': e['opening_range']['high'],
                         'or_low': e['opening_range']['low'], 'pct_over': t['pct_over']})
            p = plan(e, s)
            entry_plan = {'symbol': sym, 'entry': e}
            if 'refused' in p:
                entry_plan['plan'] = {'warnings': [p['refused']]}
            else:
                entry_plan['plan'] = p
                try:
                    entry_plan['timemachine'] = time_machine(bars, p, s)
                except ValueError as ex:
                    errors.append(f'time machine {sym}: {ex}')
            desk['plans'][sym] = entry_plan
        closes = [D[max(D)]['c'] for dd, D in sorted(split_sessions(visible).items())
                  if dd < at.date().isoformat() or at.hour * 60 + at.minute >= s.close_min]
        tags = daily_setups(closes)
        if tags:
            daily.append({'symbol': sym, 'price': round(closes[-1], 2), 'setups': tags})
    hits.sort(key=lambda h: h['bar_index'])
    desk['scan'] = {'mode': 'orb', 'as_of': desk['as_of'], 'scanned': len(parsed), 'or_minutes': s.or_minutes, 'hits': hits,
                    'note': 'A scan is a list of charts that match a rule, not a list of stocks to buy.'}
    desk['daily'] = {'mode': 'daily', 'as_of': 'the last completed session', 'hits': daily}

    if news:
        items, moves = [], []
        import yfinance as yf
        for sym in [h['symbol'] for h in hits][:8] or list(parsed)[:6]:
            try:
                for it in (yf.Ticker(f'{sym}.NS').news or [])[:5]:
                    c = it.get('content') or it
                    link = (c.get('clickThroughUrl') or {}).get('url') or (c.get('canonicalUrl') or {}).get('url') or c.get('link')
                    if c.get('title'):
                        items.append({'id': f"{sym}:{c.get('id') or link}", 'source': (c.get('provider') or {}).get('displayName') or 'Yahoo Finance',
                                      'kind': 'headline', 'ticker': sym, 'title': c['title'], 'summary': (c.get('summary') or '')[:280],
                                      'link': link, 'time': c.get('pubDate') or c.get('displayTime'), 'touches': [sym], 'tags': []})
            except Exception as ex:
                errors.append(f'news {sym}: {ex}')
            days = split_sessions(parsed[sym])
            ds = sorted(days)
            if len(ds) >= 2:
                last, prev = days[ds[-1]], days[ds[-2]]
                price, pc = last[max(last)]['c'], prev[max(prev)]['c']
                moves.append({'ticker': sym, 'price': round(price, 2), 'prev_close': round(pc, 2),
                              'pct': round((price / pc - 1) * 100, 2), 'moving': abs(price / pc - 1) >= 0.02})
        desk['news'] = {'items': items, 'moves': moves,
                        'notes': ['NSE: Yahoo Finance headlines only (no SEC 8-Ks for Indian companies).']}

    compact = {}
    for sym in set([h['symbol'] for h in hits] + list(parsed)[:6]):
        compact[sym] = skill_desk.compact_bars_tz(texts[sym], s.zone, s.open_min, s.close_min)
    return desk, compact
