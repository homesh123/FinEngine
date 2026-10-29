// ─── Future-candle projection (analog forecasting) ───────────────────────────
// Not a crystal ball: "the last few candles looked like THIS before — what
// happened next?" For the last K closed candles we build a shape vector (body,
// wicks and close-to-close move of each, in ATR units so it works at any price
// level), find the most similar windows in this chart's own history, and take
// what the next H candles did after each of them. The drawn candles are the
// median path; the shaded band is the middle 50% of those outcomes.
//
// It scores itself walk-forward: at past points, using only data available
// then, it makes the same call and checks the result. Direction colours are
// only used when those past calls were right clearly more often than chance.

import { escapeHtml as esc } from './footprintInsights.js';
import { beatsChance } from './projection.js';

const K = 4;               // candles in the shape window
const ANALOGS = 30;        // similar setups used (default; 10 / 30 / 50 in settings)
const SEARCH = 2000;       // how far back to search (candles)
const VALIDATE = 300;      // past points scored walk-forward (60 gave figures like "65%" that were noise)
const selfCheckCache = new Map();
const MIN_CALLS = 30;   // ("proven" = hit rate clearly above 50%, see beatsChance)

const quantile = (arr, q) => {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr).sort();
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
};

function features(c, j) {
    // shape of candles j-K+1 … j, scaled by ATR at j
    const atr = c[j].atr;
    if (!(atr > 0)) return null;
    const f = new Float64Array(K * 4);
    for (let t = 0; t < K; t++) {
        const d = c[j - t], p = c[j - t - 1];
        if (!d || !p) return null;
        const top = Math.max(d.open, d.close), bot = Math.min(d.open, d.close);
        f[t * 4] = (d.close - d.open) / atr;
        f[t * 4 + 1] = (d.high - top) / atr;
        f[t * 4 + 2] = (bot - d.low) / atr;
        f[t * 4 + 3] = (d.close - p.close) / atr;
    }
    return f;
}

/** Nearest analog windows ending in [from, to] (non-overlapping), most similar first. */
function nearest(feat, target, from, to, count) {
    const cand = [];
    for (let j = from; j <= to; j++) {
        const f = feat[j];
        if (!f) continue;
        let d = 0;
        for (let q = 0; q < f.length; q++) { const e = f[q] - target[q]; d += e * e; }
        cand.push([d, j]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const picked = [];
    for (const [, j] of cand) {
        if (picked.every(p => Math.abs(p - j) > K)) picked.push(j);
        if (picked.length >= count) break;
    }
    return picked;
}

/**
 * @param candles chart candles (last = live)
 * @param horizon future candles to project after the live one; 0 = how the live
 *        (forming) candle itself closes, from its open
 * @param analogs similar past setups to use
 * @returns null | { path: [{o,h,l,c}], band: [{lo,hi}], pUp, n, hitRate, calls, proven, dir, horizon, anchor }
 */
export function computePathProjection(candles, horizon = 5, analogs = ANALOGS) {
    const n = candles.length;
    const live = n - 1, ref = n - 2;                 // ref = last closed candle
    const current = horizon === 0;
    const skip = current ? 0 : 1;                    // candles between an analog's window and its outcome
    if (current) horizon = 1;
    if (n < K + horizon + 60) return null;
    const lo = Math.max(K + 1, ref - SEARCH);
    const feat = new Array(n);
    for (let j = lo; j <= ref; j++) feat[j] = features(candles, j);
    const target = feat[ref];
    if (!target) return null;

    // Outcome of an analog ending at j: candles j+2 … j+1+h relative to the
    // close of j+1 (the analog's "live" candle), in ATR units of j.
    // Current-candle mode: candle j+1 itself, relative to the close of j.
    const outcome = (j) => {
        const atr = candles[j].atr, base = candles[j + skip].close, out = [];
        for (let t = 1; t <= horizon; t++) {
            const d = candles[j + skip + t];
            out.push({ o: (d.open - base) / atr, h: (d.high - base) / atr, l: (d.low - base) / atr, c: (d.close - base) / atr });
        }
        return out;
    };
    const lastEnd = ref - horizon - skip;               // analog outcomes must be closed candles
    const minN = Math.min(10, analogs);
    const picked = nearest(feat, target, lo, lastEnd, analogs);
    if (picked.length < minN) return null;
    const outs = picked.map(outcome);

    const atrNow = candles[ref].atr, anchor = current ? candles[ref].close : candles[live].close;
    const path = [], band = [];
    let prevC = 0;
    for (let t = 0; t < horizon; t++) {
        const c = quantile(outs.map(o => o[t].c), 0.5);
        const o = prevC;                                  // continuous: opens at the previous close
        const h = Math.max(o, c, quantile(outs.map(x => x[t].h), 0.5));
        const l = Math.min(o, c, quantile(outs.map(x => x[t].l), 0.5));
        path.push({ o: anchor + o * atrNow, h: anchor + h * atrNow, l: anchor + l * atrNow, c: anchor + c * atrNow });
        band.push({ lo: anchor + quantile(outs.map(x => x[t].c), 0.25) * atrNow, hi: anchor + quantile(outs.map(x => x[t].c), 0.75) * atrNow });
        prevC = c;
    }
    const finals = outs.map(o => o[horizon - 1].c);
    const pUp = finals.filter(v => v > 0).length / finals.length;

    // Walk-forward self-check: same method at past points, past data only
    // It only changes when a candle closes: cached per closed candle and setting (it is the slow part)
    const vKey = `${candles[ref].time}|${candles[lo].time}|${n}|${horizon}|${skip}|${analogs}`;
    let calls = 0, hits = 0;
    const cached = selfCheckCache.get(vKey);
    if (cached) ({ calls, hits } = cached);
    const vFrom = Math.max(lo + 200, ref - 1500), vTo = ref - horizon - skip - 1;
    if (!cached && vTo > vFrom) {
        const step = Math.max(1, Math.floor((vTo - vFrom) / VALIDATE));
        for (let r = vFrom; r <= vTo; r += step) {
            if (!feat[r]) continue;
            const pk = nearest(feat, feat[r], lo, r - horizon - skip - 1, analogs);
            if (pk.length < minN) continue;
            const fin = pk.map(j => outcome(j)[horizon - 1].c);
            const up = fin.filter(v => v > 0).length / fin.length;
            if (up > 0.45 && up < 0.55) continue;         // no call
            const actual = candles[r + skip + horizon].close - candles[r + skip].close;
            if (actual === 0) continue;
            calls++;
            if ((up >= 0.55) === (actual > 0)) hits++;
        }
    }
    if (!cached) {
        selfCheckCache.set(vKey, { calls, hits });
        if (selfCheckCache.size > 40) selfCheckCache.delete(selfCheckCache.keys().next().value);
    }
    const hitRate = calls ? hits / calls : 0;
    const proven = beatsChance(hits, calls);
    const rawDir = pUp >= 0.55 ? 1 : pUp <= 0.45 ? -1 : 0;
    return { path, band, pUp, n: picked.length, hitRate, calls, proven, dir: proven ? rawDir : 0, rawDir, horizon: current ? 0 : horizon, current, analogs, anchor, refTime: candles[ref].time };
}

/** "This candle" / "Next candle" / "Next 5 candles". */
export const horizonLabel = (pp) => (pp.current ? 'This candle' : pp.horizon === 1 ? 'Next candle' : `Next ${pp.horizon} candles`);

/** Hover explanation in plain words. */
export function pathExplanationHtml(pp, colors, isDark) {
    const up = Math.round(pp.pUp * 100), hit = Math.round(pp.hitRate * 100);
    const head = isDark ? '#818cf8' : '#4f46e5';
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
    const end = pp.path[pp.path.length - 1].c;
    return `<div style="font-weight:700;color:${head};margin-bottom:4px">${horizonLabel(pp)} — ${up >= 50 ? `${up}% probability higher` : `${100 - up}% probability lower`}</div>
<div>Found the <b>${pp.n}</b> moments on this chart whose last ${K} candles looked most like now (body, wicks and moves, scaled by volatility), and took what ${pp.current ? 'the following candle did from its open' : `the next ${pp.horizon} candle(s) did after each`}.</div>
<div style="margin-top:4px">Drawn candles = the <b>median</b> path; shaded band = middle half of those outcomes. ${up}% of them ended higher ${pp.current ? 'at the close of that candle' : `after ${pp.horizon} candle(s)`} (median end ${esc(fmt(end))}).</div>
<div style="margin-top:4px">${pp.calls >= MIN_CALLS ? `Self-check: at ${pp.calls} past points this method called the direction right <b>${hit}%</b> of the time. ${pp.proven ? 'That beats chance, so the candles are coloured by direction.' : 'That is not clearly better than a coin flip, so the candles are grey — treat them as a typical shape, not a call.'}` : `Self-check: this chart has too little history to test the method yet (${pp.calls} past calls), so the candles are grey — a typical shape, not a call. Load more history (scroll left) or use a lower timeframe.`}</div>
<div style="margin-top:4px;opacity:.75">Statistics from this chart only — not financial advice.</div>`;
}
