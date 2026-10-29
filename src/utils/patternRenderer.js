// ─── Chart pattern drawing ───────────────────────────────────────────────────
// Draws the patterns from patterns.js on the main chart: the shape in its
// colour, point labels (X A B C D / LS H RS) and a name tag such as
// "Bullish Butterfly · forming". Stateless (nothing kept between frames).

function rgba(hex, a) {
    const h = hex.replace('#', '');
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function tag(ctx, text, px, py, color, above) {
    ctx.font = 'bold 10px sans-serif';
    const w = ctx.measureText(text).width + 10, h = 16;
    const ty = above ? py - h - 6 : py + 6;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(px - w / 2, ty, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b1120';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px, ty + h / 2);
}

function pointLabel(ctx, text, px, py, color, above) {
    if (!text) return;
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = above ? 'bottom' : 'top';
    ctx.fillText(text, px, above ? py - 4 : py + 4);
}

/**
 * @param future { lastX, step } — x of the live candle and candle spacing, for
 *               zones projected ahead of the current candle
 */
export function drawPatterns(ctx, patterns, x, y, halfBw, chartWidth, future) {
    if (!patterns || !patterns.length) return;
    const X = (t) => { const v = x(t); return v === undefined ? undefined : v + halfBw; };
    ctx.save();
    ctx.lineJoin = 'round';
    for (const p of patterns) {
        const pts = p.points.map(q => ({ ...q, px: X(q.time), py: y(q.price) }));
        if (pts.some(q => q.px === undefined)) continue;
        const minX = Math.min(...pts.map(q => q.px)), maxX = Math.max(...pts.map(q => q.px));
        if (maxX < -50 || minX > chartWidth + 50) continue;            // off screen
        const col = p.color;
        const sideWord = p.side === 'bull' ? 'Bullish ' : p.side === 'bear' ? 'Bearish ' : '';
        const label = `${p.kind === 'harmonic' ? sideWord : ''}${p.name}${p.status === 'forming' ? ' · forming' : p.status === 'confirmed' ? ' · confirmed' : ''}`;

        if (p.kind === 'harmonic') {
            const [Xp, A, B, C, D] = pts;
            ctx.fillStyle = rgba(col, 0.12);
            ctx.beginPath(); ctx.moveTo(Xp.px, Xp.py); ctx.lineTo(A.px, A.py); ctx.lineTo(B.px, B.py); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(B.px, B.py); ctx.lineTo(C.px, C.py); ctx.lineTo(D.px, D.py); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 1.6;
            ctx.beginPath(); pts.forEach((q, j) => (j ? ctx.lineTo(q.px, q.py) : ctx.moveTo(q.px, q.py))); ctx.stroke();
            ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(Xp.px, Xp.py); ctx.lineTo(B.px, B.py); ctx.moveTo(B.px, B.py); ctx.lineTo(D.px, D.py); ctx.stroke();
            ctx.setLineDash([]);
            // Bullish: X, B, D are swing lows (label below), A, C highs (above); bearish mirrored
            pts.forEach(q => pointLabel(ctx, q.label, q.px, q.py, col, (q.label === 'A' || q.label === 'C') === (p.side === 'bull')));
            tag(ctx, label, D.px, D.py, col, p.side !== 'bull');
        } else if (p.kind === 'hs' || p.kind === 'double') {
            ctx.strokeStyle = col; ctx.lineWidth = 1.6;
            ctx.beginPath(); pts.forEach((q, j) => (j ? ctx.lineTo(q.px, q.py) : ctx.moveTo(q.px, q.py))); ctx.stroke();
            if (p.neck) {
                const n1 = X(p.neck.t1), n2 = X(p.neck.endTime);
                if (n1 !== undefined && n2 !== undefined) {
                    ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(n1, y(p.neck.p1)); ctx.lineTo(n2, y(p.neck.endPrice)); ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
            const top = p.side === 'bear';
            pts.forEach(q => pointLabel(ctx, q.label, q.px, q.py, col, top));
            const anchor = p.kind === 'hs' ? pts[2] : { px: (pts[0].px + pts[2].px) / 2, py: top ? Math.min(pts[0].py, pts[2].py) : Math.max(pts[0].py, pts[2].py) };
            tag(ctx, label, anchor.px, anchor.py, col, top);
        } else if (p.kind === 'flag') {
            const [a, b] = pts;
            ctx.strokeStyle = col; ctx.lineWidth = 3;                      // pole
            ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
            ctx.lineWidth = 1.4;
            const u1 = X(p.upper.t1), u2 = X(p.upper.t2), l1 = X(p.lower.t1), l2 = X(p.lower.t2);
            if ([u1, u2, l1, l2].every(v => v !== undefined)) {
                ctx.fillStyle = rgba(col, 0.1);
                ctx.beginPath(); ctx.moveTo(u1, y(p.upper.p1)); ctx.lineTo(u2, y(p.upper.p2)); ctx.lineTo(l2, y(p.lower.p2)); ctx.lineTo(l1, y(p.lower.p1)); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(u1, y(p.upper.p1)); ctx.lineTo(u2, y(p.upper.p2)); ctx.moveTo(l1, y(p.lower.p1)); ctx.lineTo(l2, y(p.lower.p2)); ctx.stroke();
            }
            // Measured-move target (pole length from the breakout)
            const tx = X(p.target.time);
            if (tx !== undefined) {
                ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(tx, y(p.target.from)); ctx.lineTo(tx + 40, y(p.target.price)); ctx.lineTo(tx + 90, y(p.target.price)); ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = '9px sans-serif'; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.fillText('target', tx + 92, y(p.target.price));
            }
            tag(ctx, label, (a.px + b.px) / 2, p.side === 'bull' ? Math.min(a.py, b.py) : Math.max(a.py, b.py), col, p.side === 'bull');
        } else if (p.kind === 'cup') {
            ctx.strokeStyle = col; ctx.lineWidth = 1.8;
            const lows = (p.cupLows || []).map(q => ({ px: X(q.time), py: y(q.price) })).filter(q => q.px !== undefined);
            const [r1, , r2, hd] = pts;
            if (lows.length > 2) {
                // Smooth curve through the cup's lows, rim to rim
                ctx.beginPath(); ctx.moveTo(r1.px, r1.py);
                for (let j = 0; j < lows.length - 1; j++) {
                    const mx = (lows[j].px + lows[j + 1].px) / 2, my = (lows[j].py + lows[j + 1].py) / 2;
                    ctx.quadraticCurveTo(lows[j].px, lows[j].py, mx, my);
                }
                ctx.lineTo(r2.px, r2.py); ctx.stroke();
            }
            if (hd) { ctx.beginPath(); ctx.moveTo(r2.px, r2.py); ctx.lineTo(hd.px, hd.py); ctx.stroke(); }
            const rx1 = X(p.rim.t1), rx2 = X(p.rim.t2);
            if (rx1 !== undefined && rx2 !== undefined) {
                ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(rx1, y(p.rim.price)); ctx.lineTo(rx2, y(p.rim.price)); ctx.stroke();
                ctx.setLineDash([]);
            }
            pts.forEach(q => pointLabel(ctx, q.label, q.px, q.py, col, q.label === 'Rim'));
            tag(ctx, label, (r1.px + r2.px) / 2, y(p.rim.price), col, true);
        } else if (p.kind === 'potential') {
            // What has formed so far, then a dashed path to the projected zone ahead
            ctx.strokeStyle = col; ctx.lineWidth = 1.6;
            ctx.beginPath(); pts.forEach((q, j) => (j ? ctx.lineTo(q.px, q.py) : ctx.moveTo(q.px, q.py))); ctx.stroke();
            if (p.neck) {
                const n1 = X(p.neck.t1), n2 = X(p.neck.endTime);
                if (n1 !== undefined && n2 !== undefined) {
                    ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(n1, y(p.neck.p1)); ctx.lineTo(n2, y(p.neck.endPrice)); ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
            const top = p.side === 'bear';
            pts.forEach(q => pointLabel(ctx, q.label, q.px, q.py, col, p.kind === 'potential' && (q.label === 'A' || q.label === 'C') ? p.side === 'bull' : top));
            if (future && p.zone) {
                const zx0 = future.lastX + future.step, zx1 = future.lastX + future.step * (p.zone.bars + 1);
                const zy0 = y(p.zone.hi), zy1 = y(p.zone.lo);
                ctx.fillStyle = rgba(col, 0.16);
                ctx.fillRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
                ctx.setLineDash([4, 3]); ctx.strokeStyle = col; ctx.lineWidth = 1;
                ctx.strokeRect(zx0 + 0.5, zy0 + 0.5, zx1 - zx0, zy1 - zy0);
                const last = pts[pts.length - 1];
                ctx.beginPath(); ctx.moveTo(last.px, last.py); ctx.lineTo(zx0, (zy0 + zy1) / 2); ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = '9px sans-serif'; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                ctx.fillText(p.zone.label, (zx0 + zx1) / 2, zy1 + 3);
                const name = `Potential ${p.side === 'bull' ? 'Bullish ' : p.side === 'bear' ? 'Bearish ' : ''}${p.name}`;
                tag(ctx, name, (zx0 + zx1) / 2, zy0, col, true);
            }
        } else if (p.kind === 'triangle') {
            ctx.strokeStyle = col; ctx.lineWidth = 1.4;
            for (const ln of [p.upper, p.lower]) {
                const a = X(ln.t1), b = X(ln.t2);
                if (a === undefined || b === undefined) continue;
                ctx.beginPath(); ctx.moveTo(a, y(ln.p1)); ctx.lineTo(b, y(ln.p2)); ctx.stroke();
            }
            ctx.fillStyle = rgba(col, 0.08);
            const a1 = X(p.upper.t1), b1 = X(p.upper.t2), a2 = X(p.lower.t1), b2 = X(p.lower.t2);
            if ([a1, b1, a2, b2].every(v => v !== undefined)) {
                ctx.beginPath(); ctx.moveTo(a1, y(p.upper.p1)); ctx.lineTo(b1, y(p.upper.p2)); ctx.lineTo(b2, y(p.lower.p2)); ctx.lineTo(a2, y(p.lower.p1)); ctx.closePath(); ctx.fill();
                tag(ctx, label, (a1 + b1) / 2, y(p.upper.p1) < y(p.upper.p2) ? y(p.upper.p1) : y(p.upper.p2), col, true);
            }
        }
    }
    ctx.restore();
}
