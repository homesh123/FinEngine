// ─── FX24HR Market Profile (volume profile per session / day) ────────────────
// For each session (Asia 21:00–07:00, London 07:00–13:00, New York 13:00–21:00
// UTC) or each UTC day:
//   • volume profile: each candle's volume spread evenly over the price rows it
//     traded through (candle count when the feed has no volume);
//   • POC = row with the most volume; value area = rows around the POC holding
//     VA% (default 70%) of the volume → VAH / VAL;
//   • naked POC = an earlier session's POC that price has not traded back to —
//     extended to the right as a level until it is touched.
// Past data only; the current session's profile is "developing".

export const MARKET_PROFILE_DEFAULTS = { fxDays: 3, fxMult: 1.0, fxRes: 48, fxMode: 'sessions', fxVaPct: 70, fxNaked: true };

const SESSIONS = [
    { id: 'asia', label: 'Asia', from: 21, to: 7, col: '34,211,238' },        // wraps midnight
    { id: 'london', label: 'London', from: 7, to: 13, col: '245,158,11' },
    { id: 'ny', label: 'New York', from: 13, to: 21, col: '168,85,247' },
];
const DAILY = { id: 'day', label: 'Day', col: '99,102,241' };

const hourOf = (ms) => Math.floor(ms / 3600000) % 24;   // UTC hour without allocating a Date

function sessionOf(ms) {
    const h = hourOf(ms);
    for (const s of SESSIONS) if (s.from < s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to) return s;
    return SESSIONS[0];
}

/** Profiles for the last `fxDays` days (newest last). */
export function calcMarketProfile(candles, settings = {}) {
    const s = { ...MARKET_PROFILE_DEFAULTS, ...settings };
    const n = candles.length;
    if (n < 10) return [];
    const days = Math.max(1, Math.min(10, parseInt(s.fxDays, 10) || 3));
    const rowsN = Math.max(10, Math.min(200, parseInt(s.fxRes, 10) || 48));
    const vaPct = Math.max(0.5, Math.min(0.95, (Number(s.fxVaPct) || 70) / 100));
    const daily = s.fxMode === 'daily';

    // Split into blocks (session id + its day, so two London sessions never merge)
    const blocks = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
        const t = candles[i].time;
        const sess = daily ? DAILY : sessionOf(t);
        // Asia starting 21:00 belongs to the next day's session
        const dayKey = Math.floor((t + (sess.id === 'asia' && hourOf(t) >= 21 ? 3 * 3600000 : 0)) / 86400000);
        if (!cur || cur.sess !== sess || cur.dayKey !== dayKey) { cur = { sess, from: i, to: i, dayKey }; blocks.push(cur); }
        else cur.to = i;
    }
    const lastDay = blocks[blocks.length - 1].dayKey;
    const keep = blocks.filter(b => b.dayKey > lastDay - days && b.to - b.from >= 1);

    const profiles = keep.map(b => {
        let lo = Infinity, hi = -Infinity, anyVol = false;
        for (let i = b.from; i <= b.to; i++) { lo = Math.min(lo, candles[i].low); hi = Math.max(hi, candles[i].high); if (candles[i].volume > 0) anyVol = true; }
        if (!(hi > lo)) return null;
        const step = (hi - lo) / rowsN;
        const vol = new Float64Array(rowsN);
        for (let i = b.from; i <= b.to; i++) {
            const c = candles[i];
            const r0 = Math.max(0, Math.min(rowsN - 1, Math.floor((c.low - lo) / step)));
            const r1 = Math.max(r0, Math.min(rowsN - 1, Math.floor((c.high - lo) / step)));
            const w = (anyVol ? (c.volume || 0) : 1) / (r1 - r0 + 1);
            for (let r = r0; r <= r1; r++) vol[r] += w;
        }
        let poc = 0, total = 0;
        for (let r = 0; r < rowsN; r++) { total += vol[r]; if (vol[r] > vol[poc]) poc = r; }
        if (!(total > 0)) return null;
        // Value area: grow from the POC towards the bigger neighbour
        let up = poc, dn = poc, acc = vol[poc];
        while (acc < total * vaPct && (up < rowsN - 1 || dn > 0)) {
            const a = up < rowsN - 1 ? vol[up + 1] : -1, d = dn > 0 ? vol[dn - 1] : -1;
            if (a >= d) acc += vol[++up]; else acc += vol[--dn];
        }
        return {
            type: b.sess.id, label: b.sess.label, col: b.sess.col,
            startIdx: b.from, endIdx: b.to, startTime: candles[b.from].time, endTime: candles[b.to].time,
            lo, hi, step, rows: Array.from(vol), maxVol: vol[poc], total, volumeBased: anyVol,
            poc: lo + (poc + 0.5) * step, pocRow: poc, vah: lo + (up + 1) * step, val: lo + dn * step, vaUp: up, vaDn: dn,
            developing: b.to === n - 1, nakedUntil: null,
        };
    }).filter(Boolean);

    // Naked POCs: untouched by any later candle (first touch ends the level)
    if (s.fxNaked !== false) {
        for (const p of profiles) {
            if (p.developing) continue;
            p.naked = true;
            for (let j = p.endIdx + 1; j < n; j++) {
                if (candles[j].low <= p.poc && candles[j].high >= p.poc) { p.naked = false; p.touchedAt = j; break; }
            }
        }
    }
    return profiles;
}

/** Draw the profiles; returns nothing (labels are drawn inline). */
export function drawMarketProfile(ctx, dataset, profiles, x, y, bw, chartWidth, isDark, settings = {}) {
    if (!profiles?.length) return;
    const mult = Math.max(0.2, Math.min(3, Number(settings.fxMult) || 1));
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
    const fmtVol = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`);
    ctx.save();
    for (const p of profiles) {
        const x0 = x(p.startTime), xe = x(p.endTime);
        if (x0 === undefined || xe === undefined) continue;
        const x1 = xe + bw;
        if (x1 < 0 || x0 > chartWidth) continue;
        const span = Math.max(bw * 3, x1 - x0);
        const maxW = Math.min(span * 0.75 * mult, span * 1.2);
        const c = p.col;
        // light session background
        ctx.fillStyle = `rgba(${c},${isDark ? 0.04 : 0.035})`;
        ctx.fillRect(x0, y(p.hi), x1 - x0, y(p.lo) - y(p.hi));
        // histogram rows — batched: one path per style (outside VA, inside VA, POC)
        // instead of one fill per row; rows that land on the same pixel row are
        // merged (zoomed out) so the cost stays flat however many rows there are
        const paths = [new Path2D(), new Path2D(), new Path2D()];
        let lastPx = null, lastW = 0, lastCls = 0, lastTop = 0, lastBot = 0;
        const flush = () => { if (lastPx !== null) paths[lastCls].rect(x0, lastTop, lastW, Math.max(1, lastBot - lastTop)); };
        for (let r = 0; r < p.rows.length; r++) {
            const v = p.rows[r];
            if (!(v > 0)) continue;
            const yt = y(p.lo + (r + 1) * p.step), yb = y(p.lo + r * p.step);
            const w = (v / p.maxVol) * maxW;
            const cls = r === p.pocRow ? 2 : (r >= p.vaDn && r <= p.vaUp ? 1 : 0);
            const px = Math.round(yb);
            if (yb - yt < 1 && lastPx !== null && Math.abs(px - lastPx) < 1) {   // same pixel row: keep the widest
                if (w > lastW) lastW = w;
                if (cls > lastCls) lastCls = cls;
                lastTop = Math.min(lastTop, yt + 0.5);
                continue;
            }
            flush();
            lastPx = px; lastW = w; lastCls = cls; lastTop = yt + 0.5; lastBot = yb - 0.5;
        }
        flush();
        ctx.fillStyle = `rgba(${c},0.16)`; ctx.fill(paths[0]);
        ctx.fillStyle = `rgba(${c},0.42)`; ctx.fill(paths[1]);
        ctx.fillStyle = `rgba(${c},0.85)`; ctx.fill(paths[2]);
        // POC (solid) and VAH / VAL (dashed) across the session
        const hline = (price, width, dash, alpha) => {
            ctx.strokeStyle = `rgba(${c},${alpha})`; ctx.lineWidth = width; ctx.setLineDash(dash);
            ctx.beginPath(); ctx.moveTo(x0, y(price)); ctx.lineTo(x1, y(price)); ctx.stroke(); ctx.setLineDash([]);
        };
        hline(p.poc, 1.6, [], 0.95);
        hline(p.vah, 1, [4, 3], 0.7);
        hline(p.val, 1, [4, 3], 0.7);
        // label above the session
        ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = `rgba(${c},0.95)`;
        const tag = `${p.label}${p.developing ? ' (developing)' : ''} · POC ${fmt(p.poc)}${p.volumeBased ? ` · vol ${fmtVol(p.total)}` : ''}`;
        if (x1 - x0 > 60) ctx.fillText(tag, x0 + 2, y(p.hi) - 2, Math.max(60, x1 - x0));
        // naked POC: extend to the right edge until touched
        if (p.naked) {
            ctx.strokeStyle = `rgba(${c},0.75)`; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(x1, y(p.poc)); ctx.lineTo(chartWidth, y(p.poc)); ctx.stroke(); ctx.setLineDash([]);
            ctx.font = '9px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
            ctx.fillText(`nPOC ${p.label} ${fmt(p.poc)}`, chartWidth - 4, y(p.poc) - 1);
        }
    }
    ctx.restore();
}
