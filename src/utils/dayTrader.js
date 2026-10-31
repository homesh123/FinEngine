// Day Trader desk maths that runs in the browser on top of the published
// snapshot (scripts/daytrader.py): the Time Machine, position sizing, the risk
// manager's rules and the paper order book. Nothing here places a real order.

/** Break-even win rate for a reward:risk ratio (2R → 33%, 1R → 50%). */
export const breakEvenWinRate = (rr) => 1 / (1 + rr);

/**
 * Time Machine: rebuild the rest of the day `paths` times by stitching together
 * real 5-minute moves the stock made at the same time of day in prior sessions
 * (one random session per bar). Each path ends at the target (win), the stop
 * (planned loss) or the close. A bar that touches both counts as the stop.
 */
export function timeMachine({ library, startBar, trade, paths = 10000, rng = Math.random }) {
    const { entry, stop, target, direction } = trade;
    const n = library.sessions, bars = library.c[0]?.length || 0;
    const risk = Math.abs(entry - stop);
    if (!n || !risk || startBar >= bars) return null;
    const long = direction !== 'short';
    let wins = 0, losses = 0, open = 0, sumR = 0;
    const closeR = [];
    for (let k = 0; k < paths; k++) {
        let p = entry, done = false;
        for (let i = startBar; i < bars; i++) {
            const s = (rng() * n) | 0;
            const hi = p * (1 + library.h[s][i]), lo = p * (1 + library.l[s][i]);
            if (long ? lo <= stop : hi >= stop) { losses++; sumR -= 1; done = true; break; }
            if (long ? hi >= target : lo <= target) { wins++; sumR += Math.abs(target - entry) / risk; done = true; break; }
            p *= 1 + library.c[s][i];
        }
        if (!done) {
            const r = ((long ? p - entry : entry - p)) / risk;
            open++; sumR += r; closeR.push(r);
        }
    }
    const rr = Math.abs(target - entry) / risk;
    const pWin = wins / paths, pLoss = losses / paths;
    const expectancy = sumR / paths;
    const be = breakEvenWinRate(rr);
    closeR.sort((a, b) => a - b);
    let verdict;
    if (expectancy > DEFAULT_RULES.minTimeMachineEdge && pWin > be) verdict = `Edge: wins ${pct(pWin)} of replays vs ${pct(be)} needed to break even at ${rr.toFixed(1)}R. Expected +${expectancy.toFixed(2)}R per trade.`;
    else if (expectancy > -0.1) verdict = `Coin flip: about break-even (${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(2)}R expected). Not worth the risk on its own.`;
    else verdict = `Skip it: loses on average (${expectancy.toFixed(2)}R per trade). Wins ${pct(pWin)}, needs ${pct(be)}.`;
    return {
        paths, sessions: n, barsLeft: bars - startBar, wins, losses, open, pWin, pLoss, pOpen: open / paths,
        expectancy, rr, breakEven: be, verdict,
        closeMedianR: closeR.length ? closeR[closeR.length >> 1] : null,
    };
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** How many shares fit the max loss and the cash available. */
export function positionSize({ account, maxRisk, entry, stop }) {
    const perShare = Math.abs(entry - stop);
    if (!(account > 0 && maxRisk > 0 && entry > 0 && perShare > 0)) return null;
    const byRisk = Math.floor(maxRisk / perShare);
    const byCash = Math.floor(account / entry);
    const shares = Math.max(0, Math.min(byRisk, byCash));
    return {
        shares, perShare, byRisk, byCash, limitedBy: byCash < byRisk ? 'cash' : 'risk',
        cost: shares * entry, risk: shares * perShare, riskPct: (shares * perShare) / account * 100,
    };
}

export const DEFAULT_RULES = {
    maxRiskPct: 1,          // of the account, per trade
    minRewardRisk: 2,
    maxTradesPerDay: 3,
    dailyLossLimitPct: 2,
    noEntryLastMinutes: 15, // before the 16:00 ET close
    minTimeMachineEdge: 0.1, // expected R from the Time Machine must beat this (its "Edge" verdict), when it was run
};

/** Risk Manager: every rule must pass before the Order Desk will take the trade. */
export function riskCheck({ account, shares, trade, rules = DEFAULT_RULES, todayOrders = [], minutesToClose, replay }) {
    const { entry, stop, target, direction } = trade;
    const long = direction !== 'short';
    const perShare = Math.abs(entry - stop);
    const risk = shares * perShare;
    const rr = perShare ? Math.abs(target - entry) / perShare : 0;
    const realised = todayOrders.filter(o => o.status === 'closed').reduce((s, o) => s + (o.pnl || 0), 0);
    const out = [
        { rule: 'Stop is on the right side', pass: long ? stop < entry && target > entry : stop > entry && target < entry,
          detail: long ? `stop ${stop} < entry ${entry} < target ${target}` : `target ${target} < entry ${entry} < stop ${stop}` },
        { rule: `Risk ≤ ${rules.maxRiskPct}% of account`, pass: risk <= account * rules.maxRiskPct / 100 && shares > 0,
          detail: `$${risk.toFixed(2)} at risk (${(risk / account * 100).toFixed(2)}%) on ${shares} shares` },
        { rule: `Reward:risk ≥ ${rules.minRewardRisk}`, pass: rr >= rules.minRewardRisk - 1e-9, detail: `${rr.toFixed(2)}R` },
        { rule: 'Fits the cash in the account', pass: shares * entry <= account, detail: `$${(shares * entry).toFixed(2)} of $${account}` },
        { rule: `≤ ${rules.maxTradesPerDay} trades today`, pass: todayOrders.length < rules.maxTradesPerDay, detail: `${todayOrders.length} placed today` },
        { rule: `Daily loss limit ${rules.dailyLossLimitPct}%`, pass: realised > -account * rules.dailyLossLimitPct / 100,
          detail: `today's closed P&L $${realised.toFixed(2)}` },
    ];
    if (minutesToClose != null) {
        out.push({ rule: `No new entries in the last ${rules.noEntryLastMinutes} min`, pass: minutesToClose <= 0 || minutesToClose > rules.noEntryLastMinutes,
                   detail: minutesToClose > 0 ? `${Math.round(minutesToClose)} min to the close` : 'market is closed — paper fill at the snapshot price' });
    }
    if (replay) {
        out.push({ rule: 'Time Machine shows an edge', pass: replay.expectancy > rules.minTimeMachineEdge,
                   detail: `${replay.expectancy >= 0 ? '+' : ''}${replay.expectancy.toFixed(2)}R expected over ${replay.paths.toLocaleString()} replays` });
    }
    return { checks: out, approved: out.every(c => c.pass) };
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

/** Close paper positions whose stop or target the latest snapshot price has reached. */
export function markToMarket(orders, prices) {
    return orders.map(o => {
        if (o.status !== 'open' || prices[o.symbol] == null) return o;
        const p = prices[o.symbol], long = o.direction !== 'short';
        const hitStop = long ? p <= o.stop : p >= o.stop;
        const hitTarget = long ? p >= o.target : p <= o.target;
        const exit = hitStop ? o.stop : hitTarget ? o.target : null;
        const mark = exit ?? p;
        const pnl = (long ? mark - o.entry : o.entry - mark) * o.shares;
        return exit != null
            ? { ...o, status: 'closed', exit, exitReason: hitStop ? 'stop' : 'target', pnl, closedAt: new Date().toISOString() }
            : { ...o, last: p, pnl };
    });
}
