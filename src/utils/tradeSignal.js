// ─── Prediction trade signal ─────────────────────────────────────────────────
// A BUY / SELL only when every check agrees:
//   1. Traders Interest meter strong (|score| ≥ 40) and every timeframe leans the same way;
//   2. our price prediction points the same way (≥ 60 % of similar moments) and
//      has not been worse than a coin flip on this chart;
//   3. the Pressure analysis' higher-timeframe trend is not against it;
//   4. the levels leave room: stop beyond the nearest support / demand zone
//      (resistance / supply for a sell), target before the next opposite level
//      and within a normal move for the projection length, reward ≥ minRR × risk.
// Lot size risks a fixed % of the balance on that stop, capped so the margin
// stays small — a lot that is too big turns a normal stop-out into a big loss.
// Entry = last close (signals are judged on closed candles only).

const fmtP = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));

/** USD value of a 1.0 price move for 1 lot, and USD notional of 1 lot. null when unknown. */
export function contractInfo(symbol, price) {
    const s = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (/^XAU|^GOLD/.test(s)) return { perPoint: 100, notional: 100 * price };
    if (/^XAG|^SILVER/.test(s)) return { perPoint: 5000, notional: 5000 * price };
    if (/^(BTC|ETH)/.test(s)) return { perPoint: 1, notional: price };
    if (/^[A-Z]{6}$/.test(s)) {
        if (s.endsWith('USD')) return { perPoint: 100000, notional: 100000 * price };     // EURUSD, GBPUSD…
        if (s.startsWith('USD')) return { perPoint: 100000 / price, notional: 100000 };   // USDJPY, USDCAD…
    }
    return null;   // crosses, indices: contract size depends on the broker
}

/** Lots for a risk % on this stop, capped so margin ≤ maxMarginPct of the balance. */
export function sizeTrade(symbol, entry, stopDist, { balance = 1000, riskPct = 1, leverage = 100, maxMarginPct = 30 } = {}) {
    const ci = contractInfo(symbol, entry);
    if (!ci || !(stopDist > 0) || !(balance > 0)) return null;
    const down = (x) => Math.floor(x * 100 + 1e-9) / 100;
    const lossPerLot = stopDist * ci.perPoint;
    const marginPerLot = ci.notional / Math.max(1, leverage);
    let lots = down((balance * riskPct / 100) / lossPerLot);
    const marginCap = down((balance * maxMarginPct / 100) / marginPerLot);
    const cappedByMargin = lots > marginCap;
    if (cappedByMargin) lots = marginCap;
    const maxLots = Math.min(down((balance * 0.02) / lossPerLot), marginCap);   // never more than 2 % risk
    return {
        lots, maxLots, belowMin: lots < 0.01, cappedByMargin,
        risk: lots * lossPerLot, riskPct: (lots * lossPerLot) / balance * 100,
        minLotRisk: 0.01 * lossPerLot, margin: lots * marginPerLot,
    };
}

/**
 * c: candles (last = live), pp: path projection, mtf: useMtfStats result,
 * pc: Pressure analysis (zones, bias, atr), levels: computeKeyLevels result.
 * Returns { dir, entry, sl, tp, rr, hold, size, checks } — dir 0 = no signal.
 */
export function buildTradeSignal({ c, pp, mtf, pc, levels, symbol, cfg = {} }) {
    const minRR = cfg.minRR ?? 1.5;
    const checks = [];
    const add = (ok, text) => { checks.push({ ok, text }); return ok; };
    const n = c?.length || 0;
    if (n < 30 || !pp || !mtf?.ready) return { dir: 0, checks: [{ ok: false, text: 'Waiting for chart and meter data' }] };

    // 1. Traders Interest meter
    const sc = mtf.score, parts = mtf.parts || [];
    const dir = sc >= 40 ? 1 : sc <= -40 ? -1 : 0;
    const aligned = dir !== 0 && parts.every(p => (dir === 1 ? p.s > 10 : p.s < -10));
    add(dir !== 0 && aligned, dir === 0
        ? `Traders Interest meter not strong (${sc >= 0 ? '+' : ''}${sc.toFixed(0)}, needs ±40)`
        : aligned ? `Traders Interest meter strong ${dir === 1 ? 'BUY' : 'SELL'} (${sc >= 0 ? '+' : ''}${sc.toFixed(0)}), all timeframes agree`
            : 'Traders Interest meter strong, but the timeframes disagree');
    const d = dir || (pp.pUp >= 0.5 ? 1 : -1);   // direction the other checks are judged in

    // 2. our prediction
    const pDir = d === 1 ? pp.pUp : 1 - pp.pUp;
    const notWorse = pp.calls < 30 || pp.hitRate >= 0.5;
    add(pDir >= 0.6 && notWorse, pDir >= 0.6
        ? (notWorse ? `Prediction agrees (${Math.round(pDir * 100)}% ${d === 1 ? 'up' : 'down'})` : `Prediction agrees, but it was right only ${Math.round(pp.hitRate * 100)}% before`)
        : `Prediction not sure enough (${Math.round(pDir * 100)}% ${d === 1 ? 'up' : 'down'}, needs 60%)`);

    // 3. Pressure higher-timeframe trend
    const bias = pc?.bias ?? 0;
    add(bias !== -d, bias === d ? 'Pressure: bigger trend agrees' : bias === 0 ? 'Pressure: bigger trend neutral' : 'Pressure: bigger trend is against it');

    // 4. levels: stop, target, reward vs risk
    const last = c[n - 2], entry = last.close;
    const atr = pc?.atr || last.atr || (last.high - last.low) || entry * 0.001;
    const zones = (pc?.zones || []).filter(z => z.state < 2);
    const sr = levels?.levels || [];
    // protective levels behind the trade (support / demand for a buy)
    const behind = [
        ...sr.filter(l => (d === 1 ? l.kind === 'support' : l.kind === 'resistance')).map(l => l.price),
        ...zones.filter(z => z.dir === d).map(z => (d === 1 ? z.bottom : z.top)),
    ].filter(p => (d === 1 ? entry - p : p - entry) >= 0.5 * atr).sort((a, b) => Math.abs(entry - a) - Math.abs(entry - b));
    const lvl = behind.find(p => Math.abs(entry - p) <= 3 * atr);
    const sl = lvl != null ? lvl - d * 0.3 * atr : entry - d * 1.5 * atr;
    // obstacles ahead (resistance / supply for a buy)
    const ahead = [
        ...sr.filter(l => (d === 1 ? l.kind === 'resistance' : l.kind === 'support')).map(l => l.price),
        ...zones.filter(z => z.dir === -d).map(z => (d === 1 ? z.bottom : z.top)),
    ].filter(p => (d === 1 ? p - entry : entry - p) > 0.3 * atr).sort((a, b) => Math.abs(entry - a) - Math.abs(entry - b));
    const hz = Math.max(1, pp.horizon ?? 5);                 // current-candle mode counts as 1
    const reach = atr * Math.sqrt(hz);          // a normal move over the projection length
    let tp = entry + d * reach, why = `a normal ${hz}-candle move`;
    if (ahead.length && Math.abs(ahead[0] - entry) - 0.1 * atr < reach) { tp = ahead[0] - d * 0.1 * atr; why = `just before the next ${d === 1 ? 'resistance' : 'support'}`; }
    const risk = Math.abs(entry - sl), rr = Math.abs(tp - entry) / risk;
    const rr1 = (Math.floor(rr * 10) / 10).toFixed(1);   // round down, so a 1.46 never reads as "1.5, needs 1.5"
    add(rr >= minRR, rr >= minRR ? `Room to target: reward ${rr1}× the risk` : `Not enough room: target only ${rr1}× the risk (needs ${minRR}×)`);

    const ok = checks.every(x => x.ok);
    const size = sizeTrade(symbol, entry, risk, cfg);
    return {
        dir: ok ? d : 0, checks, entry, sl, tp, rr, risk, atr, size,
        slWhy: lvl != null ? `beyond the ${d === 1 ? 'support' : 'resistance'} at ${fmtP(lvl)}` : '1.5 × ATR (no level close enough)',
        tpWhy: why, hold: hz * 2, time: last.time,
    };
}

/** Did a signal's stop or target get hit after it was given? */
export function signalOutcome(c, sig) {
    for (let j = 0; j < c.length; j++) {
        const k = c[j];
        if (k.time <= sig.time) continue;
        if (sig.dir === 1 ? k.low <= sig.sl : k.high >= sig.sl) return 'sl';
        if (sig.dir === 1 ? k.high >= sig.tp : k.low <= sig.tp) return 'tp';
    }
    return 'open';
}
