// Reads {cases, tm} as JSON on stdin and prints what src/utils/dayTrader.js computes
// (used by scripts/test_js_parity.py to compare with the day-trader-skill's Python).
import { readFileSync } from 'node:fs';
import { barOfTime, buildPool, riskCheck, simulate, sizeTrade, verdict } from '../src/utils/dayTrader.js';

const input = JSON.parse(readFileSync(0, 'utf8'));
const cases = input.cases.map(({ plan, cfg, now }) => {
    try {
        const s = sizeTrade(plan, cfg);
        return { sizing: s, risk: s.refusal ? null : riskCheck({ sizing: s, cfg, nowHHMM: now }) };
    } catch (e) {
        return { error: e.message };
    }
});
let tm = null;
if (input.tm) {
    const { bars, date, entry, stop, target, entryTime } = input.tm;
    const { pool, sessions } = buildPool(bars, date);
    const mc = simulate({ pool, entry, stop, target, k: barOfTime(entryTime) });
    tm = { sessions, mc, verdict: verdict(mc).verdict };
}
process.stdout.write(JSON.stringify({ cases, tm }));
