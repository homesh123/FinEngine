// Whale Pulse drawing: bubbles (3 sizes, at the bar's close), absorption
// diamonds (beyond the bar, opposite the pressure) and deep-pressure dots —
// batched into one path per style; a small record box (draggable).
const GREEN = '16,185,129', RED = '239,68,68', AQUA = '#06b6d4', ORANGE = '#f97316';
const fmtVol = (v) => { const a = Math.abs(v); return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`; };

export function drawWhalePulse(ctx, { dataset, visibleData, x, y, bw, halfBw, chartHeight, isDark, state, placeBox }) {
    const s = state.indicatorSettings || {};
    const scale = Math.max(0.5, Math.min(2, Number(s.wpScale) || 1));
    const R = [0, 5, 8, 12].map(r => Math.max(3, Math.min(26, r * scale * Math.max(0.7, Math.min(1.6, bw / 8)))));
    const fills = {}, strokes = {};
    const path = (store, key) => (store[key] || (store[key] = new Path2D()));
    const labels = [], hits = [];
    ctx.save();
    for (const k of visibleData) {
        const px = x(k.time);
        if (px === undefined) continue;
        const cx = px + halfBw;
        if (s.wpBubbles !== false && k.wpBubble) {
            const b = k.wpBubble, r = R[b.size], cy = y(k.close);
            const key = `${b.dir > 0 ? GREEN : RED}|${b.size}`;
            path(fills, key).moveTo(cx + r, cy); fills[key].arc(cx, cy, r, 0, Math.PI * 2);
            path(strokes, key).moveTo(cx + r, cy); strokes[key].arc(cx, cy, r, 0, Math.PI * 2);
            hits.push({ x: cx, y: cy, r: Math.max(r, 6), k });
            if (s.wpLabels !== false && b.size === 3) labels.push({ cx, cy: cy - r - 2, t: `${b.dir > 0 ? '+' : '−'}${fmtVol(Math.abs(b.delta))}`, dir: b.dir });
        }
        if (s.wpAbsorption !== false && k.wpAbs) {
            const up = k.wpAbs.dir > 0;                         // bull absorption → diamond above (buying stalled)
            const dy = up ? y(k.high) - 10 : y(k.low) + 10, h = 5;
            const p = path(fills, up ? AQUA : ORANGE);
            p.moveTo(cx, dy - h); p.lineTo(cx + h, dy); p.lineTo(cx, dy + h); p.lineTo(cx - h, dy); p.closePath();
            hits.push({ x: cx, y: dy, r: 7, k, abs: true });
        }
        if (s.wpDeep !== false && k.wpDeep) {
            const up = k.wpDeep.dir > 0, dy = up ? y(k.low) + 6 : y(k.high) - 6;
            const p = path(fills, up ? 'deepUp' : 'deepDn');
            p.moveTo(cx + 2.2, dy); p.arc(cx, dy, 2.2, 0, Math.PI * 2);
            hits.push({ x: cx, y: dy, r: 6, k, deep: true });
        }
    }
    for (const [key, p] of Object.entries(fills)) {
        if (key.includes('|')) { const [col, size] = key.split('|'); ctx.fillStyle = `rgba(${col},${0.18 + 0.1 * Number(size)})`; }
        else ctx.fillStyle = key === 'deepUp' ? (isDark ? '#4ade80' : '#15803d') : key === 'deepDn' ? (isDark ? '#f87171' : '#991b1b') : key;
        ctx.fill(p);
    }
    for (const [key, p] of Object.entries(strokes)) { const [col] = key.split('|'); ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.2; ctx.stroke(p); }
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const l of labels) {
        if (!(l.cy > 12 && l.cy < chartHeight)) continue;
        // translucent pill behind the label so it reads over candles and grid
        const w = ctx.measureText(l.t).width + 8, h = 12;
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.78)' : 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.roundRect(l.cx - w / 2, l.cy - h, w, h, 3); ctx.fill();
        ctx.strokeStyle = `rgba(${l.dir > 0 ? GREEN : RED},0.35)`; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = l.dir > 0 ? (isDark ? '#34d399' : '#047857') : (isDark ? '#f87171' : '#b91c1c');
        ctx.fillText(l.t, l.cx, l.cy - 1.5);
    }

    // record box
    const rec = dataset.whalePulse?.record;
    if (s.wpRecord !== false && rec && placeBox) {
        const pct = (w, n) => (n ? `${Math.round(w / n * 100)}%` : '—');
        const src = dataset.whalePulse.source === 'ltf' ? '1m buy/sell split' : 'candle-shape estimate';
        const txt = `Whale Pulse (${src}) · big bubbles continued ${pct(rec.bubbleWins, rec.bubbles)} of ${rec.bubbles} · absorptions reversed ${pct(rec.absWins, rec.abs)} of ${rec.abs} (next ${rec.horizon} bars)`;
        ctx.font = '10px sans-serif';
        const w = ctx.measureText(txt).width + 14, h = 18;
        const { x: bx, y: by } = placeBox('whale', 8, chartHeight - h - 88, w, h);
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.94)'; ctx.fillRect(bx, by, w, h);
        ctx.strokeStyle = isDark ? '#475569' : '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
        ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 7, by + h / 2);
    }
    ctx.restore();
    return hits;
}

/** Hover box for an absorption diamond: heavy pressure that price did not follow. */
export function absorptionHtml(k, wp, colors, isDark) {
    const buy = k.wpAbs.dir > 0, b = k.wpBubble;
    const col = buy ? (isDark ? '#22d3ee' : '#0e7490') : (isDark ? '#fb923c' : '#c2410c');
    const rec = wp?.record;
    const pct = rec?.abs ? Math.round(rec.absWins / rec.abs * 100) : null;
    const row = (a, v) => `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${colors.text}">${a}</span><b>${v}</b></div>`;
    return `<div style="font-weight:700;color:${col}">◆ Absorption — ${buy ? 'buying' : 'selling'} soaked up</div>`
        + `<div style="font-size:10px;color:${colors.text};margin-bottom:4px">${new Date(k.time).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`
        + `<div style="max-width:240px;margin-bottom:4px">Heavy ${buy ? 'buying' : 'selling'} hit this candle but price barely moved ${buy ? 'up' : 'down'} — `
        + `${buy ? 'sellers' : 'buyers'} absorbed it. Often a sign the move is tiring and may turn ${buy ? 'down' : 'up'}.</div>`
        + (b ? row(wp?.source === 'ltf' ? 'Net buy − sell volume' : 'Net pressure (est.)', `${buy ? '+' : '−'}${fmtVol(Math.abs(b.delta))}`)
            + row('Candle volume', fmtVol(k.volume || 0)) + row('Volume vs average', `${b.rv.toFixed(1)}×`)
            + row('Candle body (price)', `${+Math.abs(k.close - k.open).toPrecision(3)} ${k.close >= k.open ? 'up' : 'down'}`) : '')
        + (pct != null ? `<div style="margin-top:6px;font-size:10px;opacity:.75">On this chart, price turned the other way within ${rec.horizon} candles after ${pct}% of ${rec.abs} absorptions.</div>` : '');
}

/** Hover box for a deep-pressure dot: several candles in a row pushing the same way, unusually hard. */
export function deepPressureHtml(k, colors, isDark, bars) {
    const buy = k.wpDeep.dir > 0;
    const col = buy ? (isDark ? '#4ade80' : '#15803d') : (isDark ? '#f87171' : '#991b1b');
    return `<div style="font-weight:700;color:${col}">● Deep ${buy ? 'buying' : 'selling'} pressure</div>`
        + `<div style="font-size:10px;color:${colors.text};margin-bottom:4px">${new Date(k.time).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`
        + `<div style="max-width:240px">At least ${Math.ceil(bars * 0.8)} of the last ${bars} candles were pushed by ${buy ? 'buyers' : 'sellers'}, and their combined `
        + `${buy ? 'buying' : 'selling'} was ${Math.abs(k.wpDeep.z).toFixed(1)}σ above normal — steady, persistent ${buy ? 'demand' : 'supply'}, not one spike.</div>`
        + `<div style="margin-top:6px;font-size:10px;opacity:.75">Dot ${buy ? 'below' : 'above'} the candle. A trend clue, not a trade signal on its own.</div>`;
}

/** Hover box for one bubble: what the label means, plus the bar's volume and how unusual it was. */
export function whalePulseHtml(k, wp, colors, isDark) {
    const b = k.wpBubble, buy = b.dir > 0;
    const tone = buy ? (isDark ? '#34d399' : '#047857') : (isDark ? '#f87171' : '#b91c1c');
    const size = ['', 'Small', 'Medium', 'Big'][b.size];
    const real = wp?.source === 'ltf';
    const row = (a, v) => `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:${colors.text}">${a}</span><b>${v}</b></div>`;
    const rec = wp?.record;
    const pct = rec?.bubbles ? Math.round(rec.bubbleWins / rec.bubbles * 100) : null;
    return `<div style="font-weight:700;color:${tone}">${size} ${buy ? 'buying' : 'selling'} pressure</div>`
        + `<div style="font-size:10px;color:${colors.text};margin-bottom:4px">${new Date(k.time).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`
        + row(real ? 'Net buy − sell volume' : 'Net pressure (est.)', `${buy ? '+' : '−'}${fmtVol(Math.abs(b.delta))}`)
        + row('Candle volume', fmtVol(k.volume || 0))
        + row('Volume vs average', `${b.rv.toFixed(1)}×`)
        + row('How unusual', `${Math.abs(b.z).toFixed(1)}σ (${size.toLowerCase()} ≥ ${b.size === 3 ? 4 : b.size === 2 ? 3 : 2}σ)`)
        + (k.wpAbs ? `<div style="margin-top:5px;color:${isDark ? '#22d3ee' : '#0e7490'}">◆ Absorption: the pressure did not move price — often a sign of a turn.</div>` : '')
        + `<div style="margin-top:6px;font-size:10px;opacity:.75">${real ? 'From the 1-minute buy/sell split.' : 'Estimated from where the candle closed in its range × volume.'}`
        + (pct != null ? ` Medium/big bubbles kept going ${pct}% of ${rec.bubbles} times over the next ${rec.horizon} candles.` : '') + `</div>`;
}
