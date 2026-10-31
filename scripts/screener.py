"""Investment screener snapshot: fundamentals (ROE, Piotroski F-Score, analysts'
target / margin of safety), daily trend and daily candles for each stock.

The BUY / WATCH status is decided in the browser (src/utils/screenerRules.js) so
the Criteria Config dialog works on a static site.
"""
from datetime import date

import pandas as pd
import yfinance as yf

from common import atr, num, rsi

US_UNIVERSE = [
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'BRK-B', 'JPM',
    'V', 'MA', 'UNH', 'LLY', 'JNJ', 'PG', 'HD', 'COST', 'ABBV', 'MRK',
    'PEP', 'KO', 'ADBE', 'CRM', 'AMD', 'NFLX', 'ORCL', 'QCOM', 'TXN', 'INTU',
]

# NIFTY 50 (NSE symbols; Yahoo needs the .NS suffix). LTIM left out: Yahoo reports LTIM.NS as delisted.
IN_UNIVERSE = [
    'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'BHARTIARTL', 'ITC', 'SBIN', 'LT', 'HINDUNILVR',
    'BAJFINANCE', 'HCLTECH', 'KOTAKBANK', 'MARUTI', 'AXISBANK', 'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'ASIANPAINT', 'NTPC',
    'ONGC', 'TATAMOTORS', 'POWERGRID', 'M&M', 'WIPRO', 'NESTLEIND', 'ADANIENT', 'JSWSTEEL', 'TATASTEEL', 'COALINDIA',
    'BAJAJFINSV', 'TECHM', 'GRASIM', 'HINDALCO', 'ADANIPORTS', 'CIPLA', 'DRREDDY', 'BRITANNIA', 'EICHERMOT', 'APOLLOHOSP',
    'DIVISLAB', 'HEROMOTOCO', 'SBILIFE', 'HDFCLIFE', 'BAJAJ-AUTO', 'INDUSINDBK', 'TRENT', 'SHRIRAMFIN', 'BEL',
]

UNIVERSES = {'US': US_UNIVERSE, 'IN': IN_UNIVERSE}

FINANCIAL_SECTORS = {'Financial Services'}
CYCLICAL_SECTORS = {'Energy', 'Basic Materials', 'Industrials', 'Consumer Cyclical', 'Real Estate'}


def yahoo_symbol(symbol, market):
    return f'{symbol}.NS' if market == 'IN' and '.' not in symbol else symbol


def _row(df, *names):
    """First matching row of a yfinance statement as a list (newest year first)."""
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            return [num(v) for v in df.loc[n].tolist()]
    return None


def _pair(vals):
    if not vals or len(vals) < 2 or vals[0] is None or vals[1] is None:
        return None
    return vals[0], vals[1]


def piotroski(fin, bs, cf, is_financial):
    """Return (points, tests, notes). Tests whose data is missing are skipped."""
    ni = _row(fin, 'Net Income', 'Net Income Common Stockholders')
    ta = _row(bs, 'Total Assets')
    cfo = _row(cf, 'Operating Cash Flow', 'Cash Flow From Continuing Operating Activities')
    ltd = _row(bs, 'Long Term Debt', 'Long Term Debt And Capital Lease Obligation')
    ca = _row(bs, 'Current Assets')
    cl = _row(bs, 'Current Liabilities')
    sh = _row(bs, 'Ordinary Shares Number', 'Share Issued')
    gp = _row(fin, 'Gross Profit')
    rev = _row(fin, 'Total Revenue', 'Operating Revenue')

    tests = []

    def ratio(a, b, i):
        try:
            return a[i] / b[i] if a[i] is not None and b[i] else None
        except (IndexError, TypeError):
            return None

    if ni and ta and ratio(ni, ta, 0) is not None:
        tests.append(ratio(ni, ta, 0) > 0)
    if cfo and cfo[0] is not None:
        tests.append(cfo[0] > 0)
    if ni and ta and ratio(ni, ta, 0) is not None and ratio(ni, ta, 1) is not None:
        tests.append(ratio(ni, ta, 0) > ratio(ni, ta, 1))
    if cfo and ni and cfo[0] is not None and ni[0] is not None:
        tests.append(cfo[0] > ni[0])
    if ltd and ta and ratio(ltd, ta, 0) is not None and ratio(ltd, ta, 1) is not None:
        tests.append(ratio(ltd, ta, 0) <= ratio(ltd, ta, 1))
    if not is_financial and ca and cl and ratio(ca, cl, 0) is not None and ratio(ca, cl, 1) is not None:
        tests.append(ratio(ca, cl, 0) > ratio(ca, cl, 1))
    if _pair(sh):
        tests.append(sh[0] <= sh[1] * 1.005)   # ignore tiny rounding
    if not is_financial and gp and rev and ratio(gp, rev, 0) is not None and ratio(gp, rev, 1) is not None:
        tests.append(ratio(gp, rev, 0) > ratio(gp, rev, 1))
    if rev and ta and ratio(rev, ta, 0) is not None and ratio(rev, ta, 1) is not None:
        tests.append(ratio(rev, ta, 0) > ratio(rev, ta, 1))

    note = None
    if is_financial:
        note = 'Lender: scored on fewer tests, less reliable'
    elif len(tests) < 7:
        note = f'Only {len(tests)} tests had data'
    return sum(tests), len(tests), note


def horizon(roe, rev_growth, de, f_points, f_tests, sector):
    strong = f_tests and f_points / f_tests >= 0.7
    if sector in CYCLICAL_SECTORS:
        return ('1–3 years', 'Medium-term: Cyclical business',
                f'{sector} profits rise and fall with the economic cycle, so gains are usually taken within a cycle rather than held for decades.')
    if roe is not None and roe >= 15 and (rev_growth or 0) >= 10 and (de is None or de <= 1) and strong:
        return ('5–10 years', 'Long-term: Quality compounder',
                f'High return on equity ({roe:.0f}%), revenue growing {rev_growth:.0f}% a year and healthy finances — the kind of business that can compound for years.')
    if roe is not None and roe >= 12 and strong:
        return ('3–5 years', 'Long-term: Steady performer',
                f'Profitable (ROE {roe:.0f}%) with sound finances, but growth is moderate — review after each yearly result.')
    return ('6–18 months', 'Short-term: Needs proof',
            'Weaker profitability or financial health; treat it as a shorter holding and re-check after the next results.')


def daily_trend(hist):
    c = hist['Close']
    sma50 = c.rolling(50).mean().iloc[-1] if len(c) >= 50 else None
    sma200 = c.rolling(200).mean().iloc[-1] if len(c) >= 200 else None
    last = float(c.iloc[-1])
    return {
        'sma50': num(sma50, 2),
        'sma200': num(sma200, 2),
        'rsi14': num(rsi(c).iloc[-1], 1),
        'atr14': num(atr(hist).iloc[-1], 2),
        'change_1m_pct': num((last / c.iloc[-22] - 1) * 100, 1) if len(c) > 22 else None,
        'high_52w': num(c.tail(252).max(), 2),
    }


def candles(hist):
    return [
        {'time': d.strftime('%Y-%m-%d'), 'open': round(float(r.Open), 4), 'high': round(float(r.High), 4),
         'low': round(float(r.Low), 4), 'close': round(float(r.Close), 4), 'volume': int(r.Volume or 0)}
        for d, r in hist.iterrows() if r.Close == r.Close
    ]


def target_by_label():
    d = date.today()
    return date(d.year + 1, d.month, 1).strftime('%b %Y')


def analyze(symbol, market):
    """One stock → (row for the screener, daily candles)."""
    t = yf.Ticker(yahoo_symbol(symbol, market))
    info = t.get_info() or {}
    hist = t.history(period='2y', interval='1d', auto_adjust=False)
    if hist is None or hist.empty:
        raise ValueError('no price history')
    price = num(info.get('currentPrice') or info.get('regularMarketPrice')) or float(hist['Close'].iloc[-1])
    sector = info.get('sector') or ''
    is_fin = sector in FINANCIAL_SECTORS

    roe = num(info.get('returnOnEquity'))
    roe = roe * 100 if roe is not None else None
    if roe is None:
        ni = _row(t.financials, 'Net Income')
        eq = _row(t.balance_sheet, 'Stockholders Equity', 'Total Equity Gross Minority Interest')
        if ni and eq and ni[0] is not None and eq[0]:
            roe = ni[0] / eq[0] * 100

    points, tests, note = piotroski(t.financials, t.balance_sheet, t.cashflow, is_fin)
    target = num(info.get('targetMeanPrice'))
    mos = (target - price) / target * 100 if target else None
    upside = (target - price) / price * 100 if target else None
    rev_growth = num(info.get('revenueGrowth'))
    rev_growth = rev_growth * 100 if rev_growth is not None else None
    de = num(info.get('debtToEquity'))
    de = de / 100 if de is not None else None     # Yahoo reports D/E in %
    period, category, reason = horizon(roe, rev_growth, de, points, tests, sector)
    pct = lambda k: (num(info.get(k)) * 100) if num(info.get(k)) is not None else None

    row = {
        'symbol': symbol,
        'name': info.get('shortName') or info.get('longName') or symbol,
        'sector': sector,
        'currency': info.get('currency') or ('INR' if market == 'IN' else 'USD'),
        'current_price': round(price, 2),
        'roe': round(roe, 2) if roe is not None else None,
        'f_score_points': points,
        'f_score_tests': tests,
        'f_score': round(points / tests * 9) if tests else 0,
        'f_score_note': note,
        'margin_of_safety': round(mos, 2) if mos is not None else None,
        'target_price': round(target, 2) if target else None,
        'upside_pct': round(upside, 2) if upside is not None else None,
        'analyst_count': info.get('numberOfAnalystOpinions'),
        'target_by': target_by_label(),
        'horizon_period': period,
        'horizon_category': category,
        'horizon_reason': reason,
        'revenue_growth': num(rev_growth, 1),
        'eps_growth': num(pct('earningsGrowth'), 1),
        'gross_margin': num(pct('grossMargins'), 1),
        'debt_to_equity': num(de, 2),
        'peg': num(info.get('trailingPegRatio') or info.get('pegRatio'), 2),
        'trend': daily_trend(hist),
    }
    return row, candles(hist.tail(500))


def build(market, log):
    rows, history, errors = [], {}, []
    for sym in UNIVERSES[market]:
        try:
            row, bars = analyze(sym, market)
            rows.append(row)
            history[yahoo_symbol(sym, market)] = bars
            log(f'  {market} {sym}: ok')
        except Exception as e:   # one bad ticker must not sink the snapshot
            errors.append(f'{sym}: {e}')
            log(f'  {market} {sym}: {e}')
    return rows, history, errors
