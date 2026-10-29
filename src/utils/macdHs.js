// ─── MACD H&S Breakout Scanner (port of the forex24hr Pine script) ───────────
// Head & shoulders (bearish) / inverse H&S (bullish) from pivot highs/lows
// (lookback L on both sides), validated by MACD(12,26,9) "exhaustion":
//   bearish: MACD > 0 at LS and HEAD, ≤ threshold at RS, < 0 at the last valley
//   bullish: MACD < 0 at LS and HEAD, ≥ 0 at RS, > 0 at the last valley
// Pivot order must alternate: v3 < LS < v2 < HEAD < v1 < RS < v0 (bar index).
//
// Fixes vs. the Pine original:
//   • patterns are evaluated once per newly confirmed pivot (the script ran the
//     check on every bar and redrew the same pattern until its line limit)
//   • neckline = the two troughs either side of the head (v2 → v1), extended —
//     the textbook neckline the breakout is measured against
//   • section 5 never emitted anything; now a breakout is a close beyond the
//     neckline with MACD on the pattern's side of zero, one signal per pattern
//   • SL beyond the right shoulder, TP = measured move (head → neckline)
//   • a pattern expires when price takes out the head, or after 3× its width
// Optional higher-timeframe (D/W) context runs the same detection on HTF bars.

export const MACD_HS_DEFAULTS = { mhsLookback: 5, mhsZeroThres: 0, mhsShowHTF: true, mhsHtf: 'D' };

function macdLine(closes) {
    const out = new Array(closes.length).fill(null);
    let f = null, s = null, sf = 0, ss = 0;
    for (let i = 0; i < closes.length; i++) {
        const c = closes[i];
        if (i < 12) { sf += c; if (i === 11) f = sf / 12; } else f += (c - f) * (2 / 13);
        if (i < 26) { ss += c; if (i === 25) s = ss / 26; } else s += (c - s) * (2 / 27);
        if (f !== null && s !== null) out[i] = f - s;
    }
    return out;
}

/** Detect patterns on bars [{high, low, close}] with MACD values `m`. */
function detect(bars, m, L, thres) {
    const n = bars.length;
    const patterns = [];
    for (const isHigh of [true, false]) {
        const peaks = [], valleys = [];          // most recent last: { b, p }
        const seen = new Set();
        for (let i = 2 * L; i < n; i++) {
            const c = i - L;                     // candidate pivot bar, confirmed at bar i
            let ph = true, pl = true;
            for (let j = c - L; j <= c + L; j++) {
                if (j === c) continue;
                if (bars[j].high >= bars[c].high) ph = false;   // ta.pivothigh: strictly highest
                if (bars[j].low <= bars[c].low) pl = false;
                if (!ph && !pl) break;
            }
            const isPeak = isHigh ? ph : pl, isValley = isHigh ? pl : ph;
            if (isPeak) peaks.push({ b: c, p: isHigh ? bars[c].high : bars[c].low });
            if (isValley) valleys.push({ b: c, p: isHigh ? bars[c].low : bars[c].high });
            if (!(isPeak || isValley) || peaks.length < 3 || valleys.length < 4) continue;

            const [P3, P2, P1] = peaks.slice(-3);            // LS, HEAD, RS
            const [V3, V2, V1, V0] = valleys.slice(-4);
            if (!(V3.b < P3.b && P3.b < V2.b && V2.b < P2.b && P2.b < V1.b && V1.b < P1.b && P1.b < V0.b)) continue;
            const structure = isHigh ? (P2.p > P3.p && P2.p > P1.p) : (P2.p < P3.p && P2.p < P1.p);
            const mLS = m[P3.b], mHD = m[P2.b], mRS = m[P1.b], mEnd = m[V0.b];
            if (mLS == null || mHD == null || mRS == null || mEnd == null) continue;
            const exhausted = isHigh
                ? mLS > 0 && mHD > 0 && mRS <= thres && mEnd < 0
                : mLS < 0 && mHD < 0 && mRS >= 0 && mEnd > 0;
            if (!structure || !exhausted) continue;
            const key = `${P1.b}:${V0.b}`;
            if (seen.has(key)) continue;
            seen.add(key);
            patterns.push({ side: isHigh ? 'bear' : 'bull', confirmedAt: i, ls: P3, head: P2, rs: P1, v: [V3, V2, V1, V0] });
        }
    }
    return patterns;
}

/** Neckline price at bar index b (line through the troughs next to the head). */
const neckAt = (pt, b) => {
    const [, V2, V1] = pt.v;
    const slope = V1.b === V2.b ? 0 : (V1.p - V2.p) / (V1.b - V2.b);
    return V2.p + slope * (b - V2.b);
};

/** Breakouts on the chart bars for patterns whose indices are chart-bar indices. */
function breakouts(candles, m, patterns) {
    for (const pt of patterns) {
        const width = pt.rs.b - pt.ls.b;
        const expire = pt.confirmedAt + Math.max(10, width * 3);
        for (let i = pt.confirmedAt; i < candles.length && i <= expire; i++) {
            const c = candles[i];
            if (pt.side === 'bear' ? c.high > pt.head.p : c.low < pt.head.p) { pt.invalidAt = i; break; }
            const neck = neckAt(pt, i);
            const broke = pt.side === 'bear' ? c.close < neck : c.close > neck;
            const macdOk = m[i] != null && (pt.side === 'bear' ? m[i] < 0 : m[i] > 0);
            if (broke && macdOk) {
                const dir = pt.side === 'bear' ? -1 : 1;
                const height = Math.abs(pt.head.p - neckAt(pt, pt.head.b));
                const atr = c.atr || 0;
                const sl = dir === -1 ? pt.rs.p + atr * 0.2 : pt.rs.p - atr * 0.2;
                pt.signal = { i, dir, entry: c.close, sl, tp: c.close + dir * height, neck };
                c.macdHsSignal = { dir, entry: c.close, sl, tp: pt.signal.tp, time: c.time };
                break;
            }
        }
        pt.neckEnd = pt.signal ? pt.signal.i : (pt.invalidAt ?? Math.min(candles.length - 1, expire));
    }
}

const htfKey = (t, tf) => {
    const day = Math.floor(t / 86400000);
    return tf === 'W' ? Math.floor((day + 3) / 7) : day;     // weeks start Monday
};

export function calcMacdHs(candles, s = {}) {
    const L = Math.max(2, parseInt(s.mhsLookback, 10) || MACD_HS_DEFAULTS.mhsLookback);
    const thres = Number.isFinite(Number(s.mhsZeroThres)) ? Number(s.mhsZeroThres) : 0;
    for (const c of candles) c.macdHsSignal = null;
    if (candles.length < 4 * L + 30) return [];

    const m = candles.map(c => c.macdLine ?? null);
    const chart = detect(candles, m, L, thres);
    chart.forEach(p => { p.tf = 'chart'; });
    breakouts(candles, m, chart);

    let htf = [];
    if (s.mhsShowHTF !== false) {
        const tf = s.mhsHtf === 'W' ? 'W' : 'D';
        const bars = [];
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i], k = htfKey(c.time, tf);
            const last = bars[bars.length - 1];
            if (!last || last.k !== k) bars.push({ k, high: c.high, low: c.low, close: c.close, first: i, last: i });
            else { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; last.last = i; }
        }
        // Map HTF pivots onto chart bars (the chart candle of the HTF extreme)
        const toChart = (bi, isHighPrice, price) => {
            const b = bars[bi];
            for (let i = b.first; i <= b.last; i++) if ((isHighPrice ? candles[i].high : candles[i].low) === price) return i;
            return b.first;
        };
        // The script reads full HTF history (request.security); here only the
        // chart's own candles exist — skip when they cover too few HTF bars
        if (bars.length < 4 * L + 30) return chart;
        const hp = detect(bars, macdLine(bars.map(b => b.close)), L, thres);
        htf = hp.filter(p => bars[p.confirmedAt]).map(p => {
            const hi = p.side === 'bear';
            const map = (pt, highPrice) => ({ b: toChart(pt.b, highPrice, pt.p), p: pt.p });
            return {
                side: p.side, tf, confirmedAt: bars[p.confirmedAt].last,
                ls: map(p.ls, hi), head: map(p.head, hi), rs: map(p.rs, hi),
                v: p.v.map(v => map(v, !hi)),
                neckEnd: Math.min(candles.length - 1, bars[p.confirmedAt].last),
            };
        });
    }
    return chart.concat(htf);
}

export { neckAt as macdHsNeckAt };
