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

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

import live_api  # noqa: E402
import screener  # noqa: E402
from test_build_data import FakeTicker  # noqa: E402


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

    def test_rejects_bad_symbols(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.get('/api/history?symbol=../../etc')
        self.assertEqual(e.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
