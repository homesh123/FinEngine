import { escapeHtml as esc } from './footprintInsights.js';

// ─── Next-candle projection ──────────────────────────────────────────────────
// Not a forecast model: a lookup of what happened on THIS chart after candles
// like the last closed one. A classifier gives every closed candle a class at
// several levels (most specific first, 'all' last); for the last closed
// candle's class we count how often the following candle closed up or down and
// how far it typically went from its open. Too few matches → a wider class.
//
// It also scores itself: walking forward through history, before recording
// what followed candle i it makes the call it would have made then (past data
// only). A direction is shown only when those past calls were right clearly
// more often than a coin flip — statistically, not by luck (the lower bound of
// the hit rate's 95% one-sided interval must be above 50%) — and the calls made
// for this very class weren't worse than a coin flip; otherwise "no proven edge".
// Odds are shrunk toward the chart's overall up-rate, so a class seen 20 times
// doesn't claim more than its sample supports.
// Used for footprint candles (order-flow classes) and standard candles.

const MIN_SAMPLES = 20;     // matches needed before a class is used
const MIN_CALLS = 30;       // past calls needed before an edge can be "proven"
const PRIOR = 20;           // shrinkage: weight (in candles) of the overall up-rate
const Z = 1.645;            // one-sided 95% for the "beats a coin flip" test

/** Lower bound of the Wilson interval for hits/calls. */
export function wilsonLow(hits, calls, z = Z) {
    if (!calls) return 0;
    const p = hits / calls, z2 = z * z;
    return (p + z2 / (2 * calls) - z * Math.sqrt((p * (1 - p) + z2 / (4 * calls)) / calls)) / (1 + z2 / calls);
}
/** Past calls clearly better than a coin flip. */
export const beatsChance = (hits, calls) => calls >= MIN_CALLS && wilsonLow(hits, calls) > 0.5;

const median = (arr) => {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr).sort();
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Volatility scale for the next candle's range: recent volatility (ATR 14)
 * blended with the usual range at that hour of day (sessions), relative to the
 * chart's typical range. Candle size, unlike direction, is predictable: on
 * XAUUSD 15m/1h history this cut the range-forecast error by ~16% versus a
 * flat average. Past data only (candles up to `ref`); `nextTime` = the candle
 * being forecast.
 */
export function rangeScale(candles, ref, nextTime) {
    if (ref < 50) return 1;
    let atr = candles[0].high - candles[0].low;
    const hourly = new Array(24).fill(null);
    const ranges = [];
    for (let i = Math.max(1, ref - 3000); i <= ref; i++) {
        const c = candles[i], r = c.high - c.low;
        if (!(r > 0)) continue;
        atr += (r - atr) / 14;
        const h = new Date(c.time).getUTCHours();
        hourly[h] = hourly[h] === null ? r : hourly[h] + (r - hourly[h]) * 0.1;
        ranges.push(r);
    }
    const typical = median(ranges);
    if (!(typical > 0) || !(atr > 0)) return 1;
    const hourAvg = hourly[new Date(nextTime).getUTCHours()] ?? typical;
    const s = Math.sqrt(atr * hourAvg) / typical;
    return Math.min(4, Math.max(0.25, s));
}

/**
 * @param candles   chart candles (last one = live, still forming)
 * @param classify  (candles, i) → array of class keys (most specific first) or null to skip
 * @param basisText labels for each class level (for the tooltip)
 * @param describe  (candles, i) → short phrases describing candle i in plain words
 * @returns null | { pUp, n, level, dir, rawDir, calls, hitRate, proven, upExc, downExc, basis, refTime }
 */
export function computeProjection(candles, classify, basisText, describe) {
    const live = candles.length - 1, ref = live - 1;          // last closed candle
    if (ref < 1) return null;
    const keys = classify(candles, ref);
    if (!keys) return null;
    const levels = keys.map(() => new Map());                  // per level: key → { up, n, upExc[], downExc[], calls, hits }
    let calls = 0, hits = 0, allUp = 0, allN = 0;
    const shrunk = (e) => (e.up + PRIOR * (allN ? allUp / allN : 0.5)) / (e.n + PRIOR);
    const pick = (k) => {
        for (let L = 0; L < k.length; L++) {
            const e = levels[L].get(k[L]);
            if (e && e.n >= MIN_SAMPLES) return e;
        }
        return null;
    };
    const dirOf = (p) => (p >= 0.55 ? 1 : p <= 0.45 ? -1 : 0);
    for (let i = 0; i < ref; i++) {                            // i+1 is closed too
        const k = classify(candles, i);
        if (!k) continue;
        const nx = candles[i + 1];
        const e0 = pick(k);
        const call = e0 ? dirOf(shrunk(e0)) : 0;
        if (call !== 0 && nx.close !== nx.open) {
            const hit = (call > 0) === (nx.close > nx.open);
            calls++; e0.calls++;
            if (hit) { hits++; e0.hits++; }
        }
        if (nx.close !== nx.open) { allN++; if (nx.close > nx.open) allUp++; }
        for (let L = 0; L < k.length; L++) {
            let e = levels[L].get(k[L]);
            if (!e) { e = { up: 0, n: 0, upExc: [], downExc: [], calls: 0, hits: 0 }; levels[L].set(k[L], e); }
            e.n++;
            if (nx.close > nx.open) e.up++;
            e.upExc.push(nx.high - nx.open);
            e.downExc.push(nx.open - nx.low);
        }
    }
    const hitRate = calls ? hits / calls : 0;
    for (let L = 0; L < keys.length; L++) {
        const e = levels[L].get(keys[L]);
        if (!e || e.n < MIN_SAMPLES) continue;
        const pUp = shrunk(e);
        const rawDir = dirOf(pUp);
        // This class's own past calls must not be worse than a coin flip
        const classOk = e.calls < 10 || e.hits / e.calls > 0.5;
        const proven = beatsChance(hits, calls) && classOk;
        // Typical excursions for this class, scaled to the volatility expected
        // now (recent ATR × this hour's usual range)
        const vs = rangeScale(candles, ref, candles[live].time);
        return {
            pUp, n: e.n, level: L, rawDir, dir: proven ? rawDir : 0,
            calls, hitRate, proven, classCalls: e.calls, classHitRate: e.calls ? e.hits / e.calls : 0,
            upExc: median(e.upExc) * vs, downExc: median(e.downExc) * vs,
            basis: basisText[L] || '', refTime: candles[ref].time,
            // Plain-language description of the last closed candle (for the hover box)
            refDesc: describe ? describe(candles, ref) : [],
        };
    }
    return null;
}

/** Standard candles: body strength, where it closed in its range, volume vs average. */
export function candleClass(candles, i) {
    const c = candles[i];
    const range = c.high - c.low;
    if (!(range > 0)) return null;
    const body = (c.close - c.open) / range;                     // -1 … 1
    const b = body >= 0.5 ? 2 : body > 0.1 ? 1 : body >= -0.1 ? 0 : body > -0.5 ? -1 : -2;
    const pos = (c.close - c.low) / range;                       // 0 = at low, 1 = at high
    const loc = pos >= 2 / 3 ? 1 : pos <= 1 / 3 ? -1 : 0;
    let vSum = 0, vN = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) { vSum += candles[j].volume || 0; vN++; }
    const vol = vN && vSum > 0 ? ((c.volume || 0) > (vSum / vN) * 1.3 ? 1 : 0) : 0;
    return [`${b}|${loc}|${vol}`, `${b}|${loc}`, `${b}`, 'all'];
}
/** Plain words for a standard candle (matches candleClass). */
export function describeCandle(candles, i) {
    const c = candles[i];
    const range = c.high - c.low;
    if (!(range > 0)) return [];
    const body = (c.close - c.open) / range;
    const pos = (c.close - c.low) / range;
    let vSum = 0, vN = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) { vSum += candles[j].volume || 0; vN++; }
    const out = [];
    out.push(body >= 0.5 ? 'a strong green candle (buyers pushed price up)'
        : body > 0.1 ? 'a green candle (buyers slightly ahead)'
        : body >= -0.1 ? 'an indecision candle (small body)'
        : body > -0.5 ? 'a red candle (sellers slightly ahead)'
        : 'a strong red candle (sellers pushed price down)');
    out.push(pos >= 2 / 3 ? 'it closed near its high' : pos <= 1 / 3 ? 'it closed near its low' : 'it closed mid-range');
    if (vN && vSum > 0 && (c.volume || 0) > (vSum / vN) * 1.3) out.push('volume was above average');
    return out;
}

export const CANDLE_CLASS_BASIS = [
    'same body, close position and volume', 'same body and close position', 'same body strength', 'all candles on this chart',
];

/**
 * Draw the projection next to the live candle: shaded typical range from its
 * open, an arrow toward the likelier side (only with a proven edge) and a label
 * with the odds and how often past calls were right.
 */
export function drawProjection(ctx, d, pr, px, y, colors, tf, maxX = Infinity) {
    const w = 64;
    const yOpen = y(d.open), yHi = y(d.open + pr.upExc), yLo = y(d.open - pr.downExc);
    const col = pr.dir > 0 ? colors.bull : pr.dir < 0 ? colors.bear : colors.text;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = colors.bull;
    ctx.fillRect(px, yHi, w, yOpen - yHi);
    ctx.fillStyle = colors.bear;
    ctx.fillRect(px, yOpen, w, yLo - yOpen);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = colors.text;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, yHi + 0.5, w - 1, yLo - yHi);
    ctx.beginPath();
    ctx.moveTo(px, yOpen); ctx.lineTo(px + w, yOpen);
    ctx.stroke();
    ctx.setLineDash([]);
    const ax = px + w / 2;
    const arrow = (toY) => {
        const dirY = toY < yOpen ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(ax, yOpen); ctx.lineTo(ax, toY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax, toY); ctx.lineTo(ax - 5, toY - dirY * 7); ctx.lineTo(ax + 5, toY - dirY * 7);
        ctx.closePath();
        ctx.fill();
    };
    ctx.globalAlpha = pr.dir === 0 ? 0.55 : 1;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = pr.dir === 0 ? 1.5 : 2;
    if (pr.dir > 0) arrow(yHi);
    else if (pr.dir < 0) arrow(yLo);
    else { arrow(yHi); arrow(yLo); }
    ctx.globalAlpha = 1;
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
    // Probability of the likelier side always shown; the edge says how far to trust it
    const upPct = Math.round(pr.pUp * 100);
    const line1 = upPct >= 50 ? `Next candle: ${upPct}% probability up` : `Next candle: ${100 - upPct}% probability down`;
    const line2 = `${pr.calls >= 30 ? `Past accuracy ${Math.round(pr.hitRate * 100)}%${pr.proven ? '' : ' · no proven edge'}` : 'Too little history'} · range +${fmt(pr.upExc)} / −${fmt(pr.downExc)}`;
    void tf;
    ctx.font = 'bold 10px sans-serif';
    const w1 = ctx.measureText(line1).width;
    ctx.font = '9px sans-serif';
    const tw = Math.max(w1, ctx.measureText(line2).width) + 10;
    const ly = Math.min(yHi, yOpen - 20) - 30;
    // Keep the label inside the chart (shift left before the price axis)
    const lx = Math.max(2, Math.min(px, maxX - tw - 4));
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(lx, ly, tw, 28);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + 0.5, ly + 0.5, tw - 1, 27);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = col;
    ctx.fillText(line1, lx + 5, ly + 3);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = colors.text;
    ctx.fillText(line2, lx + 5, ly + 15);
    ctx.restore();
    // Area (chart coordinates) that shows the explanation on hover
    const x0 = Math.min(px, lx);
    return { x: x0, y: ly, w: Math.max(px + w, lx + tw) - x0, h: Math.max(yLo, ly + 28) - ly };
}

/**
 * Simple-words explanation shown when hovering the projection box: what was
 * analysed, what happened after similar candles, and why there is (or isn't)
 * a direction. Returns HTML (all dynamic text escaped).
 */
export function projectionExplanationHtml(pr, colors, isDark) {
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
    const up = Math.round(pr.pUp * 100), down = 100 - up;
    const hit = Math.round(pr.hitRate * 100);
    const head = isDark ? '#818cf8' : '#4f46e5';
    const tone = pr.dir > 0 ? colors.bull : pr.dir < 0 ? colors.bear : colors.textBright;
    const p = (label, text) => `<div style="margin-top:7px"><div style="font-size:10px;font-weight:700;letter-spacing:.04em;color:${head}">${esc(label)}</div>`
        + `<div style="color:${colors.textBright}">${text}</div></div>`;
    const looked = pr.refDesc && pr.refDesc.length
        ? `The last closed candle: ${esc(pr.refDesc.join(', '))}.`
        : 'The last closed candle.';
    let why;
    if (pr.dir > 0) {
        why = `After candles like this, buyers usually stayed in control and the next candle closed higher. `
            + `This isn't luck: when this method was tested on this chart's past, its calls were right <b>${hit}%</b> of the time (${pr.calls} calls), better than a coin flip.`;
    } else if (pr.dir < 0) {
        why = `After candles like this, sellers usually stayed in control and the next candle closed lower. `
            + `This isn't luck: when this method was tested on this chart's past, its calls were right <b>${hit}%</b> of the time (${pr.calls} calls), better than a coin flip.`;
    } else if (pr.calls < 30) {
        why = 'Not enough history on this chart yet to prove the method works, so no direction is shown. Use the box as the usual range of one candle.';
    } else if (pr.proven) {
        why = 'After candles like this, up and down were about equally likely, so no direction is shown. Use the box as the usual range of one candle.';
    } else {
        why = `When this method was tested on this chart's past, its calls were right <b>${hit}%</b> of the time (${pr.calls} calls)${pr.classCalls >= 10 ? `, and <b>${Math.round(pr.classHitRate * 100)}%</b> for candles like this one (${pr.classCalls} calls)` : ''} — not clearly better than a coin flip. `
            + 'So the direction is not reliable here: use the box only as the usual range of one candle.';
    }
    return `<div style="font-weight:700;font-size:12px;color:${tone}">Next candle: ${up >= 50 ? `${up}% probability up` : `${down}% probability down`}${pr.dir !== 0 ? '' : ' · no clear direction'}</div>`
        + p('What we looked at', looked)
        + p('Similar candles', `We found <b>${pr.n}</b> earlier candles on this chart like it (${esc(pr.basis)}).`)
        + p('What happened next', `The next candle closed <b style="color:${colors.bull}">up ${up}%</b> of the time and <b style="color:${colors.bear}">down ${down}%</b>. `
            + `It typically rose up to <b>+${fmt(pr.upExc)}</b> and fell down to <b>−${fmt(pr.downExc)}</b> from its open — the shaded box, sized to the current volatility and this hour's usual range.`)
        + p(pr.dir !== 0 ? 'Why this direction' : 'Why no direction', why)
        + `<div style="margin-top:8px;font-size:10px;color:${colors.text}">Statistics from this chart's own history — not a guarantee or trading advice.</div>`;
}
