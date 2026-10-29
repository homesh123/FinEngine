// ─── Market Sessions ─────────────────────────────────────────────────────────
// Highlights the main forex trading sessions (Sydney, Tokyo, London, New York)
// on intraday charts. For each session occurrence it can draw:
//  • Range box  — the session's high-to-low range, with the session name
//  • High/Low   — the completed session's high and low, extended until the
//                 same session opens again (previous-session levels)
//  • Mean       — running average of closes during the session
//  • VWAP       — running volume-weighted average price during the session
//  • Trend      — least-squares line through the session's closes
// plus day dividers and a small dashboard (open/closed + time to open/close).
//
// Session hours are entered in UTC (+ an optional offset). Computed in the data
// worker; the result is plain arrays sized to the chart's own bars, so nothing
// accumulates between updates (no caches, timers or listeners).

export const MARKET_SESSION_SLOTS = [1, 2, 3, 4];

const SLOT_DEFAULTS = {
    1: { name: 'Sydney',   start: '21:00', end: '06:00', color: '#14b8a6' },
    2: { name: 'Tokyo',    start: '00:00', end: '09:00', color: '#ec4899' },
    3: { name: 'London',   start: '07:00', end: '16:00', color: '#3b82f6' },
    4: { name: 'New York', start: '13:00', end: '22:00', color: '#f97316' },
};

export const MARKET_SESSION_DEFAULTS = (() => {
    const d = {
        msUtcOffset: 0,         // hours added to UTC for the session times
        msFillOpacity: 10,      // range box fill, %
        msOutline: true,
        msLabels: true,
        msDashboard: true,
        msDayDividers: true,
        msDaysBack: 1,          // days of sessions shown (most recent first); 0 = all
    };
    for (const n of MARKET_SESSION_SLOTS) {
        const sd = SLOT_DEFAULTS[n];
        Object.assign(d, {
            [`ms${n}On`]: true, [`ms${n}Name`]: sd.name, [`ms${n}Start`]: sd.start,
            [`ms${n}End`]: sd.end, [`ms${n}Color`]: sd.color,
            [`ms${n}Range`]: true, [`ms${n}HiLo`]: false, [`ms${n}Mean`]: false,
            [`ms${n}Vwap`]: false, [`ms${n}Trend`]: false,
        });
    }
    return d;
})();

const DAY_MS = 86400000;
const MAX_OCCURRENCES = 400;        // per session — older ones are dropped
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "07:30" → 450 (minutes after midnight); null when invalid. */
function parseHHMM(v) {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 24 || mi > 59) return null;
    return (h * 60 + mi) % 1440;
}

function setting(s, key) {
    return s && s[key] !== undefined ? s[key] : MARKET_SESSION_DEFAULTS[key];
}

/** Session definitions from the indicator settings (only enabled, valid ones). */
export function sessionDefs(s) {
    const defs = [];
    for (const n of MARKET_SESSION_SLOTS) {
        if (!setting(s, `ms${n}On`)) continue;
        const start = parseHHMM(setting(s, `ms${n}Start`)), end = parseHHMM(setting(s, `ms${n}End`));
        if (start === null || end === null || start === end) continue;
        defs.push({
            slot: n, start, end,
            name: String(setting(s, `ms${n}Name`) || `Session ${n}`),
            color: setting(s, `ms${n}Color`) || SLOT_DEFAULTS[n].color,
            range: !!setting(s, `ms${n}Range`), hiLo: !!setting(s, `ms${n}HiLo`),
            mean: !!setting(s, `ms${n}Mean`), vwap: !!setting(s, `ms${n}Vwap`),
            trend: !!setting(s, `ms${n}Trend`),
        });
    }
    return defs;
}

/**
 * Which occurrence of a session a timestamp belongs to: the day number (in the
 * session's clock) on which that occurrence opened, or null if outside it.
 * Handles sessions that cross midnight (e.g. Sydney 21:00–06:00).
 */
function occurrenceDay(localMs, def) {
    const day = Math.floor(localMs / DAY_MS);
    const min = Math.floor((localMs - day * DAY_MS) / 60000);
    if (def.start < def.end) return (min >= def.start && min < def.end) ? day : null;
    if (min >= def.start) return day;
    if (min < def.end) return day - 1;
    return null;
}

/**
 * @returns {null | { offsetMs, sessions: [{ def, occ: [...] }], days: [{ idx, label }] }}
 *   occ = { start, end, high, low, extendTo, mean: Float64Array|null,
 *           vwap: Float64Array|null, trend: {a, b}|null, volume, live }
 */
export function computeMarketSessions(candles, s) {
    const n = candles.length;
    if (n < 2) return null;
    // Sessions only make sense on intraday charts
    const gap = candles[n - 1].time - candles[n - 2].time;
    if (!(gap > 0) || gap >= DAY_MS) return null;

    const offsetMs = (Number(setting(s, 'msUtcOffset')) || 0) * 3600000;
    const defs = sessionDefs(s);
    const daysBack = Math.max(0, parseInt(setting(s, 'msDaysBack'), 10) || 0);
    const lastDay = Math.floor((candles[n - 1].time + offsetMs) / DAY_MS);
    const firstShownDayMs = (lastDay - daysBack + 1) * DAY_MS;
    const sessions = [];

    for (const def of defs) {
        const occ = [];
        let cur = null, curKey = null;
        for (let i = 0; i < n; i++) {
            const key = occurrenceDay(candles[i].time + offsetMs, def);
            if (key === null) { cur = null; curKey = null; continue; }
            const c = candles[i];
            if (cur === null || key !== curKey) {
                cur = { start: i, end: i, high: c.high, low: c.low, volume: 0, extendTo: null, live: false, mean: null, vwap: null, trend: null };
                curKey = key;
                occ.push(cur);
            } else {
                cur.end = i;
                if (c.high > cur.high) cur.high = c.high;
                if (c.low < cur.low) cur.low = c.low;
            }
            cur.volume += c.volume || 0;
        }
        if (occ.length > MAX_OCCURRENCES) occ.splice(0, occ.length - MAX_OCCURRENCES);
        // Only the last `msDaysBack` days (a session belongs to the day it ends,
        // so the overnight Sydney session still counts as "today")
        if (daysBack > 0) {
            const keepFrom = occ.findIndex(o => candles[o.end].time + offsetMs >= firstShownDayMs);
            occ.splice(0, keepFrom === -1 ? occ.length : keepFrom);
        }

        for (let k = 0; k < occ.length; k++) {
            const o = occ[k];
            const len = o.end - o.start + 1;
            // High/low lines run until the same session opens again
            o.extendTo = k + 1 < occ.length ? occ[k + 1].start : null;
            o.live = k === occ.length - 1 && o.end === n - 1;

            if (def.mean || def.vwap) {
                const mean = def.mean ? new Float64Array(len) : null;
                const vwap = def.vwap ? new Float64Array(len) : null;
                let sumC = 0, sumPV = 0, sumV = 0;
                for (let j = 0; j < len; j++) {
                    const c = candles[o.start + j];
                    sumC += c.close;
                    if (mean) mean[j] = sumC / (j + 1);
                    if (vwap) {
                        const v = c.volume || 0;
                        const tp = (c.high + c.low + c.close) / 3;
                        sumPV += tp * v;
                        sumV += v;
                        vwap[j] = sumV > 0 ? sumPV / sumV : (j > 0 ? vwap[j - 1] : tp);
                    }
                }
                o.mean = mean;
                o.vwap = vwap;
            }

            // Least-squares fit of close vs bar number; r = correlation (trend strength)
            let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
            for (let j = 0; j < len; j++) {
                const yv = candles[o.start + j].close;
                sx += j; sy += yv; sxx += j * j; sxy += j * yv; syy += yv * yv;
            }
            const den = len * sxx - sx * sx;
            const b = den !== 0 ? (len * sxy - sx * sy) / den : 0;
            const a = (sy - b * sx) / len;
            const vy = len * syy - sy * sy;
            o.trend = { a, b, r: den > 0 && vy > 0 ? (len * sxy - sx * sy) / Math.sqrt(den * vy) : 0 };
        }
        sessions.push({ def, occ });
    }

    // Day dividers (in the same clock as the session times)
    const days = [];
    if (setting(s, 'msDayDividers')) {
        let prevDay = Math.floor((candles[0].time + offsetMs) / DAY_MS);
        for (let i = 1; i < n; i++) {
            const d = Math.floor((candles[i].time + offsetMs) / DAY_MS);
            if (d !== prevDay && (daysBack === 0 || d * DAY_MS >= firstShownDayMs)) days.push({ idx: i, label: WEEKDAYS[new Date(d * DAY_MS).getUTCDay()] });
            prevDay = d;
        }
    }

    return { offsetMs, sessions, days };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function withAlpha(hex, a) {
    const h = String(hex).replace('#', '');
    if (h.length !== 6) return hex;
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Ranges, levels and lines — drawn behind the candles (inside the chart clip). */
export function drawMarketSessions(ctx, dataset, x, y, bw, startIdx, endIdx, chartWidth, chartHeight, s, colors) {
    const ms = dataset.marketSessions;
    if (!ms) return;
    const fill = Math.max(0, Math.min(100, Number(setting(s, 'msFillOpacity')) || 0)) / 100;
    const outline = !!setting(s, 'msOutline'), labels = !!setting(s, 'msLabels');
    const xAt = (i) => x(dataset[i].time);
    const lastIdx = dataset.length - 1;

    // Day dividers
    if (ms.days.length) {
        ctx.save();
        ctx.strokeStyle = colors.text;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = colors.text;
        for (const d of ms.days) {
            if (d.idx < startIdx || d.idx > endIdx) continue;
            const px = Math.floor(xAt(d.idx)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, chartHeight);
            ctx.stroke();
            ctx.globalAlpha = 0.7;
            ctx.fillText(d.label, px + 4, 22);
            ctx.globalAlpha = 0.35;
        }
        ctx.restore();
    }

    for (const { def, occ } of ms.sessions) {
        for (const o of occ) {
            const hiLoEnd = o.extendTo ?? lastIdx;
            if (o.start > endIdx || Math.max(o.end, def.hiLo ? hiLoEnd : o.end) < startIdx) continue;
            const x0 = xAt(o.start), x1 = xAt(o.end) + bw;
            const yT = y(o.high), yB = y(o.low);

            if (def.range) {
                if (fill > 0) {
                    ctx.fillStyle = withAlpha(def.color, fill);
                    ctx.fillRect(x0, yT, x1 - x0, yB - yT);
                }
                if (outline) {
                    ctx.strokeStyle = withAlpha(def.color, 0.8);
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 3]);
                    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(yT) + 0.5, Math.round(x1 - x0), Math.round(yB - yT));
                    ctx.setLineDash([]);
                }
                if (labels && x1 - x0 > 24) {
                    ctx.font = 'bold 10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillStyle = def.color;
                    ctx.fillText(def.name, (x0 + x1) / 2, yT - 3);
                }
            }

            // Previous-session high/low, extended until this session opens again
            if (def.hiLo && !o.live) {
                const xe = o.extendTo != null ? xAt(o.extendTo) : chartWidth;
                ctx.strokeStyle = def.color;
                ctx.lineWidth = 1;
                ctx.setLineDash([6, 3]);
                ctx.beginPath();
                ctx.moveTo(x1, yT); ctx.lineTo(xe, yT);
                ctx.moveTo(x1, yB); ctx.lineTo(xe, yB);
                ctx.stroke();
                ctx.setLineDash([]);
                if (xe - x1 > 60) {
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'right';
                    ctx.fillStyle = def.color;
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(`${def.name} H`, xe - 4, yT - 2);
                    ctx.textBaseline = 'top';
                    ctx.fillText(`${def.name} L`, xe - 4, yB + 2);
                }
            }

            const half = bw / 2;
            const series = (arr, dash, width) => {
                ctx.strokeStyle = def.color;
                ctx.lineWidth = width;
                ctx.setLineDash(dash);
                ctx.beginPath();
                const from = Math.max(0, startIdx - o.start), to = Math.min(arr.length - 1, endIdx - o.start);
                for (let j = from; j <= to; j++) {
                    const px = xAt(o.start + j) + half, py = y(arr[j]);
                    if (j === from) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            };
            if (def.mean && o.mean) series(o.mean, [2, 2], 1.2);
            if (def.vwap && o.vwap) series(o.vwap, [], 1.5);
            if (def.trend && o.trend && o.end > o.start) {
                const len = o.end - o.start;
                ctx.strokeStyle = def.color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(x0 + half, y(o.trend.a));
                ctx.lineTo(xAt(o.end) + half, y(o.trend.a + o.trend.b * len));
                ctx.stroke();
            }
        }
    }
}

function fmtDuration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Open/closed status and time to the next open/close, from the wall clock. */
export function sessionClock(def, offsetMs, now = Date.now()) {
    const local = now + offsetMs;
    const day = Math.floor(local / DAY_MS);
    const min = (local - day * DAY_MS) / 60000;
    const open = def.start < def.end ? (min >= def.start && min < def.end) : (min >= def.start || min < def.end);
    const target = open ? def.end : def.start;
    let diff = target - min;
    if (diff <= 0) diff += 1440;
    // Forex is closed at the weekend (Fri ~22:00 → Sun ~21:00 UTC)
    const utc = new Date(now);
    const wd = utc.getUTCDay(), hr = utc.getUTCHours();
    const weekend = wd === 6 || (wd === 5 && hr >= 22) || (wd === 0 && hr < 21);
    return { open: open && !weekend, weekend, text: weekend ? 'Weekend' : open ? `closes in ${fmtDuration(diff * 60000)}` : `opens in ${fmtDuration(diff * 60000)}` };
}

/** Compact dashboard in the top-right corner of the chart (drawn on top). */
export function drawMarketSessionsDashboard(ctx, dataset, chartWidth, s, colors, place) {
    const ms = dataset.marketSessions;
    if (!ms || !ms.sessions.length || !setting(s, 'msDashboard')) return;
    const rows = ms.sessions.map(({ def, occ }) => {
        const clk = sessionClock(def, ms.offsetMs);
        const last = occ[occ.length - 1];
        return { def, clk, range: last ? last.high - last.low : null, r: last?.trend?.r ?? 0 };
    });
    const fmtRange = (v) => v.toFixed(v >= 100 ? 1 : v >= 1 ? 2 : 4);
    const statusText = (clk) => clk.open ? `Open · ${clk.text}` : clk.text;
    const pad = 8, rowH = 16, gap = 10, dot = 11;
    const nameFont = 'bold 10px sans-serif', smallFont = '9px sans-serif';
    ctx.save();
    // Column widths from the actual text so nothing overlaps
    ctx.font = nameFont;
    const nameW = Math.max(...rows.map(r => ctx.measureText(r.def.name).width), ctx.measureText('Market Sessions').width - dot);
    ctx.font = smallFont;
    const statusW = Math.max(...rows.map(r => ctx.measureText(statusText(r.clk)).width));
    const rangeW = Math.max(ctx.measureText('Last range').width, ...rows.map(r => r.range == null ? 0 : ctx.measureText(`▲ ${fmtRange(r.range)}`).width));
    const w = Math.ceil(pad + dot + nameW + gap + statusW + gap + rangeW + pad);
    const h = pad * 2 + 14 + rows.length * rowH;
    // `place` (chart engine) applies the user's dragged position and keeps it in view
    const { x: bx, y: by } = place ? place('sessions', chartWidth - w - 10, 10, w, h) : { x: chartWidth - w - 10, y: 10 };
    const statusX = bx + pad + dot + nameW + gap;

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(bx, by, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.gridMajor || colors.grid;
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = nameFont;
    ctx.fillStyle = colors.textBright || colors.text;
    ctx.fillText('Market Sessions', bx + pad, by + pad + 5);
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.text;
    ctx.font = smallFont;
    ctx.fillText('Last range', bx + w - pad, by + pad + 5);
    rows.forEach(({ def, clk, range, r }, i) => {
        const cy = by + pad + 14 + i * rowH + rowH / 2;
        ctx.fillStyle = clk.open ? '#22c55e' : '#64748b';
        ctx.beginPath();
        ctx.arc(bx + pad + 3, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.font = nameFont;
        ctx.fillStyle = def.color;
        ctx.fillText(def.name, bx + pad + dot, cy);
        ctx.font = smallFont;
        ctx.fillStyle = colors.text;
        ctx.fillText(statusText(clk), statusX, cy);
        if (range != null) {
            ctx.textAlign = 'right';
            ctx.fillStyle = r >= 0 ? '#22c55e' : '#ef4444';
            ctx.fillText(`${r >= 0 ? '▲' : '▼'} ${fmtRange(range)}`, bx + w - pad, cy);
        }
    });
    ctx.restore();
}
