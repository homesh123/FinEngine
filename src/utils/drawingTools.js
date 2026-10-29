// ─── Two-point drawing tools ─────────────────────────────────────────────────
// Click, drag and release to draw. Each drawing stores time1/y1 (first point)
// and time2/y2 (second point); positions also store `stop`.
//   ray            line through two points, extended to the right edge
//   rectangle      price/time zone
//   fib            Fibonacci retracement (0 at point 2 … 1 at point 1)
//   measure        price & time range: change, %, bars, duration
//   long_position  entry (point 1), target (point 2), stop — risk/reward
//   short_position same, for shorts
// Trendline / horizontal / vertical stay in the chart engine.
// Rendering is stateless (nothing kept between frames).

export const TWO_POINT_TOOLS = new Set(['ray', 'rectangle', 'fib', 'measure', 'long_position', 'short_position']);
export const isTwoPoint = (t) => t === 'trendline' || TWO_POINT_TOOLS.has(t);

const FIB_LEVELS = [
    { r: 0, c: '#94a3b8' }, { r: 0.236, c: '#ef4444' }, { r: 0.382, c: '#f97316' }, { r: 0.5, c: '#22c55e' },
    { r: 0.618, c: '#14b8a6' }, { r: 0.786, c: '#3b82f6' }, { r: 1, c: '#94a3b8' }, { r: 1.618, c: '#a855f7' },
];

const isPosition = (t) => t === 'long_position' || t === 'short_position';

/**
 * Finish a drawing on mouse-up: give a click-without-drag a sensible size and
 * set the position's stop (1:1 risk/reward by default; target on the right side).
 * `helpers`: { shiftTime(time, px) → time px pixels later, price }
 */
export function finalizeDrawing(d, helpers) {
    const out = { ...d };
    if (!TWO_POINT_TOOLS.has(out.type)) return out;
    if (out.time2 === out.time1) out.time2 = helpers.shiftTime(out.time1, 120);
    const minMove = Math.abs(out.y1) * 0.002;
    if (Math.abs(out.y2 - out.y1) < minMove * 0.1 && out.type !== 'ray') {
        out.y2 = out.y1 + (out.type === 'short_position' ? -minMove : minMove);
    }
    if (isPosition(out.type)) {
        const long = out.type === 'long_position';
        // Target must be on the profitable side: dragging the other way sets the stop instead
        if (long ? out.y2 < out.y1 : out.y2 > out.y1) {
            out.stop = out.y2;
            out.y2 = 2 * out.y1 - out.y2;
        }
        if (out.stop === undefined || out.stop === null) out.stop = 2 * out.y1 - out.y2;
    }
    return out;
}

function rgba(hex, a) {
    const h = hex.replace('#', '');
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function label(ctx, text, px, py, bg, fg = '#ffffff', align = 'center') {
    ctx.font = 'bold 10px sans-serif';
    const w = ctx.measureText(text).width + 10, h = 16;
    const lx = align === 'center' ? px - w / 2 : align === 'right' ? px - w : px;
    ctx.fillStyle = bg;
    ctx.fillRect(lx, py - h / 2, w, h);
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 5, py);
}

function anchor(ctx, px, py) {
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;
    ctx.stroke();
}

/** Points in pixels; null when either point is off the chart's data. */
function pts(d, g) {
    const x1 = g.X(d.time1), x2 = g.X(d.time2);
    if (x1 === undefined || x2 === undefined || Number.isNaN(x1) || Number.isNaN(x2)) return null;
    return { x1, y1: g.y(d.y1), x2, y2: g.y(d.y2), ys: d.stop !== undefined && d.stop !== null ? g.y(d.stop) : null };
}

/**
 * g: { X(time) → px (candle centre), y(price) → py, chartWidth, isDark, fmt(price), bars(t1, t2), dur(t1, t2) }
 */
export function renderDrawing(ctx, d, g, selected, hovered) {
    const p = pts(d, g);
    if (!p) return;
    const base = d.color || (g.isDark ? '#e2e8f0' : '#1e293b');
    const lineW = (d.width || 1.5) + (hovered ? 1 : 0);
    ctx.save();
    ctx.lineWidth = lineW;
    const left = Math.min(p.x1, p.x2), right = Math.max(p.x1, p.x2);

    if (d.type === 'ray') {
        ctx.strokeStyle = selected ? '#4f46e5' : base;
        const dx = p.x2 - p.x1, dy = p.y2 - p.y1;
        let ex = p.x2, ey = p.y2;
        if (Math.abs(dx) > 0.5) {
            const edge = dx > 0 ? g.chartWidth : 0;
            ex = edge; ey = p.y1 + dy * ((edge - p.x1) / dx);
        }
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(ex, ey); ctx.stroke();
    } else if (d.type === 'rectangle') {
        const col = d.color || '#6366f1';
        ctx.fillStyle = rgba(col, 0.12);
        ctx.fillRect(left, Math.min(p.y1, p.y2), right - left, Math.abs(p.y2 - p.y1));
        ctx.strokeStyle = selected ? '#4f46e5' : col;
        ctx.strokeRect(left, Math.min(p.y1, p.y2), right - left, Math.abs(p.y2 - p.y1));
    } else if (d.type === 'fib') {
        // 0 at point 2, 1 at point 1 (TradingView); levels between the two points' x
        const span = d.y1 - d.y2;
        const xs = left, xe = Math.max(right, left + 60);
        let prevY = null;
        FIB_LEVELS.forEach((lv, k) => {
            const price = d.y2 + span * lv.r;
            const py = g.y(price);
            if (prevY !== null && k < FIB_LEVELS.length - 1) {
                ctx.fillStyle = rgba(lv.c, 0.08);
                ctx.fillRect(xs, Math.min(prevY, py), xe - xs, Math.abs(py - prevY));
            }
            ctx.strokeStyle = lv.c;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(xs, py); ctx.lineTo(xe, py); ctx.stroke();
            ctx.font = '10px sans-serif';
            ctx.fillStyle = lv.c;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${lv.r} (${g.fmt(price)})`, xs - 4, py);
            prevY = py;
        });
        ctx.strokeStyle = selected ? '#4f46e5' : rgba('#94a3b8', 0.8);
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
        ctx.setLineDash([]);
    } else if (d.type === 'measure') {
        const up = d.y2 >= d.y1;
        const col = up ? '#3b82f6' : '#ef4444';
        ctx.fillStyle = rgba(col, 0.15);
        ctx.fillRect(left, Math.min(p.y1, p.y2), right - left, Math.abs(p.y2 - p.y1));
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        const mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2;
        // arrows along price and time
        ctx.beginPath(); ctx.moveTo(mx, p.y1); ctx.lineTo(mx, p.y2); ctx.moveTo(p.x1, my); ctx.lineTo(p.x2, my); ctx.stroke();
        const diff = d.y2 - d.y1, pctv = d.y1 ? (diff / d.y1) * 100 : 0;
        const bars = g.bars(d.time1, d.time2);
        label(ctx, `${diff >= 0 ? '+' : ''}${g.fmt(diff)} (${pctv >= 0 ? '+' : ''}${pctv.toFixed(2)}%) · ${bars} bars · ${g.dur(d.time1, d.time2)}`,
            mx, up ? Math.min(p.y1, p.y2) - 12 : Math.max(p.y1, p.y2) + 12, col);
    } else if (isPosition(d.type)) {
        const long = d.type === 'long_position';
        const stop = d.stop ?? 2 * d.y1 - d.y2;
        const ys = g.y(stop);
        const w = Math.max(right - left, 40), xs = left;
        // Profit zone (entry → target) and loss zone (entry → stop)
        ctx.fillStyle = 'rgba(34,197,94,0.18)';
        ctx.fillRect(xs, Math.min(p.y1, p.y2), w, Math.abs(p.y2 - p.y1));
        ctx.fillStyle = 'rgba(239,68,68,0.18)';
        ctx.fillRect(xs, Math.min(p.y1, ys), w, Math.abs(ys - p.y1));
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#64748b';
        ctx.beginPath(); ctx.moveTo(xs, p.y1); ctx.lineTo(xs + w, p.y1); ctx.stroke();       // entry
        const reward = Math.abs(d.y2 - d.y1), risk = Math.abs(d.y1 - stop);
        const rr = risk > 0 ? reward / risk : 0;
        const pct = (v) => (d.y1 ? `${(((v - d.y1) / d.y1) * 100 * (long ? 1 : -1)).toFixed(2)}%` : '');
        const cx = xs + w / 2;
        label(ctx, `Target ${g.fmt(d.y2)} · +${g.fmt(reward)} (${pct(d.y2)})`, cx, p.y2 + (long ? -11 : 11), '#16a34a');
        label(ctx, `Stop ${g.fmt(stop)} · −${g.fmt(risk)}`, cx, ys + (long ? 11 : -11), '#dc2626');
        label(ctx, `${long ? 'Long' : 'Short'} ${g.fmt(d.y1)} · R:R ${rr.toFixed(2)}`, cx, p.y1, g.isDark ? '#334155' : '#475569');
        if (selected) {
            anchor(ctx, xs, p.y1);           // start: entry (and left edge)
            anchor(ctx, xs + w, p.y2);       // end: target (and right edge)
            anchor(ctx, xs + w, ys);         // stop
        }
        ctx.restore();
        return;
    }

    if (selected) {
        anchor(ctx, p.x1, p.y1);
        anchor(ctx, p.x2, p.y2);
    }
    ctx.restore();
}

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
function segDist2(px, py, x1, y1, x2, y2) {
    const l2 = dist2(x1, y1, x2, y2);
    if (!l2) return dist2(px, py, x1, y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
    return dist2(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1));
}

/** Which part of drawing `d` is at (px, py): 'start' | 'end' | 'stop' | 'body' | null. */
export function hitDrawing(d, px, py, g, selected) {
    const p = pts(d, g);
    if (!p) return null;
    const R2 = 64;
    const left = Math.min(p.x1, p.x2), right = Math.max(p.x1, p.x2);
    if (isPosition(d.type)) {
        const stop = d.stop ?? 2 * d.y1 - d.y2;
        const ys = g.y(stop), w = Math.max(right - left, 40);
        if (selected) {
            if (dist2(px, py, left, p.y1) < R2) return 'start';
            if (dist2(px, py, left + w, p.y2) < R2) return 'end';
            if (dist2(px, py, left + w, ys) < R2) return 'stop';
        }
        const top = Math.min(p.y2, ys, p.y1), bot = Math.max(p.y2, ys, p.y1);
        return px >= left && px <= left + w && py >= top && py <= bot ? 'body' : null;
    }
    if (selected) {
        if (dist2(px, py, p.x1, p.y1) < R2) return 'start';
        if (dist2(px, py, p.x2, p.y2) < R2) return 'end';
    }
    if (d.type === 'ray') {
        const dx = p.x2 - p.x1;
        const ex = Math.abs(dx) > 0.5 ? (dx > 0 ? g.chartWidth : 0) : p.x2;
        const ey = Math.abs(dx) > 0.5 ? p.y1 + (p.y2 - p.y1) * ((ex - p.x1) / dx) : p.y2;
        return segDist2(px, py, p.x1, p.y1, ex, ey) < R2 ? 'body' : null;
    }
    if (d.type === 'fib') {
        const span = d.y1 - d.y2;
        const ys = FIB_LEVELS.map(lv => g.y(d.y2 + span * lv.r));
        const xe = Math.max(right, left + 60);
        if (px < left - 4 || px > xe + 4) return null;
        return ys.some(yy => Math.abs(py - yy) < 6) ? 'body' : null;
    }
    // rectangle / measure: inside the box
    const top = Math.min(p.y1, p.y2), bot = Math.max(p.y1, p.y2);
    return px >= left && px <= right && py >= top && py <= bot ? 'body' : null;
}
