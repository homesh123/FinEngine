"""Offline tests for server/live_api.py (yfinance replaced with synthetic data).

    python -m unittest discover -s scripts
"""
import json
import os
import sys
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import pandas as pd
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

import live_api  # noqa: E402
import screener  # noqa: E402
import skill_desk  # noqa: E402
from test_build_data import REEL_CHART, FakeTicker, reel_desk  # noqa: E402


def fake_download(symbols, **kw):
    idx = pd.date_range('2026-10-30 14:00', periods=3, freq='min', tz='UTC')
    frames = {s: pd.DataFrame({'Close': [170.0, 171.0, 160.0]}, index=idx) for s in symbols}
    return pd.concat(frames, axis=1)


class FakeSearch:
    def __init__(self, q, **kw):
        self.quotes = [{'symbol': 'TCS.NS', 'shortname': 'Tata Consultancy', 'quoteType': 'EQUITY', 'exchange': 'NSI'},
                       {'symbol': 'TCEHY', 'shortname': 'Tencent', 'quoteType': 'EQUITY', 'exchange': 'PNK'}]


@mock.patch('yfinance.Ticker', FakeTicker)
@mock.patch('yfinance.download', fake_download)
@mock.patch('yfinance.Search', FakeSearch)
class LiveApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), live_api.Handler)
        cls.base = f'http://127.0.0.1:{cls.srv.server_address[1]}'
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        live_api.cache = live_api.TTLCache()

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return r.status, dict(r.headers), json.loads(r.read())

    def test_screener_uses_live_price_and_sends_cors(self):
        with mock.patch.object(screener, 'UNIVERSES', {'US': ['AAPL', 'MSFT'], 'IN': []}):
            status, headers, body = self.get('/api/investment/screener?market=US')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], '*')
        self.assertTrue(body['live'])
        row = body['data'][0]
        self.assertEqual(row['current_price'], 160.0)          # last 1-minute close, not the cached 150
        self.assertEqual(row['margin_of_safety'], 20.0)         # (200 - 160) / 200
        self.assertEqual(row['upside_pct'], 25.0)

    def test_search_filters_by_market(self):
        _, _, body = self.get('/api/investment/search?q=tc&market=IN')
        self.assertEqual([s['symbol'] for s in body['data']], ['TCS'])

    def test_history_and_analyze(self):
        _, _, bars = self.get('/api/history?symbol=NVDA&interval=1day&limit=500')
        self.assertEqual(bars[-1]['time'], '2026-10-30')
        _, _, body = self.get('/api/investment/analyze/NVDA?market=US')
        self.assertEqual(body['data']['current_price'], 160.0)

    def post(self, path, body):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def test_desk_runs_the_skill(self):
        with mock.patch.object(skill_desk, 'build_desk', lambda work, log=None: reel_desk(work)), \
                mock.patch.object(skill_desk, 'fetch_chart', lambda sym: skill_desk.read_chart(REEL_CHART)):
            _, _, d = self.get('/api/desk')
            self.assertTrue(d['live'])
            self.assertEqual(d['plans']['TSLA']['plan']['stop'], 358.32)
            _, _, bars = self.get('/api/desk/bars?symbol=TSLA')
            self.assertGreater(len(bars['bars']), 4000)
            _, _, p = self.get('/api/desk/plan?symbol=TSLA&target=1R&stop=or-mid')
            self.assertEqual(p['timemachine']['mc']['p_target'], 0.2938)
            r = self.post('/api/desk/size-risk', {'plan': p['plan'], 'settings': {'budget': 5000, 'max_loss_per_trade_usd': 50}})
            self.assertEqual(r['sizing']['qty'], 8)
            with self.assertRaises(urllib.error.HTTPError) as e:
                self.get('/api/desk/plan?symbol=TSLA&target=rm%20-rf')
            self.assertEqual(e.exception.code, 400)

    def test_india_desk_endpoints(self):
        import market_desk
        from test_market_desk import as_nse, REEL_TEXT
        nse = as_nse(REEL_TEXT)
        real = market_desk.build_india_desk
        when = datetime(2026, 10, 19, 10, 0, tzinfo=market_desk.NSE.zone)
        build = lambda log=None, keep_charts=None: real(symbols=['TSLA'], charts={'TSLA': nse}, now=when, news=False,
                                                         log=lambda *_: None, keep_charts=keep_charts)
        with mock.patch.object(market_desk, 'build_india_desk', build):
            _, _, d = self.get('/api/desk?market=IN')
            self.assertEqual((d['market'], d['currency'], d['live']), ('IN', 'INR', True))
            self.assertEqual(d['plans']['TSLA']['plan']['stop'], 358.32)
            _, _, b = self.get('/api/desk/bars?symbol=TSLA&market=IN')
            self.assertGreater(len(b['bars']), 4000)
            _, _, p = self.get('/api/desk/plan?symbol=TSLA&market=IN&target=1R&stop=or-mid')
            self.assertEqual((p['plan']['target'], p['timemachine']['mc']['replays']), (370.04, 10000))
            with self.assertRaises(urllib.error.HTTPError) as e:
                self.get('/api/desk/plan?symbol=NOPE&market=IN&target=1R&stop=or-mid')
            self.assertEqual(e.exception.code, 400)

    def test_rejects_bad_symbols(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.get('/api/history?symbol=../../etc')
        self.assertEqual(e.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
