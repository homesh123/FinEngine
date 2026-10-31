// Browser fallbacks for the Day Trader desk, used only when no live API is
// connected. They are ports of the day-trader-skill's own rules
// (vendor/day-trader-skill) so the snapshot site still works on its own:
//
//   sizeTrade      trader-budget/size.py  size_trade()      (market order, plan mode)
//   riskCheck      trader-risk/check.py   the entry rules    (stop, loss, reward:risk, size, position,
//                                                             cash, daily loss, trades/day, entry window)
//   timeMachine    trader-timemachine     build_pool() + simulate() + verdict()
//
// scripts/test_js_parity.py checks sizeTrade and riskCheck against the Python
// tools, and the Time Machine against the skill's published TSLA odds. With a
// live API the page calls the Python tools instead.
//
// Nothing here places a real order: the paper book lives in this browser.

const EPS = 1e-9;
const cents = (x) => Math.round(Number(x) * 100);
export const roundCent = (x) => Math.floor(Number(x) * 100 + 0.5 + EPS) / 100;
const sharesFor = (usd, perShare) => {
    const u = Math.round(usd * 100), p = Math.round(perShare * 100);
    return p <= 0 || u <= 0 ? 0 : Math.floor(u / p);
};
const money = (x) => (Math.abs(x - Math.round(x)) < 0.005 ? `$${Math.round(x).toLocaleString('en-US')}` : `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const p2 = (x) => roundCent(x).toFixed(2);

// trader-budget/config.example.json
export const DEFAULT_CONFIG = {
    budget: 5000, cash_buffer_pct: 10, max_position_pct: 75, max_order_usd: 4000, min_order_usd: 5,
    max_loss_per_trade_usd: 50, max_daily_loss_usd: 150, max_trades_per_day: 3, max_orders_per_day: 10,
    min_reward_risk: 1.0, require_stop: true, no_entries_before: '09:45', no_entries_after: '15:30', flat_by: '15:55',
};

/** size.py size_trade() for a market order at the plan's entry. Throws on what size.py refuses with an error. */
export function sizeTrade(plan, cfg) {
    const c = { ...DEFAULT_CONFIG, ...cfg };
    const ref = roundCent(plan.entry), stop = roundCent(plan.stop), target = roundCent(plan.target);
    if (!(ref > 0 && stop > 0 && target > 0)) throw new Error('the plan needs a positive entry, stop and target');
    if (stop >= ref) throw new Error(`the stop ${p2(stop)} is not below the entry ${p2(ref)}; a long trade needs its stop underneath`);
    if (target <= ref) throw new Error(`the target ${p2(target)} is not above the entry ${p2(ref)}: the move has already happened`);
    const budget = Number(c.budget || 0);
    if (budget <= 0) throw new Error('no budget');
    const riskC = cents(ref - stop), rewardC = cents(target - ref), risk = riskC / 100;
    const cashBuffer = Math.round(budget * c.cash_buffer_pct) / 100;
    const available = Math.max(Math.round((budget - cashBuffer) * 100) / 100, 0);
    const limits = [];
    if (c.max_loss_per_trade_usd) limits.push({ name: 'max loss', usd: c.max_loss_per_trade_usd, shares: sharesFor(c.max_loss_per_trade_usd, risk), how: `${money(c.max_loss_per_trade_usd)} max loss / ${p2(risk)} risk a share` });
    if (c.max_position_pct) {
        const cap = Math.round(budget * c.max_position_pct) / 100;
        limits.push({ name: 'position cap', usd: cap, shares: sharesFor(cap, ref), how: `${c.max_position_pct}% of ${money(budget)} = ${money(cap)} / ${p2(ref)}` });
    }
    if (c.max_order_usd) limits.push({ name: 'max order', usd: c.max_order_usd, shares: sharesFor(c.max_order_usd, ref), how: `${money(c.max_order_usd)} / ${p2(ref)}` });
    limits.push({ name: 'cash', usd: available, shares: sharesFor(available, ref), how: `budget ${money(budget)} minus the ${money(cashBuffer)} cash buffer = ${money(available)} / ${p2(ref)}` });
    const qty = Math.max(0, Math.min(...limits.map(l => l.shares)));
    const boundBy = limits.find(l => l.shares === qty).name;
    limits.forEach(l => { l.binds = l.name === boundBy; });
    const cost = Math.round(qty * ref * 100) / 100, maxLoss = Math.round(qty * riskC) / 100;
    let refusal = null;
    if (qty === 0) {
        refusal = boundBy === 'max loss'
            ? `one share risks ${money(risk)} (entry ${p2(ref)} minus stop ${p2(stop)}), more than your ${money(c.max_loss_per_trade_usd)} max loss per trade. No order. Skip this trade, or plan a closer stop.`
            : `one share of ${plan.symbol} costs ${money(ref)}, more than your ${boundBy} limit (${limits.find(l => l.name === boundBy).how}). No order.`;
    } else if (c.min_reward_risk && rewardC < c.min_reward_risk * riskC - EPS) {
        refusal = `reward:risk ${(rewardC / riskC).toFixed(2)} (target ${p2(target)}, entry ${p2(ref)}, stop ${p2(stop)}) is under your minimum ${c.min_reward_risk}, so trader-risk would block it. No order.`;
    } else if (cost < Number(c.min_order_usd || 0) - 0.005) {
        refusal = `${qty} share${qty === 1 ? '' : 's'} of ${plan.symbol} is ${money(cost)}, under your ${money(c.min_order_usd)} minimum order. No order.`;
    }
    return {
        symbol: plan.symbol, entry: ref, stop, target, risk_per_share: risk, reward_risk: Math.round(rewardC / riskC * 100) / 100,
        budget, cash_buffer: cashBuffer, cash_available: available, limits, qty, bound_by: boundBy, cost, max_loss: maxLoss,
        flat_by: plan.flat_by || c.flat_by, refusal,
    };
}

const hhmm = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

/**
 * check.py's rules for one bracket entry. todayEntries: paper entries already
 * placed today ({max_loss}). nowHHMM: the desk's New York clock ("10:15").
 */
export function riskCheck({ sizing, cfg, todayEntries = [], nowHHMM }) {
    const c = { ...DEFAULT_CONFIG, ...cfg };
    const { qty, entry: ref, stop, target } = sizing;
    const value = Math.round(qty * ref * 100) / 100;
    const reasons = [], info = [];
    if (!(qty > 0) || !Number.isInteger(qty)) reasons.push(`format: a bracket order takes whole shares only, got qty ${qty}`);
    if (c.min_order_usd && value < c.min_order_usd - 0.005) reasons.push(`size: ${money(value)} is under your ${money(c.min_order_usd)} minimum order`);
    if (c.max_order_usd && value > c.max_order_usd + 0.005) reasons.push(`size: ${money(value)} is over your ${money(c.max_order_usd)} max order`);
    if (c.max_position_pct) {
        const cap = c.budget * c.max_position_pct / 100;
        if (value > cap + 0.005) reasons.push(`position: ${sizing.symbol} would be ${money(value)}, over ${c.max_position_pct}% of ${money(c.budget)} (${money(cap)})`);
    }
    const buffer = c.budget * c.cash_buffer_pct / 100;
    if (value > c.budget - buffer + 0.005) reasons.push(`cash: ${money(value)} would dip into your ${money(buffer)} cash buffer`);
    let maxLoss = null, rr = null;
    if (!stop) {
        if (c.require_stop) reasons.push('stop: no stop. Every entry needs one');
    } else if (stop >= ref - 0.01) {
        reasons.push(`stop: the stop ${p2(stop)} must be below the entry ${p2(ref)} for a buy`);
    } else {
        const riskC = cents(ref - stop), riskPs = riskC / 100;
        maxLoss = Math.round(qty * riskPs * 100) / 100;
        if (c.max_loss_per_trade_usd && maxLoss > c.max_loss_per_trade_usd + 0.01) {
            reasons.push(`loss: ${qty} shares x ${p2(riskPs)} risk a share = ${money(maxLoss)} at the stop, over your ${money(c.max_loss_per_trade_usd)} max loss per trade`);
        }
        if (target) {
            if (target <= ref + 0.01) reasons.push(`target: the target ${p2(target)} must be above the entry ${p2(ref)}`);
            else {
                rr = Math.round(cents(target - ref) / riskC * 100) / 100;
                if (c.min_reward_risk && rr < c.min_reward_risk - 1e-9) reasons.push(`reward:risk: ${rr.toFixed(2)} (target ${p2(target)}, entry ${p2(ref)}, stop ${p2(stop)}) is under your minimum ${c.min_reward_risk}`);
            }
        }
        info.push(`entry ${p2(ref)}, stop ${p2(stop)}, target ${target ? p2(target) : 'none'}: risk ${p2(riskPs)} a share`);
        info.push(`max loss ${money(maxLoss)} (limit ${money(c.max_loss_per_trade_usd)}), reward:risk ${rr != null ? rr.toFixed(2) : 'n/a'} (min ${c.min_reward_risk})`);
    }
    const lossToday = todayEntries.reduce((s, o) => s + (o.max_loss || 0), 0);
    if (c.max_daily_loss_usd && maxLoss != null && lossToday + maxLoss > c.max_daily_loss_usd + 0.01) {
        reasons.push(`daily loss: ${money(lossToday)} already at risk today plus ${money(maxLoss)} for this one = ${money(lossToday + maxLoss)}, over your ${money(c.max_daily_loss_usd)} daily loss limit`);
    }
    if (c.max_trades_per_day && todayEntries.length >= c.max_trades_per_day) {
        reasons.push(`trades: ${todayEntries.length} entries placed today, your limit is ${c.max_trades_per_day} a day`);
    }
    if (nowHHMM) {
        const now = hhmm(nowHHMM);
        if (now < hhmm(c.no_entries_before)) reasons.push(`window: no new entries before ${c.no_entries_before} New York time (it is ${nowHHMM})`);
        if (now > hhmm(c.no_entries_after)) reasons.push(`window: no new entries after ${c.no_entries_after} New York time (it is ${nowHHMM})`);
    }
    info.push(`today before this: ${todayEntries.length} of ${c.max_trades_per_day} trades, ${money(lossToday)} of ${money(c.max_daily_loss_usd)} daily loss`);
    return { verdict: reasons.length ? 'BLOCK' : 'PASS', reasons, info, max_loss: maxLoss, reward_risk: rr, value_usd: value };
}

// ── Time Machine (timemachine.py build_pool / simulate / verdict) ────────────

const SESSION_BARS = 78, COIN_FLIP = 0.05, STRONG = 0.15, MANY_NEITHER = 0.40;
const etParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** New York {date: 'YYYY-MM-DD', minute: minutes since midnight} of an epoch second. */
export function nyTime(epoch) {
    const p = Object.fromEntries(etParts.formatToParts(new Date(epoch * 1000)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/** Compact bars → {date: {slot: {o,h,l,c}}}, regular-session 5-minute slots 0..77. */
export function sessionsOf(bars) {
    const days = {};
    for (const [t, o, h, l, c] of bars) {
        const { date, minute } = nyTime(t);
        const slot = (minute - 570) / 5;
        if (slot >= 0 && slot < SESSION_BARS && Number.isInteger(slot)) (days[date] ||= {})[slot] = { o, h, l, c };
    }
    return days;
}

/** pool[i] = every full past session's bar i as ratios to bar i-1's close (sessions before `beforeDate`). */
export function buildPool(bars, beforeDate) {
    const days = sessionsOf(bars);
    const full = Object.keys(days).sort().filter(d => d < beforeDate && Object.keys(days[d]).length === SESSION_BARS);
    const pool = Array.from({ length: SESSION_BARS }, () => []);
    for (const d of full) {
        const D = days[d];
        for (let i = 1; i < SESSION_BARS; i++) {
            const pc = D[i - 1].c;
            pool[i].push([D[i].o / pc, D[i].h / pc, D[i].l / pc, D[i].c / pc]);
        }
    }
    return { pool, sessions: full.length };
}

// Seeded PRNG (mulberry32). Python's Mersenne Twister draws differ, so odds
// match the skill's statistically, not to the last digit.
function rng32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Replays bars k+1..last from entry; stop checked before target in each bar. */
export function simulate({ pool, entry, stop, target, k, last = SESSION_BARS - 1, replays = 10000, seed = 19, window = 2 }) {
    const risk = entry - stop, rTarget = Math.round((target - entry) / risk * 1e4) / 1e4;
    const rnd = rng32(seed);
    const pick = (arr) => arr[(rnd() * arr.length) | 0];
    const slot = (i) => (window === 0 ? i : Math.min(SESSION_BARS - 1, Math.max(1, i + Math.floor(rnd() * (2 * window + 1)) - window)));
    let tgt = 0, stp = 0, green = 0, sumR = 0;
    const closes = [];
    for (let n = 0; n < replays; n++) {
        let p = entry, outcome = null;
        for (let i = k + 1; i <= last; i++) {
            const [, h, l, c] = pick(pool[slot(i)]);
            if (outcome === null) {
                if (p * l <= stop) outcome = 'stop';
                else if (p * h >= target) outcome = 'target';
            }
            p *= c;
        }
        if (outcome === 'target') { tgt++; green++; sumR += rTarget; }
        else if (outcome === 'stop') { stp++; sumR -= 1; }
        else { if (p > entry) green++; sumR += (p - entry) / risk; }
        closes.push(p);
    }
    closes.sort((a, b) => a - b);
    const pct = (q) => closes[Math.min(closes.length - 1, Math.floor(q * closes.length))];
    const r4 = (x) => Math.round(x * 1e4) / 1e4;
    return {
        replays, seed, window, bars_left: last - k, engine: 'browser',
        p_target: r4(tgt / replays), p_stop: r4(stp / replays), p_neither: r4((replays - tgt - stp) / replays), p_green: r4(green / replays),
        median_close: roundCent(pct(0.5)), p5_close: roundCent(pct(0.05)), p95_close: roundCent(pct(0.95)),
        avg_R: Math.round(sumR / replays * 1000) / 1000, r_at_target: rTarget,
    };
}

/** timemachine.py verdict() and verdict_notes(). */
export function verdict(mc, until = '4:00 PM') {
    const pt = mc.p_target, ps = mc.p_stop;
    if (pt + ps <= 0) return { verdict: `No replay reached the target or the stop by ${until}: the price at ${until} decides every one.`, notes: [] };
    const r = mc.r_at_target || 1, share = pt / (pt + ps), even = 1 / (1 + r), d = share - even;
    const oneR = Math.abs(r - 1) < 0.005;
    let head;
    if (Math.abs(d) < COIN_FLIP) head = oneR ? 'Close to a coin flip' : 'Close to break-even';
    else if (Math.abs(d) < STRONG) head = d > 0 ? 'Leans toward the target' : 'Leans toward the stop';
    else head = d > 0 ? 'Strongly toward the target' : 'Strongly toward the stop';
    const odds = `target first ${(100 * pt).toFixed(1)} % vs stop first ${(100 * ps).toFixed(1)} %`;
    const text = oneR ? `${head}: ${odds}.`
        : `${head}: at ${Math.round(r * 100) / 100}R the target has to come first in ${Math.round(100 * even)} % of the replays that hit one side; it did in ${Math.round(100 * share)} % (${odds}).`;
    const notes = [];
    if (mc.p_neither > MANY_NEITHER) notes.push(`${(100 * mc.p_neither).toFixed(1)} % of the replays hit neither by ${until}; the price at ${until} decides those.`);
    if (Math.abs(d) >= COIN_FLIP && mc.avg_R && (mc.avg_R > 0) !== (d > 0)) notes.push(`Average R is ${mc.avg_R > 0 ? '+' : ''}${mc.avg_R.toFixed(3)} all the same: the replays that hit neither pull it the other way.`);
    return { verdict: text, notes };
}

/** Bar index (0..77) whose close is an "H:MM AM/PM" entry time ("10:15 AM" closes the 10:10 bar, index 8). */
export function barOfTime(text) {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(text).trim());
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === 'PM') h += 12;
    return (h * 60 + Number(m[2]) - 570) / 5 - 1;
}

// ── paper order book (this browser only) ─────────────────────────────────────

const BOOK_KEY = 'dtPaperOrders';

export function loadOrders() {
    try { return JSON.parse(localStorage.getItem(BOOK_KEY) || '[]'); } catch { return []; }
}

export function saveOrders(orders) {
    try { localStorage.setItem(BOOK_KEY, JSON.stringify(orders)); } catch { /* storage unavailable */ }
}

export const sameDay = (iso, date = new Date()) => new Date(iso).toDateString() === date.toDateString();

/** Close paper positions whose stop or target the latest price has reached. */
export function markToMarket(orders, prices) {
    return orders.map(o => {
        if (o.status !== 'open' || prices[o.symbol] == null) return o;
        const p = prices[o.symbol];
        const exit = p <= o.stop ? o.stop : p >= o.target ? o.target : null;
        const mark = exit ?? p;
        const pnl = Math.round((mark - o.entry) * o.qty * 100) / 100;
        return exit != null
            ? { ...o, status: 'closed', exit, exitReason: p <= o.stop ? 'stop' : 'target', pnl, closedAt: new Date().toISOString() }
            : { ...o, last: p, pnl };
    });
}
