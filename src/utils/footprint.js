import { computeProjection, beatsChance } from './projection.js';
// ─── Volume footprint calculation ────────────────────────────────────────────
// Follows TradingView's "Volume footprint charts" guide:
//  • Data: the finest intrabar data available, like TradingView's 1s → 1m → 60m
//    chain. Recent candles use 1-second bars built from MT5 ticks (when
//    available); then 1-minute bars (fetched separately on 1H+ charts); older
//    candles use the chart's own base bars. Each candle records its source.
//  • Buy/sell: an intrabar bar is "buy" if close > open, "sell" if close < open;
//    if equal, buy/sell by its close vs the previous bar's close; if that is also
//    equal, the same category as the previous bar. Its volume is spread over the
//    price rows it traded through.
//  • Imbalance (diagonal): buy at a row vs sell one row below, sell at a row vs
//    buy one row above; flagged when max ≥ (imbalance% / 100) × min.
//  • Stacked imbalances: N+ consecutive rows with the same-side imbalance,
//    projected forward until a later candle trades back into the zone.
//  • Row size: Auto = 0.2 × ATR (rounded to whole ticks), fixed once per
//    symbol/timeframe like TradingView (the caller passes it back as
//    opts.fixedRow), or Manual ticks per row.
//  • Value area: grows from the POC until VA% of the candle's volume.
// Forex/CFD feeds report tick volume (activity), not exchange-traded volume.

export const DEFAULT_FOOTPRINT_SETTINGS = {
    rowMode: 'auto',        // 'auto' (0.2 × ATR) | 'manual' (ticks per row)
    atrLength: 14,
    ticksPerRow: 10,
    display: 'cluster',     // 'cluster' | 'profile'
    type: 'buySell',        // 'buySell' | 'delta' | 'total' | 'ladder'
    gradient: true,
    valueArea: true,
    vaPct: 70,
    poc: true,
    summary: 'infobox',     // 'infobox' | 'table' | 'off'
    tableRows: ['volume', 'buy', 'sell', 'delta', 'deltaPct', 'cvd'],
    imbalancePct: 300,
    highlightImbalance: true,
    stacked: true,
    stackedLevels: 3,
    hoverInfo: true,        // hover a candle for an order-flow summary
    projection: true,       // next-candle odds from similar past order flow
    deltaBar: true,         // small buy-vs-sell bar under each candle
    visibleProfile: true,   // volume profile of the visible candles at the right edge
    unfinishedAuction: false, // diamond where both sides still traded at the high/low
};

export function footprintSettings(s) {
    return { ...DEFAULT_FOOTPRINT_SETTINGS, ...(s || {}) };
}

/** Smallest price step used by the data (e.g. 0.01, 0.001, 0.1). */
export function inferTickSize(bars) {
    const sample = bars.length > 400 ? bars.slice(-400) : bars;
    for (let k = 0; k <= 6; k++) {
        const m = Math.pow(10, k);
        let ok = true;
        for (const b of sample) {
            for (const p of [b.open, b.high, b.low, b.close]) {
                const v = p * m;
                if (Math.abs(v - Math.round(v)) > 0.02) { ok = false; break; }
            }
            if (!ok) break;
        }
        if (ok) return 1 / m;
    }
    // Prices aren't on a clean decimal grid (e.g. float noise): use a sensible
    // tick for the price level — ~4150 → 0.1, ~158 → 0.01, ~1.12 → 0.0001
    const ref = Math.abs(sample[sample.length - 1]?.close || 1) || 1;
    return Math.pow(10, Math.floor(Math.log10(ref)) - 4);
}

function atrAt(candles, length) {
    if (!candles.length) return 0;
    let atr = candles[0].high - candles[0].low;
    const a = 1 / Math.max(1, length);
    for (let i = 1; i < candles.length; i++) {
        const c = candles[i], pc = candles[i - 1].close;
        const tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
        atr = a * tr + (1 - a) * atr;
    }
    return atr;
}

/** Row size in price units, a whole number of ticks. */
export function resolveRowSize(candles, rawBars, s) {
    const tick = inferTickSize(rawBars);
    let ticks;
    if (s.rowMode === 'manual') {
        ticks = Math.max(1, Math.round(Number(s.ticksPerRow) || 1));
    } else {
        ticks = Math.max(1, Math.round((0.2 * atrAt(candles, s.atrLength)) / tick));
    }
    return { row: +(ticks * tick).toFixed(10), tick, ticksPerRow: ticks };
}

/** Columnar intrabar bars ({t,o,h,l,c,v}) → index with a moving pointer; null when empty. */
function intrabarIndex(intrabar, label) {
    if (!intrabar || !intrabar.t || !intrabar.t.length) return null;
    return { t: intrabar.t, o: intrabar.o, h: intrabar.h, l: intrabar.l, c: intrabar.c, v: intrabar.v, start: intrabar.t[0], ptr: 0, label };
}

/** Bars of `ib` inside [tStart, tEnd), only if `ib` starts at or before the candle. */
function sliceIntrabar(ib, tStart, tEnd) {
    if (!ib || ib.start > tStart) return null;
    while (ib.ptr < ib.t.length && ib.t[ib.ptr] < tStart) ib.ptr++;
    let j = ib.ptr;
    while (j < ib.t.length && ib.t[j] < tEnd) j++;
    return j > ib.ptr ? { from: ib.ptr, to: j - 1, cols: ib, label: ib.label } : null;
}

/**
 * Compute footprints for all candles.
 * @param candles  aggregated candles (mutated: adds `fp`, `delta`, `prediction`)
 * @param raw      chart raw bars (lower timeframe) — fallback intrabar source
 * @param ranges   [firstRawIdx, lastRawIdx] per candle
 * @param tfMins   chart timeframe in minutes
 * @param opts     { settings, intrabar (1s), intrabar1m (1m), fixedRow }
 */
export function computeFootprints(candles, raw, ranges, tfMins, opts = {}) {
    const s = footprintSettings(opts.settings);
    const fixed = opts.fixedRow;
    const { row, tick, ticksPerRow } = (s.rowMode !== 'manual' && fixed && fixed.row > 0)
        ? fixed : resolveRowSize(candles, raw, s);
    const ratio = Math.max(1, (Number(s.imbalancePct) || 300) / 100);
    const vaPct = Math.min(0.99, Math.max(0.1, (Number(s.vaPct) || 70) / 100));
    const stackN = Math.max(2, Math.round(Number(s.stackedLevels) || 3));
    const tfMs = tfMins * 60000;
    const ib = intrabarIndex(opts.intrabar, '1s');
    const ib1m = tfMins > 1 ? intrabarIndex(opts.intrabar1m, '1m') : null;
    // Raw bar size = median gap between bars (an average is inflated by market closures)
    const gaps = [];
    for (let r = Math.max(1, raw.length - 300); r < raw.length; r++) gaps.push(raw[r].time - raw[r - 1].time);
    gaps.sort((a, b) => a - b);
    const rawStep = gaps.length ? Math.max(1, Math.round(gaps[gaps.length >> 1] / 60000)) : tfMins;
    const rawLabel = rawStep >= 60 ? `${Math.round(rawStep / 60)}h` : `${Math.max(1, rawStep)}m`;

    const eps = row * 1e-6;
    const rowOf = (p) => Math.floor(p / row + 1e-7);
    const state = { prevClose: null, prevDir: 1 };
    let prevTotal = null, cvd = 0, cvdDay = null;

    for (let i = 0; i < candles.length; i++) {
        const cd = candles[i];
        const tStart = cd.time, tEnd = cd.time + tfMs;

        // Finest intrabar source covering the candle: 1s → 1m → chart base bars
        const src = sliceIntrabar(ib, tStart, tEnd) || sliceIntrabar(ib1m, tStart, tEnd);
        const bars = [];
        if (src) {
            const k = src.cols;
            for (let j = src.from; j <= src.to; j++) bars.push({ o: k.o[j], h: k.h[j], l: k.l[j], c: k.c[j], v: k.v[j] });
        } else {
            for (let r = ranges[i][0]; r <= ranges[i][1]; r++) {
                const b = raw[r];
                bars.push({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume || 0 });
            }
        }

        // Price rows spanned by this candle
        let lo = cd.low, hi = cd.high;
        for (const b of bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); }
        const base = rowOf(lo);
        const n = Math.max(1, rowOf(hi - eps) - base + 1);
        const bidF = new Float64Array(n), askF = new Float64Array(n);

        // Classify each intrabar bar (TradingView rule) and track running delta
        let run = 0, minDelta = 0, maxDelta = 0;
        for (const b of bars) {
            let dir;
            if (b.c > b.o) dir = 1;
            else if (b.c < b.o) dir = -1;
            else if (state.prevClose !== null && b.c > state.prevClose) dir = 1;
            else if (state.prevClose !== null && b.c < state.prevClose) dir = -1;
            else dir = state.prevDir;
            state.prevDir = dir;
            state.prevClose = b.c;
            if (!(b.v > 0)) continue;
            const k0 = Math.max(0, rowOf(b.l) - base);
            const k1 = Math.min(n - 1, Math.max(k0, rowOf(b.h - eps) - base));
            const per = b.v / (k1 - k0 + 1);
            const target = dir > 0 ? askF : bidF;
            for (let k = k0; k <= k1; k++) target[k] += per;
            run += dir * b.v;
            if (run < minDelta) minDelta = run;
            if (run > maxDelta) maxDelta = run;
        }

        const bid = new Int32Array(n), ask = new Int32Array(n);
        let buy = 0, sell = 0, poc = 0, pocVol = -1;
        for (let k = 0; k < n; k++) {
            bid[k] = Math.round(bidF[k]);
            ask[k] = Math.round(askF[k]);
            buy += ask[k];
            sell += bid[k];
            const t = bid[k] + ask[k];
            if (t > pocVol) { pocVol = t; poc = k; }
        }
        const total = buy + sell;

        // A candle built from a single lower-timeframe bar (e.g. 1m chart with only
        // 1m data) has no real volume distribution: every row gets the same value
        // on one side. Imbalances/stacks/arrows would be artifacts, so skip them.
        const coarse = bars.length < 2;

        // Diagonal imbalances: max(a, b) ≥ ratio × min(a, b), larger side wins
        const buyImb = new Uint8Array(n), sellImb = new Uint8Array(n);
        let buyCount = 0, sellCount = 0;
        for (let k = 0; k < n && !coarse; k++) {
            if (k > 0 && ask[k] > 0 && ask[k] >= ratio * bid[k - 1]) { buyImb[k] = 1; buyCount++; }
            if (k < n - 1 && bid[k] > 0 && bid[k] >= ratio * ask[k + 1]) { sellImb[k] = 1; sellCount++; }
        }

        // Stacked imbalances (N+ consecutive rows, same side)
        const stacks = [];
        for (const [flags, side] of [[buyImb, 'buy'], [sellImb, 'sell']]) {
            let runStart = -1;
            for (let k = 0; k <= n; k++) {
                if (k < n && flags[k]) { if (runStart < 0) runStart = k; continue; }
                if (runStart >= 0 && k - runStart >= stackN) {
                    stacks.push({ side, lo: (base + runStart) * row, hi: (base + k) * row, endTime: null });
                }
                runStart = -1;
            }
        }

        // Value area around the POC
        let vah = poc, val = poc, vaVol = Math.max(0, pocVol);
        while (vaVol < total * vaPct && (vah < n - 1 || val > 0)) {
            const up = vah < n - 1 ? bid[vah + 1] + ask[vah + 1] : -1;
            const dn = val > 0 ? bid[val - 1] + ask[val - 1] : -1;
            if (up >= dn) { vah++; vaVol += up; } else { val--; vaVol += dn; }
        }

        // Summary stats
        const delta = buy - sell;
        const day = Math.floor(cd.time / 86400000);
        if (tfMins >= 1440) cvd = delta;
        else { if (day !== cvdDay) { cvd = 0; cvdDay = day; } cvd += delta; }
        const stats = {
            volume: total, buy, sell, delta,
            buyPct: total ? (100 * buy) / total : 0,
            sellPct: total ? (100 * sell) / total : 0,
            deltaPct: total ? (100 * delta) / total : 0,
            volChangePct: prevTotal ? (100 * (total - prevTotal)) / prevTotal : null,
            minDelta, maxDelta, cvd,
            poc: (base + poc) * row,
            hlRange: cd.high - cd.low,
        };
        prevTotal = total;

        cd.fp = { row, tick, ticksPerRow, base, bid, ask, buyImb, sellImb, poc, vah, val, stacks, stats, coarse, src: src ? src.label : rawLabel };
        cd.delta = delta;
        cd.prediction = (delta > 0 && buyCount >= 2 && sellCount <= 1) ? 'UP'
            : (delta < 0 && sellCount >= 2 && buyCount <= 1) ? 'DOWN' : null;
    }

    // Delta strength relative to what's normal for the candle's data source:
    // 1s ticks and 1m bars split buy/sell very differently (a typical 5m candle
    // built from 1m bars leans ~40% one way, from 1s ticks far less), so fixed
    // % cut-offs would put candles from different sources in different classes.
    const absBySrc = new Map();
    for (const cd of candles) {
        if (cd.fp.coarse) continue;
        if (!absBySrc.has(cd.fp.src)) absBySrc.set(cd.fp.src, []);
        absBySrc.get(cd.fp.src).push(Math.abs(cd.fp.stats.deltaPct));
    }
    const medBySrc = new Map();
    for (const [k, arr] of absBySrc) {
        arr.sort((a, b) => a - b);
        // too few candles from this source to know its normal → use all sources
        medBySrc.set(k, arr.length >= 30 ? arr[arr.length >> 1] : null);
    }
    const allAbs = [].concat(...absBySrc.values()).sort((a, b) => a - b);
    const medAll = allAbs.length ? allAbs[allAbs.length >> 1] : 0;
    for (const cd of candles) {
        const m = medBySrc.get(cd.fp.src) || medAll;
        cd.fp.deltaRel = m > 0 ? cd.fp.stats.deltaPct / m : 0;
    }

    // Track record of the order-flow arrows on this chart (arrow on candle i →
    // did candle i+1 close that way?). They're drawn only when it beats chance.
    let aCalls = 0, aHits = 0;
    for (let i = 0; i < candles.length - 2; i++) {
        const p = candles[i].prediction, nx = candles[i + 1];
        if (!p || nx.close === nx.open) continue;
        aCalls++;
        if ((p === 'UP') === (nx.close > nx.open)) aHits++;
    }
    const arrowRecord = { calls: aCalls, hitRate: aCalls ? aHits / aCalls : 0, proven: beatsChance(aHits, aCalls) };
    for (const cd of candles) cd.fp.arrowRecord = arrowRecord;

    // Next-candle odds from similar past order flow (stored on the live candle)
    if (s.projection && candles.length > 2) {
        candles[candles.length - 1].fp.projection = computeProjection(candles, flowClass, FLOW_CLASS_BASIS, describeFlow);
    }

    // Project stacked imbalances forward until a later candle trades into the zone
    for (let i = 0; i < candles.length; i++) {
        const st = candles[i].fp.stacks;
        if (!st.length) continue;
        for (const z of st) {
            for (let j = i + 1; j < Math.min(candles.length, i + 500); j++) {
                if (candles[j].low < z.hi && candles[j].high > z.lo) { z.endTime = candles[j].time; break; }
            }
        }
    }
    return { row, tick, ticksPerRow };
}


// Order-flow class of candle i for the next-candle projection (see projection.js):
// delta strength, close vs value area, stacked imbalances. Approximate (coarse)
// footprints are skipped.
function flowClass(candles, i) {
    const c = candles[i];
    const fp = c.fp;
    if (!fp || fp.coarse) return null;
    // delta vs this data source's typical |delta %| (1 = an ordinary candle)
    const r = fp.deltaRel;
    const d = r <= -1.5 ? -2 : r < -0.5 ? -1 : r <= 0.5 ? 0 : r < 1.5 ? 1 : 2;
    const vah = (fp.base + fp.vah + 1) * fp.row, val = (fp.base + fp.val) * fp.row;
    const va = c.close > vah ? 1 : c.close < val ? -1 : 0;
    let stk = 0;
    for (const z of fp.stacks) stk += z.side === 'buy' ? 1 : -1;
    stk = Math.sign(stk);
    return [`${d}|${va}|${stk}`, `${d}|${va}`, `${d}`, 'all'];
}
const FLOW_CLASS_BASIS = [
    'same delta strength (vs normal), value-area close and stacked imbalances', 'same delta strength and value-area close', 'same delta strength', 'all candles on this chart',
];

/** Plain words for a footprint candle's order flow (matches flowClass). */
function describeFlow(candles, i) {
    const c = candles[i], fp = c.fp, r = fp.deltaRel;
    const out = [r >= 1.5 ? `unusually strong buying (buyers ${Math.round(fp.stats.buyPct)}% of volume)`
        : r > 0.5 ? `buyers ahead (${Math.round(fp.stats.buyPct)}% of volume)`
        : r >= -0.5 ? 'buyers and sellers about balanced for this chart'
        : r > -1.5 ? `sellers ahead (${Math.round(fp.stats.sellPct)}% of volume)`
        : `unusually strong selling (sellers ${Math.round(fp.stats.sellPct)}% of volume)`];
    const vah = (fp.base + fp.vah + 1) * fp.row, val = (fp.base + fp.val) * fp.row;
    out.push(c.close > vah ? 'it closed above the price zone where most trading happened'
        : c.close < val ? 'it closed below the price zone where most trading happened'
        : 'it closed inside the price zone where most trading happened');
    let stk = 0;
    for (const z of fp.stacks) stk += z.side === 'buy' ? 1 : -1;
    if (stk > 0) out.push('it had stacked buy imbalances (aggressive buyers at several prices)');
    if (stk < 0) out.push('it had stacked sell imbalances (aggressive sellers at several prices)');
    return out;
}
