"""Offline tests for the data job: yfinance is replaced with synthetic data, and
the Day Trader desk runs the day-trader-skill on its own recorded fixtures.

    python -m unittest discover -s scripts
"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime
from unittest import mock

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))

import build_data  # noqa: E402
import screener  # noqa: E402
import skill_desk  # noqa: E402

FIX = os.path.join(skill_desk.SKILL, 'tests', 'fixtures')
REEL_CHART = os.path.join(FIX, 'trader-timemachine', 'TSLA-60d5m.json.gz')
REEL_NOW = datetime(2026, 10, 19, 10, 15, tzinfo=skill_desk.ET)
OFFLINE = {'news': os.path.join(FIX, 'trader-news'), 'analyst': os.path.join(FIX, 'trader-analyst'),
           'pelosi': os.path.join(FIX, 'trader-pelosi', '2026FD.zip')}


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

    def get_info(self):
        return {'currentPrice': 150.0, 'shortName': self.sym + ' Inc', 'sector': 'Technology', 'currency': 'USD',
                'returnOnEquity': 0.25, 'targetMeanPrice': 200.0, 'numberOfAnalystOpinions': 30,
                'revenueGrowth': 0.15, 'debtToEquity': 40.0}

    def history(self, period, interval, **kw):
        return daily_frame()


_build_desk = skill_desk.build_desk


def reel_desk(work, **kw):
    """The skill's README trade: TSLA, Monday 2026-10-19, 10:15 AM ET, real recorded bars."""
    return _build_desk(work, symbols=['TSLA'], charts={'TSLA': skill_desk.read_chart(REEL_CHART)},
                                 now=REEL_NOW, live_sources=False, offline=OFFLINE, log=lambda *_: None, **kw)


class ScreenerTest(unittest.TestCase):
    @mock.patch('yfinance.Ticker', FakeTicker)
    def test_piotroski_and_screener_row(self):
        row, bars = screener.analyze('AAPL', 'US')
        self.assertEqual(row['f_score_tests'], 9)
        self.assertEqual(row['f_score_points'], 9)      # every year-over-year test improves in the fixture
        self.assertEqual(row['margin_of_safety'], 25.0)
        self.assertAlmostEqual(row['roe'], 25.0)
        self.assertEqual(bars[-1]['time'], '2026-10-30')


class SkillDeskTest(unittest.TestCase):
    """Validates FinEngine's desk against the numbers the skill's README publishes."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.desk, cls.bars = reel_desk(cls.tmp.name)
        cls.tsla = cls.desk['plans']['TSLA']

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_scanner_finds_the_breakout(self):
        hit = self.desk['scan']['hits'][0]
        self.assertEqual((hit['symbol'], hit['or_low'], hit['or_high'], hit['price'], hit['at']),
                         ('TSLA', 354.47, 362.18, 364.18, '10:15 AM'))

    def test_entry_triggers_at_1015(self):
        e = self.tsla['entry']
        self.assertEqual((e['status'], e['trigger']['price'], e['trigger']['time']), ('triggered', 364.18, '10:15 AM'))

    def test_exit_plan_uses_the_range_midpoint_and_2r(self):
        p = self.tsla['plan']
        self.assertEqual((p['stop'], p['risk_per_share'], p['target'], p['target_r']), (358.32, 5.86, 375.9, 2.0))
        self.assertEqual((p['entry_time'], p['entry_bar']), ('10:15 AM', 8))   # the browser replays from here

    def test_time_machine_and_history(self):
        tm = self.tsla['timemachine']
        self.assertEqual(tm['mc']['replays'], 10000)
        self.assertEqual(tm['mc']['seed'], 19)
        self.assertNotIn('sample_paths', tm['mc'])
        h = tm['history']
        self.assertEqual((h['sessions'], h['triggered']), (59, 33))

    def test_readme_1r_trade_reproduces_exactly(self):
        with tempfile.TemporaryDirectory() as work:
            skill_desk.write_config(work)
            chart = os.path.join(work, 'TSLA.json')
            with open(chart, 'w') as f:
                f.write(skill_desk.read_chart(REEL_CHART))
            out = skill_desk.plan_symbol(work, 'TSLA', chart, '2026-10-19 10:15', target='1R')
        self.assertEqual(out['plan']['target'], 370.04)
        mc, h = out['timemachine']['mc'], out['timemachine']['history']
        self.assertEqual((mc['p_target'], mc['p_stop'], mc['p_neither']), (0.2938, 0.2548, 0.4514))
        self.assertEqual((h['triggered'], h['target'], h['stop'], h['close']), (33, 13, 15, 5))

    def test_budget_and_risk_with_user_settings(self):
        with tempfile.TemporaryDirectory() as work:
            plan = dict(self.tsla['plan'], target=370.04, target_r=1.0, reward_risk=1.0)
            r = skill_desk.size_and_check(work, plan, {'budget': 5000, 'max_loss_per_trade_usd': 50}, '2026-10-19 10:15')
        s = r['sizing']
        self.assertEqual((s['qty'], s['cost'], s['max_loss'], s['bound_by']), (8, 2913.44, 46.88, 'max loss'))
        self.assertEqual(r['risk']['results'][0]['verdict'], 'PASS')

    def test_news_analyst_congress_and_clock(self):
        self.assertTrue(self.desk['clock']['open'])
        self.assertTrue(any(i['ticker'] == 'TSLA' for i in self.desk['news']['items']))
        self.assertTrue(self.desk['congress']['filings'][0]['url'].endswith('.pdf'))
        self.assertIsInstance(self.desk['analyst'], list)

    def test_compact_bars_are_regular_session(self):
        bars = self.bars['TSLA']
        self.assertEqual(len(bars[0]), 6)
        self.assertTrue(all(b[2] >= b[3] for b in bars))


class FullBuildTest(unittest.TestCase):
    @mock.patch('yfinance.Ticker', FakeTicker)
    def test_full_build_writes_every_file(self):
        real = skill_desk.build_desk
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(screener, 'UNIVERSES', {'US': ['AAPL'], 'IN': ['TCS']}), \
                mock.patch.object(skill_desk, 'build_desk', lambda work, log=print: reel_desk(work)), \
                mock.patch.object(sys, 'argv', ['x', '--out', f'{d}/out', '--cache', f'{d}/cache']):
            build_data.main()
            out = lambda *p: os.path.join(d, 'out', *p)
            load = lambda p: json.loads(open(p).read())
            desk = load(out('daytrader.json'))
            self.assertEqual(desk['scan']['hits'][0]['symbol'], 'TSLA')
            self.assertIn('generated_at', desk)
            self.assertEqual(len(load(out('intraday', 'TSLA.json'))['bars'][0]), 6)
            self.assertEqual(load(out('screener-IN.json'))['data'][0]['symbol'], 'TCS')
            self.assertTrue(os.path.exists(out('history', 'TCS.NS.json')))
            self.assertTrue(os.path.exists(out('criteria.json')))
        self.assertIs(skill_desk.build_desk, real)


if __name__ == '__main__':
    unittest.main()
