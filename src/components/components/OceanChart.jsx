import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── Ocean chart: the market as a boat trip ──────────────────────────────────
// One simple story, drawn on a 2D canvas from the live symbol's data and the
// Pressure analysis (dataset.pressure):
//   the boat (our logo) is the price; above it is the nearest SELLERS WALL
//   (ice, supply zone), below it the nearest BUYERS FLOOR (reef, demand zone);
//   bubbles / an up-arrow = buyers pushing, rain / a down-arrow = sellers pushing;
//   during a trade a green flag marks the target (TP) and rocks the exit (SL).
// Everything else (extra zones, divergences, TP1) is left out on purpose so a
// beginner reads it in seconds. Up on screen = higher price (scale on the right).
// Overlays the normal chart, so alerts and auto-trading keep running underneath.

const WINDOW = 50;             // candles of history in view (few, so each tick visibly moves the boat)
const BOAT_X = 0.62;           // boat position across the scene (room ahead for labels)
const AXIS_W = 58;
const fmt = (v) => (v == null ? '—' : Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
const away = (a, b) => (Math.abs(b) >= 100 ? Math.abs(a - b).toFixed(2) : Math.abs(a - b).toFixed(5));   // decimals of the price, not of the gap

/** Where the latest trade stands: open, tp1, tp2, sl (stop first, like the simulator). */
function tradeStatus(c, sg) {
    let half = false;
    for (let j = sg.i + 1; j < c.length; j++) {
        const k = c[j], buy = sg.dir === 1;
        if (buy ? k.low <= (half ? sg.entry : sg.sl) : k.high >= (half ? sg.entry : sg.sl)) return half ? 'be' : 'sl';
        if (!half && (buy ? k.high >= sg.tp1 : k.low <= sg.tp1)) half = true;
        if (buy ? k.high >= sg.tp2 : k.low <= sg.tp2) return 'tp2';
    }
    return half ? 'tp1' : 'open';
}

/** The few things the scene shows: nearest wall / floor, buyer share, busy-ness, open trade. */
function readScene(c, pc, px, status) {
    const n = c.length, closed = c.slice(Math.max(0, n - 6), n - 1);   // last 5 closed bars: steadier than one bar
    const bs = closed.length ? closed.reduce((s, k) => s + (k.pcBs ?? 0.5), 0) / closed.length : 0.5;
    const rv = c[n - 2]?.pcRv ?? 1;
    const zones = (pc?.zones || []).filter(z => z.state < 2);
    const wall = zones.filter(z => z.dir === -1 && z.bottom > px).sort((a, b) => a.bottom - b.bottom)[0] || null;
    const floor = zones.filter(z => z.dir === 1 && z.top < px).sort((a, b) => b.top - a.top)[0] || null;
    const sg = pc?.signals[pc.signals.length - 1];
    const trade = sg && (status === 'open' || status === 'tp1') ? sg : null;
    return { bs, rv, wall, floor, trade };
}

export default function OceanChart({ dataset, state, livePriceFeed }) {
    const wrapRef = useRef(null), canvasRef = useRef(null);
    const dataRef = useRef(dataset);
    const fxRef = useRef({ parts: [], shards: [], splash: [], events: [], lastZones: null, lastSig: null, lastStatus: null });
    const [hud, setHud] = useState(null);
    const [legend, setLegend] = useState(false);
    const dark = state.theme === 'dark';
    dataRef.current = dataset;

    // ── events (wall/floor broken, new trade, target, stop) + the info box ──
    useEffect(() => {
        const c = dataset, pc = c?.pressure, fx = fxRef.current;
        if (!c?.length || !pc) return;
        const last = c[c.length - 1], now = performance.now();
        const push = (text, kind) => { fx.events.unshift({ text, kind, at: now }); fx.events.length = Math.min(fx.events.length, 3); };
        const ids = new Set(pc.zones.map(z => z.id));
        if (fx.lastZones) {
            for (const z of fx.lastZones) {
                if (ids.has(z.id) || z.state >= 2) continue;
                if (z.dir === -1 && last.close > z.top) { push(`💥 The boat broke through the sellers wall at ${fmt(z.top)} — price can go higher now`, 'up'); fx.burst = { price: z.top, kind: 'ice', at: now }; }
                if (z.dir === 1 && last.close < z.bottom) { push(`💥 The buyers floor at ${fmt(z.bottom)} broke — price can fall further now`, 'down'); fx.burst = { price: z.bottom, kind: 'reef', at: now }; }
            }
        }
        fx.lastZones = pc.zones;
        const sg = pc.signals[pc.signals.length - 1];
        if (sg && fx.lastSig !== null && sg.i !== fx.lastSig) push(`🔔 New ${sg.dir === 1 ? 'BUY' : 'SELL'} trade at ${fmt(sg.entry)}`, 'info');
        fx.lastSig = sg ? sg.i : -1;
        const st = sg ? tradeStatus(c, sg) : null;
        if (sg && fx.lastStatus && st !== fx.lastStatus) {
            if (st === 'tp1') push('✅ Halfway to the target — half the profit is banked', 'up');
            if (st === 'tp2') { push(`🎉 Target reached at ${fmt(sg.tp2)} — trade won!`, 'up'); fx.burst = { price: sg.tp2, kind: 'fireworks', at: now }; }
            if (st === 'sl') { push(`❌ Hit the rocks at ${fmt(sg.sl)} — trade closed with a small loss`, 'down'); fx.burst = { price: sg.sl, kind: 'rocks', at: now }; }
            if (st === 'be') push('Trade closed at its start price — no loss', 'info');
        }
        fx.lastStatus = st;

        const px = livePriceFeed?.get?.() || last.close;
        const { bs, rv, wall, floor, trade } = readScene(c, pc, px, st);
        const div = pc.divs[pc.divs.length - 1];
        const buy = Math.round(bs * 100);
        setHud({
            buy,
            who: bs >= 0.55 ? { text: 'Buyers are stronger', icon: '🟢', cls: 'text-emerald-700 dark:text-emerald-300' }
                : bs <= 0.45 ? { text: 'Sellers are stronger', icon: '🔴', cls: 'text-red-700 dark:text-red-300' }
                : { text: 'Buyers and sellers are even', icon: '⚪', cls: 'text-slate-800 dark:text-slate-100' },
            trend: pc.bias === 1 ? 'Big picture: price has been going UP ⬆' : pc.bias === -1 ? 'Big picture: price has been going DOWN ⬇' : 'Big picture: price is going sideways ↔',
            above: wall ? `⬆ Sellers wall at ${fmt(wall.bottom)} (${away(wall.bottom, px)} above)` : '⬆ No sellers wall nearby',
            below: floor ? `⬇ Buyers floor at ${fmt(floor.top)} (${away(px, floor.top)} below)` : '⬇ No buyers floor nearby',
            note: div && c.length - 1 - div.i <= 10 ? `⚠️ The ${div.dir === -1 ? 'rise' : 'fall'} is getting tired`
                : rv >= 1.5 ? '🌊 Very busy market — big waves, fast moves' : null,
            action: trade
                ? { cls: 'bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200', text: `In a ${trade.dir === 1 ? 'BUY' : 'SELL'} trade from ${fmt(trade.entry)} · 🏁 target ${fmt(trade.tp2)} · ⛔ exit if wrong ${fmt(trade.sl)}` }
                : pc.plan
                    ? { cls: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200', text: pc.plan.dir === 1 ? `Watch: a BUY if price dips to the floor (${fmt(pc.plan.entry)})` : `Watch: a SELL if price climbs to the wall (${fmt(pc.plan.entry)})` }
                    : { cls: 'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200', text: 'Nothing to do — wait until the boat reaches a wall or a floor' },
            event: fx.events[0] && now - fx.events[0].at < 5 * 60e3 ? fx.events[0] : null,
        });
    }, [dataset, livePriceFeed]);

    // ── animation loop ──
    useEffect(() => {
        const cv = canvasRef.current, wrap = wrapRef.current;
        if (!cv || !wrap) return undefined;
        const ctx = cv.getContext('2d');
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        let W = 0, H = 0, raf = 0;
        const t0 = performance.now();
        const resize = () => {
            const dpr = window.devicePixelRatio || 1, r = wrap.getBoundingClientRect();
            W = r.width; H = r.height;
            cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
            cv.style.width = `${W}px`; cv.style.height = `${H}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        const ro = new ResizeObserver(resize); ro.observe(wrap);
        const fx = fxRef.current;
        const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

        // a label with a solid background: big first line, optional small second line
        const pill = (x, yMid, title, sub, fg, bg, align = 'right') => {
            ctx.font = `bold 12px ${FONT}`;
            let w = ctx.measureText(title).width;
            if (sub) { ctx.font = `11px ${FONT}`; w = Math.max(w, ctx.measureText(sub).width); }
            const h = sub ? 32 : 18, bw = w + 14, x0 = align === 'right' ? x - bw : align === 'center' ? x - bw / 2 : x;
            ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x0, yMid - h / 2, bw, h, 7); ctx.fill();
            ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.font = `bold 12px ${FONT}`; ctx.fillText(title, x0 + 7, sub ? yMid - 7 : yMid);
            if (sub) { ctx.font = `11px ${FONT}`; ctx.globalAlpha = 0.85; ctx.fillText(sub, x0 + 7, yMid + 8); ctx.globalAlpha = 1; }
            return h;
        };

        const frame = (now) => {
            raf = requestAnimationFrame(frame);
            const t = still ? 0 : (now - t0) / 1000;
            const c = dataRef.current, pc = c?.pressure;
            ctx.clearRect(0, 0, W, H);
            if (!c || c.length < 5 || W < 50) return;
            const n = c.length, from = Math.max(0, n - WINDOW), view = c.slice(from);
            const live = livePriceFeed?.get?.() || c[n - 1].close;
            const { bs, rv, wall, floor, trade } = readScene(c, pc, live, fx.lastStatus);
            // every tick: remember its direction (flashes the price tag) and glide the boat to it
            if (fx.prevLive != null && live !== fx.prevLive) fx.tick = { d: live - fx.prevLive, at: now };
            fx.prevLive = live;
            const shown = fx.shown = fx.shown == null || still ? live : fx.shown + (live - fx.shown) * 0.12;

            // price range: history + the wall, floor and trade levels when near
            let lo = Infinity, hi = -Infinity;
            for (const k of view) { lo = Math.min(lo, k.low); hi = Math.max(hi, k.high); }
            const span0 = hi - lo || 1, near = (p) => p > lo - span0 * 0.6 && p < hi + span0 * 0.6;
            for (const p of [wall?.top, floor?.bottom, trade?.sl, trade?.tp2]) if (p != null && near(p)) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
            const pad = (hi - lo) * 0.16 || 1; lo -= pad; hi += pad;
            // the scale eases instead of jumping, so the boat moves rather than the axis (snaps on a symbol change)
            if (fx.lo == null || still || Math.abs(lo - fx.lo) > (hi - lo) * 2) { fx.lo = lo; fx.hi = hi; }
            else { fx.lo += (lo - fx.lo) * 0.05; fx.hi += (hi - fx.hi) * 0.05; }
            lo = Math.min(fx.lo, shown - pad / 2); hi = Math.max(fx.hi, shown + pad / 2);
            const plotW = W - AXIS_W, top = W < 520 ? 130 : 24, bot = H - 24;   // phones: the scene starts below the compact info box
            const y = (p) => bot - ((p - lo) / (hi - lo)) * (bot - top);
            const boatX = plotW * BOAT_X;
            const x = (j) => (j / Math.max(1, view.length - 1)) * boatX;

            // labels on the right never overlap: each takes the first free slot near its line
            const used = [];
            const slot = (ly, h) => {
                const fits = (v) => used.every(u => v + h / 2 + 3 < u.a || v - h / 2 - 3 > u.b);
                let v = ly;
                for (let k = 1; !fits(v) && k < 20; k++) v = ly + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 12;
                v = Math.max(top + h / 2, Math.min(bot - h / 2, v));
                used.push({ a: v - h / 2, b: v + h / 2 }); return v;
            };

            // sky
            const sky = ctx.createLinearGradient(0, 0, 0, H);
            if (dark) { sky.addColorStop(0, '#0b1026'); sky.addColorStop(1, '#1e293b'); } else { sky.addColorStop(0, '#bfe3ff'); sky.addColorStop(1, '#f1f8ff'); }
            ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

            // sea: the price path behind the boat, flat water ahead; waves grow with how busy the market is
            const amp = 1.5 + Math.max(0.4, Math.min(3, rv)) * 2.2;
            const surf = (px, base) => base + Math.sin(px * 0.045 + t * 2.1) * amp + Math.sin(px * 0.11 - t * 3.3) * amp * 0.4;
            const pts = view.map((k, j) => y(j === view.length - 1 ? shown : k.close));
            const yLive = y(shown);
            ctx.beginPath(); ctx.moveTo(0, H);
            for (let px = 0; px <= plotW; px += 4) {
                let base = yLive;
                if (px < boatX) { const f = (px / boatX) * (pts.length - 1), j = Math.floor(f); base = pts[j] + ((pts[Math.min(j + 1, pts.length - 1)] - pts[j]) * (f - j)); }
                ctx.lineTo(px, surf(px, base));
            }
            ctx.lineTo(plotW, H); ctx.closePath();
            const sea = ctx.createLinearGradient(0, top, 0, H);
            if (dark) { sea.addColorStop(0, '#0e4f7a'); sea.addColorStop(1, '#03111f'); } else { sea.addColorStop(0, '#2b8fd6'); sea.addColorStop(1, '#0b3a66'); }
            ctx.fillStyle = sea; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.6; ctx.stroke();

            // the open trade first, so its labels sit exactly on their lines
            if (trade) {
                const x0 = boatX + 24;
                const hline = (p, col, dash) => {
                    const ly = y(p); ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(plotW - 4, ly); ctx.stroke(); ctx.setLineDash([]); return ly;
                };
                const ye = hline(trade.entry, '#eab308', [5, 4]);
                ctx.fillStyle = '#eab308'; ctx.beginPath(); ctx.arc(x0, ye, 5, 0, Math.PI * 2); ctx.fill();
                pill(plotW - 8, slot(ye, 18), `${trade.dir === 1 ? 'BUY' : 'SELL'} started here ${fmt(trade.entry)}`, null, '#422006', '#fde047');
                const yt = hline(trade.tp2, '#16a34a', []);
                const fx0 = x0 + 6;   // flag on a pole
                ctx.fillStyle = dark ? '#cbd5e1' : '#334155'; ctx.fillRect(fx0, yt - 26, 2, 26);
                ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.moveTo(fx0 + 2, yt - 26); ctx.lineTo(fx0 + 18 + Math.sin(t * 4) * 2, yt - 20); ctx.lineTo(fx0 + 2, yt - 14); ctx.fill();
                pill(plotW - 8, slot(yt, 32), `🏁 TARGET ${fmt(trade.tp2)}`, 'take profit — the trade wins here', '#fff', '#16a34a');
                const ys = hline(trade.sl, '#dc2626', [7, 5]);
                ctx.fillStyle = dark ? '#64748b' : '#334155';
                for (const [dx, r] of [[0, 8], [12, 11], [26, 7]]) { ctx.beginPath(); ctx.arc(x0 + dx, ys + 3, r, Math.PI, 0); ctx.fill(); }
                pill(plotW - 8, slot(ys, 32), `⛔ EXIT IF WRONG ${fmt(trade.sl)}`, 'stop loss — rocks, the trade loses here', '#fff', '#dc2626');
            }

            // the sellers wall (ice) above and the buyers floor (reef) below
            for (const z of [wall, floor]) {
                if (!z) continue;
                const ice = z.dir === -1, zt = y(z.top), zb = y(z.bottom);
                if (zb < top - 10 || zt > bot + 10) continue;
                const bx = z.baseIdx >= from ? x(z.baseIdx - from) : 0;
                ctx.fillStyle = ice ? (dark ? 'rgba(224,242,254,0.75)' : 'rgba(255,255,255,0.95)') : (dark ? 'rgba(251,146,60,0.6)' : 'rgba(251,146,60,0.8)');
                ctx.beginPath(); ctx.moveTo(bx, zb);
                for (let px = bx; px <= plotW; px += 10) ctx.lineTo(px, zt + (((px * 7 + z.id * 13) % 9) - 4) * (ice ? 1 : 0.6));
                ctx.lineTo(plotW, zb);
                for (let px = plotW; px >= bx; px -= 12) ctx.lineTo(px, zb + (((px * 5 + z.id * 3) % 7) - 3) * (ice ? 1.4 : 0.6));
                ctx.closePath(); ctx.fill();
                ctx.strokeStyle = ice ? '#38bdf8' : '#ea580c'; ctx.lineWidth = 1.5; ctx.stroke();
                const ly = ice ? zt - 20 : zb + 20;
                pill(plotW - 8, slot(ly, 32), ice ? `🧊 SELLERS WALL ${fmt(z.bottom)}` : `🪸 BUYERS FLOOR ${fmt(z.top)}`,
                    ice ? 'price often stops or turns DOWN here' : 'price often stops or bounces UP here',
                    ice ? '#0c4a6e' : '#7c2d12', ice ? '#e0f2fe' : '#ffedd5');
            }

            // buyers rise as bubbles, sellers fall as rain
            if (!still) {
                const busy = Math.max(0.4, Math.min(3, rv));
                const buyRate = Math.max(0, bs - 0.5) * 2 * busy, sellRate = Math.max(0, 0.5 - bs) * 2 * busy;
                if (fx.parts.length < 220) {
                    if (Math.random() < buyRate * 0.9) fx.parts.push({ kind: 'b', x: boatX + (Math.random() - 0.5) * 80, y: yLive + 60 + Math.random() * 40, v: -(0.6 + Math.random()), life: 1 });
                    if (Math.random() < sellRate * 0.9) fx.parts.push({ kind: 's', x: boatX + (Math.random() - 0.5) * 90, y: top + Math.random() * 20, v: 2 + Math.random() * 2, life: 1 });
                }
                for (const p of fx.parts) { p.y += p.v; p.life -= 0.008; }
                fx.parts = fx.parts.filter(p => p.life > 0 && (p.kind === 'b' ? p.y > yLive : p.y < yLive));
                for (const p of fx.parts) {
                    if (p.kind === 'b') { ctx.strokeStyle = `rgba(74,222,128,${p.life})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.stroke(); }
                    else { ctx.strokeStyle = `rgba(248,113,113,${p.life})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2, p.y + 7); ctx.stroke(); }
                }
            }

            // tug of war on the boat: sellers = an anchor dragging it under (with splashes),
            // buyers = balloons on the mast pulling it back up; the stronger side wins
            const push = (bs - 0.5) * 2;   // −1 sellers … +1 buyers
            fx.push = fx.push == null || still ? push : fx.push + (push - fx.push) * 0.03;
            const sink = fx.push < 0 ? -fx.push * 11 : -fx.push * 6;   // px: + = deeper in the water
            const by0 = surf(boatX, yLive), by = by0 + sink;
            const sway = Math.sin(t * 1.3);

            // the boat (logo)
            const slope = (pts[pts.length - 1] - pts[Math.max(0, pts.length - 4)]) / (x(3) || 1);
            ctx.save(); ctx.translate(boatX, by); ctx.rotate(Math.max(-0.3, Math.min(0.3, Math.atan(slope) * 0.6 + Math.sin(t * 2.1) * 0.04)));
            ctx.scale(0.62, 0.62); ctx.translate(-70, -78);
            const sail = ctx.createLinearGradient(40, 20, 68, 66); sail.addColorStop(0, '#6366f1'); sail.addColorStop(1, '#7c3aed');
            ctx.fillStyle = sail; ctx.beginPath(); ctx.moveTo(68, 20); ctx.lineTo(68, 66); ctx.lineTo(40, 66); ctx.fill();
            ctx.fillStyle = '#10b981'; ctx.beginPath(); ctx.moveTo(76, 32); ctx.lineTo(76, 66); ctx.lineTo(100, 66); ctx.fill();
            ctx.fillStyle = dark ? '#f8fafc' : '#0f172a'; ctx.beginPath(); ctx.moveTo(38, 72); ctx.lineTo(102, 72); ctx.lineTo(94, 84); ctx.lineTo(46, 84); ctx.fill();
            ctx.restore();

            // water in front of the hull, so a sinking boat really sits under the surface
            ctx.beginPath(); ctx.moveTo(boatX - 40, by0 + 40);
            for (let px = boatX - 40; px <= boatX + 40; px += 4) ctx.lineTo(px, surf(px, yLive));
            ctx.lineTo(boatX + 40, by0 + 40); ctx.closePath();
            ctx.globalAlpha = 0.8; ctx.fillStyle = sea; ctx.fill(); ctx.globalAlpha = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.6;
            ctx.beginPath(); for (let px = boatX - 40; px <= boatX + 40; px += 4) ctx.lineTo(px, surf(px, yLive)); ctx.stroke();

            // anchor + chain (sellers) under the boat
            const ss = 1 - bs, ay = by + 22 + ss * 46, as = 0.6 + ss;
            ctx.strokeStyle = 'rgba(248,113,113,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.moveTo(boatX, by + 4); ctx.quadraticCurveTo(boatX + sway * 4, (by + ay) / 2, boatX, ay - 8 * as); ctx.stroke(); ctx.setLineDash([]);
            ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2.5 * as; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(boatX, ay - 8 * as, 3 * as, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(boatX, ay - 5 * as); ctx.lineTo(boatX, ay + 8 * as); ctx.stroke();
            ctx.beginPath(); ctx.arc(boatX, ay, 9 * as, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
            ctx.lineCap = 'butt';
            pill(boatX + 16 * as, ay, `Sellers ${Math.round(ss * 100)}% pulling down`, null, '#fff', '#dc2626', 'left');

            // splashes while the sellers drag it down
            if (!still && fx.push < -0.1 && Math.random() < -fx.push * 0.8) {
                for (let k = 0; k < 4; k++) {
                    const side = Math.random() < 0.5 ? -1 : 1;
                    fx.splash.push({ x: boatX + side * (14 + Math.random() * 12), y: by0 - 2, vx: side * (0.8 + Math.random() * 1.8), vy: -(1.8 + Math.random() * 2.5), life: 1 });
                }
            }
            for (const d of fx.splash) { d.x += d.vx; d.y += d.vy; d.vy += 0.15; d.life -= 0.025; }
            fx.splash = fx.splash.filter(d => d.life > 0 && d.y < by0 + 4);
            ctx.fillStyle = '#ffffff';
            for (const d of fx.splash) { ctx.globalAlpha = d.life; ctx.beginPath(); ctx.arc(d.x, d.y, 2.6, 0, Math.PI * 2); ctx.fill(); }
            ctx.globalAlpha = 1;

            // balloons (buyers) tied to the mast
            const mastY = by - 36, nB = bs < 0.4 ? 1 : bs < 0.6 ? 2 : 3, r = 5 + bs * 9;
            for (let k = 0; k < nB; k++) {
                const bx = boatX - 2 + (k - (nB - 1) / 2) * (r * 2.1) + sway * 3, byB = mastY - 26 - bs * 34 - (k % 2) * 6;
                ctx.strokeStyle = 'rgba(21,128,61,0.8)'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(boatX - 1, mastY); ctx.quadraticCurveTo((boatX + bx) / 2 + sway * 4, (mastY + byB) / 2, bx, byB + r); ctx.stroke();
                const g = ctx.createRadialGradient(bx - r / 3, byB - r / 3, 1, bx, byB, r); g.addColorStop(0, '#86efac'); g.addColorStop(1, '#16a34a');
                ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, byB, r * 0.9, r, 0, 0, Math.PI * 2); ctx.fill();
            }
            pill(boatX + r * nB + 6, mastY - 26 - bs * 34, `Buyers ${Math.round(bs * 100)}% pulling up`, null, '#fff', '#16a34a', 'left');

            const tk = fx.tick && now - fx.tick.at < 1500 ? fx.tick : null;   // green/red flash after a tick
            pill(boatX - 34, by - 8, `PRICE NOW ${fmt(live)}${tk ? ` ${tk.d > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(tk.d))}` : ''}`, null, '#fff', tk ? (tk.d > 0 ? '#16a34a' : '#dc2626') : '#4f46e5', 'right');


            // one-off effects: ice shatter, reef crack, fireworks, crash
            if (fx.burst && !still && !fx.burst.spawned) {
                fx.burst.spawned = true;
                const col = { ice: '#e0f2fe', reef: '#fb923c', fireworks: null, rocks: '#94a3b8' }[fx.burst.kind], by2 = y(fx.burst.price);
                for (let k = 0; k < 40; k++) {
                    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
                    fx.shards.push({ x: boatX, y: by2, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 1, col: col || `hsl(${Math.random() * 360},90%,60%)` });
                }
            }
            for (const s of fx.shards) { s.x += s.vx; s.y += s.vy; s.vy += 0.06; s.life -= 0.012; }
            fx.shards = fx.shards.filter(s => s.life > 0);
            for (const s of fx.shards) { ctx.globalAlpha = s.life; ctx.fillStyle = s.col; ctx.fillRect(s.x, s.y, 3, 3); }
            ctx.globalAlpha = 1;

            // price scale
            ctx.fillStyle = dark ? '#0b1220' : '#f8fafc'; ctx.fillRect(plotW, 0, AXIS_W, H);
            ctx.fillStyle = dark ? '#94a3b8' : '#475569'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            for (let k = 0; k <= 5; k++) { const p = lo + (hi - lo) * (k / 5); ctx.fillText(fmt(p), plotW + 6, y(p)); }
            ctx.fillStyle = tk ? (tk.d > 0 ? '#16a34a' : '#dc2626') : '#4f46e5'; ctx.fillRect(plotW, yLive - 9, AXIS_W, 18);
            ctx.fillStyle = '#fff'; ctx.font = `bold 10px ${FONT}`; ctx.fillText(fmt(live), plotW + 5, yLive);
        };
        raf = requestAnimationFrame(frame);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, [dark, livePriceFeed]);

    const evCol = { up: 'text-emerald-700 dark:text-emerald-300', down: 'text-red-700 dark:text-red-300', info: 'text-indigo-700 dark:text-indigo-300' };
    return (
        <div ref={wrapRef} className="absolute inset-0 z-30 overflow-hidden">
            <canvas ref={canvasRef} className="block" aria-label={`Ocean view of ${state.symbol}`} />
            {hud && (
                <div className="absolute top-2 left-2 w-[min(330px,calc(100%-90px))] rounded-xl bg-white/92 dark:bg-slate-900/88 backdrop-blur border border-white/60 dark:border-slate-700 shadow-lg px-3 py-2 text-xs leading-snug text-slate-700 dark:text-slate-300 pointer-events-none">
                    <div className={`text-sm font-bold ${hud.who.cls}`}>{hud.who.icon} {hud.who.text}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold">
                        <span className="text-emerald-700 dark:text-emerald-300">Buyers {hud.buy}%</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden bg-red-500" role="img" aria-label={`Buyers ${hud.buy}%, sellers ${100 - hud.buy}%`}>
                            <div className="h-full bg-emerald-500 transition-[width] duration-700" style={{ width: `${hud.buy}%` }} />
                        </div>
                        <span className="text-red-700 dark:text-red-300">{100 - hud.buy}% Sellers</span>
                    </div>
                    <div className="mt-1 max-[519px]:hidden">{hud.trend}</div>
                    <div className="max-[519px]:hidden">{hud.above}</div>
                    <div className="max-[519px]:hidden">{hud.below}</div>
                    {hud.note && <div className="max-[519px]:hidden text-amber-700 dark:text-amber-300 font-semibold">{hud.note}</div>}
                    <div className={`mt-1.5 rounded-lg px-2 py-1 font-semibold ${hud.action.cls}`}>⛵ {hud.action.text}</div>
                    {hud.event && <div className={`mt-1 font-semibold ${evCol[hud.event.kind] || ''}`}>{hud.event.text}</div>}
                </div>
            )}
            <button type="button" onClick={() => setLegend(true)}
                className="absolute bottom-3 left-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/90 dark:bg-slate-900/85 border border-slate-200 dark:border-slate-700 text-indigo-700 dark:text-indigo-300 shadow hover:bg-white">
                ❓ What am I looking at?
            </button>
            {legend && createPortal(
                <div className={dark ? 'dark' : undefined}>
                    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4 ts-scrim-in" onMouseDown={(e) => { if (e.target === e.currentTarget) setLegend(false); }}>
                        <div role="dialog" aria-label="What am I looking at?" className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl p-4 text-xs text-slate-600 dark:text-slate-300 ts-pop-in">
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">The market is a boat trip</h3>
                                <button type="button" onClick={() => setLegend(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-base">×</button>
                            </div>
                            <p className="mb-2">The boat is the price. When the boat goes up, the price goes up. It sails between a <b>wall</b> above and a <b>floor</b> below.</p>
                            <table className="w-full border-collapse">
                                <tbody className="[&_td]:py-1 [&_td]:pr-2 [&_td]:border-b [&_td]:border-slate-100 dark:[&_td]:border-slate-700 [&_td:first-child]:font-semibold [&_td:first-child]:text-slate-800 dark:[&_td:first-child]:text-slate-100 [&_td:first-child]:whitespace-nowrap">
                                    <tr><td>⛵ Boat</td><td>The price right now.</td></tr>
                                    <tr><td>🧊 Ice wall</td><td>Sellers wait here. Price often stops or turns down.</td></tr>
                                    <tr><td>🪸 Reef floor</td><td>Buyers wait here. Price often stops or bounces up.</td></tr>
                                    <tr><td>🎈 Green balloons</td><td>Buyers pulling the boat up. More and bigger balloons = stronger buyers.</td></tr>
                                    <tr><td>⚓ Red anchor</td><td>Sellers dragging the boat down. When sellers win, the boat sinks and splashes.</td></tr>
                                    <tr><td>🌊 Big waves</td><td>A busy market — prices move fast.</td></tr>
                                    <tr><td>🏁 Green flag</td><td>Target: where a trade takes its profit.</td></tr>
                                    <tr><td>⛔ Rocks</td><td>Exit if wrong: where a trade is closed to keep the loss small.</td></tr>
                                    <tr><td>💥 Breaking ice / reef</td><td>Price broke through the wall or floor — it can keep going that way.</td></tr>
                                </tbody>
                            </table>
                            <p className="mt-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">Simple rule: near the floor, look for buys. Near the wall, look for sells. In the middle, wait.</p>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">A picture of the live chart to help you learn — not advice. Trade ideas can be wrong.</p>
                            <a href="/ocean.html" target="_blank" rel="noopener" className="mt-1 inline-block text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Read the full story →</a>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
