// ─── Market context: economic calendar + CFTC positioning ────────────────────
// Backend: /api/calendar (Forex Factory weekly feed, cached hourly, history kept)
// and /api/cot (CFTC Commitments of Traders, official, weekly). See
// MARKET_CONTEXT.md.
import { escapeHtml as esc } from './footprintInsights.js';

export async function fetchCalendar(symbol) {
    const res = await fetch(`/api/calendar?symbol=${encodeURIComponent(symbol.replace('/', ''))}`);
    if (!res.ok) throw new Error(`calendar ${res.status}`);
    return res.json();
}

export async function fetchCot(symbol) {
    const res = await fetch(`/api/cot?symbol=${encodeURIComponent(symbol.replace('/', ''))}`);
    if (!res.ok) throw new Error(`cot ${res.status}`);
    return res.json();
}

const IMPACT = {
    High: { col: '#ef4444', rank: 3, label: 'High impact' },
    Medium: { col: '#f59e0b', rank: 2, label: 'Medium impact' },
    Low: { col: '#a3a3a3', rank: 1, label: 'Low impact' },
    Holiday: { col: '#64748b', rank: 0, label: 'Bank holiday' },
};

/**
 * Event markers along the bottom of the price chart (inside its clip): one
 * marker per candle slot, coloured by the highest impact in it. Future events
 * are placed past the live candle. Returns hit areas for the hover popup.
 */
export function drawCalendar(ctx, events, dataset, x, bw, halfBw, chartWidth, chartHeight, tfMs, isDark, minRank = 2) {
    if (!events?.length || !dataset.length) return [];
    const n = dataset.length, first = dataset[0].time, last = dataset[n - 1];
    const lastX = x(last.time);
    if (lastX === undefined) return [];
    const step = n > 1 && x(dataset[n - 2].time) !== undefined ? lastX - x(dataset[n - 2].time) : bw / 0.8;
    const slotX = (t) => {
        if (t < first) return null;
        if (t >= last.time) return lastX + ((t - last.time) / tfMs) * step + halfBw;
        let lo = 0, hi = n - 1;                                     // last candle with time ≤ t
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (dataset[mid].time <= t) lo = mid; else hi = mid - 1; }
        const px = x(dataset[lo].time);
        return px === undefined ? null : px + halfBw;
    };
    const groups = new Map();
    const offRight = [];                                           // future events past the right edge
    for (const e of events) {
        const imp = IMPACT[e.impact];
        if (!imp || imp.rank < minRank) continue;
        const px = slotX(e.t);
        if (px !== null && px > chartWidth + 10 && e.t > Date.now()) { offRight.push(e); continue; }
        if (px === null || px < -10 || px > chartWidth + 10) continue;
        const k = Math.round(px);
        if (!groups.has(k)) groups.set(k, { x: px, events: [] });
        groups.get(k).events.push(e);
    }
    const hits = [];
    const y = chartHeight - 9;
    ctx.save();
    for (const g of groups.values()) {
        const top = g.events.reduce((a, e) => (IMPACT[e.impact].rank > IMPACT[a.impact].rank ? e : a), g.events[0]);
        const col = IMPACT[top.impact].col;
        const future = top.t > Date.now();
        ctx.globalAlpha = future ? 1 : 0.55;
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(g.x, y - 7); ctx.lineTo(g.x, y - 26); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(g.x, y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(top.cur === 'All' ? '★' : top.cur.slice(0, 1), g.x, y + 0.5);
        hits.push({ x: g.x, y, r: 9, events: g.events });
    }
    // Upcoming events beyond the visible area (e.g. next week, seen at the weekend):
    // a tag at the bottom-right; hovering it lists them
    if (offRight.length) {
        offRight.sort((a, b) => a.t - b.t);
        const next = offRight.find(e => e.impact === 'High') || offRight[0];
        const when = new Date(next.t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const txt = `Next: ${next.cur} ${next.title} · ${when} →`;
        ctx.font = 'bold 9px sans-serif';
        const w = Math.min(chartWidth - 8, ctx.measureText(txt).width + 22), h = 15;
        const bx = chartWidth - w - 4, by = y - h / 2;
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.95)'; ctx.fillRect(bx, by, w, h);
        ctx.strokeStyle = IMPACT[next.impact].col; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
        ctx.fillStyle = IMPACT[next.impact].col; ctx.beginPath(); ctx.arc(bx + 8, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, bx + 15, y + 0.5, w - 19);
        ctx.globalAlpha = 1;
        hits.push({ x: bx + w / 2, y, r: Math.max(w / 2, 9), rh: h / 2, events: offRight.slice(0, 8) });
    }
    ctx.restore();
    return hits;
}

/** Hover popup for the events of one marker. */
export function calendarHtml(events, colors, isDark) {
    const head = isDark ? '#818cf8' : '#4f46e5';
    const fmtT = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const rows = events.map(e => {
        const imp = IMPACT[e.impact] || IMPACT.Low;
        const vals = [e.forecast && `forecast ${esc(e.forecast)}`, e.previous && `previous ${esc(e.previous)}`].filter(Boolean).join(' · ');
        return `<div style="margin-top:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${imp.col};margin-right:5px"></span>`
            + `<b>${esc(e.cur)}</b> ${esc(e.title)}<div style="font-size:10px;color:${colors.text}">${esc(fmtT(e.t))} · ${imp.label}${vals ? ` · ${vals}` : ''}</div></div>`;
    }).join('');
    return `<div style="font-weight:700;color:${head}">Economic calendar</div>${rows}`
        + `<div style="margin-top:6px;font-size:10px;opacity:.7">Source: Forex Factory. Times in your local time zone.</div>`;
}

/** "High-impact USD news in 25 min: CPI m/m" when one is ≤ 60 min away (or ≤ 15 min ago). */
export function newsWarning(events, now = Date.now()) {
    if (!events?.length) return null;
    const near = events.filter(e => e.impact === 'High' && e.t >= now - 15 * 60000 && e.t <= now + 60 * 60000).sort((a, b) => a.t - b.t)[0];
    if (!near) return null;
    const mins = Math.round((near.t - now) / 60000);
    return mins >= 0 ? `High-impact ${near.cur} news in ${mins} min: ${near.title}` : `High-impact ${near.cur} news ${-mins} min ago: ${near.title}`;
}

/** One line for the model hover: CFTC large-speculator positioning. */
export function cotHtml(cot) {
    if (!cot?.available) return '';
    const pct = Math.round(cot.pctLong * 100);
    const chg = cot.netChange == null ? '' : ` (${cot.netChange >= 0 ? '+' : ''}${Math.round(cot.netChange).toLocaleString()} contracts vs previous week)`;
    const note = cot.inverse ? ' — futures are the inverse of this pair' : '';
    return `<div style="margin-top:6px"><b>Big speculators (CFTC, ${esc(cot.date)}):</b> ${pct}% long${chg}${note}. Very one-sided positioning has often preceded reversals.</div>`;
}

export async function fetchSentiment(symbol) {
    const res = await fetch(`/api/sentiment?symbol=${encodeURIComponent(symbol.replace('/', ''))}`);
    if (!res.ok) throw new Error(`sentiment ${res.status}`);
    return res.json();
}

/** One line for the model hover: Myfxbook retail positioning (contrarian at extremes). */
export function sentimentHtml(s) {
    if (!s?.available) return '';
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
    const side = s.longPct >= s.shortPct ? `${Math.round(s.longPct)}% long` : `${Math.round(s.shortPct)}% short`;
    const extreme = Math.max(s.longPct, s.shortPct) >= 70 ? ' — strongly one-sided; the retail crowd is often on the wrong side at extremes' : '';
    const avg = s.avgLong && s.avgShort ? ` (average entry: longs ${fmt(s.avgLong)}, shorts ${fmt(s.avgShort)})` : '';
    return `<div style="margin-top:6px"><b>Retail traders:</b> ${side}${avg}${extreme}. <span style="opacity:.7">Source: Myfxbook</span></div>`;
}
