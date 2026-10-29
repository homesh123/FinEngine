// ─── Volume-Based Support & Resistance ───────────────────────────────────────
// Heavy-volume candles (volume ≥ factor × its SMA) mark prices where many traders
// acted. For candle i, every heavy candle in the previous `lookback` bars gives:
//   its HIGH as resistance when that high is above the close of candle i,
//   its LOW  as support    when that low  is below it
// (a broken resistance below price becomes support, and vice versa).
// Heaviest candles first; levels within mergePct % of a stronger one are merged
// into it. Strength = that candle's volume ÷ its volume SMA. No lookahead: only
// candles before i are used.

export function vbrLevelsAt(candles, i, volSma, { lookback = 200, factor = 2, minVol = 0, maxLevels = 12, mergePct = 0.2 } = {}) {
    const ref = candles[i].close, cands = [];
    for (let j = Math.max(0, i - lookback); j < i; j++) {
        const k = candles[j], sma = volSma[j];
        if (!sma || !(k.volume > 0) || k.volume < Math.max(sma * factor, minVol)) continue;
        const strength = k.volume / sma;
        if (k.high > ref) cands.push({ price: k.high, kind: 'resistance', strength, i: j });
        if (k.low < ref) cands.push({ price: k.low, kind: 'support', strength, i: j });
    }
    cands.sort((a, b) => b.strength - a.strength);
    const out = [];
    for (const c of cands) {
        if (out.some(l => Math.abs(l.price - c.price) <= c.price * mergePct / 100)) continue;
        out.push(c);
        if (out.length >= maxLevels) break;
    }
    return out.sort((a, b) => a.price - b.price);
}

/** Simple moving average of volume (null until `len` bars). */
export function volumeSma(candles, len) {
    const out = new Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
        sum += candles[i].volume || 0;
        if (i >= len) sum -= candles[i - len].volume || 0;
        if (i >= len - 1) out[i] = sum / len;
    }
    return out;
}
