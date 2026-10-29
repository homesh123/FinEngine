// ─── Pressure Chart (Pro) — drawing ──────────────────────────────────────────
// Replaces the candles when the chart type is "Pressure". Draw order: zones →
// equilibrium → pressure bars → divergence markers → signals → levels → card.
// Bars are batched into one Path2D per colour/width style, so the cost stays
// flat however many candles are visible.
import { pressureLots, GRADE_RISK } from './pressureChart.js';

const GREEN = '16,185,129', RED = '239,68,68', AMBER = '#d97706', PURPLE = '99,102,241';
const fmtP = (v) => (v == null ? '—' : Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
const tfName = (m) => (m >= 10080 ? 'W1' : m >= 1440 ? 'D1' : m >= 60 ? `H${m / 60}` : `M${m}`);

export function drawPressure(ctx, { dataset, visibleData, x, y, bw, halfBw, chartWidth, chartHeight, isDark, state, placeBox }) {
    const pc = dataset.pressure;
    if (!pc) return;
    const s = state.indicatorSettings || {};
    const text = isDark ? '#e2e8f0' : '#0f172a', muted = isDark ? '#94a3b8' : '#64748b';
    const lastX = x(dataset[dataset.length - 1].time);
    const rightX = chartWidth;
    ctx.save();

    // ── Zones ──
    if (s.pcZones !== false) {
        for (const z of pc.zones) {
            const bx = x(dataset[z.baseIdx]?.time);
            const x0 = bx === undefined ? 0 : Math.max(0, bx);
            const yt = y(z.top), yb = y(z.bottom);
            if (yb < 0 || yt > chartHeight || x0 > rightX) continue;
            const col = z.dir === 1 ? GREEN : RED;
            const a = z.state === 0 ? 0.2 : z.state === 1 ? 0.12 : 0.05;
            ctx.fillStyle = `rgba(${col},${a})`;
            ctx.fillRect(x0, yt, rightX - x0, yb - yt);
            if (z.ob && z.state < 2) {
                ctx.strokeStyle = `rgba(${PURPLE},0.8)`; ctx.lineWidth = 1.5;
                ctx.strokeRect(x0 + 0.75, yt + 0.75, rightX - x0 - 1.5, yb - yt - 1.5);
            }
            // unfilled FVG backing the zone
            if (z.fvg && !z.fvg.filled) {
                const fx = x(dataset[z.fvg.i0]?.time);
                if (fx !== undefined) {
                    ctx.fillStyle = `rgba(${PURPLE},0.22)`;
                    ctx.fillRect(fx, y(z.fvg.hi), bw * 3.4, y(z.fvg.lo) - y(z.fvg.hi));
                    ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = `rgba(${PURPLE},0.95)`;
                    ctx.fillText('FVG', fx + 2, y(z.fvg.hi) - 1);
                }
            }
            const state = z.state === 0 ? 'fresh' : z.state === 1 ? `tested ${z.touches}×` : 'used';
            const label = `${z.dir === 1 ? 'BUY' : 'SELL'} ZONE · ${state}${z.ob ? ' order block' : ''}${z.swept && z.state < 2 ? ' · swept' : ''}`;
            if (yb - yt >= 10) {
                ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
                ctx.fillStyle = `rgba(${col},${z.state === 2 ? 0.5 : 0.95})`;
                ctx.fillText(label, rightX - 8, (yt + yb) / 2);
            }
        }
    }

    // ── Equilibrium (premium / discount) ──
    if (pc.eq != null) {
        const ey = y(pc.eq);
        if (ey > 0 && ey < chartHeight) {
            ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(0, ey); ctx.lineTo(rightX, ey); ctx.stroke(); ctx.setLineDash([]);
            // labels mid-chart, so they never sit on a zone's label at the right edge
            const lx = Math.round(rightX * 0.55);
            ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
            ctx.fillStyle = muted; ctx.textBaseline = 'bottom'; ctx.fillText(`Equilibrium ${fmtP(pc.eq)}`, lx, ey - 2);
            ctx.fillStyle = `rgb(${RED})`; ctx.fillText('PREMIUM: sell only', lx, ey - 15);
            ctx.fillStyle = `rgb(${GREEN})`; ctx.textBaseline = 'top'; ctx.fillText('DISCOUNT: buy only', lx, ey + 3);
        }
    }

    // ── Pressure bars: colour = who won, width = RelVol class ──
    const W = [0, 0.28, 0.5, 0.78, 1.0];
    const bodies = new Map();               // fill style → Path2D
    const wicks = new Path2D();
    const add = (style, rx, ry, rw, rh) => { let p = bodies.get(style); if (!p) bodies.set(style, (p = new Path2D())); p.rect(rx, ry, rw, rh); };
    for (const d of visibleData) {
        if (d.pcBs === undefined) continue;
        const px = x(d.time);
        if (px === undefined) continue;
        const cx = Math.round(px + halfBw) + 0.5;
        wicks.moveTo(cx, Math.round(y(d.high))); wicks.lineTo(cx, Math.round(y(d.low)));
        const w = Math.max(1, bw * W[d.pcW]);
        const yo = y(d.open), yc = y(d.close);
        const top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
        const b = d.pcBs, col = b >= 0.5 ? GREEN : RED, strong = b >= 0.6 || b <= 0.4;
        add(`rgba(${col},${strong ? 1 : 0.45})`, px + halfBw - w / 2, top, w, h);
    }
    ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.75)' : 'rgba(100,116,139,0.8)'; ctx.lineWidth = 1;
    ctx.stroke(wicks);
    for (const [style, p] of bodies) { ctx.fillStyle = style; ctx.fill(p); }

    // ── Divergences: amber diamond on the confirmation bar (never back-dated) ──
    const first = visibleData[0]?.time, last = visibleData[visibleData.length - 1]?.time;
    for (const dv of pc.divs) {
        const d = dataset[dv.i];
        if (!d || d.time < first || d.time > last) continue;
        const dx = x(d.time) + halfBw, dy = dv.dir === -1 ? y(d.high) - 12 : y(d.low) + 12;
        ctx.fillStyle = AMBER;
        ctx.beginPath(); ctx.moveTo(dx, dy - 5); ctx.lineTo(dx + 5, dy); ctx.lineTo(dx, dy + 5); ctx.lineTo(dx - 5, dy); ctx.closePath(); ctx.fill();
    }

    // ── Signals ──
    const tradeOf = new Map(pc.trades.map(t => [t.i, t]));
    for (const sg of pc.signals) {
        const d = dataset[sg.i];
        if (!d || d.time < first || d.time > last) continue;
        const sx = x(d.time) + halfBw;
        const up = sg.dir === 1, col = up ? GREEN : RED;
        const tip = up ? y(d.low) + 8 : y(d.high) - 8;
        ctx.fillStyle = `rgb(${col})`;
        ctx.beginPath();
        if (up) { ctx.moveTo(sx, tip); ctx.lineTo(sx - 6, tip + 9); ctx.lineTo(sx + 6, tip + 9); }
        else { ctx.moveTo(sx, tip); ctx.lineTo(sx - 6, tip - 9); ctx.lineTo(sx + 6, tip - 9); }
        ctx.closePath(); ctx.fill();
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.textBaseline = up ? 'top' : 'bottom';
        const ly = up ? tip + 12 : tip - 12;
        // grade + confidence (only once 10+ earlier same-grade trades exist)
        ctx.fillText(`${up ? 'BUY' : 'SELL'} ${sg.grade}${sg.conf?.enough ? ` · ${Math.round(sg.conf.p * 100)}%` : ''}`, sx, ly);
        const t = tradeOf.get(sg.i);
        const sub = sg.swept ? 'sweep + reclaim' : sg.fresh ? (sg.ob ? 'fresh order block' : 'fresh zone') : 'tested zone';
        ctx.font = '9px sans-serif'; ctx.fillStyle = muted;
        ctx.fillText(t && t.r !== undefined ? `${sub} · ${t.r >= 0 ? '+' : ''}${t.r.toFixed(1)}R` : sub, sx, up ? ly + 12 : ly - 12);
    }

    // ── Levels: the open signal's trade, else the setup being watched ──
    const lastSig = pc.signals[pc.signals.length - 1];
    const openTrade = lastSig && tradeOf.get(lastSig.i)?.open ? lastSig : null;
    const lv = openTrade || pc.plan;
    if (lv && s.pcLevels !== false) {
        const fromX = openTrade ? x(dataset[openTrade.i].time) + halfBw : (lastX ?? 0) + bw * 2;
        const lineX0 = Math.min(Math.max(0, fromX), rightX - 40);
        const level = (price, col, dash, label) => {
            const ly = y(price);
            if (ly < 0 || ly > chartHeight) return;
            ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash(dash);
            ctx.beginPath(); ctx.moveTo(lineX0, ly); ctx.lineTo(rightX, ly); ctx.stroke(); ctx.setLineDash([]);
            ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = col;
            ctx.fillText(label, rightX - 8, ly - 2);
        };
        const g = `rgb(${GREEN})`, r = `rgb(${RED})`;
        const buy = lv.dir === 1;
        level(lv.entry, buy ? g : r, [], `${openTrade ? '' : 'Watch '}${buy ? 'BUY' : 'SELL'} ${openTrade ? `${openTrade.grade} ` : ''}entry ${fmtP(lv.entry)}`);
        level(lv.sl, r, [6, 4], `SL ${fmtP(lv.sl)}`);
        level(lv.tp1, g, [2, 3], `TP1 ${fmtP(lv.tp1)} (${Number(s.pcTp1R) || 1.5}R, half off)`);
        level(lv.tp2, g, [6, 4], `TP2 ${fmtP(lv.tp2)}`);
        // path from the live candle to a watched entry
        if (!openTrade && lastX !== undefined) {
            const lc = dataset[dataset.length - 1];
            ctx.strokeStyle = isDark ? 'rgba(226,232,240,0.6)' : 'rgba(15,23,42,0.6)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(lastX + halfBw, y(lc.close)); ctx.lineTo(lineX0 + 20, y(lv.entry)); ctx.stroke(); ctx.setLineDash([]);
        }
    }

    ctx.restore();
}

/** Info card (top-left, draggable) — drawn after all other overlays so nothing paints over it. */
export function drawPressureCard(ctx, { dataset, chartWidth, isDark, state, placeBox }) {
    const pc = dataset.pressure;
    if (!pc) return;
    const s = state.indicatorSettings || {};
    const text = isDark ? '#e2e8f0' : '#0f172a', muted = isDark ? '#94a3b8' : '#64748b';
    ctx.save();
    if (s.pcCard !== false && placeBox) {
        // collapsed = first line (the bias) only; click the card to toggle (kept per browser)
        let collapsed = false;
        try { collapsed = localStorage.getItem('ts_pc_card_collapsed') === '1'; } catch { /* storage unavailable */ }
        const all = cardLines(pc, dataset, state);
        const lines = collapsed ? all.slice(0, 1) : all;
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        const w = Math.min(chartWidth - 16, Math.max(...lines.map(l => ctx.measureText(l.t).width)) + 34), h = lines.length * 16 + 12;
        const toggle = () => { try { localStorage.setItem('ts_pc_card_collapsed', collapsed ? '0' : '1'); } catch { /* storage unavailable */ } };
        // default spot: top-left, under the indicator list (one ~23px row per indicator)
        let legendRows = Object.values(state.indicators || {}).filter(Boolean).length;
        try { if (localStorage.getItem('indicatorLegendCollapsed') === '1') legendRows = Math.min(1, legendRows); } catch { /* storage unavailable */ }
        const { x: bx, y: by } = placeBox('pressure', 8, 30 + legendRows * 23, w, h, toggle);
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.roundRect(bx, by, w, h, 8); ctx.fill();
        ctx.strokeStyle = isDark ? '#475569' : '#94a3b8'; ctx.lineWidth = 1; ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        lines.forEach((l, k) => { ctx.fillStyle = l.c === 'muted' ? muted : l.c || text; ctx.fillText(l.t, bx + 10, by + 14 + k * 16, w - 34); });
        // chevron: ▾ expanded / ▸ collapsed
        ctx.fillStyle = muted; ctx.beginPath();
        const cx = bx + w - 14, cy = by + 14;
        if (collapsed) { ctx.moveTo(cx - 2, cy - 4); ctx.lineTo(cx + 3, cy); ctx.lineTo(cx - 2, cy + 4); }
        else { ctx.moveTo(cx - 4, cy - 2); ctx.lineTo(cx + 4, cy - 2); ctx.lineTo(cx, cy + 3); }
        ctx.closePath(); ctx.fill();
    }
    ctx.restore();
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const pct = (v) => `${Math.round(v * 100)}%`;

function cardLines(pc, dataset, state) {
    const s = state.indicatorSettings || {};
    const out = [];
    const b = pc.bias, bt = tfName(pc.biasMins);
    out.push({ t: `${bt} BIAS: ${b === 1 ? 'BULLISH → buy zones only' : b === -1 ? 'BEARISH → sell zones only' : 'NEUTRAL → grades capped at B'}`, c: b === 1 ? `rgb(${GREEN})` : b === -1 ? `rgb(${RED})` : null });
    if (!pc.profile.signals) out.push({ t: pc.profile.note, c: 'muted' });
    else if (!pc.deltaOk) out.push({ t: `Delta off → volume only (${pc.mode === 'clv' ? 'no buy/sell split on this timeframe' : s.pcDeltaSource === 'off' ? 'set in settings' : `split repeats the candle, ρ ${pc.rho?.toFixed(2)}`})`, c: 'muted' });

    const last = pc.signals[pc.signals.length - 1];
    const lastT = last && pc.trades.find(t => t.i === last.i);
    const live = last && lastT?.open ? last : null;
    const p = live || pc.plan;
    const now = Date.now(), px = dataset[dataset.length - 1]?.close;
    if (live) {
        out.push({ t: `Signal: ${live.dir === 1 ? 'BUY' : 'SELL'} ${live.grade} at ${fmtP(live.entry)} · SL ${fmtP(live.sl)} · TP1 ${fmtP(live.tp1)} · TP2 ${fmtP(live.tp2)}`, c: live.dir === 1 ? `rgb(${GREEN})` : `rgb(${RED})` });
        // confidence from earlier same-grade trades only
        const cf = live.conf;
        out.push({ t: cf?.enough ? `Confidence ${pct(cf.p)} (n=${cf.n}, 95% ${pct(cf.lo)}–${pct(cf.hi)})` : `Confidence: not enough history (n=${cf?.n ?? 0}, need 10)`, c: cf?.enough ? null : 'muted' });
        // execution window: valid N bars after the signal bar, void past the chase limit
        const chased = px != null && (live.dir === 1 ? px > live.chaseLimit : px < live.chaseLimit);
        const expired = now > live.deadline;
        out.push({ t: expired || chased
            ? `Execution window closed (${expired ? `after ${hhmm(live.deadline)}` : `price beyond ${fmtP(live.chaseLimit)}`}) — don't chase`
            : `Enter by ${hhmm(live.deadline)} · only while price ${live.dir === 1 ? '≤' : '≥'} ${fmtP(live.chaseLimit)}`, c: expired || chased ? AMBER : null });
        if (live.typicalHold != null) {
            const mins = live.typicalHold * ((state.timeframe || 15));
            out.push({ t: `Typical hold ${live.typicalHold} bars (≈ ${mins >= 120 ? `${(mins / 60).toFixed(mins >= 600 ? 0 : 1)} h` : `${mins} min`})`, c: 'muted' });
        }
    } else if (p) out.push({ t: `Watching: ${p.dir === 1 ? 'BUY' : 'SELL'} zone ${fmtP(p.zone.bottom)}–${fmtP(p.zone.top)} · waits for a confirmation bar` });
    else out.push({ t: 'No setup: price is between zones — no trade', c: 'muted' });

    if (p) {
        const bal = Number(s.pcBalance) || 10000, risk = Number(s.pcRisk) || 0.5;
        const k = live ? (live.riskK ?? GRADE_RISK[live.grade] ?? 1) : 1;
        const lot = pressureLots(state.symbol, bal, risk, p.risk, k, Number(s.pcCommission) || 0);
        const riskUsd = Math.round(bal * risk / 100 * k);
        const lotTxt = !lot ? '' : lot.notTraded ? ' → grade C, not traded' : lot.belowMin ? ' → below 0.01 lot minimum (skip or raise risk)' : ` → ${lot.lots.toFixed(2)} lot`;
        out.push({ t: `Risk ${risk}%${k !== 1 ? ` × ${k}` : ''} = USD ${riskUsd}${lotTxt} (USD ${bal >= 1000 ? `${Math.round(bal / 1000)}k` : bal} acct)` });
        out.push({ t: `R:R ${p.rr.toFixed(1)} after spread  |  stop ${Math.abs(p.entry) >= 100 ? p.risk.toFixed(2) : p.risk.toFixed(5)} away` });
    }
    // track record by grade (this chart's history, in-sample)
    const rec = ['A+', 'A', 'B'].map(g => pc.stats?.[g]).map((st, k) => st && st.n ? `${['A+', 'A', 'B'][k]} ${Math.round(st.w / st.n * 100)}% of ${st.n}` : null).filter(Boolean);
    if (rec.length) out.push({ t: `Record here: ${rec.join(' · ')} won`, c: 'muted' });
    out.push({ t: 'Signals unproven — in-sample stats, backtests show no clear edge yet', c: AMBER });
    return out;
}
