// ─── Indicator panes (Volume, MACD, RSI, DeMarker, CVD) ──────────────────────
// TradingView-style panes under the main chart: header with name, settings and
// values (last candle, or the hovered one via drawPaneHeader), gridlines,
// right-axis ticks and a coloured current-value tag. Returns each pane's
// geometry and scale so the crosshair can show values in every pane.
// Stateless: nothing is kept between frames.
import * as d3 from 'd3';
import { gridStyle } from './chartGrid';

export const PANE_COLORS = {
    rsi: '#7e57c2', rsiMa: '#f5c542', macd: '#2962ff', signal: '#ff6d00',
    histUpStrong: '#26a69a', histUpWeak: '#b2dfdb', histDnStrong: '#ff5252', histDnWeak: '#ffcdd2',
    dem: '#0ea5e9', cvd: '#2962ff', cvdSmooth: '#f59e0b', volMa: '#3b82f6',
};

/** Number formatting by magnitude (indicator values span 0.0001 … 1e6). */
export function fmtVal(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(4);
    return v.toPrecision(3);
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Pane definitions: header label, value segments, value range and drawing. */
function paneDefs(s) {
    const rsiOb = num(s.rsiOb, 70), rsiOs = num(s.rsiOs, 30);
    const demOb = num(s.demOb, 0.7), demOs = num(s.demOs, 0.3);
    return {
        volume: (() => {
            const up = s.volUpColor || '#26a69a', dn = s.volDnColor || '#ef5350', hiX = num(s.volHighMult, 2), maOn = s.volMaShow !== false;
            const maCol = s.volMaColor || PANE_COLORS.volMa;
            const col = (d) => (d.close >= d.open ? up : dn);
            return {
                title: `Vol${maOn ? ` · ${s.volMaType === 'EMA' ? 'EMA' : 'MA'} ${num(s.volMaLen, 20)}` : ''}`,
                values: (d) => [[fmtVal(d.volume), col(d)], ...(maOn ? [[fmtVal(d.volMa), maCol]] : []),
                    ...(d.volRel != null ? [[`RelVol ${d.volRel.toFixed(2)}×`, hiX > 0 && d.volRel >= hiX ? col(d) : '#8e8e93']] : [])],
                last: (d) => d.volume, lastColor: col,
                domain: (data) => [0, (d3.max(data, d => Math.max(d.volume || 0, maOn ? d.volMa || 0 : 0)) || 1) * 1.08],
                draw: (g) => {
                    // normal bars soft; bars at least volHighMult × the average at full strength
                    g.bars(d => d.volume, d => `${col(d)}${hiX > 0 && d.volRel >= hiX ? 'f2' : '73'}`);
                    if (maOn) g.line(d => d.volMa, maCol, 1.3);
                },
            };
        })(),
        macd: {
            title: `MACD ${num(s.macdFast, 12)} ${num(s.macdSlow, 26)} ${num(s.macdSig, 9)}`,
            values: (d) => [[fmtVal(d.macdHist), histColor(d, null)], [fmtVal(d.macdLine), PANE_COLORS.macd], [fmtVal(d.macdSignal), PANE_COLORS.signal]],
            last: (d) => d.macdLine, lastColor: () => PANE_COLORS.macd,
            domain: (data) => {
                const v = data.flatMap(d => [d.macdLine, d.macdSignal, d.macdHist]).filter(x => x !== null && x !== undefined);
                const lo = d3.min(v) ?? -1, hi = d3.max(v) ?? 1, pad = (hi - lo) * 0.08 || 1e-6;
                return [Math.min(lo, 0) - pad, Math.max(hi, 0) + pad];
            },
            zero: true,
            draw: (g) => {
                // 4-colour histogram: growing/falling above/below zero (TradingView)
                const prevHist = new Map();
                let prev = null;
                for (const d of g.all) { prevHist.set(d.time, prev); prev = d.macdHist; }
                g.bars(d => d.macdHist, d => histColor(d, prevHist.get(d.time)), true);
                g.line(d => d.macdLine, PANE_COLORS.macd, 1.4);
                g.line(d => d.macdSignal, PANE_COLORS.signal, 1.4);
            },
        },
        rsi: {
            title: `RSI ${num(s.rsiPeriod, 14)}${num(s.rsiMaLen, 14) > 0 ? ` · MA ${num(s.rsiMaLen, 14)}` : ''}`,
            values: (d) => [[fmtVal(d.rsi), PANE_COLORS.rsi], ...(d.rsiMa != null ? [[fmtVal(d.rsiMa), PANE_COLORS.rsiMa]] : [])],
            last: (d) => d.rsi, lastColor: () => PANE_COLORS.rsi,
            domain: () => [0, 100], fixedTicks: [rsiOs, 50, rsiOb],
            draw: (g) => {
                g.band(rsiOs, rsiOb, 'rgba(126,87,194,0.08)');
                g.level(rsiOb); g.level(50, true); g.level(rsiOs);
                g.line(d => d.rsi, PANE_COLORS.rsi, 1.5);
                g.line(d => d.rsiMa, PANE_COLORS.rsiMa, 1.1);
            },
        },
        demarker: {
            title: `DeMarker ${num(s.demPeriod, 14)}`,
            values: (d) => [[fmtVal(d.demarker), PANE_COLORS.dem]],
            last: (d) => d.demarker, lastColor: () => PANE_COLORS.dem,
            domain: () => [0, 1], fixedTicks: [demOs, 0.5, demOb],
            draw: (g) => {
                g.band(demOs, demOb, 'rgba(14,165,233,0.08)');
                g.level(demOb); g.level(0.5, true); g.level(demOs);
                g.line(d => d.demarker, PANE_COLORS.dem, 1.5);
            },
        },
        pressure: {
            title: 'Strength · (BuyShare − 0.5) × RelVol · EMA 5 · amber = divergence',
            values: (d) => (d.pcStr === undefined ? [] : [
                [fmtVal(d.pcStr), d.pcStr >= 0 ? '#10b981' : '#ef4444'], [`EMA ${fmtVal(d.pcEma)}`, PANE_COLORS.cvdSmooth],
                [`Buy ${Math.round(d.pcBs * 100)}%`, d.pcBs >= 0.5 ? '#10b981' : '#ef4444'], [`RelVol ${d.pcRv.toFixed(2)}×`, '#64748b'],
            ]),
            last: (d) => d.pcEma, lastColor: () => PANE_COLORS.cvdSmooth,
            domain: (data) => {
                const m = d3.max(data, d => Math.max(Math.abs(d.pcStr || 0), Math.abs(d.pcEma || 0))) || 0.1;
                return [-m * 1.08, m * 1.08];
            },
            zero: true,
            draw: (g) => {
                g.bars(d => d.pcStr, d => (d.pcAmber ? 'rgba(217,119,6,0.85)' : d.pcStr >= 0 ? 'rgba(16,185,129,0.8)' : 'rgba(239,68,68,0.8)'), true);
                g.line(d => d.pcEma, PANE_COLORS.cvdSmooth, 1.3);
            },
        },
        cvd: {
            title: `CVD · ${s.cvdAggType === 'Rolling Window' ? `rolling ${num(s.cvdRollLen, 20)}` : 'daily'} · SMA ${num(s.cvdSmoothLen, 5)}`,
            values: (d) => [[fmtVal(d.cvdAccum), PANE_COLORS.cvd], [fmtVal(d.cvdSmooth), PANE_COLORS.cvdSmooth], [`Δ ${fmtVal(d.cvdCandleDelta)}`, d.cvdCandleDelta >= 0 ? '#26a69a' : '#ef5350']],
            last: (d) => d.cvdAccum, lastColor: () => PANE_COLORS.cvd,
            domain: (data) => {
                const m = d3.max(data, d => Math.max(Math.abs(d.cvdAccum || 0), Math.abs(d.cvdSmooth || 0), Math.abs(d.cvdCandleDelta || 0))) || 1;
                return [-m * 1.08, m * 1.08];
            },
            zero: true,
            draw: (g) => {
                g.bars(d => d.cvdCandleDelta, d => (d.cvdCandleDelta >= 0 ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)'), true);
                g.line(d => d.cvdAccum, PANE_COLORS.cvd, 1.6);
                g.line(d => d.cvdSmooth, PANE_COLORS.cvdSmooth, 1.1);
            },
        },
    };
}

function histColor(d, prev) {
    const h = d.macdHist;
    if (h === null || h === undefined) return 'transparent';
    const growing = prev === null || prev === undefined ? true : Math.abs(h) >= Math.abs(prev);
    if (h >= 0) return growing ? PANE_COLORS.histUpStrong : PANE_COLORS.histUpWeak;
    return growing ? PANE_COLORS.histDnStrong : PANE_COLORS.histDnWeak;
}

/**
 * Draw all active panes. Returns [{ ind, top, height, toY, fromY }] in chart
 * coordinates (ctx already translated by the chart margin).
 */
export function drawPanes(ctx, { panes, heights, top, visibleData, x, bw, halfBw, chartWidth, colors, isDark, settings, grid: gridSettings }) {
    const defs = paneDefs(settings || {});
    const out = [];
    let y0 = top;
    for (const ind of panes) {
        const def = defs[ind];
        const h = heights[ind] || 80;
        if (!def) { y0 += h; continue; }
        const data = visibleData;
        const [lo, hi] = def.domain(data);
        const scale = d3.scaleLinear().domain([lo, hi]).range([h - 4, 14]);   // keep the header row clear
        const paneTop = y0;                    // fixed copy — y0 moves on to the next pane
        const toY = (v) => paneTop + scale(v);

        // Background, separator (also the resize handle) and gridlines
        ctx.fillStyle = colors.paneBg;
        ctx.fillRect(0, y0, chartWidth, h);
        ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
        ctx.fillRect(0, y0 - 1, chartWidth, 2);
        const ticks = def.fixedTicks || scale.ticks(Math.max(2, Math.floor(h / 30)));
        const grid = gridStyle(gridSettings, colors);       // Chart Settings → Grid lines
        if (grid) {
            ctx.strokeStyle = grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const t of ticks) { const ty = Math.round(toY(t)) + 0.5; ctx.moveTo(0, ty); ctx.lineTo(chartWidth, ty); }
            ctx.stroke();
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y0, chartWidth, h);
        ctx.clip();
        if (def.zero) {
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(0, Math.round(toY(0)) + 0.5); ctx.lineTo(chartWidth, Math.round(toY(0)) + 0.5); ctx.stroke();
            ctx.setLineDash([]);
        }
        const g = {
            all: data,
            line: (get, color, width) => {
                ctx.strokeStyle = color; ctx.lineWidth = width;
                ctx.beginPath();
                let on = false;
                for (const d of data) {
                    const v = get(d), px = x(d.time);
                    if (v === null || v === undefined || Number.isNaN(v) || px === undefined) { on = false; continue; }
                    if (!on) { ctx.moveTo(px + halfBw, toY(v)); on = true; } else ctx.lineTo(px + halfBw, toY(v));
                }
                ctx.stroke();
            },
            bars: (get, color, fromZero) => {
                const base = toY(fromZero ? 0 : lo);
                const w = Math.max(1, bw * 0.8), off = (bw - w) / 2;
                for (const d of data) {
                    const v = get(d), px = x(d.time);
                    if (v === null || v === undefined || px === undefined) continue;
                    const vy = toY(v);
                    ctx.fillStyle = color(d);
                    ctx.fillRect(px + off, Math.min(base, vy), w, Math.max(1, Math.abs(base - vy)));
                }
            },
            band: (a, b, color) => {
                ctx.fillStyle = color;
                ctx.fillRect(0, toY(b), chartWidth, toY(a) - toY(b));
            },
            level: (v, faint) => {
                ctx.strokeStyle = isDark ? `rgba(148,163,184,${faint ? 0.25 : 0.5})` : `rgba(100,116,139,${faint ? 0.25 : 0.5})`;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.beginPath(); ctx.moveTo(0, Math.round(toY(v)) + 0.5); ctx.lineTo(chartWidth, Math.round(toY(v)) + 0.5); ctx.stroke();
                ctx.setLineDash([]);
            },
        };
        def.draw(g);
        ctx.restore();

        // Right axis ticks
        ctx.fillStyle = colors.text;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const t of ticks) {
            const ty = toY(t);
            if (ty > y0 + 8 && ty < y0 + h - 4) ctx.fillText(fmtVal(t), chartWidth + 5, ty);
        }
        // Current-value tag (last candle)
        let lastD = null;
        for (let k = data.length - 1; k >= 0; k--) {
            const v = def.last(data[k]);
            if (v !== null && v !== undefined) { lastD = data[k]; break; }
        }
        if (lastD) {
            const v = def.last(lastD), ty = Math.max(y0 + 8, Math.min(y0 + h - 8, toY(v)));
            const label = fmtVal(v);
            ctx.font = 'bold 10px sans-serif';
            const w = Math.max(40, ctx.measureText(label).width + 8);
            ctx.fillStyle = def.lastColor(lastD);
            ctx.fillRect(chartWidth + 1, ty - 8, w, 16);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, chartWidth + 5, ty);
        }
        // Header: name + values of the last candle (crosshair overlays the hovered one)
        const pane = { ind, top: paneTop, height: h, toY, fromY: (py) => scale.invert(py - paneTop), def };
        if (lastD) drawPaneHeader(ctx, pane, lastD, colors, isDark);
        out.push(pane);
        y0 += h;
    }
    return out;
}

/** Header row "RSI 14 · MA 14  48.23  51.02" for candle `d` (used by the crosshair too). */
export function drawPaneHeader(ctx, pane, d, colors, isDark) {
    const { def, top } = pane;
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const segs = [[def.title, colors.text], ...def.values(d)];
    let w = 6;
    const widths = segs.map(([t], i) => { ctx.font = i === 0 ? 'bold 10px sans-serif' : '10px sans-serif'; const m = ctx.measureText(t).width; w += m + 8; return m; });
    ctx.fillStyle = isDark ? 'rgba(11,17,32,0.85)' : 'rgba(255,255,255,0.88)';
    ctx.fillRect(2, top + 2, w, 13);
    let px = 6;
    segs.forEach(([t, c], i) => {
        ctx.font = i === 0 ? 'bold 10px sans-serif' : '10px sans-serif';
        ctx.fillStyle = c || colors.text;
        ctx.fillText(t, px, top + 9);
        px += widths[i] + 8;
    });
    ctx.restore();
}
