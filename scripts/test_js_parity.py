"""The browser fallbacks in src/utils/dayTrader.js against the day-trader-skill's
Python: sizing and risk verdicts must match exactly, the Time Machine's odds
statistically (different random generator, same algorithm).

    python -m unittest discover -s scripts      (needs node on PATH)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import skill_desk  # noqa: E402
from test_build_data import REEL_CHART  # noqa: E402

HARNESS = os.path.join(os.path.dirname(__file__), 'js_parity_harness.mjs')
REEL = {'symbol': 'TSLA', 'side': 'buy', 'date': '2026-10-19', 'setup': 'orb', 'entry': 364.18, 'entry_time': '10:15 AM',
        'stop': 358.32, 'target': 370.04, 'target_r': 1.0, 'flat_by': '15:55'}
CHEAP = dict(REEL, symbol='SOFI', entry=12.34, stop=12.10, target=12.82)
CASES = [
    ('readme 1R', REEL, {'budget': 5000, 'max_loss_per_trade_usd': 50}, '10:15'),
    ('2R target', dict(REEL, target=375.9), {'budget': 5000, 'max_loss_per_trade_usd': 50}, '10:15'),
    ('stop too far for max loss', REEL, {'budget': 5000, 'max_loss_per_trade_usd': 3}, '10:15'),
    ('reward:risk under min', REEL, {'budget': 5000, 'max_loss_per_trade_usd': 50, 'min_reward_risk': 1.5}, '10:15'),
    ('cash binds', REEL, {'budget': 1000, 'max_loss_per_trade_usd': 200}, '10:15'),
    ('cheap stock, position cap binds', CHEAP, {'budget': 25000, 'max_loss_per_trade_usd': 2000, 'max_order_usd': 100000}, '10:15'),
    ('max order binds', CHEAP, {'budget': 25000, 'max_loss_per_trade_usd': 2000}, '10:15'),
    ('before the entry window', REEL, {'budget': 5000, 'max_loss_per_trade_usd': 50}, '09:40'),
    ('after the entry window', REEL, {'budget': 5000, 'max_loss_per_trade_usd': 50}, '15:45'),
]


def python_side(plan, cfg, now):
    with tempfile.TemporaryDirectory() as work:
        try:
            return skill_desk.size_and_check(work, plan, cfg, f"{plan['date']} {now}")
        except skill_desk.ToolError as e:
            return {'error': str(e)}


@unittest.skipUnless(shutil.which('node'), 'node is not installed')
class JsParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bars = skill_desk.compact_bars(skill_desk.read_chart(REEL_CHART))
        payload = {'cases': [{'plan': p, 'cfg': dict(skill_desk.DEFAULT_CONFIG, **c), 'now': n} for _, p, c, n in CASES],
                   'tm': {'bars': bars, 'date': '2026-10-19', 'entry': 364.18, 'stop': 358.32, 'target': 370.04, 'entryTime': '10:15 AM'}}
        out = subprocess.run(['node', HARNESS], input=json.dumps(payload), capture_output=True, text=True, check=True)
        cls.js = json.loads(out.stdout)

    def test_sizing_and_risk_match_the_skill(self):
        for (name, plan, cfg, now), js in zip(CASES, self.js['cases']):
            with self.subTest(name):
                py = python_side(plan, cfg, now)
                s, js_s = py['sizing'], js['sizing']
                for k in ('qty', 'cost', 'max_loss', 'bound_by', 'risk_per_share', 'reward_risk'):
                    self.assertEqual(js_s[k], s[k], k)
                self.assertEqual(js_s['refusal'] is None, s['refusal'] is None, (js_s['refusal'], s['refusal']))
                if s['refusal'] is None:
                    r = py['risk']['results'][0]
                    self.assertEqual(js['risk']['verdict'], r['verdict'], (js['risk']['reasons'], r['reasons']))
                    kinds = lambda reasons: sorted({x.split(':')[0] for x in reasons})
                    self.assertEqual(kinds(js['risk']['reasons']), kinds(r['reasons']))

    def test_time_machine_odds_match_the_skill(self):
        tm = self.js['tm']
        self.assertEqual(tm['sessions'], 59)
        mc = tm['mc']
        # the skill (seed 19): target 29.38 %, stop 25.48 %, neither 45.14 %
        self.assertAlmostEqual(mc['p_target'], 0.2938, delta=0.015)
        self.assertAlmostEqual(mc['p_stop'], 0.2548, delta=0.015)
        self.assertAlmostEqual(mc['p_neither'], 0.4514, delta=0.015)
        self.assertTrue(tm['verdict'].startswith('Close to a coin flip'), tm['verdict'])


if __name__ == '__main__':
    unittest.main()
