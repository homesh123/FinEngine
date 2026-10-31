"""market_desk.py (the skill's rules for any exchange) against the skill itself.

    python -m unittest discover -s scripts
"""
import importlib.util
import json
import os
import random
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

import market_desk as md  # noqa: E402
import skill_desk  # noqa: E402
from test_build_data import REEL_CHART  # noqa: E402

REEL_TEXT = skill_desk.read_chart(REEL_CHART)


def skill_module(path, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(skill_desk.SKILL, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def as_nse(text):
    """The recorded TSLA bars moved onto NSE hours: 9:30 ET (EDT) → 9:15 IST, so each
    78-bar NYSE session becomes a full 75-bar NSE session (the last 3 bars fall after 15:30)."""
    doc = json.loads(text)
    res = doc['chart']['result'][0]
    shift = -(9 * 3600 + 45 * 60)
    res['timestamp'] = [t + shift if t is not None else None for t in res['timestamp']]
    if 'regularMarketTime' in res.get('meta', {}):
        res['meta']['regularMarketTime'] += shift
    return json.dumps(doc)


class SkillParityTest(unittest.TestCase):
    """Run with the NYSE session, the port must give the skill's own numbers."""

    @classmethod
    def setUpClass(cls):
        s = md.NYSE
        cls.now = datetime(2026, 10, 19, 10, 15, tzinfo=s.zone)
        cls.bars = md.parse_chart(REEL_TEXT, s, cls.now)
        cls.entry = md.entry_check('TSLA', cls.bars, s, cls.now)

    def test_entry_and_plan(self):
        e = self.entry
        self.assertEqual((e['status'], e['opening_range']['low'], e['opening_range']['high'], e['trigger']['price'],
                          e['trigger']['time'], e['trigger']['bar_index']), ('triggered', 354.47, 362.18, 364.18, '10:15 AM', 8))
        p = md.plan(e, md.NYSE, 'or-mid', '1R')
        self.assertEqual((p['stop'], p['target'], p['risk_per_share']), (358.32, 370.04, 5.86))

    def test_time_machine_matches_the_skill_draw_for_draw(self):
        p = md.plan(self.entry, md.NYSE, 'or-mid', '1R')
        tm = md.time_machine(self.bars, p, md.NYSE)
        mc, h = tm['mc'], tm['history']
        self.assertEqual((mc['p_target'], mc['p_stop'], mc['p_neither'], mc['avg_R'], mc['median_close']),
                         (0.2938, 0.2548, 0.4514, 0.034, 364.36))
        self.assertEqual((h['sessions'], h['triggered'], h['target'], h['stop'], h['close'], h['avg_R']),
                         (59, 33, 13, 15, 5, -0.062))
        self.assertEqual(tm['verdict'], 'Close to a coin flip: target first 29.4 % vs stop first 25.5 %.')

    def test_2r_matches_the_skill_tool(self):
        p = md.plan(self.entry, md.NYSE, 'or-mid', '2R')
        mine = md.time_machine(self.bars, p, md.NYSE)
        with self.subTest('skill'):
            import tempfile
            with tempfile.TemporaryDirectory() as work:
                skill_desk.write_config(work)
                path = os.path.join(work, 'TSLA.json')
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(REEL_TEXT)
                theirs = skill_desk.plan_symbol(work, 'TSLA', path, '2026-10-19 10:15', target='2R')['timemachine']
        for k in ('p_target', 'p_stop', 'p_neither', 'p_green', 'avg_R', 'median_close', 'p5_close', 'p95_close'):
            self.assertEqual(mine['mc'][k], theirs['mc'][k], k)
        self.assertEqual(mine['mc']['bands'], theirs['mc']['bands'])
        self.assertEqual(mine['history']['trades'], theirs['history']['trades'])
        self.assertEqual(mine['verdict'], theirs['verdict'])

    def test_daily_setups_match_the_skill(self):
        scan = skill_module('trader-scanner/scan.py', 'dts_scan')
        rnd = random.Random(7)
        for _ in range(500):
            c = [100.0]
            for _ in range(rnd.randint(30, 70)):
                c.append(max(1.0, c[-1] * (1 + rnd.gauss(rnd.choice([-0.01, 0, 0.012]), rnd.choice([0.005, 0.02, 0.04])))))
            self.assertEqual(sorted(md.daily_setups(c)), sorted(scan.find_setups(c)[0]))


class ChartUrlTest(unittest.TestCase):
    def test_nse_symbols_keep_their_suffix(self):
        # The first live run failed: the skill's fetcher turns '.' into '-' (RELIANCE.NS → RELIANCE-NS, 404)
        self.assertEqual(md.chart_url('RELIANCE.NS'), 'https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=60d&interval=5m')
        self.assertIn('/chart/M%26M.NS?', md.chart_url('M&M.NS', 'query1'))
        self.assertIn('/chart/BAJAJ-AUTO.NS?', md.chart_url('BAJAJ-AUTO.NS'))


class IndiaDeskTest(unittest.TestCase):
    def build(self, when):
        return md.build_india_desk(symbols=['TSLA'], charts={'TSLA': as_nse(REEL_TEXT)}, now=when, news=False,
                                   log=lambda *_: None)

    def test_in_session(self):
        desk, bars = self.build(datetime(2026, 10, 19, 10, 0, tzinfo=md.NSE.zone))   # the 9:55 IST bar has closed
        self.assertEqual((desk['market'], desk['currency'], desk['replay_note']), ('IN', 'INR', None))
        hit = desk['scan']['hits'][0]
        self.assertEqual((hit['symbol'], hit['or_low'], hit['or_high'], hit['price'], hit['at']),
                         ('TSLA', 354.47, 362.18, 364.18, '10:00 AM'))
        p = desk['plans']['TSLA']
        self.assertEqual((p['plan']['stop'], p['plan']['target'], p['plan']['flat_by']), (358.32, 375.9, '15:25'))
        tm = p['timemachine']
        self.assertEqual((tm['mc']['replays'], tm['mc']['bars_left'], tm['history']['sessions']), (10000, 66, 59))
        self.assertEqual(desk['config']['no_entries_after'], '15:00')
        self.assertTrue(all(len(b) == 6 for b in bars['TSLA']))

    def test_after_3pm_replays_the_session(self):
        desk, _ = self.build(datetime(2026, 10, 16, 18, 0, tzinfo=md.NSE.zone))
        self.assertEqual(desk['as_of'], '2026-10-16 15:00')
        self.assertIn('after 3:00 PM', desk['replay_note'])


if __name__ == '__main__':
    unittest.main()


class UpstoxViaTradeSagarTest(unittest.TestCase):
    """The India desk takes Upstox candles from TradeSagar's backend for the days they
    cover, keeps Yahoo for older sessions, and falls back to Yahoo when Upstox isn't there."""

    def setUp(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from unittest import mock
        nse = as_nse(REEL_TEXT)
        res = json.loads(nse)['chart']['result'][0]
        q = res['indicators']['quote'][0]
        day = lambda t: datetime.fromtimestamp(t, md.NSE.zone).date().isoformat()
        # Upstox's copy of 19 Oct: every price 1.00 higher, so we can tell which source won
        self.candles = [{'time': t * 1000, 'open': q['open'][i] + 1, 'high': q['high'][i] + 1, 'low': q['low'][i] + 1,
                         'close': q['close'][i] + 1, 'volume': q['volume'][i]}
                        for i, t in enumerate(res['timestamp']) if t and day(t) == '2026-10-19' and q['close'][i] is not None]
        test, state = self, {'connected': True}
        self.state = state

        class TradeSagar(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get('X-Trade-Token') != 'secret':
                    body, code = {'detail': 'bad token'}, 401
                elif self.path.startswith('/api/upstox/status'):
                    body, code = {'connected': state['connected'], 'user_name': 'H'}, 200
                elif self.path.startswith('/api/upstox/history') and 'symbol=NSE%3ATSLA' in self.path and 'interval=5min' in self.path:
                    body, code = test.candles, 200
                else:
                    body, code = {'detail': 'not found'}, 404
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), TradeSagar)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.patches = [mock.patch.object(md, 'TRADESAGAR_API', f'http://127.0.0.1:{self.srv.server_address[1]}'),
                        mock.patch.dict(os.environ, {'TRADESAGAR_TOKEN': 'secret'}),
                        mock.patch.object(md, 'fetch_chart', lambda ysym, pause=1.0: nse)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.srv.shutdown()

    def build(self):
        return md.build_india_desk(symbols=['TSLA'], now=datetime(2026, 10, 19, 10, 0, tzinfo=md.NSE.zone), news=False,
                                   log=lambda *_: None)[0]

    def test_upstox_bars_win_for_today_and_yahoo_keeps_the_history(self):
        desk = self.build()
        self.assertEqual(desk['data_source'], 'Upstox (via TradeSagar) + Yahoo history')
        self.assertTrue(desk['upstox']['connected'])
        self.assertEqual(desk['scan']['hits'][0]['price'], 365.18)                 # Upstox's +1.00 close
        self.assertEqual(desk['plans']['TSLA']['timemachine']['history']['sessions'], 59)   # Yahoo's older sessions

    def test_logged_out_falls_back_to_yahoo(self):
        self.state['connected'] = False
        desk = self.build()
        self.assertEqual(desk['data_source'], 'Yahoo Finance')
        self.assertIn('not logged in', desk['upstox']['reason'])
        self.assertEqual(desk['scan']['hits'][0]['price'], 364.18)

    def test_tradesagar_down_falls_back_to_yahoo(self):
        self.srv.shutdown()
        self.srv.server_close()
        desk = self.build()
        self.assertEqual(desk['data_source'], 'Yahoo Finance')
        self.assertIn('unreachable', desk['upstox']['reason'])
