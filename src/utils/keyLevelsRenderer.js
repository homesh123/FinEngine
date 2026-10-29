// Draws computeKeyLevels() output: support / resistance lines (dashed, from the
// first touch to the right edge, labelled with their touch count) and unbroken
// trendlines extended into the projection area.
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));

export function drawKeyLevels(ctx, kl, dataset, x, y, halfBw, chartWidth, chartHeight, isDark, showTrend, showSR) {
    if (!kl) return;
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.textBaseline = 'bottom';
    if (showSR) {
        for (const l of kl.levels) {
            const ly = y(l.price);
            if (!(ly > 0 && ly < chartHeight)) continue;
            const res = l.kind === 'resistance';
            const col = res ? (isDark ? '#f87171' : '#b91c1c') : (isDark ? '#34d399' : '#047857');
            const fx = x(dataset[l.first]?.time);
            const x0 = fx === undefined ? 0 : Math.max(0, fx + halfBw);
            ctx.strokeStyle = col; ctx.globalAlpha = 0.8; ctx.lineWidth = Math.min(3, 0.8 + l.touches * 0.3);
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(chartWidth, ly); ctx.stroke();
            ctx.setLineDash([]); ctx.globalAlpha = 1;
            ctx.fillStyle = col; ctx.textAlign = 'left';
            ctx.fillText(`${res ? 'Resistance' : 'Support'} ${fmt(l.price)} · ${l.touches} touches`, x0 + 4, ly - 2);
        }
    }
    if (showTrend) {
        const lastI = dataset.length - 1;
        const step = lastI > 0 ? (x(dataset[lastI].time) - x(dataset[lastI - 1].time)) || 1 : 1;
        for (const t of kl.trends) {
            const x1 = x(dataset[t.i1]?.time);
            if (x1 === undefined) continue;
            // extend to the right edge (incl. the projection area)
            const iEnd = lastI + Math.max(0, (chartWidth - (x(dataset[lastI].time) + halfBw)) / step);
            const xEnd = x(dataset[lastI].time) + halfBw + (iEnd - lastI) * step;
            const pEnd = t.p1 + t.slope * (iEnd - t.i1);
            const up = t.kind === 'up';
            const col = up ? (isDark ? '#2dd4bf' : '#0f766e') : (isDark ? '#fb7185' : '#be123c');
            ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.moveTo(x1 + halfBw, y(t.p1)); ctx.lineTo(xEnd, y(pEnd)); ctx.stroke();
            ctx.globalAlpha = 1;
            // label at the live candle
            const pNow = t.p1 + t.slope * (lastI - t.i1), ly = y(pNow);
            if (ly > 10 && ly < chartHeight) {
                ctx.fillStyle = col; ctx.textAlign = 'right';
                ctx.fillText(up ? `Uptrend line ${fmt(pNow)}` : `Downtrend line ${fmt(pNow)}`, x(dataset[lastI].time) - 6, up ? ly + 12 : ly - 2);
            }
        }
    }
    ctx.restore();
}
