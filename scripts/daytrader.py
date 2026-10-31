"""Day Trader desk snapshot, following the day-trader-skill workflow
(scanner → news → entry → exit → time machine → size → risk → order → alerts,
plus earnings analyst and congress tracker).

Free public data only: Yahoo Finance 5-minute bars (via yfinance), SEC EDGAR
(filings, XBRL company facts) and the House Clerk's financial-disclosure index.
Sizing, risk checks, paper orders, alerts and the 10,000-path Time Machine run in
the browser on top of this snapshot (src/utils/dayTrader.js).
"""
import io
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import yfinance as yf

from common import atr, http_bytes, http_json, num, rsi

WATCHLIST = [s.strip().upper() for s in os.environ.get(
    'DT_WATCHLIST', 'NVDA,TSLA,AAPL,MSFT,META,AMD,AMZN,GOOGL,PLTR,SPY,QQQ').split(',') if s.strip()]
ETFS = {'SPY', 'QQQ', 'IWM', 'DIA'}
ET_TZ = 'America/New_York'
OR_BARS = 3            # opening range = first 15 minutes (3 × 5-minute bars)
BARS_PER_DAY = 78      # 09:30–16:00 in 5-minute bars


# ── prices ────────────────────────────────────────────────────────────────────

def load_intraday(symbol):
    df = yf.Ticker(symbol).history(period='60d', interval='5m', prepost=False, auto_adjust=False)
    if df is None or df.empty:
        raise ValueError('no 5-minute data')
    df = df.tz_convert(ET_TZ) if df.index.tz is not None else df.tz_localize('UTC').tz_convert(ET_TZ)
    t = df.index.hour * 60 + df.index.minute
    df = df[(t >= 570) & (t < 960)]                     # regular session only
    df = df[['Open', 'High', 'Low', 'Close', 'Volume']].dropna(subset=['Close'])
    df['session'] = df.index.date
    df['bar'] = (df.index.hour * 60 + df.index.minute - 570) // 5
    return df


def vwap(day):
    tp = (day['High'] + day['Low'] + day['Close']) / 3
    v = day['Volume'].replace(0, np.nan)
    return float((tp * v).sum() / v.sum()) if v.notna().any() else float(day['Close'].iloc[-1])


def relative_volume(df, today, last_bar):
    """Today's volume so far vs the average of prior sessions at the same time of day."""
    prior = df[(df['session'] != today) & (df['bar'] <= last_bar)].groupby('session')['Volume'].sum()
    now = df[(df['session'] == today)]['Volume'].sum()
    avg = prior.tail(20).mean()
    return float(now / avg) if avg else None


def bull_flag(day, atr5):
    """A sharp push (the pole) then a tight, shallow pause near its top."""
    if len(day) < 9 or not atr5:
        return None
    h, l, c = day['High'].values, day['Low'].values, day['Close'].values
    for flag_len in range(3, 9):
        p = len(day) - flag_len - 1                      # last bar of the pole
        if p < 3:
            break
        for pole_len in range(3, 7):
            s = p - pole_len
            if s < 0:
                break
            rise = h[p] - l[s]
            if rise < 2.5 * atr5 or c[p] <= c[s]:
                continue
            flag_lo, flag_hi = l[p + 1:].min(), h[p + 1:].max()
            if flag_hi <= h[p] * 1.001 and flag_lo >= h[p] - 0.5 * rise:
                return {'pole_low': round(float(l[s]), 2), 'pole_high': round(float(h[p]), 2),
                        'flag_low': round(float(flag_lo), 2), 'bars_in_flag': flag_len}
    return None


def scan_symbol(df):
    sessions = sorted(df['session'].unique())
    today = sessions[-1]
    day = df[df['session'] == today]
    prev_close = float(df[df['session'] == sessions[-2]]['Close'].iloc[-1]) if len(sessions) > 1 else None
    last = float(day['Close'].iloc[-1])
    a5 = float(atr(df).iloc[-1])
    r5 = rsi(df['Close'])
    or_slice = day.iloc[:OR_BARS]
    orh, orl = float(or_slice['High'].max()), float(or_slice['Low'].min())
    last_bar = int(day['bar'].iloc[-1])
    rvol = relative_volume(df, today, last_bar)
    vw = vwap(day)

    setups = []
    after = day.iloc[OR_BARS:]
    if len(after):
        up = after[after['Close'] > orh]
        dn = after[after['Close'] < orl]
        if len(up) and last > orh:
            setups.append({'type': 'orb_long', 'label': 'Opening-range breakout',
                           'detail': f'Closed above the 15-min high {orh:.2f} at {up.index[0].strftime("%H:%M")} ET'})
        elif len(dn) and last < orl:
            setups.append({'type': 'orb_short', 'label': 'Opening-range breakdown',
                           'detail': f'Closed below the 15-min low {orl:.2f} at {dn.index[0].strftime("%H:%M")} ET'})
    flag = bull_flag(day, a5)
    if flag:
        setups.append({'type': 'bull_flag', 'label': 'Bull flag',
                       'detail': f'Pole {flag["pole_low"]}→{flag["pole_high"]}, pausing {flag["bars_in_flag"]} bars above {flag["flag_low"]}'})
    recent_rsi = r5.tail(6)
    if recent_rsi.min() < 30 and len(day) > 1 and last > float(day['High'].iloc[-2]):
        setups.append({'type': 'oversold_bounce', 'label': 'Oversold bounce',
                       'detail': f'5-min RSI hit {recent_rsi.min():.0f} and the last bar closed above the prior high'})

    weights = {'orb_long': 3, 'orb_short': 2, 'bull_flag': 2, 'oversold_bounce': 1}
    score = sum(weights[s['type']] for s in setups) * (min(rvol, 3) if rvol else 1)
    return {
        'price': round(last, 2),
        'change_pct': round((last / prev_close - 1) * 100, 2) if prev_close else None,
        'prev_close': round(prev_close, 2) if prev_close else None,
        'day_high': round(float(day['High'].max()), 2),
        'day_low': round(float(day['Low'].min()), 2),
        'vwap': round(vw, 2),
        'or_high': round(orh, 2),
        'or_low': round(orl, 2),
        'rvol': num(rvol, 2),
        'rsi5m': num(r5.iloc[-1], 1),
        'atr5m': round(a5, 3),
        'above_vwap': last > vw,
        'setups': setups,
        'score': round(score, 2),
    }, flag


def plan_trade(scan, flag, day):
    """Entry / stop / target decided before the trade (Exit Planner + Entry Timer state)."""
    a5 = scan['atr5m']
    if any(s['type'] == 'orb_short' for s in scan['setups']):
        entry = scan['or_low'] - 0.01
        stop = min(scan['or_high'], entry + 2 * a5)
        direction, basis = 'short', 'Opening-range breakdown: sell below the 15-min low, stop back inside the range'
    elif flag:
        entry = flag['pole_high'] + 0.01
        stop = max(flag['flag_low'] - 0.01, entry - 2 * a5)
        direction, basis = 'long', 'Bull flag: buy the break of the pole high, stop under the flag'
    else:
        entry = scan['or_high'] + 0.01
        stop = max(scan['or_low'] - 0.01, entry - 2 * a5)
        direction, basis = 'long', 'Opening-range breakout: buy above the 15-min high, stop under the range (max 2 × ATR)'
    risk = abs(entry - stop)
    target = entry + 2 * risk if direction == 'long' else entry - 2 * risk

    # Entry Timer: first 5-minute close through the entry, after the opening range
    after = day.iloc[OR_BARS:]
    hit = after[after['Close'] > entry] if direction == 'long' else after[after['Close'] < entry]
    state, at = 'waiting', None
    if len(hit):
        state, at = 'triggered', hit.index[0].strftime('%H:%M')
        rest = after.loc[hit.index[0]:]
        if direction == 'long':
            if (rest['Low'] <= stop).any():
                state = 'stopped'
            elif (rest['High'] >= target).any():
                state = 'target_hit'
        else:
            if (rest['High'] >= stop).any():
                state = 'stopped'
            elif (rest['Low'] <= target).any():
                state = 'target_hit'
    return {'direction': direction, 'entry': round(entry, 2), 'stop': round(stop, 2), 'target': round(target, 2),
            'risk_per_share': round(risk, 2), 'reward_risk': 2.0, 'basis': basis,
            'trigger_state': state, 'triggered_at': at}


def replay_library(df):
    """Per-session 5-minute moves for the Time Machine: high/low/close of each bar
    relative to the previous bar's close, for complete prior sessions."""
    sessions = sorted(df['session'].unique())[:-1]
    h, l, c = [], [], []
    prev_close = None
    for s in sessions:
        d = df[df['session'] == s].set_index('bar')
        if len(d) < BARS_PER_DAY - 2:
            prev_close = float(d['Close'].iloc[-1]) if len(d) else prev_close
            continue
        d = d.reindex(range(BARS_PER_DAY)).ffill().bfill()
        pc = np.concatenate([[prev_close or d['Open'].iloc[0]], d['Close'].values[:-1]])
        h.append(np.round(d['High'].values / pc - 1, 5).tolist())
        l.append(np.round(d['Low'].values / pc - 1, 5).tolist())
        c.append(np.round(d['Close'].values / pc - 1, 5).tolist())
        prev_close = float(d['Close'].iloc[-1])
    return {'sessions': len(c), 'h': h, 'l': l, 'c': c}


def today_bars(day):
    return [[t.strftime('%H:%M'), round(float(r.Open), 2), round(float(r.High), 2), round(float(r.Low), 2),
             round(float(r.Close), 2), int(r.Volume or 0)] for t, r in day.iterrows()]


# ── news and SEC ──────────────────────────────────────────────────────────────

def news(symbol, limit=6):
    out = []
    for item in (yf.Ticker(symbol).news or [])[:limit]:
        c = item.get('content') or item
        link = (c.get('clickThroughUrl') or {}).get('url') or (c.get('canonicalUrl') or {}).get('url') or c.get('link')
        pub = c.get('pubDate') or c.get('displayTime')
        if not pub and c.get('providerPublishTime'):
            pub = datetime.fromtimestamp(c['providerPublishTime'], timezone.utc).isoformat()
        out.append({'title': c.get('title'), 'publisher': (c.get('provider') or {}).get('displayName') or c.get('publisher'),
                    'link': link, 'published': pub, 'summary': (c.get('summary') or '')[:280]})
    return [n for n in out if n['title']]


_cik_map = None


def cik_for(symbol):
    global _cik_map
    if _cik_map is None:
        data = http_json('https://www.sec.gov/files/company_tickers.json')
        _cik_map = {v['ticker'].upper(): int(v['cik_str']) for v in data.values()}
    return _cik_map.get(symbol.upper().replace('-', '.')) or _cik_map.get(symbol.upper())


def sec_filings(symbol, days=45, limit=8):
    cik = cik_for(symbol)
    if not cik:
        return []
    rec = http_json(f'https://data.sec.gov/submissions/CIK{cik:010d}.json')['filings']['recent']
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%d')
    out = []
    for i, form in enumerate(rec['form']):
        if rec['filingDate'][i] < since:
            break
        acc = rec['accessionNumber'][i].replace('-', '')
        out.append({'form': form, 'filed': rec['filingDate'][i],
                    'description': rec.get('primaryDocDescription', [''] * (i + 1))[i] or form,
                    'url': f'https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{rec["primaryDocument"][i]}'})
        if len(out) >= limit:
            break
    return out


CONCEPTS = {
    'revenue': (['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'], 'USD'),
    'net_income': (['NetIncomeLoss'], 'USD'),
    'eps_diluted': (['EarningsPerShareDiluted'], 'USD/shares'),
    'operating_income': (['OperatingIncomeLoss'], 'USD'),
    'operating_cash_flow': (['NetCashProvidedByUsedInOperatingActivities'], 'USD'),
}


def _quarterly(facts, names, unit):
    """{frame: (value, end, form, filed)} for quarterly frames (CY2025Q3), best concept."""
    best = {}
    for n in names:
        units = facts.get(n, {}).get('units', {}).get(unit, [])
        series = {f['frame']: (f['val'], f['end'], f['form'], f['filed'])
                  for f in units if re.fullmatch(r'CY\d{4}Q\d', f.get('frame', ''))}
        if series and (not best or max(series) > max(best)):
            best = series
    return best


def earnings(symbol):
    cik = cik_for(symbol)
    if not cik:
        return None
    facts = http_json(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json')
    gaap = facts.get('facts', {}).get('us-gaap', {})
    out = {'company': facts.get('entityName'), 'metrics': {}}
    for key, (names, unit) in CONCEPTS.items():
        q = _quarterly(gaap, names, unit)
        if not q:
            continue
        frame = max(q)
        val, end, form, filed = q[frame]
        y, qn = int(frame[2:6]), frame[-1]
        prior = q.get(f'CY{y - 1}Q{qn}')
        out['metrics'][key] = {'value': val, 'period': frame, 'period_end': end, 'form': form, 'filed': filed,
                               'prior_year': prior[0] if prior else None,
                               'yoy_pct': round((val / prior[0] - 1) * 100, 1) if prior and prior[0] else None}
    rev, ni = out['metrics'].get('revenue'), out['metrics'].get('net_income')
    if rev and ni and rev['period'] == ni['period'] and rev['value']:
        out['metrics']['net_margin_pct'] = {'value': round(ni['value'] / rev['value'] * 100, 1), 'period': rev['period']}
    return out if out['metrics'] else None


def congress_trades(limit=40):
    """Recent Periodic Transaction Reports (stock trades) filed by House members."""
    out = []
    year = datetime.now(timezone.utc).year
    for y in (year, year - 1):
        raw = http_bytes(f'https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{y}FD.zip')
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            xml_name = next(n for n in z.namelist() if n.lower().endswith('.xml'))
            root = ET.fromstring(z.read(xml_name))
        for m in root.iter('Member'):
            if (m.findtext('FilingType') or '').strip() != 'P':
                continue
            name = ' '.join(filter(None, [(m.findtext(k) or '').strip() for k in ('Prefix', 'First', 'Last', 'Suffix')]))
            filed = m.findtext('FilingDate') or ''
            try:
                iso = datetime.strptime(filed, '%m/%d/%Y').strftime('%Y-%m-%d')
            except ValueError:
                iso = filed
            doc = (m.findtext('DocID') or '').strip()
            out.append({'name': name, 'district': m.findtext('StateDst'), 'filed': iso,
                        'url': f'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{y}/{doc}.pdf'})
        if len(out) >= limit:
            break
    out.sort(key=lambda r: r['filed'], reverse=True)
    return out[:limit]


# ── build ─────────────────────────────────────────────────────────────────────

def build(log):
    """→ (desk snapshot, {symbol: intraday file})."""
    desk = {'watchlist': WATCHLIST, 'scanner': [], 'plans': {}, 'news': {}, 'filings': {}, 'earnings': {},
            'congress': [], 'errors': []}
    intraday = {}
    last_ts = None
    for sym in WATCHLIST:
        try:
            df = load_intraday(sym)
            today = df['session'].iloc[-1]
            day = df[df['session'] == today]
            scan, flag = scan_symbol(df)
            desk['scanner'].append({'symbol': sym, **scan})
            desk['plans'][sym] = plan_trade(scan, flag, day)
            intraday[sym] = {'symbol': sym, 'session_date': str(today), 'bar_minutes': 5,
                             'bars_per_day': BARS_PER_DAY, 'today': today_bars(day), 'library': replay_library(df)}
            ts = day.index[-1]
            last_ts = ts if last_ts is None or ts > last_ts else last_ts
            log(f'  desk {sym}: {len(day)} bars today, setups={[s["type"] for s in scan["setups"]]}')
        except Exception as e:
            desk['errors'].append(f'prices {sym}: {e}')
            log(f'  desk {sym}: {e}')
        for key, fn in (('news', news), ('filings', sec_filings), ('earnings', earnings)):
            if key != 'news' and sym in ETFS:
                continue
            try:
                desk[key][sym] = fn(sym)
            except Exception as e:
                desk['errors'].append(f'{key} {sym}: {e}')
    try:
        desk['congress'] = congress_trades()
    except Exception as e:
        desk['errors'].append(f'congress: {e}')
    desk['scanner'].sort(key=lambda r: r['score'], reverse=True)

    if last_ts is not None:
        close = last_ts.replace(hour=16, minute=0, second=0, microsecond=0)
        bar_end = last_ts + timedelta(minutes=5)
        desk['session'] = {'date': str(last_ts.date()), 'last_bar': last_ts.strftime('%H:%M'),
                           'complete': bar_end >= close or datetime.now(timezone.utc) > close.astimezone(timezone.utc),
                           'close_utc': close.astimezone(timezone.utc).isoformat()}
    return desk, intraday
