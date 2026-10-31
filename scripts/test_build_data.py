"""Offline tests for the data job: yfinance and HTTP are replaced with synthetic data.

    python -m unittest discover -s scripts
"""
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))

import build_data  # noqa: E402
import daytrader  # noqa: E402
import screener  # noqa: E402


def intraday_frame(sessions=30, seed=1, breakout=True):
    rng = np.random.default_rng(seed)
    days = pd.bdate_range(end='2026-10-30', periods=sessions)
    idx, rows, px = [], [], 100.0
    for d in days:
        for b in range(daytrader.BARS_PER_DAY):
            t = pd.Timestamp(d.year, d.month, d.day, 9, 30, tz='America/New_York') + pd.Timedelta(minutes=5 * b)
            drift = 0.004 if (breakout and d == days[-1] and 3 <= b < 10) else 0.0
            o = px
            c = o * (1 + drift + rng.normal(0, 0.0015))
            rows.append([o, max(o, c) * 1.001, min(o, c) * 0.999, c, int(rng.integers(1e4, 5e4))])
            idx.append(t)
            px = c
    return pd.DataFrame(rows, index=pd.DatetimeIndex(idx), columns=['Open', 'High', 'Low', 'Close', 'Volume'])


def daily_frame(n=300):
    idx = pd.bdate_range(end='2026-10-30', periods=n)
    c = np.linspace(100, 150, n)
    return pd.DataFrame({'Open': c, 'High': c * 1.01, 'Low': c * 0.99, 'Close': c, 'Volume': 1e6}, index=idx)


def statements():
    cols = pd.to_datetime(['2025-12-31', '2024-12-31'])
    fin = pd.DataFrame({cols[0]: [20, 100, 60], cols[1]: [15, 90, 50]}, index=['Net Income', 'Total Revenue', 'Gross Profit'])
    bs = pd.DataFrame({cols[0]: [200, 30, 80, 40, 10, 100], cols[1]: [190, 35, 70, 40, 10, 95]},
                      index=['Total Assets', 'Long Term Debt', 'Current Assets', 'Current Liabilities',
                             'Ordinary Shares Number', 'Stockholders Equity'])
    cf = pd.DataFrame({cols[0]: [30], cols[1]: [25]}, index=['Operating Cash Flow'])
    return fin, bs, cf


class FakeTicker:
    def __init__(self, sym):
        self.sym = sym
        self.financials, self.balance_sheet, self.cashflow = statements()
        self.news = [{'content': {'title': f'{sym} beats', 'pubDate': '2026-10-30T12:00:00Z',
                                  'provider': {'displayName': 'Wire'}, 'canonicalUrl': {'url': 'https://x/1'}}}]

    def get_info(self):
        return {'currentPrice': 150.0, 'shortName': self.sym + ' Inc', 'sector': 'Technology', 'currency': 'USD',
                'returnOnEquity': 0.25, 'targetMeanPrice': 200.0, 'numberOfAnalystOpinions': 30,
                'revenueGrowth': 0.15, 'debtToEquity': 40.0}

    def history(self, period, interval, **kw):
        return intraday_frame() if interval == '5m' else daily_frame()


def fake_http_json(url, **kw):
    if url.endswith('company_tickers.json'):
        return {'0': {'cik_str': 1045810, 'ticker': 'NVDA', 'title': 'NVIDIA'}}
    if 'submissions' in url:
        return {'filings': {'recent': {'form': ['8-K', '4'], 'filingDate': ['2099-01-02', '2099-01-01'],
                                       'accessionNumber': ['0001-26-000001', '0001-26-000002'],
                                       'primaryDocument': ['a.htm', 'b.xml'], 'primaryDocDescription': ['8-K', '']}}}
    if 'companyfacts' in url:
        q = lambda frame, v: {'frame': frame, 'val': v, 'end': '2026-07-31', 'form': '10-Q', 'filed': '2026-08-27'}
        return {'entityName': 'NVIDIA', 'facts': {'us-gaap': {
            'Revenues': {'units': {'USD': [q('CY2025Q2', 30), q('CY2026Q2', 45)]}},
            'NetIncomeLoss': {'units': {'USD': [q('CY2025Q2', 15), q('CY2026Q2', 25)]}}}}}
    raise AssertionError(url)


def fake_http_bytes(url, **kw):
    xml = ('<FinancialDisclosure><Member><Prefix>Hon.</Prefix><Last>Doe</Last><First>Jane</First><FilingType>P</FilingType>'
           '<StateDst>CA11</StateDst><Year>2026</Year><FilingDate>10/27/2026</FilingDate><DocID>20031234</DocID></Member>'
           '<Member><Last>Roe</Last><First>Rick</First><FilingType>O</FilingType><FilingDate>10/20/2026</FilingDate>'
           '<DocID>1</DocID></Member></FinancialDisclosure>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('2026FD.xml', xml)
    return buf.getvalue()


@mock.patch('yfinance.Ticker', FakeTicker)
@mock.patch.object(daytrader, 'http_json', fake_http_json)
@mock.patch.object(daytrader, 'http_bytes', fake_http_bytes)
class BuildDataTest(unittest.TestCase):
    def setUp(self):
        daytrader._cik_map = None

    def test_scan_finds_opening_range_breakout_and_plans_it(self):
        df = daytrader.load_intraday('NVDA')
        scan, flag = daytrader.scan_symbol(df)
        self.assertIn('orb_long', [s['type'] for s in scan['setups']])
        day = df[df['session'] == df['session'].iloc[-1]]
        plan = daytrader.plan_trade(scan, flag, day)
        self.assertEqual(plan['direction'], 'long')
        self.assertLess(plan['stop'], plan['entry'])
        self.assertAlmostEqual(plan['target'] - plan['entry'], 2 * (plan['entry'] - plan['stop']), places=1)
        self.assertIn(plan['trigger_state'], ('triggered', 'target_hit', 'stopped'))

    def test_replay_library_has_one_row_per_prior_session(self):
        lib = daytrader.replay_library(daytrader.load_intraday('NVDA'))
        self.assertEqual(lib['sessions'], 29)
        self.assertEqual(len(lib['c'][0]), daytrader.BARS_PER_DAY)
        self.assertTrue(all(h >= c >= l for h, c, l in zip(lib['h'][0], lib['c'][0], lib['l'][0])))

    def test_earnings_compares_with_same_quarter_last_year(self):
        e = daytrader.earnings('NVDA')
        self.assertEqual(e['metrics']['revenue']['yoy_pct'], 50.0)
        self.assertEqual(e['metrics']['net_margin_pct']['value'], 55.6)

    def test_congress_keeps_only_transaction_reports(self):
        rows = daytrader.congress_trades()
        self.assertEqual([r['name'] for r in rows], ['Hon. Jane Doe'] * len(rows))
        self.assertTrue(rows[0]['url'].endswith('/ptr-pdfs/2026/20031234.pdf'))

    def test_piotroski_and_screener_row(self):
        row, bars = screener.analyze('AAPL', 'US')
        self.assertEqual(row['f_score_tests'], 9)
        self.assertEqual(row['f_score_points'], 9)      # every year-over-year test improves in the fixture
        self.assertEqual(row['margin_of_safety'], 25.0)
        self.assertAlmostEqual(row['roe'], 25.0)
        self.assertEqual(bars[-1]['time'], '2026-10-30')

    def test_full_build_writes_every_file(self):
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(screener, 'UNIVERSES', {'US': ['AAPL'], 'IN': ['TCS']}), \
                mock.patch.object(daytrader, 'WATCHLIST', ['NVDA', 'SPY']), \
                mock.patch.object(sys, 'argv', ['x', '--out', f'{d}/out', '--cache', f'{d}/cache']):
            build_data.main()
            out = lambda *p: os.path.join(d, 'out', *p)
            load = lambda p: json.loads(open(p).read())
            desk = load(out('daytrader.json'))
            self.assertEqual({r['symbol'] for r in desk['scanner']}, {'NVDA', 'SPY'})
            self.assertNotIn('SPY', desk['earnings'])
            self.assertEqual(desk['errors'], [])
            self.assertTrue(os.path.exists(out('intraday', 'NVDA.json')))
            self.assertEqual(load(out('screener-IN.json'))['data'][0]['symbol'], 'TCS')
            self.assertTrue(os.path.exists(out('history', 'TCS.NS.json')))
            self.assertTrue(os.path.exists(out('criteria.json')))


if __name__ == '__main__':
    unittest.main()
