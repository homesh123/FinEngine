// ─── Ichimoku Kinko Hyo ──────────────────────────────────────────────────────
// Standard definition (Goichi Hosoda; as in Patel "Trading with Ichimoku Clouds",
// Elliott "Ichimoku Charts", StockCharts ChartSchool, TradingView's built-in):
//   Tenkan-sen  = (highest high + lowest low) / 2 over 9
//   Kijun-sen   = same over 26
//   Senkou A    = (Tenkan + Kijun) / 2, plotted 26 periods ahead
//   Senkou B    = (highest high + lowest low) / 2 over 52, plotted 26 ahead
//   Chikou      = close, plotted 26 periods back
// "26 ahead / back" follows TradingView: an offset of displacement − 1 = 25 bars,
// so the cloud under candle i is the spans computed at i − 25.
//
// Signals (the textbook "strong" signal — every component agrees), at candle close:
//   BUY  when a trigger fires — Tenkan crosses above Kijun, or the close breaks above
//        the cloud — and at the same time: close above the cloud, Tenkan > Kijun,
//        Chikou above the close 25 bars back, and the cloud ahead is bullish (A > B).
//   SELL is the mirror. A trigger inside or against the cloud is ignored (weak signal).
//   SL = the Kijun-sen, but at least 0.5 × ATR(14) from the entry (a Kijun hugging price
//   would give no room); TP = 2 × that risk. Entry = the signal candle's close.
//   (Same levels as research/prediction/ichimoku_test.mjs.)
// Nothing repaints: everything at candle i uses candles up to i.

export const ICHIMOKU_DEFAULTS = { ichTenkan: 9, ichKijun: 26, ichSenkouB: 52, ichDisplacement: 26, ichSignals: true };

const mid = (c, i, n) => {
    if (i < n - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (c[j].high > hi) hi = c[j].high; if (c[j].low < lo) lo = c[j].low; }
    return (hi + lo) / 2;
};

/** Sets ichTenkan / ichKijun / ichSpanA / ichSpanB (unshifted), ichCloudTop / ichCloudBot (cloud under the candle) and ichSignal on each candle. */
export function calcIchimoku(c, s = {}) {
    const tN = Math.max(1, parseInt(s.ichTenkan) || 9), kN = Math.max(1, parseInt(s.ichKijun) || 26);
    const bN = Math.max(1, parseInt(s.ichSenkouB) || 52), off = Math.max(1, (parseInt(s.ichDisplacement) || 26) - 1);
    const signals = s.ichSignals !== false;
    let atr = 0;
    for (let i = 0; i < c.length; i++) {
        const k = c[i], t = mid(c, i, tN), kj = mid(c, i, kN), b = mid(c, i, bN);
        const pc = c[i - 1], tr = pc ? Math.max(k.high - k.low, Math.abs(k.high - pc.close), Math.abs(k.low - pc.close)) : k.high - k.low;
        atr = i < 14 ? (atr * i + tr) / (i + 1) : atr + (tr - atr) / 14;   // Wilder ATR(14)
        k.ichTenkan = t; k.ichKijun = kj;
        k.ichSpanA = t != null && kj != null ? (t + kj) / 2 : null;
        k.ichSpanB = b;
        const src = c[i - off];                       // cloud now = spans computed `off` bars ago
        k.ichCloudTop = src && src.ichSpanA != null && src.ichSpanB != null ? Math.max(src.ichSpanA, src.ichSpanB) : null;
        k.ichCloudBot = src && src.ichSpanA != null && src.ichSpanB != null ? Math.min(src.ichSpanA, src.ichSpanB) : null;
        k.ichSignal = null;
        if (!signals || i < 1 || k.ichCloudTop == null || k.ichSpanB == null || !c[i - off]) continue;
        const p = c[i - 1];
        const tkUp = p.ichTenkan != null && p.ichTenkan <= p.ichKijun && t > kj;
        const tkDn = p.ichTenkan != null && p.ichTenkan >= p.ichKijun && t < kj;
        const brkUp = p.ichCloudTop != null && p.close <= p.ichCloudTop && k.close > k.ichCloudTop;
        const brkDn = p.ichCloudBot != null && p.close >= p.ichCloudBot && k.close < k.ichCloudBot;
        const chikouUp = k.close > c[i - off].close, chikouDn = k.close < c[i - off].close;
        const futureUp = k.ichSpanA > k.ichSpanB, futureDn = k.ichSpanA < k.ichSpanB;
        const dir = (tkUp || brkUp) && k.close > k.ichCloudTop && t > kj && chikouUp && futureUp ? 1
            : (tkDn || brkDn) && k.close < k.ichCloudBot && t < kj && chikouDn && futureDn ? -1 : 0;
        if (dir) {
            const sl = dir * (k.close - kj) >= 0.5 * atr ? kj : k.close - dir * 0.5 * atr;
            k.ichSignal = { dir, why: (dir === 1 ? tkUp : tkDn) ? 'TK cross' : 'Kumo breakout', price: k.close, stop: sl, sl, tp: k.close + dir * 2 * Math.abs(k.close - sl) };
        }
    }
    return { off };
}

/** Lines, the cloud (also `off` bars into the future), Chikou and BUY / SELL markers. */
export function drawIchimoku(ctx, { dataset, visibleData, x, y, bw, isDark, state, drawLabel, chartWidth = Infinity }) {
    const s = state.indicatorSettings || {};
    const off = Math.max(1, (parseInt(s.ichDisplacement) || 26) - 1);
    const n = dataset.length;
    if (n < 2 || !visibleData.length) return;
    const step = x(dataset[n - 1].time) - x(dataset[n - 2].time) || bw / 0.8;
    const idx0 = dataset.indexOf(visibleData[0]), idx1 = dataset.indexOf(visibleData[visibleData.length - 1]);
    const xi = (i) => (i < n ? x(dataset[i].time) : x(dataset[n - 1].time) + (i - n + 1) * step) + bw / 2;   // candle i, also future

    // cloud: spans of candle j drawn at j + off (past and future)
    const pts = [];
    for (let j = Math.max(0, idx0 - off - 1); j <= Math.min(n - 1, idx1); j++) {
        const k = dataset[j];
        if (k.ichSpanA != null && k.ichSpanB != null) pts.push({ X: xi(j + off), a: k.ichSpanA, b: k.ichSpanB });
    }
    for (let q = 1; q < pts.length; q++) {
        const p0 = pts[q - 1], p1 = pts[q];
        ctx.fillStyle = p1.a >= p1.b ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)';
        ctx.beginPath(); ctx.moveTo(p0.X, y(p0.a)); ctx.lineTo(p1.X, y(p1.a)); ctx.lineTo(p1.X, y(p1.b)); ctx.lineTo(p0.X, y(p0.b)); ctx.closePath(); ctx.fill();
    }
    const line = (get, shift, col, w = 1.3, from = Math.max(0, idx0 - shift), to = idx1) => {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
        let on = false;
        for (let j = from; j <= to; j++) {
            const v = get(dataset[j]); if (v == null) { on = false; continue; }
            const X = xi(j + shift), Y = y(v);
            if (on) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); on = true; }
        }
        ctx.stroke();
    };
    line(k => k.ichSpanA, off, 'rgba(16,185,129,0.8)', 1, Math.max(0, idx0 - off - 1));
    line(k => k.ichSpanB, off, 'rgba(239,68,68,0.8)', 1, Math.max(0, idx0 - off - 1));
    line(k => k.ichTenkan, 0, '#2962ff');
    line(k => k.ichKijun, 0, '#b71c1c');
    line(k => k.close, -off, isDark ? 'rgba(167,139,250,0.9)' : 'rgba(124,58,237,0.85)', 1.2, Math.max(off, idx0), Math.min(n - 1, idx1 + off));   // Chikou

    if (s.ichSignals === false) return;
    const dec = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
    // price tag: solid rounded box, white text, at the end of its line; kept inside the
    // chart (pinned to the right edge when the line runs past it) and nudged so tags don't overlap
    const used = [];
    const tag = (X, Y, text, bg) => {
        ctx.font = 'bold 10px sans-serif';
        const w = ctx.measureText(text).width + 10;
        X = Math.max(2, Math.min(X, chartWidth - w - 2));   // line runs past the edge → pin the tag at the edge
        const hit = (yy) => used.some(u => X < u.x + u.w && u.x < X + w && Math.abs(u.y - yy) < 17);
        for (let k = 1; hit(Y) && k < 8; k++) Y += (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 17;
        used.push({ x: X, y: Y, w });
        ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(X, Y - 8, w, 16, 4); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, X + 5, Y + 0.5);
    };
    const BUY = '#00ffcc', SELL = '#e43a72', TP = '#16a34a', SL = '#dc2626';
    for (const k of visibleData) {
        const sg = k.ichSignal; if (!sg) continue;
        const i0 = dataset.indexOf(k), X0 = x(k.time) + bw / 2, up = sg.dir === 1;
        if (sg.tp) {
            // TP / SL lines from the signal until one is hit (or 40 candles), tagged at their end
            let end = Math.min(n - 1, i0 + 40), hit = null;
            for (let j = i0 + 1; j <= end; j++) {
                const q = dataset[j];
                if (up ? q.low <= sg.sl : q.high >= sg.sl) { end = j; hit = 'sl'; break; }
                if (up ? q.high >= sg.tp : q.low <= sg.tp) { end = j; hit = 'tp'; break; }
            }
            const X1 = Math.max(x(dataset[end].time) + bw / 2, X0 + 24);
            ctx.globalAlpha = 0.12; ctx.fillStyle = TP;            // shaded reward / risk zones
            ctx.fillRect(X0, Math.min(y(sg.price), y(sg.tp)), X1 - X0, Math.abs(y(sg.tp) - y(sg.price)));
            ctx.fillStyle = SL; ctx.fillRect(X0, Math.min(y(sg.price), y(sg.sl)), X1 - X0, Math.abs(y(sg.sl) - y(sg.price)));
            ctx.globalAlpha = 1;
            for (const [p, col] of [[sg.tp, TP], [sg.sl, SL]]) {
                ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
                ctx.beginPath(); ctx.moveTo(X0, y(p)); ctx.lineTo(X1, y(p)); ctx.stroke(); ctx.setLineDash([]);
            }
            tag(X1 + 3, y(sg.tp), `TP ${dec(sg.tp)}${hit === 'tp' ? ' ✓' : ''}`, TP);
            tag(X1 + 3, y(sg.sl), `SL ${dec(sg.sl)}${hit === 'sl' ? ' ✗' : ''}`, SL);
        }
        // BUY / SELL bubble pointing at the candle, the same look as Gold Move
        if (drawLabel) drawLabel(ctx, X0, up ? y(k.low) + 5 : y(k.high) - 5, [up ? 'Buy' : 'Sell'], up ? BUY : SELL, up ? 'black' : 'white', up);
    }
}
