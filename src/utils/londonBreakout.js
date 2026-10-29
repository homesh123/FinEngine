// ─── London Breakout ("Big Ben") ─────────────────────────────────────────────
// The Asian session builds a range overnight; London's open brings the volume
// that breaks it. Each London day:
//   1. Asian range = high/low of the candles from Asia start to Asia end
//      (London local time - GMT in winter, BST in summer, handled here).
//   2. Entry window (Asia end → entry cut-off): the first candle that CLOSES
//      above the range high (+ buffer) is a BUY, below the low a SELL. One
//      trade per day.
//   3. SL = the other side of the range (or its middle); TP1 / TP2 = entry ±
//      1× / 2× the range height. Exit at TP2, SL, or the session end time.
//   Ranges unusually small or large versus the last 10 days are skipped
//   (fakeout-prone / move already done).
// Intraday charts only (≤ 1 hour). Signals sit on the breakout candle
// (c.lbSignal), TP1 on c.lbTp1, exits on c.lbExit - used by alerts too.

export const LONDON_BREAKOUT_DEFAULTS = {
    lbAsiaStart: 0, lbAsiaEnd: 7, lbEntryEnd: 10, lbSessionEnd: 16,   // London hours
    lbSlMode: 'range',            // 'range' (other side) | 'mid' (middle of range)
    lbTp1: 1, lbTp2: 2,           // × range height
    lbBuffer: 0,                  // breakout must close this % of the range beyond it
    lbMinRange: 0.4, lbMaxRange: 2.5, // × average of the last 10 Asian ranges
};

// UK summer time: last Sunday of March 01:00 UTC → last Sunday of October 01:00 UTC
const bstCache = new Map();
function bstWindow(year) {
    let w = bstCache.get(year);
    if (!w) {
        const lastSunday = (m) => { const d = new Date(Date.UTC(year, m + 1, 0)); return Date.UTC(year, m, d.getUTCDate() - d.getUTCDay(), 1); };
        w = [lastSunday(2), lastSunday(9)];
        bstCache.set(year, w);
    }
    return w;
}
/** London local time (ms) for a UTC timestamp. */
export function londonTime(ms) {
    const [a, b] = bstWindow(new Date(ms).getUTCFullYear());
    return ms + (ms >= a && ms < b ? 3600000 : 0);
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * @returns array of days: { asia: [i0, i1], hi, lo, entryEnd, end, skipped, trade? }
 *          trade: { dir, i, entry, sl, tp1, tp2, tp1At, exitAt, exitType, exitPrice }
 */
export function calcLondonBreakout(candles, settings = {}, tfMins = 15) {
    for (const c of candles) { c.lbSignal = null; c.lbTp1 = null; c.lbExit = null; }
    if (!(tfMins > 0 && tfMins <= 60) || candles.length < 50) return [];
    const s = { ...LONDON_BREAKOUT_DEFAULTS, ...settings };
    const aStart = num(s.lbAsiaStart, 0), aEnd = num(s.lbAsiaEnd, 7), eEnd = num(s.lbEntryEnd, 10), sEnd = num(s.lbSessionEnd, 16);
    const tp1M = num(s.lbTp1, 1), tp2M = num(s.lbTp2, 2), buf = num(s.lbBuffer, 0) / 100;
    const minR = num(s.lbMinRange, 0.4), maxR = num(s.lbMaxRange, 2.5);
    const hourOf = (c) => { const t = new Date(londonTime(c.time)); return t.getUTCHours() + t.getUTCMinutes() / 60; };
    const dayOf = (c) => Math.floor(londonTime(c.time) / 86400000);

    // Group candles by London day
    const days = [];
    let cur = null;
    for (let i = 0; i < candles.length; i++) {
        const d = dayOf(candles[i]);
        if (!cur || cur.day !== d) { cur = { day: d, from: i, to: i }; days.push(cur); } else cur.to = i;
    }
    const out = [], recent = [];
    for (const d of days) {
        let i0 = -1, i1 = -1, hi = -Infinity, lo = Infinity;
        for (let i = d.from; i <= d.to; i++) {
            const h = hourOf(candles[i]);
            if (h >= aStart && h < aEnd) {
                if (i0 < 0) i0 = i;
                i1 = i; hi = Math.max(hi, candles[i].high); lo = Math.min(lo, candles[i].low);
            }
        }
        if (i0 < 0 || i1 >= d.to) continue;                         // no Asian session / London not open yet
        const range = hi - lo;
        if (!(range > 0)) continue;
        const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : range;
        recent.push(range); if (recent.length > 10) recent.shift();
        const ratio = range / avg;
        const skipped = recent.length >= 3 && (ratio < minR || ratio > maxR) ? (ratio < minR ? 'range too small' : 'range too large') : null;
        let entryEnd = i1, end = i1;
        for (let i = i1 + 1; i <= d.to; i++) {
            const h = hourOf(candles[i]);
            if (h < eEnd) entryEnd = i;
            if (h < sEnd) end = i;
        }
        const day = { asia: [i0, i1], hi, lo, entryEnd, end, skipped, trade: null };
        out.push(day);
        if (skipped) continue;

        // Breakout: first close beyond the range inside the entry window
        for (let i = i1 + 1; i <= entryEnd; i++) {
            const c = candles[i];
            const dir = c.close > hi + buf * range ? 1 : c.close < lo - buf * range ? -1 : 0;
            if (!dir) continue;
            const entry = c.close;
            const sl = s.lbSlMode === 'mid' ? (hi + lo) / 2 : dir > 0 ? lo : hi;
            const tr = { dir, i, entry, sl, tp1: entry + dir * tp1M * range, tp2: entry + dir * tp2M * range, tp1At: -1, exitAt: -1, exitType: null, exitPrice: null };
            c.lbSignal = { dir, entry, sl, tp1: tr.tp1, tp2: tr.tp2, hi, lo, time: c.time };
            // Manage: SL first if a candle touches both (conservative)
            for (let j = i + 1; j < candles.length && tr.exitAt < 0; j++) {
                const k = candles[j];
                const hitSl = dir > 0 ? k.low <= tr.sl : k.high >= tr.sl;
                const hit1 = dir > 0 ? k.high >= tr.tp1 : k.low <= tr.tp1;
                const hit2 = dir > 0 ? k.high >= tr.tp2 : k.low <= tr.tp2;
                if (hitSl) { tr.exitAt = j; tr.exitType = tr.tp1At >= 0 ? 'SL after TP1' : 'SL'; tr.exitPrice = tr.sl; }
                else if (hit2) { if (tr.tp1At < 0) { tr.tp1At = j; k.lbTp1 = { dir, price: tr.tp1 }; } tr.exitAt = j; tr.exitType = 'TP2'; tr.exitPrice = tr.tp2; }
                else {
                    if (hit1 && tr.tp1At < 0) { tr.tp1At = j; k.lbTp1 = { dir, price: tr.tp1 }; }
                    if (j >= end && j < candles.length - 1) { tr.exitAt = j; tr.exitType = 'Session end'; tr.exitPrice = k.close; }
                }
                if (tr.exitAt === j) k.lbExit = { dir, type: tr.exitType, price: tr.exitPrice };
            }
            day.trade = tr;
            break;
        }
    }
    return out.slice(-120);
}

/** Draw ranges, breakout arrows, SL/TP lines and exits for days in view. */
export function drawLondonBreakout(ctx, dataset, days, x, y, bw, halfBw, startIdx, endIdx, colors, isDark) {
    if (!days?.length) return;
    const at = (i) => { const d = dataset[i]; return d ? x(d.time) : undefined; };
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
    ctx.save();
    for (const d of days) {
        const lastIdx = d.trade && d.trade.exitAt >= 0 ? d.trade.exitAt : d.end;
        if (lastIdx < startIdx - 1 || d.asia[0] > endIdx + 1) continue;
        const x0 = at(d.asia[0]), x1 = at(d.asia[1]), xe = at(d.entryEnd);
        if (x0 === undefined || x1 === undefined) continue;
        // Asian range box
        const grey = isDark ? 'rgba(148,163,184,' : 'rgba(100,116,139,';
        ctx.fillStyle = d.skipped ? `${grey}0.06)` : (isDark ? 'rgba(99,102,241,0.10)' : 'rgba(79,70,229,0.07)');
        ctx.fillRect(x0, y(d.hi), x1 + bw - x0, y(d.lo) - y(d.hi));
        ctx.strokeStyle = d.skipped ? `${grey}0.5)` : (isDark ? 'rgba(129,140,248,0.7)' : 'rgba(79,70,229,0.6)');
        ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y(d.hi) + 0.5, x1 + bw - x0 - 1, y(d.lo) - y(d.hi));
        // Range levels through the entry window
        if (xe !== undefined) {
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(x1 + bw, y(d.hi)); ctx.lineTo(xe + bw, y(d.hi)); ctx.moveTo(x1 + bw, y(d.lo)); ctx.lineTo(xe + bw, y(d.lo)); ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = d.skipped ? `${grey}0.8)` : (isDark ? '#a5b4fc' : '#4f46e5');
        ctx.fillText(d.skipped ? `Asia range · skipped (${d.skipped})` : 'Asia range', x0 + 2, y(d.hi) - 2);

        const tr = d.trade;
        if (!tr) continue;
        const xi = at(tr.i);
        if (xi === undefined) continue;
        const col = tr.dir > 0 ? colors.bull : colors.bear;
        const xEnd = at(tr.exitAt >= 0 ? tr.exitAt : Math.min(dataset.length - 1, d.end)) ?? xi;
        // SL / TP lines from entry to exit
        const hline = (price, c, label, dash) => {
            ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(dash);
            ctx.beginPath(); ctx.moveTo(xi + halfBw, y(price)); ctx.lineTo(xEnd + bw, y(price)); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = c; ctx.font = '9px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
            ctx.fillText(`${label} ${fmt(price)}`, xEnd + bw, y(price) - 1);
        };
        hline(tr.entry, isDark ? '#94a3b8' : '#64748b', 'Entry', [2, 2]);
        hline(tr.sl, colors.bear === col ? '#f59e0b' : colors.bear, 'SL', [4, 3]);
        hline(tr.tp1, col, 'TP1', [4, 3]);
        hline(tr.tp2, col, 'TP2', [4, 3]);
        // Breakout arrow + label
        const cy = tr.dir > 0 ? y(dataset[tr.i].low) + 6 : y(dataset[tr.i].high) - 6;
        ctx.fillStyle = col;
        ctx.beginPath();
        if (tr.dir > 0) { ctx.moveTo(xi + halfBw, cy); ctx.lineTo(xi + halfBw - 6, cy + 9); ctx.lineTo(xi + halfBw + 6, cy + 9); }
        else { ctx.moveTo(xi + halfBw, cy); ctx.lineTo(xi + halfBw - 6, cy - 9); ctx.lineTo(xi + halfBw + 6, cy - 9); }
        ctx.closePath(); ctx.fill();
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = tr.dir > 0 ? 'top' : 'bottom';
        ctx.fillText(tr.dir > 0 ? 'LB BUY' : 'LB SELL', xi + halfBw, tr.dir > 0 ? cy + 11 : cy - 11);
        // TP1 and exit markers
        const mark = (idx, text, c) => {
            const xm = at(idx); if (xm === undefined) return;
            ctx.font = 'bold 9px sans-serif';
            const w = ctx.measureText(text).width + 8;
            const my = tr.dir > 0 ? y(dataset[idx].high) - 16 : y(dataset[idx].low) + 4;
            ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(xm + halfBw - w / 2, my, w, 12, 3); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, xm + halfBw, my + 6);
        };
        if (tr.tp1At >= 0 && tr.tp1At !== tr.exitAt) mark(tr.tp1At, 'TP1', col);
        if (tr.exitAt >= 0) mark(tr.exitAt, tr.exitType, tr.exitType === 'TP2' ? col : tr.exitType.startsWith('SL') ? '#f59e0b' : '#64748b');
    }
    ctx.restore();
}
