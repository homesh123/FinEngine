// ─── Key levels near price (projection add-ons) ──────────────────────────────
// From confirmed swing points of the current timeframe (3-bar fractals, known 3
// bars after the swing — nothing repaints):
//  • Support / resistance: swing highs and lows within 0.35 × ATR of each other
//    are one level; a level needs ≥ 2 touches. The 2 nearest above and below the
//    live price are returned, with their touch count (more touches = stronger).
//  • Trendline: through the last two rising swing lows (uptrend) and/or the last
//    two falling swing highs (downtrend), kept only while no close has broken it.

const P = 3;

export function computeKeyLevels(c, { lookback = 300 } = {}) {
    const n = c ? c.length : 0;
    const ref = n - 2;                                   // last closed candle
    if (n < 40) return null;
    const start = Math.max(P, ref - lookback);
    const atr = c[ref].atr || (c[ref].high - c[ref].low) || 1;
    const highs = [], lows = [];
    for (let j = start; j <= ref - P; j++) {
        let ph = true, pl = true;
        for (let m = 1; m <= P; m++) {
            if (!(c[j].high > c[j - m].high && c[j].high >= c[j + m].high)) ph = false;
            if (!(c[j].low < c[j - m].low && c[j].low <= c[j + m].low)) pl = false;
        }
        if (ph) highs.push({ i: j, p: c[j].high });
        if (pl) lows.push({ i: j, p: c[j].low });
    }

    // Support / resistance: cluster all swing prices
    const pts = [...highs, ...lows].sort((a, b) => a.p - b.p);
    const tol = 0.35 * atr;
    const clusters = [];
    for (const pt of pts) {
        const cl = clusters[clusters.length - 1];
        if (cl && pt.p - cl.maxP <= tol) { cl.sum += pt.p; cl.k++; cl.maxP = pt.p; cl.first = Math.min(cl.first, pt.i); cl.last = Math.max(cl.last, pt.i); }
        else clusters.push({ sum: pt.p, k: 1, maxP: pt.p, first: pt.i, last: pt.i });
    }
    const px = c[n - 1].close;
    const lv = clusters.filter(cl => cl.k >= 2).map(cl => ({ price: cl.sum / cl.k, touches: cl.k, first: cl.first, last: cl.last }));
    const supports = lv.filter(l => l.price < px).sort((a, b) => b.price - a.price).slice(0, 2).map(l => ({ ...l, kind: 'support' }));
    const resistances = lv.filter(l => l.price > px).sort((a, b) => a.price - b.price).slice(0, 2).map(l => ({ ...l, kind: 'resistance' }));

    // Trendlines from the last two swings, valid while unbroken
    const trends = [];
    const unbroken = (a, b, up) => {
        const slope = (b.p - a.p) / (b.i - a.i);
        for (let k = a.i + 1; k <= ref; k++) {
            const line = a.p + slope * (k - a.i);
            if (up ? c[k].close < line - 0.1 * atr : c[k].close > line + 0.1 * atr) return null;
        }
        return slope;
    };
    if (lows.length >= 2) {
        const [a, b] = lows.slice(-2);
        if (b.p > a.p) { const s = unbroken(a, b, true); if (s !== null) trends.push({ kind: 'up', i1: a.i, p1: a.p, slope: s }); }
    }
    if (highs.length >= 2) {
        const [a, b] = highs.slice(-2);
        if (b.p < a.p) { const s = unbroken(a, b, false); if (s !== null) trends.push({ kind: 'down', i1: a.i, p1: a.p, slope: s }); }
    }
    return { levels: [...resistances, ...supports], trends };
}
