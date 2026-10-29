// ─── Moving Averages (up to 3 lines) ─────────────────────────────────────────
// Types, calculated like TradingView's ta.* functions:
//   SMA  simple · EMA exponential (seeded with the SMA of the first `len` values)
//   WMA  linearly weighted (newest weight len … oldest 1)
//   HMA  Hull = WMA(2·WMA(len/2) − WMA(len), round(√len))
//   SMMA smoothed / Wilder's RMA (α = 1/len, seeded with the SMA)
//   VWMA volume-weighted = Σ(src·vol) / Σvol over len (equal weights when there is no volume)
// Line 1 keeps the original single-line keys (mvType, mvLen, …); lines 2 and 3 use mv2* / mv3*.
// Crossovers of line 1 over line 2 (both on) are marked at candle close: +1 golden, −1 death.

export const MA_LINE_DEFAULTS = [
    { on: true, type: 'EMA', len: 20, source: 'close', color: '#2962ff', width: 2, style: 'solid' },
    { on: false, type: 'SMA', len: 50, source: 'close', color: '#ff9500', width: 2, style: 'solid' },
    { on: false, type: 'SMA', len: 200, source: 'close', color: '#af52de', width: 2, style: 'solid' },
];
const PREFIX = ['mv', 'mv2', 'mv3'];

/** Settings of line k (0–2), defaults filled in. Line 1 is on unless switched off explicitly. */
export function maLine(s, k) {
    const p = PREFIX[k], d = MA_LINE_DEFAULTS[k];
    const on = k === 0 ? s.mvOn !== false : !!s[`${p}On`];
    return {
        on, type: s[`${p}Type`] || d.type, len: Math.max(1, parseInt(s[`${p}Len`]) || d.len), source: s[`${p}Source`] || d.source,
        color: s[`${p}Color`] || d.color, width: Math.max(1, Math.min(4, Number(s[`${p}Width`]) || d.width)), style: s[`${p}Style`] || d.style,
    };
}

const srcOf = (key) => (c) => (key === 'hlc3' ? (c.high + c.low + c.close) / 3 : key === 'hl2' ? (c.high + c.low) / 2
    : key === 'ohlc4' ? (c.open + c.high + c.low + c.close) / 4 : c[key] ?? c.close);

function sma(v, n) {
    const out = new Array(v.length).fill(null); let s = 0, k = 0;
    for (let i = 0; i < v.length; i++) {
        if (v[i] == null) { s = 0; k = 0; continue; }
        s += v[i]; k++;
        if (k > n) { s -= v[i - n]; k = n; }
        if (k === n) out[i] = s / n;
    }
    return out;
}
function wma(v, n) {
    const out = new Array(v.length).fill(null), den = n * (n + 1) / 2;
    for (let i = n - 1; i < v.length; i++) {
        let s = 0, ok = true;
        for (let j = 0; j < n; j++) { const x = v[i - j]; if (x == null) { ok = false; break; } s += x * (n - j); }
        if (ok) out[i] = s / den;
    }
    return out;
}
function seededSmooth(v, n, alpha) {     // EMA / RMA: first value = SMA of the first n
    const out = new Array(v.length).fill(null); let prev = null, s = 0, k = 0;
    for (let i = 0; i < v.length; i++) {
        if (v[i] == null) continue;
        if (prev === null) { s += v[i]; k++; if (k === n) { prev = s / n; out[i] = prev; } continue; }
        prev = prev + alpha * (v[i] - prev); out[i] = prev;
    }
    return out;
}

/** One moving average over candles. */
export function maSeries(candles, { type = 'EMA', len = 20, source = 'close' } = {}) {
    const n = Math.max(1, len), get = srcOf(source), v = candles.map(get);
    switch (type) {
        case 'SMA': return sma(v, n);
        case 'WMA': return wma(v, n);
        case 'SMMA': return seededSmooth(v, n, 1 / n);
        case 'HMA': {
            const a = wma(v, Math.max(1, Math.floor(n / 2))), b = wma(v, n);
            return wma(v.map((_, i) => (a[i] == null || b[i] == null ? null : 2 * a[i] - b[i])), Math.max(1, Math.round(Math.sqrt(n))));
        }
        case 'VWMA': {
            const out = new Array(v.length).fill(null); let pv = 0, vv = 0;
            const hasVol = candles.some(c => c.volume > 0);
            for (let i = 0; i < v.length; i++) {
                const w = hasVol ? (candles[i].volume || 0) : 1;
                pv += v[i] * w; vv += w;
                if (i >= n) { const w0 = hasVol ? (candles[i - n].volume || 0) : 1; pv -= v[i - n] * w0; vv -= w0; }
                if (i >= n - 1) out[i] = vv > 0 ? pv / vv : null;
            }
            return out;
        }
        default: return seededSmooth(v, n, 2 / (n + 1));   // EMA
    }
}

/** Sets mvVal / mv2Val / mv3Val (null when that line is off) and mvCross on the candles. */
export function calcMovingAverages(candles, s = {}) {
    const keys = ['mvVal', 'mv2Val', 'mv3Val'];
    const lines = [0, 1, 2].map(k => maLine(s, k));
    lines.forEach((L, k) => {
        const vals = L.on ? maSeries(candles, L) : null;
        for (let i = 0; i < candles.length; i++) candles[i][keys[k]] = vals ? vals[i] : null;
    });
    const cross = lines[0].on && lines[1].on;
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i], p = candles[i - 1];
        c.mvCross = 0;
        if (!cross || !p || c.mvVal == null || c.mv2Val == null || p.mvVal == null || p.mv2Val == null) continue;
        if (p.mvVal <= p.mv2Val && c.mvVal > c.mv2Val) c.mvCross = 1;
        else if (p.mvVal >= p.mv2Val && c.mvVal < c.mv2Val) c.mvCross = -1;
    }
}
