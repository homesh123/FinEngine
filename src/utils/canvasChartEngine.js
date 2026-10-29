import * as d3 from 'd3';
import { drawFootprint, footprintReservePx } from './footprintRenderer';
import { drawMarketSessions, drawMarketSessionsDashboard } from './marketSessions';
import { describeFootprint, showFootprintTooltip, hideFootprintTooltip, showHtmlTooltip } from './footprintInsights';
import { drawProjection, projectionExplanationHtml } from './projection';
import { drawPatterns } from './patternRenderer';
import { drawPanes, drawPaneHeader, fmtVal } from './paneRenderer';
import { TWO_POINT_TOOLS, isTwoPoint, renderDrawing, hitDrawing, finalizeDrawing } from './drawingTools';
import { macdHsNeckAt } from './macdHs';
import { drawLondonBreakout } from './londonBreakout';
import { drawBtcTurtle } from './btcTurtle';
import { drawPressure, drawPressureCard } from './pressureRenderer';
import { drawKeyLevels } from './keyLevelsRenderer';
import { LIVE_MODE } from './liveMode';
import { drawWhalePulse, whalePulseHtml, absorptionHtml, deepPressureHtml } from './whalePulseRenderer';
import { drawIchimoku } from './ichimoku';
import { maLine } from './movingAverages';
import { candleColors } from './candleThemes';
import { drawMarketProfile } from './marketProfile';
import { smcContractSize } from './smcPro';
import { pathExplanationHtml, horizonLabel } from './pathProjection';
import { drawModelBox, modelExplanationHtml } from './modelPrediction';
import { drawCalendar, calendarHtml, newsWarning } from './marketContext';
import { gridStyle, hexToRgba } from './chartGrid';
import { envReady } from './env';


// ─── Draggable info boxes (SMC / Livermore / Market Sessions dashboards) ─────
// Offsets from each box's default spot, shared by all charts, saved per browser.
const BOX_KEY = 'ts_chart_box_pos_v1';
let boxPos = null;
const getBoxPos = () => {
    if (!boxPos) { try { boxPos = JSON.parse(localStorage.getItem(BOX_KEY) || '{}') || {}; } catch { boxPos = {}; } }
    return boxPos;
};
const saveBoxPos = () => { try { localStorage.setItem(BOX_KEY, JSON.stringify(boxPos || {})); } catch { /* storage unavailable */ } };

const drawingToolActiveFor = (st) => st.activeTool && !st.activeTool.startsWith('cursor') && st.activeTool !== 'eraser';

// Hit testing utils
function distSq(x1, y1, x2, y2) { return (x1 - x2) ** 2 + (y1 - y2) ** 2; }
function distToSegmentSq(px, py, x1, y1, x2, y2) {
    let l2 = distSq(x1, y1, x2, y2);
    if (l2 === 0) return distSq(px, py, x1, y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distSq(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1));
}

// Decimal places the instrument actually quotes (gold 2, EURUSD 5, JPY pairs 3),
// inferred from recent closes; capped at 5.
function priceDecimals(data) {
    if (!data || !data.length) return 2;
    let dec = 0;
    for (let i = Math.max(0, data.length - 60); i < data.length; i++) {
        const v = data[i].close;
        if (!Number.isFinite(v)) continue;
        let d = 0;
        // tolerance ~ float32 rounding (some feeds send 4196.2001953125 for 4196.20)
        const tol = Math.max(1e-9, Math.abs(v) * 2e-7);
        while (d < 5 && Math.abs(Math.round(v * 10 ** d) / 10 ** d - v) > tol) d++;
        if (d > dec) dec = d;
        if (dec === 5) break;
    }
    return dec;
}

// ---------------------------------------------------------------------------
// Time axis (TradingView-style): pick a "nice" interval from the real pixel
// spacing, label bucket boundaries, promote day/month/year starts, and never
// let two labels overlap (higher-rank labels win).
// ---------------------------------------------------------------------------
const MIN_MS = 60000, HOUR_MS = 3600000, DAY_MS = 86400000;
const AXIS_STEPS = [
    { ms: MIN_MS }, { ms: 5 * MIN_MS }, { ms: 15 * MIN_MS }, { ms: 30 * MIN_MS },
    { ms: HOUR_MS }, { ms: 2 * HOUR_MS }, { ms: 3 * HOUR_MS }, { ms: 4 * HOUR_MS }, { ms: 6 * HOUR_MS }, { ms: 12 * HOUR_MS },
    { days: 1 }, { days: 2 }, { week: true },
    { months: 1 }, { months: 3 }, { months: 6 }, { years: 1 }, { years: 5 },
];
const approxMs = (st) => st.ms || (st.days ? st.days * DAY_MS : st.week ? 7 * DAY_MS : st.months ? st.months * 30.4 * DAY_MS : st.years * 365.25 * DAY_MS);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => (n < 10 ? '0' : '') + n;

function axisBucket(t, st) {
    const d = new Date(t);
    const localMs = t - d.getTimezoneOffset() * MIN_MS;
    if (st.ms) return Math.floor(localMs / st.ms);
    const dayNum = Math.floor(localMs / DAY_MS);
    if (st.days) return Math.floor(dayNum / st.days);
    if (st.week) return Math.floor((dayNum + 3) / 7); // weeks start Monday
    if (st.months) return Math.floor((d.getFullYear() * 12 + d.getMonth()) / st.months);
    return Math.floor(d.getFullYear() / st.years);
}

function computeTimeAxis(ctx, visibleData, x, halfBw, chartWidth, timeframe) {
    if (!visibleData || visibleData.length < 2) return [];
    const tfMs = Math.max(1, timeframe || 1) * MIN_MS;
    // Real spacing between two neighbouring candles (works with zoomed scales)
    const pxPerBar = Math.max(0.01, Math.abs(x(visibleData[1].time) - x(visibleData[0].time)) || halfBw * 2.5);
    const MIN_GAP_PX = 72;
    const step = AXIS_STEPS.find(st => approxMs(st) >= tfMs && (approxMs(st) / tfMs) * pxPerBar >= MIN_GAP_PX) || AXIS_STEPS[AXIS_STEPS.length - 1];

    const candidates = [];
    let prev = null;
    for (const d of visibleData) {
        const tx = x(d.time) + halfBw;
        if (prev && tx >= 0 && tx <= chartWidth && axisBucket(d.time, step) !== axisBucket(prev.time, step)) {
            const a = new Date(prev.time), b = new Date(d.time);
            let label, rank;
            if (a.getFullYear() !== b.getFullYear()) { label = String(b.getFullYear()); rank = 4; }
            else if (a.getMonth() !== b.getMonth()) { label = MONTHS[b.getMonth()]; rank = 3; }
            else if (a.getDate() !== b.getDate()) { label = String(b.getDate()); rank = 2; }
            else { label = `${pad2(b.getHours())}:${pad2(b.getMinutes())}`; rank = 1; }
            candidates.push({ tx, label, rank });
        }
        prev = d;
    }

    const fontFor = (rank) => (rank >= 2 ? '600 10px sans-serif' : '10px sans-serif');
    for (const c of candidates) { ctx.font = fontFor(c.rank); c.w = ctx.measureText(c.label).width + 6; }

    // Place higher-rank labels first, then fill in; skip any that would collide
    const GAP = 10;
    const placed = [];
    const order = [...candidates].sort((p, q) => q.rank - p.rank || p.tx - q.tx);
    for (const c of order) {
        const l = c.tx - c.w / 2, r = c.tx + c.w / 2;
        if (l < 0 || r > chartWidth) continue;
        if (placed.some(p => l < p.tx + p.w / 2 + GAP && r > p.tx - p.w / 2 - GAP)) continue;
        placed.push(c);
    }
    return placed;
}

const axisFont = (rank) => (rank >= 2 ? '600 10px sans-serif' : '10px sans-serif');

function drawTimeAxis(ctx, visibleData, x, halfBw, chartWidth, timeframe, labelY, colors, isDark, placed) {
    placed = placed || computeTimeAxis(ctx, visibleData, x, halfBw, chartWidth, timeframe);
    const fontFor = axisFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelH = 13;
    for (const c of placed) {
        // Background pill so the label stays readable over pane content
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.88)';
        ctx.beginPath();
        ctx.roundRect(c.tx - c.w / 2, labelY - labelH / 2, c.w, labelH, 3);
        ctx.fill();
        ctx.font = fontFor(c.rank);
        ctx.fillStyle = c.rank >= 2 ? (isDark ? '#e2e8f0' : '#0f172a') : colors.text;
        ctx.fillText(c.label, c.tx, labelY);
    }
    ctx.font = '10px sans-serif';
}

/** Speech-bubble label with a pointer at (x, y): box below the tip when isUp, above otherwise (Gold Move, Ichimoku). */
export function drawPointerLabel(ctx, x, y, textLines, bgColor, textColor, isUp) {
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    let maxWidth = 0;
    textLines.forEach(l => {
        let w = ctx.measureText(l).width;
        if (w > maxWidth) maxWidth = w;
    });

    let boxWidth = maxWidth + 12;
    let lineHeight = 12;
    let boxHeight = textLines.length * lineHeight + 6;
    let pointerHeight = 6;
    let pointerWidth = 8;

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    let r = 3;
    let hw = boxWidth / 2;
    let h = boxHeight;
    let ph = pointerHeight;
    let pw = pointerWidth;

    if (isUp) {
        // Tip at (x, y), box is below.
        ctx.moveTo(x, y);
        ctx.lineTo(x + pw / 2, y + ph);
        ctx.lineTo(x + hw - r, y + ph);
        ctx.arc(x + hw - r, y + ph + r, r, 1.5 * Math.PI, 0);
        ctx.lineTo(x + hw, y + ph + h - r);
        ctx.arc(x + hw - r, y + ph + h - r, r, 0, 0.5 * Math.PI);
        ctx.lineTo(x - hw + r, y + ph + h);
        ctx.arc(x - hw + r, y + ph + h - r, r, 0.5 * Math.PI, Math.PI);
        ctx.lineTo(x - hw, y + ph + r);
        ctx.arc(x - hw + r, y + ph + r, r, Math.PI, 1.5 * Math.PI);
        ctx.lineTo(x - pw / 2, y + ph);
    } else {
        // Tip at (x, y), box is above.
        ctx.moveTo(x, y);
        ctx.lineTo(x + pw / 2, y - ph);
        ctx.lineTo(x + hw - r, y - ph);
        ctx.arc(x + hw - r, y - ph - r, r, 0.5 * Math.PI, 0, true);
        ctx.lineTo(x + hw, y - ph - h + r);
        ctx.arc(x + hw - r, y - ph - h + r, r, 0, 1.5 * Math.PI, true);
        ctx.lineTo(x - hw + r, y - ph - h);
        ctx.arc(x - hw + r, y - ph - h + r, r, 1.5 * Math.PI, Math.PI, true);
        ctx.lineTo(x - hw, y - ph - r);
        ctx.arc(x - hw + r, y - ph - r, r, Math.PI, 0.5 * Math.PI, true);
        ctx.lineTo(x - pw / 2, y - ph);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = textColor;
    textLines.forEach((l, i) => {
        let centerY = isUp ? (y + pointerHeight + boxHeight / 2) : (y - pointerHeight - boxHeight / 2);
        let textY = centerY + (i - (textLines.length - 1) / 2) * lineHeight;
        ctx.fillText(l, x, textY + 1); // +1 visual tweak for middle baseline
    });
}

export function renderCanvasChart(canvasNode, wrapperNode, dataset, state, setAlertsCallback, onResizeEnd, onLoadMore, onDrawComplete, onDrawDelete, onPanUpdate, onDrawSelect) {
    if (!envReady()) return;
    if (!canvasNode || !wrapperNode || dataset.length === 0) return;

    // ─── Minimal cleanup ───
    // Only clean up resources that cause memory leaks, NOT chart state
    if (canvasNode._cleanupScheduled) {
        // Clean up previous animation frame
        if (canvasNode._animationFrameId) {
            cancelAnimationFrame(canvasNode._animationFrameId);
            canvasNode._animationFrameId = null;
        }
        
        // Clean up offscreen canvases from previous render
        if (canvasNode._offscreen) {
            canvasNode._offscreen.width = 1;
            canvasNode._offscreen.height = 1;
            canvasNode._offscreen = null;
        }
        const crosshairNode = canvasNode.nextElementSibling;
        if (crosshairNode && crosshairNode._offscreen) {
            crosshairNode._offscreen.width = 1;
            crosshairNode._offscreen.height = 1;
            crosshairNode._offscreen = null;
        }
        
        canvasNode._cleanupScheduled = false;
    }
    
    // Mark for cleanup on next render
    canvasNode._cleanupScheduled = true;

    // Get visible contexts for blitting (double-buffer)
    const visibleCtx = canvasNode.getContext("2d", { alpha: false });
    const crosshairNode = canvasNode.nextElementSibling;
    const visibleCtxC = crosshairNode ? crosshairNode.getContext("2d") : null;

    // High-DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const width = wrapperNode.clientWidth;
    const height = wrapperNode.clientHeight;

    if (width <= 0 || height <= 0) return;

    // Mobile DPR optimization: cap at 1.5x on mobile to reduce pixel count
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const effectiveDpr = isMobile ? Math.min(dpr, 1.5) : dpr;

    const targetW = width * effectiveDpr;
    const targetH = height * effectiveDpr;
    // Only reassign canvas dimensions when they actually change — assigning .width/.height
    // always clears the canvas to blank, even when the value is identical, causing flicker.
    if (canvasNode.width !== targetW || canvasNode.height !== targetH) {
        canvasNode.width = targetW;
        canvasNode.height = targetH;
        canvasNode.style.width = `${width}px`;
        canvasNode.style.height = `${height}px`;
    }

    if (crosshairNode && visibleCtxC) {
        if (crosshairNode.width !== targetW || crosshairNode.height !== targetH) {
            crosshairNode.width = targetW;
            crosshairNode.height = targetH;
            crosshairNode.style.width = `${width}px`;
            crosshairNode.style.height = `${height}px`;
        }
    }

    // Offscreen canvas for double buffering (eliminates flicker on full redraw)
    let offCanvas = canvasNode._offscreen;
    if (!offCanvas) {
        offCanvas = document.createElement('canvas');
        offCanvas.style.display = 'none';
        canvasNode._offscreen = offCanvas;
    }
    if (offCanvas.width !== targetW || offCanvas.height !== targetH) {
        offCanvas.width = targetW;
        offCanvas.height = targetH;
        offCanvas.style.width = `${width}px`;
        offCanvas.style.height = `${height}px`;
    }
    let ctx = offCanvas.getContext("2d");
    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    // Offscreen canvas for crosshair double buffering
    let offCanvasC = null;
    let ctxC = null;
    if (crosshairNode && visibleCtxC) {
        offCanvasC = crosshairNode._offscreen;
        if (!offCanvasC) {
            offCanvasC = document.createElement('canvas');
            offCanvasC.style.display = 'none';
            crosshairNode._offscreen = offCanvasC;
        }
        if (offCanvasC.width !== targetW || offCanvasC.height !== targetH) {
            offCanvasC.width = targetW;
            offCanvasC.height = targetH;
            offCanvasC.style.width = `${width}px`;
            offCanvasC.style.height = `${height}px`;
        }
        ctxC = offCanvasC.getContext("2d");
        ctxC.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
        ctxC.clearRect(0, 0, width, height);

    }

    const margin = { top: 15, right: 60, bottom: 30, left: 0 };   // right = price-axis width
    let chartWidth = width - margin.left - margin.right;

    const isDark = state.theme === 'dark';
    const colors = {
        text:        isDark ? "#94a3b8" : "#1e293b",       // muted axis labels
        textBright:  isDark ? "#cbd5e1" : "#0f172a",       // brighter labels
        grid:        isDark ? "#131c28" : "#e2e8f0",       // very subtle grid
        gridMajor:   isDark ? "#1a2436" : "#cbd5e1",       // slightly brighter major grid
        paneBg:      isDark ? "#080c14" : "#f1f5f9",       // sub-pane background
        bg:          isDark ? "#05080f" : "#ffffff",        // main chart background
        axisBar:     isDark ? "#0c1118" : "#f8fafc",       // axis strip background
        sessionLine: isDark ? "rgba(59, 130, 246, 0.25)" : "rgba(59, 130, 246, 0.18)",
        bull:        "#22c55e",
        bear:        "#ef4444",
        bullBg:      "rgba(34, 197, 94, 0.15)",
        bearBg:      "rgba(239, 68, 68, 0.15)",
        sma:         "#f59e0b",
        ema:         "#8b5cf6"
    };
    // Candle colour theme (Chart Settings → Candle colours); up / down accents follow it
    const candle = candleColors(state, isDark, colors.bg);
    colors.bull = candle.upBorder; colors.bear = candle.downBorder;

    const activePanes = ['volume', 'macd', 'rsi', 'demarker', 'cvd'].filter(ind => state.indicators[ind] && !state.hiddenIndicators?.[ind]
        && !(ind === 'volume' && state.indicatorSettings?.volDisplay === 'overlay'));   // overlay volume draws inside the price chart
    // Pressure Chart: its strength meter is a pane of its own
    if (state.chartType === 'pressure' && state.indicatorSettings?.pcMeter !== false) activePanes.push('pressure');
    const subPaneHeights = { volume: 80, macd: 90, rsi: 90, demarker: 80, cvd: 100, pressure: 100, ...(state.subPaneHeights || {}) };
    const subPaneGap = 0; // panes touch directly — no empty gap rows

    let totalSubHeight = 0;
    activePanes.forEach(ind => { totalSubHeight += subPaneHeights[ind] + subPaneGap; });

    let chartHeight = height - margin.top - margin.bottom - totalSubHeight - 30;
    // Layout: main chart, then the indicator panes directly under it, then the
    // time axis at the very bottom (TradingView-style).
    const PANE_GAP = 2;
    const panesTop = () => chartHeight + PANE_GAP;                                  // first pane (chart coords)
    const panesBottom = () => chartHeight + (activePanes.length ? PANE_GAP + totalSubHeight : 0);
    const axisLabelY = () => panesBottom() + 10;                                     // time labels

    if (!canvasNode._cState) {
        canvasNode._cState = {
            tx: d3.zoomIdentity,
            ty: d3.zoomIdentity,
            autoScaleY: true,
            isDrawingLine: false,
            draftDrawing: null
        };
    }
    const cState = canvasNode._cState;

    const newDomain = dataset.map(d => d.time);

    if (canvasNode._lastDomain && newDomain.length > canvasNode._lastDomain.length) {
        if (newDomain[newDomain.length - 1] === canvasNode._lastDomain[canvasNode._lastDomain.length - 1]) {
            // Adjust zoom to prevent jumping when historical data is loaded
            let oldXBase = d3.scaleBand().domain(canvasNode._lastDomain).range([0, chartWidth]).padding(0.2);
            let tempXBase = d3.scaleBand().domain(newDomain).range([0, chartWidth]).padding(0.2);
            let oldX = oldXBase(canvasNode._lastDomain[0]);
            let newX = tempXBase(canvasNode._lastDomain[0]);
            let visualOld = cState.tx.applyX(oldX);
            let k_new = cState.tx.k * (oldXBase.bandwidth() / tempXBase.bandwidth());
            let tx_x_new = visualOld - k_new * newX;
            cState.tx = d3.zoomIdentity.translate(tx_x_new, cState.tx.y).scale(k_new);
        }
    }
    canvasNode._lastDomain = newDomain;

    // Footprint columns sit almost edge to edge (like TradingView) to fit the numbers
    const xBase = d3.scaleBand().domain(newDomain).range([0, chartWidth])
        .padding(state.chartType === 'footprint' ? 0.06 : 0.2);

    // ── Drawing-tool helpers (drawingTools.js) ──
    const priceFmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(4) : v.toFixed(5));
    const indexOfTime = (t) => {
        let lo = 0, hi = dataset.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (dataset[mid].time < t) lo = mid + 1; else hi = mid; }
        return lo;
    };
    const durText = (t1, t2) => {
        const m = Math.round(Math.abs(t2 - t1) / 60000);
        const dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
        return dd ? `${dd}d ${hh}h` : hh ? `${hh}h ${mm}m` : `${mm}m`;
    };
    const drawingGeom = (xs, ys) => ({
        X: (t) => { const v = xs(t); return v === undefined ? undefined : v + xs.bandwidth() / 2; },
        y: ys, chartWidth, isDark, fmt: priceFmt,
        bars: (t1, t2) => Math.abs(indexOfTime(t2) - indexOfTime(t1)), dur: durText,
    });
    const finishDrawing = (d) => finalizeDrawing(d, {
        shiftTime: (t, px) => { const v = xNow()(t); return v === undefined ? t : invertX(v + px); },
    });

    // The x scale for the current pan/zoom, for mouse handlers (draw() builds
    // its own; handlers run outside draw(), where its `x` doesn't exist).
    const xNow = () => xBase.copy().range([0, chartWidth].map(d => cState.tx.applyX(d)));

    function invertX(px) {
        if (!dataset || dataset.length === 0) return Date.now();
        let rawPx = cState.tx.invertX(px);
        let step = xBase.step();
        let idx = Math.floor(rawPx / step);
        idx = Math.max(0, Math.min(dataset.length - 1, idx));
        return dataset[idx].time;
    }

    // Empty space kept between the newest candle and the price axis when the
    // view snaps to the latest data (~8 candles, 60px min, 25% of width max —
    // inside the 50% right-side allowance used on resize).
    const rightGapPx = (k, gapBars = 8) => Math.min(chartWidth * 0.25, Math.max(60, xBase.step() * k * gapBars));

    // Live mode: once the user has left the chart alone for a few seconds, keep the
    // live candle ~12 candles clear of the price axis and the price scale on auto
    // (same zoom; runs on every data update).
    if (LIVE_MODE && dataset.length && Date.now() - (cState.lastUserAt || 0) > 8000) {
        const k = cState.tx.k, lastRight = xBase(newDomain[newDomain.length - 1]) + xBase.bandwidth();
        cState.tx = d3.zoomIdentity.translate(chartWidth - rightGapPx(k, 12) - lastRight * k, cState.tx.y).scale(k);
        cState.autoScaleY = true;
        cState.ty = d3.zoomIdentity;
        d3.select(canvasNode).property("__zoom", cState.tx);   // keep d3's drag/wheel zoom in sync
    }

    canvasNode._zoomTo = (barsToFit, gapBars = 8) => {
        if (!dataset || dataset.length === 0) return;
        const n = Math.min(dataset.length, Math.max(10, barsToFit)); // limit to sensible range
        const k = dataset.length / n;
        const tx = -(k - 1) * chartWidth - rightGapPx(k, gapBars);
        cState.tx = d3.zoomIdentity.translate(tx, cState.tx.y).scale(k);
        cState.autoScaleY = true;
        d3.select(canvasNode).property("__zoom", cState.tx); // keep d3's drag/wheel zoom in sync
        draw();
    };

    // Zoom in/out around the current running (last) candle — used by the
    // zoom buttons. The candle keeps its screen position; if it is scrolled out
    // of view it is brought back near the right edge first.
    // Deepest zoom-in, shared by the buttons and the mouse wheel / pinch:
    // never fewer than ~10 candles on screen (same bound as _zoomTo)
    const maxZoomK = () => Math.max(100, (dataset ? dataset.length : 0) / 10);

    canvasNode._zoomAtLatest = (factor) => {
        if (!dataset || dataset.length === 0) return;
        const last = dataset[dataset.length - 1];
        const baseX = xBase(last.time) + xBase.bandwidth() / 2;
        let anchor = cState.tx.applyX(baseX);
        if (!(anchor >= 0 && anchor <= chartWidth)) anchor = chartWidth * 0.85;
        const newK = Math.max(0.01, Math.min(maxZoomK(), cState.tx.k * factor));
        cState.tx = d3.zoomIdentity.translate(anchor - baseX * newK, cState.tx.y).scale(newK);
        d3.select(canvasNode).property("__zoom", cState.tx); // keep d3's wheel/drag zoom in sync
        checkLoadMore();
        if (onPanUpdate) onPanUpdate(cState);
        draw();
    };

    let rawMin = 2400;
    let rawMax = 2450;
    if (dataset.length > 0) {
        rawMin = dataset[0].low;
        rawMax = dataset[0].high;
        for (let i = 1; i < dataset.length; i++) {
            if (dataset[i].low < rawMin) rawMin = dataset[i].low;
            if (dataset[i].high > rawMax) rawMax = dataset[i].high;
        }
    }
    let initialRange = rawMax - rawMin;
    if (initialRange === 0) initialRange = rawMax * 0.001;
    const yBase = d3.scaleLinear().domain([rawMin - (initialRange * 0.1), rawMax + (initialRange * 0.1)]).range([chartHeight, 0]);

    // Right-click menu helpers: what is under the pointer, and a full view reset
    canvasNode._pointInfo = (clientX, clientY) => {
        const r = canvasNode.getBoundingClientRect();
        const mx = clientX - r.left, my = clientY - r.top;
        const inChart = mx >= margin.left && mx <= margin.left + chartWidth && my >= margin.top && my <= margin.top + chartHeight;
        const ys = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));
        return {
            inChart,
            price: inChart ? ys.invert(my - margin.top) : null,
            time: inChart ? invertX(mx - margin.left) : null,
            drawingId: cState.hoveredDrawingId || null,
        };
    };
    canvasNode._resetView = () => {
        cState.autoScaleY = true;
        cState.ty = d3.zoomIdentity;
        if (canvasNode._scrollToMostRecent) canvasNode._scrollToMostRecent();
        if (onPanUpdate) onPanUpdate(cState);
        draw();
    };
    // Manual price scale: keep the range being looked at across renders (this
    // function runs on every data update — rebuilding from the full history
    // made a manually panned/zoomed price scale jump back).
    if (!cState.autoScaleY && cState.yDomain) yBase.domain(cState.yDomain);

    // Price-scale transform helpers. Always build a new transform: the old code
    // mutated cState.ty in place, which could be d3's shared zoomIdentity.
    const FOLLOW_IDLE_MS = 8000;                     // see "re-centre on the live candle"
    const touched = () => { cState.lastUserAt = Date.now(); };
    const setTyY = (yv) => { cState.ty = d3.zoomIdentity.translate(0, yv).scale(cState.ty.k || 1); };
    // Switch from auto to manual price scale without the chart jumping:
    // the current auto range becomes the manual range, transform reset.
    const freezeY = () => {
        if (!cState.autoScaleY) return;
        cState.autoScaleY = false;
        cState.ty = d3.zoomIdentity;
    };

    // Draw throttling - prevents queueing multiple draw calls during fast interactions
    let drawPending = false;
    function scheduleDraw() {
        if (!drawPending) {
            drawPending = true;
            canvasNode._animationFrameId = requestAnimationFrame(() => {
                drawPending = false;
                canvasNode._animationFrameId = null;
                draw();
            });
        }
    }

    // Canvas drawing loop
    // Live tick price: pushed onto the canvas node by ChartArea on every tick so
    // the price label can update with a plain redraw (no full chart rebuild).
    const getLivePrice = () => (canvasNode._livePrice > 0 ? canvasNode._livePrice : state.livePrice);

    // Place a box at its default (x, y) plus the user's saved offset, kept inside
    // the plot area; registers its screen rect so it can be dragged. Works in
    // whatever transform the caller draws in (only scale + translate are used).
    // onTap(localX, localY): called on a click (no drag) inside the box
    const placeBox = (id, x, y, w, h, onTap = null) => {
        const m = ctx.getTransform(), sc = m.a || 1;
        const ox = m.e / sc, oy = m.f / sc;                       // local → css offset
        const off = getBoxPos()[id] || { dx: 0, dy: 0 };
        const minX = margin.left - ox, maxX = margin.left + chartWidth - ox - w;
        const minY = margin.top - oy, maxY = margin.top + chartHeight - oy - h;
        const nx = Math.max(minX, Math.min(maxX, x + off.dx)), ny = Math.max(minY, Math.min(Math.max(minY, maxY), y + off.dy));
        cState.boxes.push({ id, x: nx + ox, y: ny + oy, w, h, defX: x + ox, defY: y + oy, onTap });
        return { x: nx, y: ny };
    };

    function draw() {
        cState.boxes = [];
        const livePrice = getLivePrice();
        if (dataset && dataset.length > 0 && livePrice && livePrice > 0) {
            let lastIdx = dataset.length - 1;
            let lp = livePrice;
            dataset[lastIdx].close = lp;
            if (lp > dataset[lastIdx].high) dataset[lastIdx].high = lp;
            if (lp < dataset[lastIdx].low) dataset[lastIdx].low = lp;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, width, height);

        const xRange = [0, chartWidth].map(d => cState.tx.applyX(d));
        const x = xBase.copy().range(xRange);
        const bw = x.bandwidth();
        const halfBw = bw / 2;

        // O(1) visible data extraction instead of O(N) filter on 5000+ items every frame
        const getIndex = (px) => {
            if (!dataset.length) return 0;
            let rawPx = cState.tx.invertX(px);
            let idx = Math.floor(rawPx / xBase.step());
            return Math.max(0, Math.min(dataset.length - 1, idx));
        };
        const startIdx = getIndex(-bw * 2);
        const endIdx = getIndex(chartWidth + bw * 2);
        let visibleData = dataset.slice(startIdx, endIdx + 1);
        const isFootprint = state.chartType === 'footprint';
        const fpSummaryH = isFootprint ? footprintReservePx(state) : 0;

        if (cState.autoScaleY && visibleData.length > 0) {
            let rawMin = d3.min(visibleData, d => d.low);
            let rawMax = d3.max(visibleData, d => d.high);

            if (isFootprint) {
                // Footprint rows span whole row-size steps around the candle range
                for (const d of visibleData) {
                    if (!d.fp) continue;
                    rawMin = Math.min(rawMin, d.fp.base * d.fp.row);
                    rawMax = Math.max(rawMax, (d.fp.base + d.fp.bid.length) * d.fp.row);
                }
            }

            let pRange = rawMax - rawMin;
            if (pRange === 0) pRange = rawMax * 0.001;

            let padding = isFootprint ? 0.06 : 0.1;
            let lo = rawMin - (pRange * padding), hi = rawMax + (pRange * padding);
            // Keep the footprint's Delta/Volume summary band clear of the cells
            if (fpSummaryH > 0 && chartHeight > fpSummaryH * 2) {
                lo -= (hi - lo) * fpSummaryH / (chartHeight - fpSummaryH);
            }
            yBase.domain([lo, hi]);
            cState.yDomain = [lo, hi];   // becomes the manual range if the user pans vertically
        }

        // Manual price scale + user idle ≥ 8 s + live candle on screen but near/past
        // the top or bottom → re-centre on it (keeps the user's vertical zoom).
        if (!cState.autoScaleY && dataset.length && Date.now() - (cState.lastUserAt || 0) > FOLLOW_IDLE_MS) {
            const last = dataset[dataset.length - 1];
            const lx = x(last.time);
            const price = livePrice > 0 ? livePrice : last.close;
            if (lx !== undefined && lx >= -bw && lx <= chartWidth + bw) {
                const py = yBase.copy().range([chartHeight, 0].map(d => cState.ty.applyY(d)))(price);
                const edge = chartHeight * 0.08;
                if (py < edge || py > chartHeight - edge) setTyY((cState.ty.y || 0) + (chartHeight / 2 - py));
            }
        }
        const yZoomed = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));
        // Same mapping, but with the domain = the prices actually on screen, so
        // y.ticks() labels the whole axis after vertical pan/zoom (not just the initial range)
        const y = yZoomed.copy().domain([yZoomed.invert(chartHeight), yZoomed.invert(0)]).range([chartHeight, 0]);



        ctx.save();
        ctx.translate(margin.left, margin.top);

        // Grid lines (Chart Settings → Grid lines; off by default). Horizontal at
        // the price-axis ticks, vertical at the time-axis labels.
        const timeTicks = computeTimeAxis(ctx, visibleData, x, halfBw, chartWidth, state.timeframe);
        const grid = gridStyle(state.grid, colors);
        if (grid) {
            ctx.strokeStyle = grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            y.ticks(Math.max(2, Math.min(12, Math.floor(chartHeight / 42)))).forEach(tick => {
                const ty = y(tick);
                if (ty >= 0 && ty <= chartHeight) { ctx.moveTo(0, Math.floor(ty) + 0.5); ctx.lineTo(chartWidth, Math.floor(ty) + 0.5); }
            });
            for (const t of timeTicks) { ctx.moveTo(Math.floor(t.tx) + 0.5, 0); ctx.lineTo(Math.floor(t.tx) + 0.5, chartHeight); }
            ctx.stroke();
        }

        // Draw Axis Border Lines
        ctx.strokeStyle = isDark ? "#475569" : "#cbd5e1";
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Right vertical axis line
        ctx.moveTo(chartWidth, 0);
        ctx.lineTo(chartWidth, chartHeight);
        // Bottom horizontal axis line
        ctx.moveTo(0, chartHeight);
        ctx.lineTo(chartWidth, chartHeight);
        ctx.stroke();

        // --- Session Separators ---
        if (state.layers?.sessionLines !== false) {
            const sessionColor = hexToRgba(state.layers?.sessionLineColor, state.layers?.sessionLineOpacity ?? 25) || colors.sessionLine;
            let lastSession = null;
            visibleData.forEach(d => {
                const date = new Date(d.time);
                let mins = date.getUTCHours() * 60 + date.getUTCMinutes();
                let sess = null;
                if (mins >= 0 && mins < 480) sess = 'asia';
                else if (mins >= 480 && mins < 960) sess = 'euro';
                else if (mins >= 960 && mins < 1440) sess = 'usa';

                if (lastSession !== null && sess && sess !== lastSession) {
                    let xPos = x(d.time);
                    if (xPos !== undefined && xPos >= 0 && xPos <= chartWidth) {
                        ctx.strokeStyle = sessionColor;
                        ctx.setLineDash([4, 4]);
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.moveTo(Math.floor(xPos) + 0.5, 0);
                        ctx.lineTo(Math.floor(xPos) + 0.5, chartHeight);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                }
                if (sess) lastSession = sess;
            });
        }

        // Main Chart Clipping
        cState.projHit = null;   // set again below if a projection box is drawn
        cState.modelHit = null;  // trained-model box (set below)
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, chartWidth, chartHeight);
        ctx.clip();

        // --- Market Sessions (behind the candles) ---
        const showSessions = state.indicators.sessions && !state.hiddenIndicators?.sessions && dataset.marketSessions;
        if (showSessions) {
            drawMarketSessions(ctx, dataset, x, y, bw, startIdx, endIdx, chartWidth, chartHeight, state.indicatorSettings, colors);
        }

        // --- FX24HR Market Profile (volume rows, POC, value area, naked POCs) ---
        if (state.indicators.fxProfile && !state.hiddenIndicators?.fxProfile && dataset.fxProfiles) {
            drawMarketProfile(ctx, dataset, dataset.fxProfiles, x, y, bw, chartWidth, isDark, state.indicatorSettings || {});
        }

        // --- SD Zones ---
        if (state.indicators.sdPro && !state.hiddenIndicators?.sdPro && dataset.sdZones) {
            dataset.sdZones.forEach(z => {
                if (z.breached) return;
                let startX = x(z.time);
                if (startX === undefined) return;

                let drawX = Math.max(0, startX);
                let drawWidth = chartWidth - drawX;
                if (drawWidth <= 0) return;

                let yTop = Math.min(y(z.proximal), y(z.distal));
                let yBottom = Math.max(y(z.proximal), y(z.distal));
                let h = Math.max(1, yBottom - yTop);

                let isSupply = z.type === 'supply';
                ctx.fillStyle = isSupply ? "rgba(239, 68, 68, 0.25)" : "rgba(34, 197, 94, 0.25)";
                ctx.fillRect(drawX, yTop, drawWidth, h);

                ctx.strokeStyle = isSupply ? "rgba(239, 68, 68, 0.8)" : "rgba(34, 197, 94, 0.8)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(drawX, yTop); ctx.lineTo(chartWidth, yTop);
                ctx.moveTo(drawX, yBottom); ctx.lineTo(chartWidth, yBottom);
                ctx.stroke();

                let centerX = drawX + (drawWidth / 2);
                let centerY = yTop + (h / 2);

                // Inline label: "Supply Zone  Score: 1.23" on a single line
                // Scale font to bar height so text is always readable (tall zones = big text)
                // size and place it on the part of the zone that is on screen, so it is never cut off
                let visTop = Math.max(yTop, 0), visBottom = Math.min(yBottom, chartHeight);
                if (visBottom - visTop < 8) return;
                let fontSize = Math.max(9, Math.min(14, Math.round((visBottom - visTop) * 0.5)));
                centerY = (visTop + visBottom) / 2;
                // white reads on the dark theme; on light backgrounds use a deep red / green
                ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.95)" : (isSupply ? "#991b1b" : "#166534");
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                let label = `${isSupply ? "Supply Zone" : "Demand Zone"}  Score: ${(z.score || 0).toFixed(2)}`;
                ctx.fillText(label, centerX, centerY);
            });
        }

        // Draw Footprint (TradingView-style). Standard candles are batch-drawn below.
        if (isFootprint) {
            cState.projHit = drawFootprint(ctx, visibleData, x, y, bw, halfBw, chartWidth, chartHeight, colors, state);
        }

        // Volume as an overlay: columns along the bottom fifth of the price chart, behind the candles
        if (!isFootprint && state.indicators?.volume && !state.hiddenIndicators?.volume && state.indicatorSettings?.volDisplay === 'overlay') {
            const S = state.indicatorSettings, upC = S.volUpColor || '#26a69a', dnC = S.volDnColor || '#ef5350';
            const hiX = Number(S.volHighMult ?? 2), H = chartHeight * 0.2;
            const vMax = Math.max(1, ...visibleData.map(d => Math.max(d.volume || 0, d.volMa || 0)));
            const vy = (v) => chartHeight - (v / vMax) * H;
            const w = Math.max(1, bw * 0.8), off = (bw - w) / 2;
            for (const d of visibleData) {
                const px = x(d.time); if (px === undefined || !(d.volume > 0)) continue;
                const strong = hiX > 0 && d.volRel >= hiX;
                ctx.globalAlpha = strong ? 0.6 : 0.24;
                ctx.fillStyle = d.close >= d.open ? upC : dnC;
                const top = vy(d.volume);
                ctx.beginPath(); ctx.roundRect(px + off, top, w, chartHeight - top, w > 4 ? [2, 2, 0, 0] : 0); ctx.fill();
            }
            ctx.globalAlpha = 1;
            if (S.volMaShow !== false) {
                ctx.strokeStyle = S.volMaColor || '#007aff'; ctx.lineWidth = 1.25; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
                ctx.beginPath(); let on = false;
                for (const d of visibleData) { const px = x(d.time); if (d.volMa == null || px === undefined) { on = false; continue; } const Y = vy(d.volMa); if (on) ctx.lineTo(px + halfBw, Y); else { ctx.moveTo(px + halfBw, Y); on = true; } }
                ctx.stroke(); ctx.globalAlpha = 1;
            }
        }

        // Pressure Chart (Pro): pressure bars, zones, signals and the info card replace the candles
        const isPressure = state.chartType === 'pressure' && !!dataset.pressure;
        if (isPressure) {
            drawPressure(ctx, { dataset, visibleData, x, y, bw, halfBw, chartWidth, chartHeight, isDark, state, placeBox });
        }

        // Line chart: closes joined at the candle centres (one path)
        const isLine = !isFootprint && !isPressure && state.chartType === 'line';
        const isOhlc = !isFootprint && !isPressure && state.chartType === 'ohlc';
        if (isLine) {
            ctx.strokeStyle = isDark ? '#60a5fa' : '#2563eb';
            ctx.lineWidth = 2; ctx.lineJoin = 'round';
            ctx.beginPath();
            let on = false;
            for (const d of visibleData) {
                const px = x(d.time);
                if (px === undefined) continue;
                if (on) ctx.lineTo(px + halfBw, y(d.close)); else { ctx.moveTo(px + halfBw, y(d.close)); on = true; }
            }
            ctx.stroke();
            ctx.lineJoin = 'miter';
        }
        // OHLC bars: high–low line, open tick left, close tick right (one path per colour)
        if (isOhlc) {
            const up = new Path2D(), dn = new Path2D();
            const tick = Math.max(2, Math.round(bw * 0.4));
            for (const d of visibleData) {
                const px = x(d.time);
                if (px === undefined) continue;
                const cx = Math.round(px + halfBw) + 0.5, p = d.close >= d.open ? up : dn;
                p.moveTo(cx, Math.round(y(d.high))); p.lineTo(cx, Math.round(y(d.low)));
                const yo = Math.round(y(d.open)) + 0.5, yc = Math.round(y(d.close)) + 0.5;
                p.moveTo(cx - tick, yo); p.lineTo(cx, yo);
                p.moveTo(cx, yc); p.lineTo(cx + tick, yc);
            }
            ctx.lineWidth = bw >= 6 ? 1.5 : 1;
            ctx.strokeStyle = colors.bull; ctx.stroke(up);
            ctx.strokeStyle = colors.bear; ctx.stroke(dn);
            ctx.lineWidth = 1;
        }

        // Batch standard candlestick drawing for massive performance gain
        if (!isFootprint && !isPressure && !isLine && !isOhlc) {
            const useHA = state.chartType === 'heikin-ashi';
            ctx.lineWidth = 1;

            const snap = (val) => Math.round(val) + 0.5;

            // Draw all bull wicks
            ctx.strokeStyle = candle.upWick;
            ctx.beginPath();
            visibleData.forEach(d => {
                const cOpen = useHA ? d.haOpen : d.open;
                const cClose = useHA ? d.haClose : d.close;
                if (cClose >= cOpen) {
                    const xPos = x(d.time);
                    if (xPos !== undefined) {
                        const cx = snap(xPos + halfBw);
                        ctx.moveTo(cx, snap(y(d.high)));
                        ctx.lineTo(cx, snap(y(d.low)));
                    }
                }
            });
            ctx.stroke();

            // Draw all bear wicks
            ctx.strokeStyle = candle.downWick;
            ctx.beginPath();
            visibleData.forEach(d => {
                const cOpen = useHA ? d.haOpen : d.open;
                const cClose = useHA ? d.haClose : d.close;
                if (cClose < cOpen) {
                    const xPos = x(d.time);
                    if (xPos !== undefined) {
                        const cx = snap(xPos + halfBw);
                        ctx.moveTo(cx, snap(y(d.high)));
                        ctx.lineTo(cx, snap(y(d.low)));
                    }
                }
            });
            ctx.stroke();

            // Draw all bull bodies (outline drawn too when the theme's body differs, e.g. hollow)
            const upPath = new Path2D(), dnPath = new Path2D();
            ctx.fillStyle = candle.upBody;
            ctx.beginPath();
            visibleData.forEach(d => {
                const cOpen = useHA ? d.haOpen : d.open;
                const cClose = useHA ? d.haClose : d.close;
                if (cClose >= cOpen) {
                    const xPos = x(d.time);
                    if (xPos !== undefined) {
                        const sx = Math.round(xPos);
                        const sy = Math.round(y(cClose));
                        const sw = Math.max(Math.round(bw), 1);
                        const sh = Math.max(Math.round(y(cOpen) - y(cClose)), 1);
                        ctx.rect(sx, sy, sw, sh); upPath.rect(sx + 0.5, sy + 0.5, Math.max(sw - 1, 0), Math.max(sh - 1, 0));
                    }
                }
            });
            ctx.fill();

            // Draw all bear bodies
            ctx.fillStyle = candle.downBody;
            ctx.beginPath();
            visibleData.forEach(d => {
                const cOpen = useHA ? d.haOpen : d.open;
                const cClose = useHA ? d.haClose : d.close;
                if (cClose < cOpen) {
                    const xPos = x(d.time);
                    if (xPos !== undefined) {
                        const sx = Math.round(xPos);
                        const sy = Math.round(y(cOpen));
                        const sw = Math.max(Math.round(bw), 1);
                        const sh = Math.max(Math.round(y(cClose) - y(cOpen)), 1);
                        ctx.rect(sx, sy, sw, sh); dnPath.rect(sx + 0.5, sy + 0.5, Math.max(sw - 1, 0), Math.max(sh - 1, 0));
                    }
                }
            });
            ctx.fill();
            if (candle.upBody !== candle.upBorder) { ctx.strokeStyle = candle.upBorder; ctx.stroke(upPath); }
            if (candle.downBody !== candle.downBorder) { ctx.strokeStyle = candle.downBorder; ctx.stroke(dnPath); }
        }

        // VWAP (anchored per session/week/month) with ±σ bands
        if (state.indicators?.vwap && !state.hiddenIndicators?.vwap) {
            const S = state.indicatorSettings || {};
            const showBands = S.vwapBands !== false;
            const series = (key, color, width, dash) => {
                ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
                ctx.beginPath();
                let on = false;
                for (const d of visibleData) {
                    const v = d[key], px = x(d.time);
                    if (v === undefined || v === null || px === undefined || d.vwapStart) { on = false; }
                    if (v === undefined || v === null || px === undefined) continue;
                    if (!on) { ctx.moveTo(px + halfBw, y(v)); on = true; } else ctx.lineTo(px + halfBw, y(v));
                }
                ctx.stroke();
                ctx.setLineDash([]);
            };
            if (showBands) {
                // Shade between band 1 lines (per anchor segment)
                ctx.fillStyle = isDark ? 'rgba(76,175,80,0.06)' : 'rgba(76,175,80,0.08)';
                let seg = [];
                const flush = () => {
                    if (seg.length > 1) {
                        ctx.beginPath();
                        seg.forEach((d, j) => (j ? ctx.lineTo(x(d.time) + halfBw, y(d.vwapUp1)) : ctx.moveTo(x(d.time) + halfBw, y(d.vwapUp1))));
                        for (let j = seg.length - 1; j >= 0; j--) ctx.lineTo(x(seg[j].time) + halfBw, y(seg[j].vwapDn1));
                        ctx.closePath(); ctx.fill();
                    }
                    seg = [];
                };
                for (const d of visibleData) {
                    if (d.vwapStart) flush();
                    if (d.vwapUp1 !== undefined && x(d.time) !== undefined) seg.push(d);
                }
                flush();
                series('vwapUp2', 'rgba(128,128,0,0.8)', 1, [4, 3]);
                series('vwapDn2', 'rgba(128,128,0,0.8)', 1, [4, 3]);
                series('vwapUp1', 'rgba(76,175,80,0.9)', 1);
                series('vwapDn1', 'rgba(76,175,80,0.9)', 1);
            }
            series('vwap', '#2962ff', 1.8);
        }

        // Ichimoku: Tenkan, Kijun, cloud (also ahead), Chikou, BUY / SELL
        if (!isFootprint && state.indicators?.ichimoku && !state.hiddenIndicators?.ichimoku) {
            drawIchimoku(ctx, { dataset, visibleData, x, y, bw, isDark, state, drawLabel: drawPointerLabel, chartWidth });
        }

        // Whale Pulse: big-trade bubbles, absorption diamonds, deep-pressure dots
        cState.wpHits = [];
        if (!isFootprint && state.indicators?.whalePulse && !state.hiddenIndicators?.whalePulse) {
            cState.wpHits = drawWhalePulse(ctx, { dataset, visibleData, x, y, bw, halfBw, chartHeight, isDark, state, placeBox });
        }

        // Moving Averages: up to 3 lines; optional ribbon between lines 1 and 2 and crossover marks
        if (state.indicators?.movingAvg && !state.hiddenIndicators?.movingAvg) {
            const S = state.indicatorSettings || {};
            const L = [0, 1, 2].map(k => maLine(S, k)), keys = ['mvVal', 'mv2Val', 'mv3Val'];
            const cx = (d) => x(d.time) + halfBw;
            if (S.mvRibbon && L[0].on && L[1].on) {          // ribbon: green while line 1 is above line 2
                for (let q = 1; q < visibleData.length; q++) {
                    const a = visibleData[q - 1], b = visibleData[q];
                    if (a.mvVal == null || a.mv2Val == null || b.mvVal == null || b.mv2Val == null || x(a.time) === undefined || x(b.time) === undefined) continue;
                    ctx.fillStyle = b.mvVal >= b.mv2Val ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.12)';
                    ctx.beginPath(); ctx.moveTo(cx(a), y(a.mvVal)); ctx.lineTo(cx(b), y(b.mvVal)); ctx.lineTo(cx(b), y(b.mv2Val)); ctx.lineTo(cx(a), y(a.mv2Val)); ctx.closePath(); ctx.fill();
                }
            }
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            for (let k = 2; k >= 0; k--) {                    // line 1 on top
                if (!L[k].on) continue;
                const { color, width: w, style } = L[k];
                ctx.strokeStyle = color; ctx.lineWidth = w;
                ctx.setLineDash(style === 'dashed' ? [w * 4, w * 3] : style === 'dotted' ? [0.1, w * 2.5] : []);
                ctx.beginPath();
                let on = false;
                for (const d of visibleData) {
                    const v = d[keys[k]], px = x(d.time);
                    if (v == null || px === undefined) { on = false; continue; }
                    if (on) ctx.lineTo(px + halfBw, y(v)); else { ctx.moveTo(px + halfBw, y(v)); on = true; }
                }
                ctx.stroke();
            }
            ctx.setLineDash([]); ctx.lineCap = 'butt';
            if (S.mvCrosses && L[0].on && L[1].on) {          // golden / death cross: ringed dot where the lines cross
                for (const d of visibleData) {
                    if (!d.mvCross || x(d.time) === undefined) continue;
                    const Y = y((d.mvVal + d.mv2Val) / 2), col = d.mvCross > 0 ? '#34c759' : '#ff3b30';
                    ctx.fillStyle = isDark ? '#0b1220' : '#ffffff'; ctx.beginPath(); ctx.arc(cx(d), Y, 6, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
                    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx(d), Y, 2.6, 0, Math.PI * 2); ctx.fill();
                }
            }
        }

        // Bollinger Bands: shaded channel, blue upper / green lower, orange basis
        if (state.indicators?.bollinger && !state.hiddenIndicators?.bollinger) {
            const pts = visibleData.filter(d => d.bbBasis !== null && d.bbBasis !== undefined && x(d.time) !== undefined);
            if (pts.length > 1) {
                if (state.indicatorSettings?.bbFill !== false) {
                    ctx.fillStyle = isDark ? 'rgba(33,150,243,0.07)' : 'rgba(33,150,243,0.08)';
                    ctx.beginPath();
                    pts.forEach((d, j) => (j ? ctx.lineTo(x(d.time) + halfBw, y(d.bbUp)) : ctx.moveTo(x(d.time) + halfBw, y(d.bbUp))));
                    for (let j = pts.length - 1; j >= 0; j--) ctx.lineTo(x(pts[j].time) + halfBw, y(pts[j].bbDn));
                    ctx.closePath(); ctx.fill();
                }
                const line = (key, color, width) => {
                    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
                    pts.forEach((d, j) => (j ? ctx.lineTo(x(d.time) + halfBw, y(d[key])) : ctx.moveTo(x(d.time) + halfBw, y(d[key]))));
                    ctx.stroke();
                };
                line('bbUp', '#2962ff', 1);
                line('bbDn', '#089981', 1);
                line('bbBasis', '#ff6d00', 1.2);
            }
        }

        // London Breakout (Big Ben): Asian range, breakout, SL/TP, exits
        if (!isFootprint && state.indicators?.londonBreakout && !state.hiddenIndicators?.londonBreakout) {
            drawLondonBreakout(ctx, dataset, dataset.londonBreakout, x, y, bw, halfBw, startIdx, endIdx, colors, isDark);
        }
        if (!isFootprint && state.indicators?.btcTurtle && !state.hiddenIndicators?.btcTurtle) {
            drawBtcTurtle(ctx, dataset, dataset.btcTurtle, x, y, bw, halfBw, startIdx, endIdx, isDark, chartHeight);
        }

        // MACD H&S Breakout scanner
        if (!isFootprint && state.indicators?.macdHs && !state.hiddenIndicators?.macdHs && dataset.macdHsPatterns?.length) {
            const lo = startIdx - 1, hi = endIdx + 1;
            const at = (b) => { const d = dataset[b]; return d ? x(d.time) : undefined; };
            for (const pt of dataset.macdHsPatterns) {
                if (pt.neckEnd < lo || pt.v[0].b > hi) continue;            // not in view
                const bear = pt.side === 'bear', faded = pt.tf !== 'chart';
                const col = bear ? (faded ? 'rgba(239,68,68,0.45)' : '#ef4444') : (faded ? 'rgba(34,197,94,0.45)' : '#22c55e');
                const path = [pt.v[0], pt.ls, pt.v[1], pt.head, pt.v[2], pt.rs, pt.v[3]];
                ctx.strokeStyle = col; ctx.lineWidth = faded ? 1.5 : 2;
                ctx.beginPath();
                let started = false;
                for (const q of path) {
                    const qx = at(q.b); if (qx === undefined) continue;
                    if (!started) { ctx.moveTo(qx + halfBw, y(q.p)); started = true; } else ctx.lineTo(qx + halfBw, y(q.p));
                }
                ctx.stroke();
                // Neckline: troughs either side of the head, extended to the breakout / expiry
                const nx1 = at(pt.v[1].b), nx2 = at(pt.neckEnd);
                if (nx1 !== undefined && nx2 !== undefined) {
                    ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)';
                    ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
                    ctx.beginPath(); ctx.moveTo(nx1 + halfBw, y(macdHsNeckAt(pt, pt.v[1].b))); ctx.lineTo(nx2 + halfBw, y(macdHsNeckAt(pt, pt.neckEnd))); ctx.stroke();
                    ctx.setLineDash([]);
                }
                // LS / HEAD / RS labels
                const tag = (q, text, bg) => {
                    const qx = at(q.b); if (qx === undefined) return;
                    ctx.font = 'bold 9px sans-serif';
                    const w = ctx.measureText(text).width + 8;
                    const ty = bear ? y(q.p) - 14 : y(q.p) + 14;
                    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(qx + halfBw - w / 2, ty - 7, w, 14, 3); ctx.fill();
                    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, qx + halfBw, ty);
                };
                tag(pt.ls, 'LS', faded ? 'rgba(100,116,139,0.6)' : '#64748b');
                tag(pt.head, faded ? `HEAD (${pt.tf})` : 'HEAD', col);
                tag(pt.rs, 'RS (MACD 0)', faded ? 'rgba(249,115,22,0.6)' : '#f97316');
                // Breakout signal with SL / TP
                const sg = pt.signal;
                const sx = sg ? at(sg.i) : undefined;
                if (sg && sx !== undefined) {
                    const cx = sx + halfBw, d = dataset[sg.i];
                    const tipY = bear ? y(d.high) - 6 : y(d.low) + 6;
                    ctx.fillStyle = col;
                    ctx.beginPath(); ctx.moveTo(cx, tipY); ctx.lineTo(cx - 7, tipY + (bear ? -10 : 10)); ctx.lineTo(cx + 7, tipY + (bear ? -10 : 10)); ctx.fill();
                    const label = bear ? 'H&S SELL' : 'IH&S BUY';
                    ctx.font = 'bold 9px sans-serif';
                    const w = ctx.measureText(label).width + 8, by = bear ? tipY - 18 : tipY + 18;
                    ctx.beginPath(); ctx.roundRect(cx - w / 2, by - 7, w, 14, 3); ctx.fill();
                    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, cx, by);
                    const seg = (price, color, text) => {
                        const ly = y(price);
                        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
                        ctx.beginPath(); ctx.moveTo(cx, ly); ctx.lineTo(Math.min(chartWidth, cx + 90), ly); ctx.stroke(); ctx.setLineDash([]);
                        ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                        ctx.fillText(text, Math.min(chartWidth - 60, cx + 4), ly - 2);
                    };
                    seg(sg.sl, '#ef4444', `SL ${sg.sl.toFixed(2)}`);
                    seg(sg.tp, '#22c55e', `TP ${sg.tp.toFixed(2)}`);
                }
            }
        }

        // Chart patterns (Chart Settings → Chart patterns)
        if (!isFootprint && state.indicatorSettings?.ptEnabled && dataset.chartPatterns?.length) {
            const n = dataset.length;
            const lastX = x(dataset[n - 1].time), prevX = n > 1 ? x(dataset[n - 2].time) : undefined;
            const future = lastX !== undefined ? { lastX: lastX + halfBw, step: prevX !== undefined ? lastX - prevX : bw } : null;
            drawPatterns(ctx, dataset.chartPatterns, x, y, halfBw, chartWidth, future);
        }

        // Next-candle projection (standard charts): typical range + odds beside the live candle
        if (!isFootprint && state.indicators?.nextProjection && !state.hiddenIndicators?.nextProjection) {
            const last = dataset[dataset.length - 1];
            const lx = last ? x(last.time) : undefined;
            const pp = last?.pathProjection;
            // Key levels for the current timeframe (Chart Settings → projection options)
            const KL = dataset.keyLevels, PS = state.indicatorSettings || {};
            if (KL && lx !== undefined) drawKeyLevels(ctx, KL, dataset, x, y, halfBw, chartWidth, chartHeight, isDark, PS.ppTrend !== false, PS.ppSR !== false);
            if (lx !== undefined && pp && pp.path?.length) {
                // Start the projected path at the LIVE price: it was computed from the close
                // at the last data update, and price has moved since
                // (current-candle mode predicts the live candle from its open: no shift)
                const sh = pp.current ? 0 : (Number.isFinite(last.close) ? last.close : pp.anchor) - pp.anchor;
                const yP = (v) => y(v + sh);
                // Future candles: median path of similar past setups + middle-50% band
                const prevX = dataset.length > 1 ? x(dataset[dataset.length - 2].time) : undefined;
                const step = prevX !== undefined ? lx - prevX : bw / 0.8;
                const off = pp.current ? 0 : 1;                               // current mode: drawn over the live candle
                const fx = (t) => lx + step * (t + off) + halfBw;          // centre of projected candle t
                const up = colors.bull, down = colors.bear;
                const neutral = isDark ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.9)';
                // band
                ctx.fillStyle = isDark ? 'rgba(129,140,248,0.10)' : 'rgba(79,70,229,0.08)';
                ctx.beginPath();
                ctx.moveTo(fx(-1), yP(pp.anchor));
                pp.band.forEach((b, t) => ctx.lineTo(fx(t), yP(b.hi)));
                for (let t = pp.band.length - 1; t >= 0; t--) ctx.lineTo(fx(t), yP(pp.band[t].lo));
                ctx.closePath(); ctx.fill();
                if (state.chartType === 'line') {
                    ctx.strokeStyle = pp.dir > 0 ? up : pp.dir < 0 ? down : neutral;
                    ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
                    ctx.beginPath(); ctx.moveTo(fx(-1), yP(pp.anchor));
                    pp.path.forEach((c, t) => ctx.lineTo(fx(t), yP(c.c)));
                    ctx.stroke(); ctx.setLineDash([]);
                } else {
                    pp.path.forEach((c, t) => {
                        const cx = fx(t), bull = c.c >= c.o;
                        const col = pp.dir === 0 ? neutral : bull ? up : down;
                        ctx.globalAlpha = 0.85;
                        ctx.strokeStyle = col; ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(cx, yP(c.h)); ctx.lineTo(cx, yP(c.l)); ctx.stroke();
                        const top = yP(Math.max(c.o, c.c)), hgt = Math.max(1, Math.abs(yP(c.o) - yP(c.c)));
                        ctx.globalAlpha = 0.28; ctx.fillStyle = col;
                        ctx.fillRect(cx - halfBw, top, bw, hgt);
                        ctx.globalAlpha = 0.9; ctx.setLineDash([3, 2]);
                        ctx.strokeRect(cx - halfBw + 0.5, top + 0.5, bw - 1, hgt - 1);
                        ctx.setLineDash([]);
                    });
                    ctx.globalAlpha = 1;
                }
                // label above the cone — on desktop the main chart shows it in the sidebar card instead
                // shown elsewhere: desktop sidebar card, or the phone's floating box (main chart)
                const labelInTabs = window.innerWidth >= 768 ? canvasNode._projInTabs : canvasNode._projInBox;
                const hiAll = Math.max(...pp.path.map(c => c.h), ...pp.band.map(b => b.hi));
                const loAll = Math.min(...pp.path.map(c => c.l), ...pp.band.map(b => b.lo));
                // Headline: probability of the likelier side; second line: how far to trust it
                const upPct = Math.round(pp.pUp * 100);
                const line1 = `${horizonLabel(pp)}: ${upPct >= 50 ? `${upPct}% probability higher` : `${100 - upPct}% probability lower`}`;
                const line2 = (pp.calls >= 30 ? `Past accuracy ${Math.round(pp.hitRate * 100)}% of ${pp.calls} calls${pp.proven ? ' · proven edge' : ' · no proven edge'}` : 'Too little history to check accuracy')
                    + ` · from ${pp.n} similar past moments · hover for details`;
                ctx.font = 'bold 10px sans-serif';
                const w1 = ctx.measureText(line1).width;
                ctx.font = '9px sans-serif';
                const tw = Math.max(w1, ctx.measureText(line2).width) + 10;
                const lbx = Math.max(2, Math.min(lx + halfBw, chartWidth - tw - 4));
                const lby = Math.max(4, yP(hiAll) - 34);
                const tone = pp.dir > 0 ? up : pp.dir < 0 ? down : neutral;
                if (!labelInTabs) {
                    ctx.globalAlpha = 0.92; ctx.fillStyle = colors.bg; ctx.fillRect(lbx, lby, tw, 28); ctx.globalAlpha = 1;
                    ctx.strokeStyle = tone; ctx.lineWidth = 1;
                    ctx.strokeRect(lbx + 0.5, lby + 0.5, tw - 1, 27);
                    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                    ctx.font = 'bold 10px sans-serif';
                    ctx.fillStyle = pp.dir !== 0 ? tone : (colors.textBright || colors.text);
                    ctx.fillText(line1, lbx + 5, lby + 3);
                    ctx.font = '9px sans-serif'; ctx.fillStyle = colors.text;
                    ctx.fillText(line2, lbx + 5, lby + 15);
                }
                // hover area: label + cone (cone only when the label is in the tabs bar)
                const top = labelInTabs ? yP(hiAll) : lby;
                const x0 = labelInTabs ? lx : Math.min(lbx, lx), x1 = Math.max(labelInTabs ? 0 : lbx + tw, fx(pp.path.length - 1) + halfBw);
                cState.projHit = { rect: { x: x0, y: top, w: x1 - x0, h: Math.max(yP(loAll), top + 28) - top }, pp };
            } else if (lx !== undefined && last.candleProjection) {
                cState.projHit = { rect: drawProjection(ctx, last, last.candleProjection, lx + bw + 6, y, colors, state.timeframe, chartWidth), pr: last.candleProjection };
            }
            // Trained model (backend): small draggable box with its odds and track record
            const mp = canvasNode._modelPrediction;
            if (mp && mp.forChart === `${state.symbol}_${state.timeframe}`) {
                const cal = canvasNode._calendar;
                const notice = cal && cal.forSymbol === state.symbol ? newsWarning(cal.events) : null;
                const r = drawModelBox(ctx, mp, placeBox, chartWidth, chartHeight, colors, isDark, notice);
                if (r) cState.modelHit = { rect: r, mp };
            }
        }

        // Economic calendar markers along the bottom of the price chart
        cState.calHits = [];
        const calData = canvasNode._calendar;
        if (state.showCalendar !== false && calData && calData.forSymbol === state.symbol) {
            cState.calHits = drawCalendar(ctx, calData.events, dataset, x, bw, halfBw, chartWidth, chartHeight, (state.timeframe || 15) * 60000, isDark);
        }

        ctx.restore(); // Restore main clipping

        // Draw X Axis Labels directly below the main chart
        ctx.fillStyle = colors.text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "10px sans-serif";

        drawTimeAxis(ctx, visibleData, x, halfBw, chartWidth, state.timeframe, axisLabelY(), colors, isDark, timeTicks);

        // Draw Y Axis Labels — tick count follows the chart height, decimals follow
        // the tick step, and labels under the live-price tag are skipped.
        const pxDecimals = priceDecimals(dataset);
        const yTicks = y.ticks(Math.max(2, Math.min(12, Math.floor(chartHeight / 42))));
        const yTickStep = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
        const tickDecimals = Math.min(pxDecimals, Math.max(0, -Math.floor(Math.log10(yTickStep) + 1e-9)));
        const livePy = dataset && dataset.length ? y((livePrice && livePrice > 0) ? livePrice : dataset[dataset.length - 1].close) : null;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "10px sans-serif";
        ctx.fillStyle = colors.text;
        yTicks.forEach(tick => {
            const ty = y(tick);
            if (ty < 6 || ty > chartHeight - 6) return;
            if (livePy !== null && Math.abs(ty - livePy) < 14) return;
            ctx.fillText(tick.toFixed(tickDecimals), chartWidth + 5, ty);
        });

        // Moving-average value tags on the price axis (the live-price tag below draws over them)
        if (state.indicators?.movingAvg && !state.hiddenIndicators?.movingAvg && state.indicatorSettings?.mvAxisTags !== false) {
            const S = state.indicatorSettings || {}, keys = ['mvVal', 'mv2Val', 'mv3Val'];
            const lastV = visibleData[visibleData.length - 1];
            const tags = [0, 1, 2].map(k => ({ L: maLine(S, k), v: lastV?.[keys[k]] }))
                .filter(t => t.L.on && t.v != null).map(t => ({ ...t, ty: y(t.v) })).filter(t => t.ty >= 8 && t.ty <= chartHeight - 8)
                .sort((a, b) => a.ty - b.ty);
            // stack: 17 px apart, clear of the live-price tag and its countdown (they keep their place)
            const live = dataset?.length ? y(livePrice > 0 ? livePrice : dataset[dataset.length - 1].close) : null;
            for (let q = 0; q < tags.length; q++) {
                if (q > 0 && tags[q].ty < tags[q - 1].ty + 17) tags[q].ty = tags[q - 1].ty + 17;
                if (live !== null && tags[q].ty > live - 18 && tags[q].ty < live + 36) tags[q].ty = tags[q].ty < live ? live - 18 : live + 36;   // live tag + countdown under it
                if (q > 0 && tags[q].ty < tags[q - 1].ty + 17) tags[q].ty = tags[q - 1].ty + 17;
            }
            ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            for (const t of tags) {
                const ty = Math.max(8, Math.min(chartHeight - 8, t.ty));
                ctx.fillStyle = t.L.color; ctx.beginPath(); ctx.roundRect(chartWidth, ty - 8, margin.right, 16, [4, 0, 0, 4]); ctx.fill();
                ctx.fillStyle = '#ffffff'; ctx.fillText(t.v.toFixed(pxDecimals), chartWidth + 4, ty + 0.5);
            }
        }

        // --- Current Price & Time Left ---
        if (dataset && dataset.length > 0) {
            let lastCandle = dataset[dataset.length - 1];
            // state.livePrice is set by TICK_UPDATE (every ~1s from backend).
            // Fall back to lastCandle.close if no tick received yet.
            let currentPrice = (livePrice && livePrice > 0)
                ? livePrice
                : lastCandle.close;
            let py = y(currentPrice);

            if (py >= 0 && py <= chartHeight) {
                // Horizontal Dotted Line
                ctx.strokeStyle = isDark ? "#38bdf8" : "#0284c7";
                ctx.setLineDash([2, 4]);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(0, py);
                ctx.lineTo(chartWidth, py);
                ctx.stroke();
                ctx.setLineDash([]);

                // Price Label Background
                ctx.fillStyle = isDark ? "#38bdf8" : "#0284c7";
                ctx.beginPath();
                ctx.roundRect(chartWidth, py - 10, margin.right, 20, [4, 0, 0, 4]);
                ctx.fill();

                // Price Label Text
                ctx.fillStyle = "#ffffff";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.font = "bold 10px sans-serif";
                ctx.fillText(currentPrice.toFixed(pxDecimals), chartWidth + 4, py);

                // Time to close candle
                let now = new Date();
                let tfMs = (state.timeframe || 15) * 60000;
                let nextCloseTime = Math.ceil(now.getTime() / tfMs) * tfMs;
                let msLeft = nextCloseTime - now.getTime();

                if (msLeft > 0) {
                    let sLeft = Math.floor(msLeft / 1000);
                    let mLeft = Math.floor(sLeft / 60);
                    let hLeft = Math.floor(mLeft / 60);
                    sLeft %= 60;
                    mLeft %= 60;

                    let timeLeftStr = "";
                    if (hLeft > 0) timeLeftStr += hLeft + "h ";
                    if (mLeft > 0 || hLeft > 0) timeLeftStr += mLeft.toString().padStart(2, '0') + "m ";
                    timeLeftStr += sLeft.toString().padStart(2, '0') + "s";

                    // Time Left Text — draw background pill first so it's readable over Y-axis numbers
                    ctx.font = "9px sans-serif";
                    const ctW = ctx.measureText(timeLeftStr).width + 6;
                    const ctH = 13;
                    ctx.fillStyle = isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.88)";
                    ctx.beginPath();
                    ctx.roundRect(chartWidth + 4 - 3, py + 16 - ctH / 2, ctW, ctH, 3);
                    ctx.fill();

                    ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
                    ctx.fillText(timeLeftStr, chartWidth + 4, py + 16);
                }
            }
        }
        // Draw QIT (Quantum Imbalance Trap) Strategy Visuals
        if (state.indicators && state.indicators.qit && !state.hiddenIndicators?.qit) {
            visibleData.forEach(d => {
                if (d.qitSignal === 'LONG') {
                    let px = x(d.time) + halfBw;
                    let py = y(d.low) + 20;
                    ctx.fillStyle = "#00bfff";
                    ctx.beginPath();
                    ctx.roundRect(px - 30, py, 60, 16, 4);
                    ctx.fill();
                    ctx.fillStyle = "#ffffff";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.font = "bold 9px sans-serif";
                    ctx.fillText("▲ QIT LONG", px, py + 8);
                }
                if (d.qitSignal === 'SHORT') {
                    let px = x(d.time) + halfBw;
                    let py = y(d.high) - 36;
                    ctx.fillStyle = "#ff8c00";
                    ctx.beginPath();
                    ctx.roundRect(px - 30, py, 60, 16, 4);
                    ctx.fill();
                    ctx.fillStyle = "#ffffff";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.font = "bold 9px sans-serif";
                    ctx.fillText("▼ QIT SHORT", px, py + 8);
                }
            });

            // R multiples as configured (same fallbacks as the calculation)
            const qInd = state.indicatorSettings || {};
            const qR = { tp1: Number(qInd.qitTp1) || 1.5, tp2: Number(qInd.qitTp2) || 2.5, tp3: Number(qInd.qitTp3) || 3.5 };
            const qfmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));

            // Track record of this chart's past signals (draggable box)
            const qRec = dataset.qitRecord;
            if (qRec) {
                const txt = qRec.signals ? `QIT past signals: ${Math.round(qRec.tp1 * 100)}% hit TP1, ${Math.round(qRec.tp2 * 100)}% TP2 (${qRec.signals})` : 'QIT past signals: not enough yet';
                ctx.font = '10px sans-serif';
                const bw2 = ctx.measureText(txt).width + 14, bh2 = 18;
                const { x: qx, y: qy } = placeBox('qit', 8, chartHeight - bh2 - 40, bw2, bh2);
                ctx.fillStyle = isDark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.94)'; ctx.fillRect(qx, qy, bw2, bh2);
                ctx.strokeStyle = isDark ? '#475569' : '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(qx + 0.5, qy + 0.5, bw2 - 1, bh2 - 1);
                ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, qx + 7, qy + bh2 / 2);
            }

            let lastVisibleCandle = visibleData[visibleData.length - 1];
            if (lastVisibleCandle && lastVisibleCandle.qitState) {
                let qs = lastVisibleCandle.qitState;
                let startX = 0;
                if (qs.signalTime) {
                    let sx = x(qs.signalTime);
                    if (sx !== undefined && !isNaN(sx)) startX = sx + halfBw;
                }

                let drawLevel = (price, color, dash, label) => {
                    let py = y(price);
                    if (py < 0 || py > chartHeight) return;
                    ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(startX, py); ctx.lineTo(chartWidth, py); ctx.stroke();

                    // Draw label box near the current running candle
                    ctx.font = "bold 10px sans-serif";
                    let textStr = label;
                    let textW = ctx.measureText(textStr).width + 12;

                    let lastCandleX = dataset.length > 0 ? x(dataset[dataset.length - 1].time) + halfBw : chartWidth;
                    let boxX = lastCandleX + 15;
                    if (boxX + textW > chartWidth) boxX = chartWidth - textW - 5;
                    if (boxX < startX) boxX = startX + 5;

                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.roundRect(boxX, py - 9, textW, 18, 4);
                    ctx.fill();

                    ctx.fillStyle = (color === "#ffe600" || color === "#b4ff32") ? "#000000" : "#ffffff";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(textStr, boxX + textW / 2, py);
                };

                if (qs.bull_active) {
                    let zHi = y(qs.zone_hi_b), zLo = y(qs.zone_lo_b);
                    ctx.fillStyle = "rgba(0,191,255,0.2)";
                    let zh = Math.min(zHi, zLo);
                    let zheight = Math.abs(zLo - zHi);
                    ctx.fillRect(startX, zh, chartWidth - startX, zheight);
                    ctx.strokeStyle = "#00bfff"; ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeRect(startX, zh, chartWidth - startX, zheight);

                    drawLevel(qs.entry_bull, "#00bfff", [], "ENTRY " + qfmt(qs.entry_bull));
                    drawLevel(qs.sl_bull, "#dc00b4", [5, 5], "SL " + qfmt(qs.sl_bull));
                    drawLevel(qs.tp1_bull, "#ffe600", [2, 2], `TP1 ${qfmt(qs.tp1_bull)} (${qR.tp1}R)`);
                    drawLevel(qs.tp2_bull, "#b4ff32", [2, 2], `TP2 ${qfmt(qs.tp2_bull)} (${qR.tp2}R)`);
                    drawLevel(qs.tp3_bull, "#ff69b4", [2, 2], `TP3 ${qfmt(qs.tp3_bull)} (${qR.tp3}R)`);
                }
                if (qs.bear_active) {
                    let zHi = y(qs.zone_hi_bear), zLo = y(qs.zone_lo_bear);
                    ctx.fillStyle = "rgba(255,140,0,0.2)";
                    let zh = Math.min(zHi, zLo);
                    let zheight = Math.abs(zLo - zHi);
                    ctx.fillRect(startX, zh, chartWidth - startX, zheight);
                    ctx.strokeStyle = "#ff8c00"; ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeRect(startX, zh, chartWidth - startX, zheight);

                    drawLevel(qs.entry_bear, "#ff8c00", [], "ENTRY " + qfmt(qs.entry_bear));
                    drawLevel(qs.sl_bear, "#dc00b4", [5, 5], "SL " + qfmt(qs.sl_bear));
                    drawLevel(qs.tp1_bear, "#ffe600", [2, 2], `TP1 ${qfmt(qs.tp1_bear)} (${qR.tp1}R)`);
                    drawLevel(qs.tp2_bear, "#b4ff32", [2, 2], `TP2 ${qfmt(qs.tp2_bear)} (${qR.tp2}R)`);
                    drawLevel(qs.tp3_bear, "#ff69b4", [2, 2], `TP3 ${qfmt(qs.tp3_bear)} (${qR.tp3}R)`);
                }
                ctx.setLineDash([]);
            }
        }
        // Volume-Based Support & Resistance (VBR): red resistance above price, green support below;
        // thicker = heavier volume (strength = volume ÷ its average)
        if (state.indicators.vbr && !state.hiddenIndicators?.vbr) {
            const levels = visibleData[visibleData.length - 1]?.vbrLevels || [];
            for (const lv of levels) {
                const py = y(lv.price);
                if (py < 0 || py > chartHeight) continue;
                const res = lv.kind === 'resistance', col = res ? 'rgba(220, 38, 38, 0.75)' : 'rgba(22, 163, 74, 0.75)';
                ctx.strokeStyle = col; ctx.lineWidth = lv.strength >= 4 ? 2.5 : lv.strength >= 3 ? 2 : 1.25; ctx.setLineDash([]);
                ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(chartWidth, py); ctx.stroke();
                const text = `${res ? 'R' : 'S'} ${Math.abs(lv.price) >= 100 ? lv.price.toFixed(2) : lv.price.toFixed(5)} · ${lv.strength.toFixed(1)}×`;
                ctx.font = 'bold 10px sans-serif';
                const w = ctx.measureText(text).width + 10;
                ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(chartWidth - w, py - 9, w, 18, 4); ctx.fill();
                ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(text, chartWidth - w / 2, py);
            }
        }

        // MTF Order Blocks
        if (state.indicators.mtfOb && !state.hiddenIndicators?.mtfOb && dataset.mtfOrderBlocks) {
            dataset.mtfOrderBlocks.forEach(ob => {
                let xStart = x(ob.time);
                if (xStart === undefined) {
                    // if ob is off-screen left, we might still need to draw it if it extends into screen
                    if (ob.mitTime) {
                        let tempX = x(ob.mitTime);
                        if (tempX === undefined && ob.mitTime > visibleData[visibleData.length - 1].time) {
                            xStart = 0; // Starts left of screen, ends right of screen
                        } else if (tempX !== undefined) {
                            xStart = 0; // Starts left of screen, ends on screen
                        } else {
                            return; // Fully off-screen
                        }
                    } else {
                        xStart = 0; // Starts left of screen, unmitigated
                    }
                }

                let xEnd;
                if (ob.mitTime) {
                    xEnd = x(ob.mitTime);
                    if (xEnd === undefined) {
                        if (ob.mitTime > visibleData[visibleData.length - 1].time) xEnd = chartWidth;
                        else return; // Fully off-screen
                    }
                } else {
                    xEnd = chartWidth;
                }

                if (xStart > chartWidth) return; // Completely in the future (unlikely but possible)
                if (xEnd < 0) return; // Completely in the past

                let yHigh = y(ob.high);
                let yLow = y(ob.low);
                let top = Math.min(yHigh, yLow);
                let bottom = Math.max(yHigh, yLow);
                let height = bottom - top;

                // Parse color and make it semi-transparent
                // Assuming colors are hex like #20b2aa
                let hex = ob.color.replace('#', '');
                let r = parseInt(hex.substring(0, 2), 16);
                let g = parseInt(hex.substring(2, 4), 16);
                let b = parseInt(hex.substring(4, 6), 16);

                ctx.fillStyle = `rgba(${r},${g},${b},0.2)`;
                ctx.fillRect(xStart, top, xEnd - xStart, height);

                // Add a small clear badge label for the Order Block
                if (x(ob.time) !== undefined && xEnd - xStart > 20) {
                    let text = `${ob.tf} ${ob.type} OB`;
                    ctx.font = "bold 10px sans-serif";
                    let tw = ctx.measureText(text).width + 10;
                    let th = 18;
                    
                    // Draw Solid Badge
                    ctx.fillStyle = ob.color;
                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(xStart, top, tw, th, [0, 0, 4, 0]);
                    } else {
                        ctx.rect(xStart, top, tw, th);
                    }
                    ctx.fill();

                    // Draw Text
                    ctx.fillStyle = "#ffffff"; // White text for contrast on colored background
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillText(text, xStart + 5, top + (th / 2));
                }
            });
        }
        // Draw MA Ribbon
        if (state.indicators.maRibbon && !state.hiddenIndicators?.maRibbon) {
            [1, 2, 3, 4].forEach(m => {
                if (state.indicatorSettings[`ma${m}Show`]) {
                    ctx.strokeStyle = state.indicatorSettings[`ma${m}Color`] || "#f6c309";
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    let started = false;
                    visibleData.forEach(d => {
                        let val = d[`ma${m}`];
                        if (val !== undefined && val !== null && !isNaN(val)) {
                            let hx = x(d.time);
                            if (hx !== undefined) {
                                if (!started) { ctx.moveTo(hx + halfBw, y(val)); started = true; }
                                else { ctx.lineTo(hx + halfBw, y(val)); }
                            }
                        }
                    });
                    ctx.stroke();
                }
            });
        }

        // Draw Gold Move Visuals
        if (state.indicators.goldMove && !state.hiddenIndicators?.goldMove) {
            // Draw Keltner Channel Clouds
            if (state.indicatorSettings?.gmTrendCloud !== false) {
                const drawKCCloud = (kTop, kBot, color) => {
                    let pTop = [], pBot = [];
                    visibleData.forEach(d => {
                        let hx = x(d.time);
                        if (hx !== undefined && d[kTop] != null && d[kBot] != null) {
                            pTop.push({ x: hx + halfBw, y: y(d[kTop]) });
                            pBot.push({ x: hx + halfBw, y: y(d[kBot]) });
                        }
                    });
                    if (pTop.length > 1) {
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.moveTo(pTop[0].x, pTop[0].y);
                        for (let i = 1; i < pTop.length; i++) ctx.lineTo(pTop[i].x, pTop[i].y);
                        for (let i = pBot.length - 1; i >= 0; i--) ctx.lineTo(pBot[i].x, pBot[i].y);
                        ctx.closePath();
                        ctx.fill();
                    }
                };
                drawKCCloud('gmK1', 'gmK2', 'rgba(202, 0, 158, 0.30)'); // k1-k2, uphighColor  #ca009e4d
                drawKCCloud('gmK2', 'gmK3', 'rgba(202, 0, 158, 0.18)'); // k2-k3, uplowColor   #ca009e2f
                drawKCCloud('gmK6', 'gmK7', 'rgba(151, 0, 202, 0.18)'); // l3-l2, downlowColor #9700ca2f
                drawKCCloud('gmK7', 'gmK8', 'rgba(179, 0, 255, 0.30)'); // l2-l1, downhighColor#b300ff4d
            }

            // Draw EMA Cloud (150-250)
            if (state.indicatorSettings?.gmTrendCloud !== false) {
                let p_ema150 = [], p_ema250 = [];
                visibleData.forEach(d => {
                    let hx = x(d.time);
                    if (hx !== undefined && d.gmEma150 != null && d.gmEma250 != null) {
                        p_ema150.push({ x: hx + halfBw, y: y(d.gmEma150), isBull: d.gmEma150 > d.gmEma250 });
                        p_ema250.push({ x: hx + halfBw, y: y(d.gmEma250) });
                    }
                });

                if (p_ema150.length > 1) {
                    let chunks = [];
                    let currentChunk = [0];
                    for (let i = 1; i < p_ema150.length; i++) {
                        if (p_ema150[i].isBull === p_ema150[i - 1].isBull) {
                            currentChunk.push(i);
                        } else {
                            chunks.push(currentChunk);
                            currentChunk = [i - 1, i]; // overlap by 1 to prevent gaps
                        }
                    }
                    if (currentChunk.length > 0) chunks.push(currentChunk);

                    chunks.forEach(chunk => {
                        if (chunk.length < 2) return;
                        let isBull = p_ema150[chunk[0]].isBull;
                        ctx.fillStyle = isBull ? "rgba(74, 222, 128, 0.4)" : "rgba(248, 113, 113, 0.4)";
                        ctx.beginPath();
                        ctx.moveTo(p_ema150[chunk[0]].x, p_ema150[chunk[0]].y);
                        for (let i = 1; i < chunk.length; i++) {
                            ctx.lineTo(p_ema150[chunk[i]].x, p_ema150[chunk[i]].y);
                        }
                        for (let i = chunk.length - 1; i >= 0; i--) {
                            ctx.lineTo(p_ema250[chunk[i]].x, p_ema250[chunk[i]].y);
                        }
                        ctx.closePath();
                        ctx.fill();
                    });
                }
            }

            // Draw 200 EMA Line (controlled by "Show Moving Average" setting)
            if (state.indicatorSettings?.gmMovingAvarg !== false) {
                ctx.lineWidth = 2;
                ctx.beginPath();
                let started = false;
                let lastUptrend = null;

                visibleData.forEach(d => {
                    if (d.gmEma200 != null) {
                        let hx = x(d.time);
                        if (hx !== undefined) {
                            let uptrend = d.gmEma200 > d.close;
                            if (lastUptrend !== null && lastUptrend !== uptrend) {
                                ctx.stroke();
                                ctx.beginPath();
                                started = false;
                            }

                            ctx.strokeStyle = uptrend ? "rgba(0, 255, 204, 0.9)" : "rgba(228, 58, 114, 0.9)";

                            if (!started) { ctx.moveTo(hx + halfBw, y(d.gmEma200)); started = true; }
                            else { ctx.lineTo(hx + halfBw, y(d.gmEma200)); }

                            lastUptrend = uptrend;
                        }
                    }
                });
                ctx.stroke();
            }

            // Draw Ribbon
            if (state.indicatorSettings?.gmTrendRibbon !== false) {
                let ribbonCount = 8;
                for (let k = 0; k < ribbonCount; k++) {
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    let started = false;
                    let lastUptrend = null;

                    visibleData.forEach((d) => {
                        if (d.gmRibbon && d.gmRibbon[k] != null) {
                            let hx = x(d.time);
                            if (hx !== undefined) {
                                let uptrend = d.gmRibbon.length >= 8 ? (d.gmRibbon[0] > d.gmRibbon[7]) : true;

                                if (lastUptrend !== null && lastUptrend !== uptrend) {
                                    ctx.stroke();
                                    ctx.beginPath();
                                    started = false;
                                }

                                ctx.strokeStyle = uptrend ? `rgba(0, 255, 204, ${Math.max(0.2, 1 - k * 0.1)})` : `rgba(228, 58, 114, ${Math.max(0.2, 1 - k * 0.1)})`;

                                if (!started) { ctx.moveTo(hx + halfBw, y(d.gmRibbon[k])); started = true; }
                                else { ctx.lineTo(hx + halfBw, y(d.gmRibbon[k])); }

                                lastUptrend = uptrend;
                            }
                        }
                    });
                    ctx.stroke();
                }
            }

            // Draw SuperTrend / Chaos Trend Line
            if (state.indicatorSettings?.gmChaosTrend !== false) {
                ctx.lineWidth = 2;
                ctx.beginPath();
                let started = false;
                let lastDir = null;
                let lastY = null;

                visibleData.forEach(d => {
                    if (d.gmChaosTrend != null) {
                        let hx = x(d.time);
                        if (hx !== undefined) {
                            let dir = d.gmChaosTrendDir; // -1 for bull, 1 for bear
                            if (lastDir !== null && lastDir !== dir) {
                                ctx.stroke();
                                ctx.beginPath();
                                started = false;
                            }

                            // It's a step line, so we lineTo(currentX, previousY) then lineTo(currentX, currentY)
                            let currentY = y(d.gmChaosTrend);
                            ctx.strokeStyle = dir === -1 ? "#00e73a" : "#ff0000";

                            if (!started) {
                                ctx.moveTo(hx + halfBw, currentY);
                                started = true;
                            } else {
                                ctx.lineTo(hx + halfBw, lastY);
                                ctx.lineTo(hx + halfBw, currentY);
                            }

                            lastDir = dir;
                            lastY = currentY;
                        }
                    }
                });
                ctx.stroke();
            }

            // Draw Signals
            if (state.indicatorSettings?.gmSignalsShow !== false) {
                const drawLabel = drawPointerLabel;

                let gmSignalType = state.indicatorSettings?.gmSignalType || "All Signals";

                visibleData.forEach(d => {
                    let hx = x(d.time);
                    if (hx !== undefined) {
                        // Buy/Smart Buy use labelup (pointer UP pointing to low)
                        // Sell/Smart Sell use labeldown (pointer DOWN pointing to high)

                        let yLow = y(d.low) + 5;
                        let yHigh = y(d.high) - 5;

                        if (d.gmSBull) {
                            drawLabel(ctx, hx + halfBw, yLow, ["Buy"], "#00ffcc", "black", true);
                        } else if (d.gmBull && gmSignalType !== "Smart Signals") {
                            drawLabel(ctx, hx + halfBw, yLow, ["Buy"], "#00ffcc", "black", true);
                        }

                        if (d.gmSBear) {
                            drawLabel(ctx, hx + halfBw, yHigh, ["Sell"], "#e43a72", "white", false);
                        } else if (d.gmBear && gmSignalType !== "Smart Signals") {
                            drawLabel(ctx, hx + halfBw, yHigh, ["Sell"], "#e43a72", "white", false);
                        }

                        if (d.gmTP1) {
                            let isBuy = d.gmTP1Type === 'buy';
                            let yCenter = isBuy ? yHigh - 15 : yLow + 15; // buy TP is above high, sell TP is below low
                            let color = isBuy ? "#00ffcc" : "#e43a72";

                            // Draw X cross
                            ctx.beginPath();
                            ctx.strokeStyle = color;
                            ctx.lineWidth = 2;
                            ctx.moveTo(hx + halfBw - 3, yCenter - 3);
                            ctx.lineTo(hx + halfBw + 3, yCenter + 3);
                            ctx.moveTo(hx + halfBw + 3, yCenter - 3);
                            ctx.lineTo(hx + halfBw - 3, yCenter + 3);
                            ctx.stroke();

                            // Draw TP1 text
                            ctx.fillStyle = color;
                            ctx.font = "bold 10px sans-serif";
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            let textY = isBuy ? yCenter - 10 : yCenter + 10;
                            ctx.fillText("TP1", hx + halfBw, textY);
                        }
                    }
                });
            }
            // Track record of this chart's signals (draggable box)
            const gRec = dataset.gmRecord;
            if (gRec) {
                const txt = gRec.signals
                    ? `Gold Move past signals: ${Math.round(gRec.tp1 * 100)}% hit TP1 (${gRec.signals})${gRec.smart ? ` · Smart ${Math.round(gRec.smartTp1 * 100)}%` : ''} · break-even 50%`
                    : 'Gold Move past signals: not enough yet';
                ctx.font = '10px sans-serif';
                const bw3 = ctx.measureText(txt).width + 14, bh3 = 18;
                const { x: gx, y: gy } = placeBox('gmrec', 8, chartHeight - bh3 - 64, bw3, bh3);
                ctx.fillStyle = isDark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.94)'; ctx.fillRect(gx, gy, bw3, bh3);
                ctx.strokeStyle = isDark ? '#475569' : '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(gx + 0.5, gy + 0.5, bw3 - 1, bh3 - 1);
                ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, gx + 7, gy + bh3 / 2);
            }
        }

        // Draw SMC Pro Visuals (zones, confirmed signals, latest trade, watch levels, dashboard)
        if (state.indicators.smcPro && !state.hiddenIndicators?.smcPro) {
            const smcData = dataset.length > 0 ? dataset[dataset.length - 1].smcProData : null;
            if (smcData) {
                const lastC = dataset[dataset.length - 1];
                const lastX = x(lastC.time);
                const activeEndX = (lastX !== undefined ? lastX : chartWidth) + (bw + 2) * 5;
                const xAt = (i) => { const d = dataset[i]; const v = d ? x(d.time) : undefined; return v === undefined ? 0 : v; };
                const fmtP = (v) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
                const ind = state.indicatorSettings || {};
                const riskMoney = (Number(ind.smcAccBal) || 10000) * ((Number(ind.smcRiskCap) || 1) / 100);
                const contract = smcContractSize(state.symbol, ind.smcContractSize);
                const lotsFor = (entry, sl) => { const d = Math.abs(entry - sl); return d > 0 ? riskMoney / (d * contract) : 0; };

                // Zones: solid = fresh, faded + dashed = tested (waiting for a confirmation close)
                const zoneStyle = (z) => {
                    const ob = z.type.startsWith('ob');
                    const rgb = z.isSupply ? (ob ? '239,68,68' : '249,115,22') : (ob ? '59,130,246' : '20,184,166');
                    return { fill: `rgba(${rgb},${z.state === 'tested' ? 0.07 : 0.14})`, line: `rgba(${rgb},${z.state === 'tested' ? 0.5 : 0.85})`, rgb };
                };
                for (const z of [...smcData.obZones, ...smcData.sdZones]) {
                    const sx = xAt(z.startIdx), topY = y(z.top), botY = y(z.bottom);
                    if (activeEndX < 0 || sx > chartWidth) continue;
                    const st = zoneStyle(z);
                    ctx.fillStyle = st.fill; ctx.strokeStyle = st.line; ctx.lineWidth = 1;
                    if (z.state === 'tested') ctx.setLineDash([4, 3]);
                    ctx.beginPath(); ctx.rect(sx, topY, activeEndX - sx, botY - topY); ctx.fill(); ctx.stroke();
                    ctx.setLineDash([]);
                    const name = z.type === 'ob_bull' ? 'Bullish OB' : z.type === 'ob_bear' ? 'Bearish OB' : z.isSupply ? `Supply [${z.score.toFixed(1)}]` : `Demand [${z.score.toFixed(1)}]`;
                    ctx.fillStyle = `rgba(${st.rgb},0.95)`; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                    ctx.fillText(z.state === 'tested' ? `${name} · tested, waiting for confirmation` : name, Math.max(sx, 2) + 4, (topY + botY) / 2);
                }

                // Confirmed signals on visible candles
                for (const d of visibleData) {
                    const sg = d.smcSignal; if (!sg) continue;
                    const cx = x(d.time); if (cx === undefined) continue;
                    const col = sg.dir > 0 ? colors.bull : colors.bear;
                    const ty = sg.dir > 0 ? y(d.low) + 6 : y(d.high) - 6;
                    ctx.fillStyle = col; ctx.beginPath();
                    if (sg.dir > 0) { ctx.moveTo(cx + halfBw, ty); ctx.lineTo(cx + halfBw - 5, ty + 8); ctx.lineTo(cx + halfBw + 5, ty + 8); }
                    else { ctx.moveTo(cx + halfBw, ty); ctx.lineTo(cx + halfBw - 5, ty - 8); ctx.lineTo(cx + halfBw + 5, ty - 8); }
                    ctx.closePath(); ctx.fill();
                    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = sg.dir > 0 ? 'top' : 'bottom';
                    ctx.fillText(sg.dir > 0 ? 'SMC BUY' : 'SMC SELL', cx + halfBw, sg.dir > 0 ? ty + 10 : ty - 10);
                }

                const tag = (tipX, tipY, text, bg) => {
                    ctx.font = '10px sans-serif';
                    const w = ctx.measureText(text).width + 12, h = 16;
                    ctx.fillStyle = bg; ctx.beginPath();
                    ctx.moveTo(tipX, tipY); ctx.lineTo(tipX + 6, tipY - h / 2); ctx.lineTo(tipX + w, tipY - h / 2); ctx.lineTo(tipX + w, tipY + h / 2); ctx.lineTo(tipX + 6, tipY + h / 2);
                    ctx.closePath(); ctx.fill();
                    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, tipX + 9, tipY);
                };
                const labelX = Math.min(activeEndX + 10, chartWidth - 170);

                // Latest confirmed signal: entry / SL / TPs (until the trade resolves)
                const ls = smcData.lastSignal;
                if (ls && !ls.result) {
                    const sx = xAt(ls.i);
                    const line = (price, col, dash, text) => {
                        ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash(dash);
                        ctx.beginPath(); ctx.moveTo(sx, y(price)); ctx.lineTo(labelX, y(price)); ctx.stroke(); ctx.setLineDash([]);
                        tag(labelX, y(price), text, col);
                    };
                    const ec = ls.dir > 0 ? '#3b82f6' : '#f97316';
                    line(ls.entry, ec, [], `SMC ${ls.dir > 0 ? 'BUY' : 'SELL'} ${fmtP(ls.entry)} · ${lotsFor(ls.entry, ls.sl).toFixed(2)} lots`);
                    line(ls.sl, '#ef4444', [], `SL ${fmtP(ls.sl)}`);
                    [[ls.tp1, 'TP1', ls.tp1Hit], [ls.tp2, 'TP2', ls.tp2Hit], [ls.tp3, 'TP3', false]].forEach(([p, nm, hit]) => line(p, '#22c55e', [4, 4], `${nm} ${fmtP(p)}${hit ? ' ✓' : ''}`));
                }

                // Watch levels: nearest fresh zones - enter only after a confirmation close
                for (const w of smcData.watch) {
                    if (ls && !ls.result) break;                        // a trade is running
                    const col = w.type === 'BUY' ? '#3b82f6' : '#f97316';
                    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
                    const sx = lastX !== undefined ? lastX : 0;
                    ctx.beginPath(); ctx.moveTo(sx, y(w.level)); ctx.lineTo(labelX, y(w.level)); ctx.stroke(); ctx.setLineDash([]);
                    tag(labelX, y(w.level), `Watch ${w.type}: ${w.type === 'BUY' ? 'bullish' : 'bearish'} close ${w.type === 'BUY' ? 'above' : 'below'} ${fmtP(w.level)}`, col);
                }

                // Dashboard (theme-aware, draggable)
                const rec = smcData.record;
                const dW = 260, dH = 78;
                // Default bottom-right (top-right is used by other dashboards); draggable
                const { x: dashX, y: dashY } = placeBox('smc', chartWidth - dW - 10, chartHeight - dH - 30, dW, dH);
                ctx.fillStyle = isDark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.94)';
                ctx.fillRect(dashX, dashY, dW, dH);
                ctx.strokeStyle = isDark ? '#475569' : '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(dashX + 0.5, dashY + 0.5, dW - 1, dH - 1);
                const fg = isDark ? '#f1f5f9' : '#0f172a', sub = isDark ? '#94a3b8' : '#64748b';
                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = fg; ctx.font = 'bold 12px sans-serif'; ctx.fillText('SMC Pro', dashX + 10, dashY + 16);
                ctx.font = '11px sans-serif';
                const row = (yy, label, val, col) => { ctx.fillStyle = sub; ctx.fillText(label, dashX + 10, dashY + yy); ctx.fillStyle = col; ctx.fillText(val, dashX + 112, dashY + yy); };
                const pb = smcData.dashboard.pressureBias;
                row(34, 'Pressure (this TF):', pb, pb === 'BULLISH' ? '#22c55e' : pb === 'BEARISH' ? '#ef4444' : sub);
                row(51, 'Risk per trade:', `$${riskMoney.toFixed(2)} (${Number(ind.smcRiskCap) || 1}%)`, isDark ? '#a3e635' : '#4d7c0f');
                row(68, 'Past signals:', rec.signals ? `${Math.round(rec.tp1 * 100)}% hit TP1, ${Math.round(rec.tp2 * 100)}% TP2 (${rec.signals})` : 'not enough yet', fg);
            }
        }

        // Draw Livermore Gold Trend PRO Visuals
        if (state.indicators.livermore && !state.hiddenIndicators?.livermore) {
            // 1. Trend EMA (length from settings; field name kept from v12)
            ctx.strokeStyle = "rgba(0, 0, 255, 0.5)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            let started = false;
            visibleData.forEach(d => {
                if (d.ema100 !== undefined && d.ema100 !== null) {
                    let hx = x(d.time);
                    if (hx !== undefined) {
                        if (!started) { ctx.moveTo(hx + halfBw, y(d.ema100)); started = true; }
                        else { ctx.lineTo(hx + halfBw, y(d.ema100)); }
                    }
                }
            });
            ctx.stroke();

            // 2. Trades — like the Pine strategy on TradingView: entry fills at the
            //    next open, SL/trailing stop (red) and TP (green) step lines, risk /
            //    reward zones, exit badges with the result.
            const lmFmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
            const stepW = bw / 0.8;                     // one bar slot (band step)
            // Entry / exit dot: bigger, ringed in the background colour so it stands out on a candle body
            const dot = (cx, cy, col) => {
                ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
                ctx.fillStyle = col; ctx.fill();
                ctx.lineWidth = 2; ctx.strokeStyle = isDark ? "#0b1220" : "#ffffff"; ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
            };
            const badge = (cx, cy, text, bg) => {
                ctx.font = "bold 9px sans-serif";
                const w = ctx.measureText(text).width + 8;
                ctx.fillStyle = bg;
                ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - 7, w, 14, 3); ctx.fill();
                ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText(text, cx, cy);
            };
            // Active-during-bar levels = state at the previous close (orders work from the next bar)
            for (let k = 0; k < visibleData.length; k++) {
                const d = visibleData[k];
                const prevD = k > 0 ? visibleData[k - 1] : null;
                const ps = prevD?.livermoreState;
                const hx = x(d.time);
                if (hx === undefined || !ps || !ps.armed || ps.position_size <= 0) continue;
                const x0 = hx + halfBw - stepW / 2, x1 = hx + halfBw + stepW / 2;
                const entry = ps.entryPrice;
                // zones
                ctx.fillStyle = isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.08)";
                if (ps.initSl != null) { const a1 = y(entry), a2 = y(ps.initSl); ctx.fillRect(x0, Math.min(a1, a2), x1 - x0, Math.abs(a2 - a1)); }
                ctx.fillStyle = isDark ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.08)";
                if (ps.tp != null) { const a1 = y(entry), a2 = y(ps.tp); ctx.fillRect(x0, Math.min(a1, a2), x1 - x0, Math.abs(a2 - a1)); }
                // step lines
                ctx.lineWidth = 2;
                if (ps.sl != null) { ctx.strokeStyle = "#ef4444"; ctx.beginPath(); ctx.moveTo(x0, y(ps.sl)); ctx.lineTo(x1, y(ps.sl)); ctx.stroke(); }
                if (ps.tp != null) { ctx.strokeStyle = "#22c55e"; ctx.beginPath(); ctx.moveTo(x0, y(ps.tp)); ctx.lineTo(x1, y(ps.tp)); ctx.stroke(); }
                ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.strokeStyle = isDark ? "rgba(203,213,225,0.7)" : "rgba(71,85,105,0.7)";
                ctx.beginPath(); ctx.moveTo(x0, y(entry)); ctx.lineTo(x1, y(entry)); ctx.stroke(); ctx.setLineDash([]);
            }

            visibleData.forEach(d => {
                const hx = x(d.time);
                if (hx === undefined) return;
                const px = hx + halfBw;
                // Signal (bar close) → BUY / ADD
                if (d.livermoreBuy) {
                    const tip = y(d.low) + 5;
                    ctx.fillStyle = "#0ea5e9";
                    ctx.beginPath(); ctx.moveTo(px, tip); ctx.lineTo(px - 6, tip + 8); ctx.lineTo(px + 6, tip + 8); ctx.fill();
                    badge(px, tip + 18, d.livermoreAdd ? "ADD" : "BUY", "#0ea5e9");
                }
                // Fill at this bar's open
                if (d.livermoreFill != null) dot(px, y(d.livermoreFill), "#0ea5e9");
                // Exit with result
                if (d.livermoreExit) {
                    const pnl = d.livermorePnl ?? 0;
                    const win = pnl >= 0;
                    const col = d.livermoreExit === 'TP' ? "#16a34a" : win ? "#d97706" : "#dc2626";
                    const tip = y(d.high) - 5;
                    ctx.fillStyle = col;
                    ctx.beginPath(); ctx.moveTo(px, tip); ctx.lineTo(px - 6, tip - 8); ctx.lineTo(px + 6, tip - 8); ctx.fill();
                    if (d.livermoreExitPrice != null) dot(px, y(d.livermoreExitPrice), col);
                    badge(px, tip - 18, `${d.livermoreExit} ${pnl >= 0 ? '+' : '−'}${lmFmt(Math.abs(pnl))}${d.livermoreTrailed ? ' (trail)' : ''}`, col);
                }
            });

            // Open trade: labels at the right edge (Entry / SL / TP)
            const lastLm = dataset[dataset.length - 1]?.livermoreState;
            if (lastLm && lastLm.position_size > 0) {
                const tag = (price, text, bg) => {
                    const py = y(price);
                    if (!(py >= 0 && py <= chartHeight)) return;
                    ctx.font = "bold 9px sans-serif";
                    const w = ctx.measureText(text).width + 8;
                    ctx.fillStyle = bg;
                    ctx.beginPath(); ctx.roundRect(chartWidth - w - 4, py - 7, w, 14, 3); ctx.fill();
                    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                    ctx.fillText(text, chartWidth - w / 2 - 4, py);
                };
                if (lastLm.tp != null) tag(lastLm.tp, `TP ${lmFmt(lastLm.tp)}  +${lmFmt(lastLm.tp - lastLm.entryPrice)}`, "#16a34a");
                if (lastLm.entryPrice != null) tag(lastLm.entryPrice, `Long ${lastLm.position_size > 1 ? '×2 ' : ''}@ ${lmFmt(lastLm.entryPrice)}`, "#0ea5e9");
                if (lastLm.sl != null) tag(lastLm.sl, `${lastLm.trailed ? 'Trailing stop' : 'SL'} ${lmFmt(lastLm.sl)}  ${lastLm.sl >= lastLm.entryPrice ? '+' : '−'}${lmFmt(Math.abs(lastLm.sl - lastLm.entryPrice))}`, "#dc2626");
            }

            // Render Active Positions
            if (state.activePositions && state.activePositions.length > 0) {
                state.activePositions.forEach(pos => {
                    // Only draw if position matches current chart symbol
                    if (pos.symbol === state.symbol) {
                        const drawLevelLine = (price, label, color, dash = []) => {
                            let py = y(price);
                            if (py >= 0 && py <= chartHeight) {
                                ctx.strokeStyle = color;
                                ctx.lineWidth = 1.5;
                                ctx.setLineDash(dash);
                                ctx.beginPath();
                                ctx.moveTo(0, py);
                                ctx.lineTo(chartWidth, py);
                                ctx.stroke();
                                ctx.setLineDash([]);

                                ctx.font = "11px sans-serif";
                                let tw = ctx.measureText(label).width + 8;
                                ctx.fillStyle = color;
                                ctx.beginPath();
                                ctx.roundRect(chartWidth - tw - 60, py - 8, tw, 16, 2);
                                ctx.fill();
                                ctx.fillStyle = "#ffffff";
                                ctx.textAlign = "center";
                                ctx.textBaseline = "middle";
                                ctx.fillText(label, chartWidth - 60 - tw / 2, py);
                            }
                        };

                        let pColor = pos.type === 'BUY' ? "#3b82f6" : "#ef4444";
                        let profitLabel = (pos.profit >= 0 ? "+" : "") + pos.profit.toFixed(2);
                        drawLevelLine(pos.open_price, `${pos.type} ${pos.volume} [${profitLabel}]`, pColor, [4, 4]);

                        if (pos.sl > 0) {
                            drawLevelLine(pos.sl, `SL`, "#ef4444", [2, 2]);
                        }
                        if (pos.tp > 0) {
                            drawLevelLine(pos.tp, `TP`, "#10b981", [2, 2]);
                        }
                    }
                });
            }

            // 3. Livermore Dashboard Table (Top Right)
            let lastCandle = dataset.length > 0 ? dataset[dataset.length - 1] : null;
            if (lastCandle) {
                let dashW = 140;
                let dashH = 75;
                let { x: dashX, y: dashY } = placeBox('livermore', chartWidth - dashW - 10, 10, dashW, dashH);

                ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
                ctx.fillRect(dashX, dashY, dashW, dashH);
                ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
                ctx.lineWidth = 1;
                ctx.strokeRect(dashX, dashY, dashW, dashH);

                ctx.font = "bold 10px sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";

                let cx1 = dashX + 10;
                let cx2 = dashX + 70;
                let rowH = 20;

                // Row 1: ADX
                let adxVal = (lastCandle.adx || 0).toFixed(2);
                let adxColor = (lastCandle.adx > 20) ? "#00ff00" : "#ff0000";
                ctx.fillStyle = "#ffffff"; ctx.fillText("ADX", cx1, dashY + rowH);
                ctx.fillStyle = adxColor; ctx.fillText(adxVal, cx2, dashY + rowH);

                // Row 2: Risk/Trade
                ctx.fillStyle = "#ffffff"; ctx.fillText("Risk/Trade", cx1, dashY + rowH * 2);
                ctx.fillStyle = "#ffff00"; ctx.fillText("2.0%", cx2, dashY + rowH * 2);

                // Row 3: Status
                let isLong = lastCandle.livermoreState && lastCandle.livermoreState.position_size > 0;
                ctx.fillStyle = "#ffffff"; ctx.fillText("Status", cx1, dashY + rowH * 3);
                ctx.fillStyle = "#00ffff"; ctx.fillText(isLong ? "LONG" : "WAIT", cx2, dashY + rowH * 3);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // Draw LSR – Liquidity Sweep Reversal
        // ─────────────────────────────────────────────────────────────────────
        if (state.indicators.lsr && !state.hiddenIndicators?.lsr) {
            // 1. Draw liquidity pool level lines
            if (dataset.lsrLevels && dataset.lsrLevels.length > 0) {
                dataset.lsrLevels.forEach(lv => {
                    let py = y(lv.price);
                    if (py < -20 || py > chartHeight + 20) return;

                    let isH4      = lv.lbl && lv.lbl.includes('H4');
                    let isHigh    = lv.ty === 1;
                    let isSwept   = lv.swept;
                    let isEqHL    = lv.n >= 2;

                    // Color: H4=red/blue, H1=orange/aqua; swept=grey
                    let colBase;
                    if (isSwept)      colBase = '#6b7280';
                    else if (isH4)    colBase = isHigh ? '#ef4444' : '#3b82f6';
                    else              colBase = isHigh ? '#f97316' : '#06b6d4';

                    let lw = (isH4 ? 2 : 1) + (isEqHL ? 1 : 0);

                    // Start X: use lv.time mapped to chart, or 0 if off-screen
                    let startX = x(lv.time);
                    if (startX === undefined) startX = 0;
                    startX = Math.max(0, startX);

                    ctx.strokeStyle = colBase;
                    ctx.lineWidth = lw;
                    if (isSwept) ctx.setLineDash([3, 4]);
                    else          ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(startX, Math.round(py) + 0.5);
                    ctx.lineTo(chartWidth, Math.round(py) + 0.5);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Label
                    let base  = isHigh ? 'BSL' : 'SSL';
                    let tag   = isEqHL ? (isHigh ? ' EQH×' : ' EQL×') + lv.n : '';
                    let txt   = lv.lbl + ' ' + base + tag + ' ' + lv.price.toFixed(2) + (isSwept ? ' (swept)' : '');
                    ctx.font = 'bold 9px sans-serif';
                    let tw = ctx.measureText(txt).width + 8;
                    ctx.fillStyle = isSwept ? 'rgba(107,114,128,0.75)' : colBase.replace(')', ',0.85)').replace('rgb', 'rgba');
                    ctx.beginPath();
                    ctx.roundRect(chartWidth - tw - 2, py - 8, tw, 16, 3);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(txt, chartWidth - tw / 2 - 2, py);
                });
            }

            // 2. Draw BUY / SELL signals + SL / TP levels on each signal candle
            visibleData.forEach(d => {
                if (!d.lsrSignal) return;
                let sig = d.lsrSignal;
                let px = x(d.time);
                if (px === undefined) return;
                let cx = px + halfBw;

                let isBuy = sig.dir === 1;
                let sigColor = isBuy ? '#22c55e' : '#ef4444';

                // Arrow / triangle marker
                if (isBuy) {
                    let tipY = y(d.low) + 6;
                    ctx.fillStyle = '#22c55e';
                    ctx.beginPath();
                    ctx.moveTo(cx, tipY);
                    ctx.lineTo(cx - 7, tipY + 10);
                    ctx.lineTo(cx + 7, tipY + 10);
                    ctx.fill();
                    // SELL label badge
                    ctx.beginPath();
                    ctx.roundRect(cx - 16, tipY + 11, 32, 14, 3);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('BUY', cx, tipY + 18);
                } else {
                    let tipY = y(d.high) - 6;
                    ctx.fillStyle = '#ef4444';
                    ctx.beginPath();
                    ctx.moveTo(cx, tipY);
                    ctx.lineTo(cx - 7, tipY - 10);
                    ctx.lineTo(cx + 7, tipY - 10);
                    ctx.fill();
                    // SELL label badge (background was missing)
                    ctx.beginPath();
                    ctx.roundRect(cx - 16, tipY - 25, 32, 14, 3);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('SELL', cx, tipY - 18);
                }

                // Entry / SL / TP lines extending rightward from signal candle.
                // `indent` shifts the label right relative to the BUY/SELL badge,
                // creating clear visual separation between the direction badge and levels.
                const drawLevel = (price, color, dash, label, pxStart, indent = 0) => {
                    let ly = y(price);
                    if (ly < 0 || ly > chartHeight) return;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash(dash);
                    ctx.beginPath();
                    ctx.moveTo(pxStart, Math.round(ly) + 0.5);
                    ctx.lineTo(chartWidth, Math.round(ly) + 0.5);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Label pill — indented right of BUY/SELL badge
                    ctx.font = 'bold 9px sans-serif';
                    let lw2 = ctx.measureText(label).width + 10;
                    let labelX = pxStart + halfBw * 2 + 6 + indent;
                    if (labelX + lw2 > chartWidth - 4) labelX = chartWidth - lw2 - 4;
                    if (labelX < 2) labelX = 2;

                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.92;
                    ctx.beginPath();
                    ctx.roundRect(labelX, ly - 8, lw2, 16, 3);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, labelX + 5, ly);
                };

                let startPx = Math.max(0, px);
                // Indent ENTRY/SL/TP labels 28px right of BUY/SELL badge
                // so they are visually grouped but clearly separated
                const LV_INDENT = 28;
                drawLevel(sig.entry, '#eab308', [],      `ENTRY ${sig.entry.toFixed(2)}`, startPx, LV_INDENT);
                drawLevel(sig.sl,    '#ef4444', [4, 4],  `SL ${sig.sl.toFixed(2)}`,       startPx, LV_INDENT);
                drawLevel(sig.tp1,   '#22c55e', [2, 3],  `TP1 ${sig.tp1.toFixed(2)}`,     startPx, LV_INDENT);
                drawLevel(sig.tp2,   '#22c55e', [2, 3],  `TP2 ${sig.tp2.toFixed(2)}`,     startPx, LV_INDENT);
                drawLevel(sig.tp3,   '#22c55e', [2, 3],  `TP3 ${sig.tp3.toFixed(2)}`,     startPx, LV_INDENT);
                // Opposite liquidity = natural target (where the next stops sit)
                if (sig.liqTarget != null) {
                    drawLevel(sig.liqTarget, '#a855f7', [6, 3],
                        `LIQ ${sig.liqTargetLbl || ''} ${sig.liqTarget.toFixed(2)}${sig.rrToLiq ? ` · ${sig.rrToLiq.toFixed(1)}R` : ''}`, startPx, LV_INDENT);
                }
            });
        }

        // Indicator panes (Volume, MACD, RSI, DeMarker, CVD) — geometry kept for the crosshair
        cState.panes = drawPanes(ctx, {
            panes: activePanes, heights: subPaneHeights, top: panesTop(), visibleData, x, bw, halfBw,
            chartWidth, colors, isDark, settings: state.indicatorSettings, grid: state.grid,
        });

        // Draw Drawings (Trendlines, Horizontal, Vertical)
        const drawings = state.drawings && state.drawings[state.symbol] ? state.drawings[state.symbol] : [];
        const allDrawings = cState.draftDrawing ? [...drawings.filter(d => d.id !== cState.draftDrawing.id), cState.draftDrawing] : drawings;

        allDrawings.forEach(d => {
            let isSelected = state.selectedDrawingId === d.id;
            let isHovered = cState.hoveredDrawingId === d.id;
            if (TWO_POINT_TOOLS.has(d.type)) {           // ray, rectangle, fib, measure, long/short
                renderDrawing(ctx, d, drawingGeom(x, y), isSelected && !cState.draftDrawing, isHovered);
                return;
            }

            ctx.strokeStyle = d.color || (isDark ? '#e2e8f0' : '#1e293b');
            ctx.lineWidth = (d.width || 2) + (isHovered ? 1 : 0);
            if (isSelected) ctx.strokeStyle = '#4f46e5'; // Indigo-600

            ctx.beginPath();

            let px1, py1, px2, py2;

            if (d.type === 'horizontal') {
                let py = y(d.y);
                if (py >= 0 && py <= chartHeight) {
                    ctx.moveTo(0, py);
                    ctx.lineTo(chartWidth, py);
                }
            } else if (d.type === 'vertical') {
                let px = x(d.time) + halfBw;
                if (px >= 0 && px <= chartWidth) {
                    ctx.moveTo(px, 0);
                    ctx.lineTo(px, chartHeight);
                }
            } else if (d.type === 'trendline') {
                px1 = x(d.time1) + halfBw;
                py1 = y(d.y1);
                px2 = x(d.time2) + halfBw;
                py2 = y(d.y2);
                ctx.moveTo(px1, py1);
                ctx.lineTo(px2, py2);
            }
            ctx.stroke();

            // Draw anchors if selected
            if (isSelected && !cState.draftDrawing) {
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#4f46e5';
                ctx.lineWidth = 2;
                if (d.type === 'horizontal') {
                    ctx.beginPath(); ctx.arc(chartWidth / 2, y(d.y), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                } else if (d.type === 'vertical') {
                    ctx.beginPath(); ctx.arc(x(d.time) + halfBw, chartHeight / 2, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                } else if (d.type === 'trendline') {
                    ctx.beginPath(); ctx.arc(px1, py1, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                    ctx.beginPath(); ctx.arc(px2, py2, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                }
            }
        });

        // Draw Manual Trade SL/TP lines
        if (state.manualTrade) {
            const { sl, tp } = state.manualTrade;
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);

            if (sl) {
                let slY = y(parseFloat(sl));
                if (slY >= 0 && slY <= chartHeight) {
                    ctx.strokeStyle = '#ef4444'; // Red for SL
                    ctx.beginPath();
                    ctx.moveTo(0, slY);
                    ctx.lineTo(chartWidth, slY);
                    ctx.stroke();
                    // SL Label
                    ctx.fillStyle = '#ef4444';
                    ctx.fillText('SL', chartWidth - margin.right - 20, slY - 4);
                }
            }
            if (tp) {
                let tpY = y(parseFloat(tp));
                if (tpY >= 0 && tpY <= chartHeight) {
                    ctx.strokeStyle = '#22c55e'; // Green for TP
                    ctx.beginPath();
                    ctx.moveTo(0, tpY);
                    ctx.lineTo(chartWidth, tpY);
                    ctx.stroke();
                    // TP Label
                    ctx.fillStyle = '#22c55e';
                    ctx.fillText('TP', chartWidth - margin.right - 20, tpY - 4);
                }
            }
            ctx.setLineDash([]);
        }

        // Market Sessions dashboard (on top of everything in the chart)
        if (showSessions) drawMarketSessionsDashboard(ctx, dataset, chartWidth, state.indicatorSettings, colors, placeBox);
        // Pressure Chart info card last, so no other overlay paints over it
        if (state.chartType === 'pressure' && dataset.pressure) drawPressureCard(ctx, { dataset, chartWidth, isDark, state, placeBox });

        ctx.restore(); // Restore global translate

        // Double-buffer blit: atomically swap offscreen buffer to visible canvas
        visibleCtx.clearRect(0, 0, canvasNode.width, canvasNode.height);
        visibleCtx.drawImage(offCanvas, 0, 0);
        canvasNode._lastDrawAt = performance.now();
    }

    canvasNode._triggerDraw = () => draw();

    canvasNode._resizeChart = () => {
        const newWidth = wrapperNode.clientWidth;
        const newHeight = wrapperNode.clientHeight;
        if (newWidth <= 0 || newHeight <= 0) return;

        const newDpr = window.devicePixelRatio || 1;
        const newCanvasWidth = newWidth * newDpr;
        const newCanvasHeight = newHeight * newDpr;

        canvasNode.width = newCanvasWidth;
        canvasNode.height = newCanvasHeight;
        canvasNode.style.width = `${newWidth}px`;
        canvasNode.style.height = `${newHeight}px`;

        if (offCanvas) {
            offCanvas.width = newCanvasWidth;
            offCanvas.height = newCanvasHeight;
            offCanvas.style.width = `${newWidth}px`;
            offCanvas.style.height = `${newHeight}px`;
        }
        // Re-apply DPR scale after dimension reset (setting .width/.height clears the transform)
        ctx.setTransform(newDpr, 0, 0, newDpr, 0, 0);

        if (crosshairNode && offCanvasC) {
            crosshairNode.width = newCanvasWidth;
            crosshairNode.height = newCanvasHeight;
            crosshairNode.style.width = `${newWidth}px`;
            crosshairNode.style.height = `${newHeight}px`;

            offCanvasC.width = newCanvasWidth;
            offCanvasC.height = newCanvasHeight;
            offCanvasC.style.width = `${newWidth}px`;
            offCanvasC.style.height = `${newHeight}px`;
        }
        if (ctxC) {
            ctxC.setTransform(newDpr, 0, 0, newDpr, 0, 0);
        }

        chartWidth = newWidth - margin.left - margin.right;
        chartHeight = Math.max(50, newHeight - margin.top - margin.bottom - totalSubHeight - 30);

        const maxTx = -(cState.tx.k - 1) * chartWidth;
        const minTx = maxTx - chartWidth * 0.5; // allow 50% chart width extra space on right
        if (cState.tx.x > 0) cState.tx = d3.zoomIdentity.translate(0, cState.tx.y).scale(cState.tx.k);
        if (cState.tx.x < minTx) cState.tx = d3.zoomIdentity.translate(minTx, cState.tx.y).scale(cState.tx.k);

        d3.select(canvasNode).property("__zoom", cState.tx);
        draw();
    };

    canvasNode._scrollToMostRecent = () => {
        if (!dataset || dataset.length === 0) return;
        const w = wrapperNode.clientWidth - margin.left - margin.right;
        const k = cState.tx.k;
        // Leave empty space between the running candle and the Y-axis
        // (see rightGapPx). Panning stays unrestricted.
        const tx = -(k - 1) * w - rightGapPx(k);
        cState.tx = d3.zoomIdentity.translate(tx, cState.tx.y).scale(k);
        // Sync d3's internal transform so the next drag/wheel continues from here
        d3.select(canvasNode).property("__zoom", cState.tx);
        draw();
    };

    // Track loading state to prevent duplicate requests
    if (!canvasNode._loadingMore) canvasNode._loadingMore = false;

    function checkLoadMore() {
        if (!onLoadMore || canvasNode._loadingMore || dataset.length === 0) return;
        // Check if first candle is within visible area (left ~3 bars from left edge)
        const firstX = cState.tx.applyX(xBase(dataset[0].time));
        if (firstX > -100) {
            canvasNode._loadingMore = true;
            const result = onLoadMore();
            if (result && result.finally) {
                result.finally(() => { canvasNode._loadingMore = false; });
            } else {
                setTimeout(() => { canvasNode._loadingMore = false; }, 3000);
            }
        }
    }

    // Set up D3 Zoom behavior on the canvas node
    // d3 zoom is attached to the canvas only once (first render), but the chart
    // is rebuilt on every data update. The attached handlers therefore forward
    // to these per-render functions; calling the first render's closures drew
    // from a destroyed offscreen buffer → blank chart while panning.
    canvasNode._zoomFilter = (event) => {
        // Touch is handled by our own listeners below (vertical pan, inertia,
        // pinch). d3's touch handling calls stopImmediatePropagation, which
        // kept those listeners from ever running on phones.
        if (event.type && event.type.startsWith('touch')) return false;
        if (cState.boxDrag) return false;
        if (state.activeTool && !state.activeTool.startsWith('cursor') && state.activeTool !== 'eraser') return false;
        if (event.type === 'mousedown') {
            let my = d3.pointer(event, canvasNode)[1];
            let sy = panesTop() + margin.top;   // top edge of the first pane (resize handle)
            for (let ind of activePanes) {
                if (Math.abs(my - sy) <= 5) return false;
                sy += subPaneHeights[ind] + subPaneGap;
            }
            if (cState.hoveredDrawingId) return false;
        }
        return !event.ctrlKey && !event.button;
    };
    canvasNode._onZoom = (event) => {
        cState.tx = event.transform;
        if (event.sourceEvent) touched();

        if (event.sourceEvent && event.sourceEvent.type === 'mousemove') {
            const dy = event.sourceEvent.movementY || 0;
            if (cState.autoScaleY) {
                // TradingView-style: a deliberate vertical drag switches the
                // price scale to manual (small jitter while scrolling doesn't)
                cState.dragDy = (cState.dragDy || 0) + dy;
                if (Math.abs(cState.dragDy) > 8) { freezeY(); setTyY(cState.dragDy); }
            } else if (dy) {
                setTyY(cState.ty.y + dy);
            }
        }

        checkLoadMore();
        if (onPanUpdate) onPanUpdate(cState);
        scheduleDraw();
    };

    // Only real input counts as interaction — every redraw re-applies the zoom
    // transform programmatically, which fires these events without a sourceEvent.
    canvasNode._onZoomStart = (event) => { cState.dragDy = 0; if (event?.sourceEvent) touched(); };
    // The behaviour attached first stays the one handling wheel/drag; its zoom
    // limit follows the data (more candles loaded → deeper zoom allowed)
    if (!canvasNode._zoomBehavior) {
        canvasNode._zoomBehavior = d3.zoom()
            .filter((event) => canvasNode._zoomFilter(event))
            .on("start", (event) => canvasNode._onZoomStart(event))
            .on("zoom", (event) => canvasNode._onZoom(event));
    }
    const zoom = canvasNode._zoomBehavior.scaleExtent([0.01, maxZoomK()]);

    if (!canvasNode._zoomAttached) {
        d3.select(canvasNode)
            .call(zoom)
            .property("__zoom", cState.tx);
        canvasNode._zoomAttached = true;
    } else {
        // Update the zoom transform in d3's internal state
        zoom.transform(d3.select(canvasNode), cState.tx);
    }

    // Drag info boxes (mouse or touch). Double-click a box = back to its default spot.
    const boxAt = (e) => {
        const r = canvasNode.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        return [...(cState.boxes || [])].reverse().find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    };
    canvasNode._boxHandlers = {
        down: (e) => {
            if (drawingToolActiveFor(state)) return;
            const b = boxAt(e);
            if (!b) return;
            const off = getBoxPos()[b.id] || { dx: 0, dy: 0 };
            cState.boxDrag = { id: b.id, sx: e.clientX, sy: e.clientY, dx: off.dx, dy: off.dy, pid: e.pointerId };
            try { canvasNode.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
            canvasNode.style.cursor = 'grabbing';
            e.preventDefault();
        },
        move: (e) => {
            const d = cState.boxDrag;
            if (d) {
                getBoxPos()[d.id] = { dx: d.dx + (e.clientX - d.sx), dy: d.dy + (e.clientY - d.sy) };
                scheduleDraw();
            } else if (e.pointerType === 'mouse' && !e.buttons) {
                canvasNode.style.cursor = boxAt(e) ? 'grab' : '';
            }
        },
        up: (e) => {
            const d = cState.boxDrag;
            if (!d) return;
            cState.boxDrag = null;
            try { canvasNode.releasePointerCapture(d.pid); } catch { /* already released */ }
            canvasNode.style.cursor = '';
            // a click without dragging → the box's own tap action (e.g. collapse)
            if (Math.abs(e.clientX - d.sx) < 4 && Math.abs(e.clientY - d.sy) < 4) {
                const tb = (cState.boxes || []).find(x => x.id === d.id);
                if (tb?.onTap) {
                    const r = canvasNode.getBoundingClientRect();
                    getBoxPos()[d.id] = { dx: d.dx, dy: d.dy };
                    tb.onTap(e.clientX - r.left - tb.x, e.clientY - r.top - tb.y);
                    scheduleDraw();
                    return;
                }
            }
            // store the clamped position (not where the pointer went past the
            // chart edge), so dragging back responds immediately
            const b = (cState.boxes || []).find(x => x.id === d.id);
            if (b) {
                const nx = Math.max(margin.left, Math.min(margin.left + chartWidth - b.w, b.defX + d.dx + (e.clientX - d.sx)));
                const ny = Math.max(margin.top, Math.min(margin.top + chartHeight - b.h, b.defY + d.dy + (e.clientY - d.sy)));
                getBoxPos()[d.id] = { dx: nx - b.defX, dy: ny - b.defY };
                scheduleDraw();
            }
            saveBoxPos();
        },
        dbl: (e) => {
            const b = boxAt(e);
            if (!b) return;
            delete getBoxPos()[b.id];
            saveBoxPos();
            scheduleDraw();
        },
    };
    if (!canvasNode._boxAttached) {
        canvasNode.addEventListener('pointerdown', (e) => canvasNode._boxHandlers.down(e));
        canvasNode.addEventListener('pointermove', (e) => canvasNode._boxHandlers.move(e));
        canvasNode.addEventListener('pointerup', (e) => canvasNode._boxHandlers.up(e));
        canvasNode.addEventListener('pointercancel', (e) => canvasNode._boxHandlers.up(e));
        canvasNode.addEventListener('dblclick', (e) => canvasNode._boxHandlers.dbl(e));
        canvasNode._boxAttached = true;
    }

    // Handle Y-Axis Drag for Vertical Zoom
    // Handlers are attached once; they forward to the current render's
    // functions (see the d3 zoom note above).
    const yAxisOverlay = wrapperNode.parentElement ? wrapperNode.parentElement.querySelector('.y-axis-overlay') : null;
    if (yAxisOverlay) {
        yAxisOverlay._handlers = {
            start: () => {
                freezeY();
                touched();
                if (onPanUpdate) onPanUpdate(cState);
            },
            drag: (event) => {
                touched();
                let k = Math.exp(-event.dy * 0.01);
                let py = event.y; // approximate mouse Y
                let r = (py - cState.ty.y) / cState.ty.k;
                let newK = cState.ty.k * k;
                cState.ty = d3.zoomIdentity.translate(py - r * newK, 0).scale(newK);
                scheduleDraw();
            },
            wheel: (event) => {
                event.preventDefault();
                freezeY();
                touched();
                let k = Math.exp(-event.deltaY * 0.002);
                let py = d3.pointer(event)[1];
                let r = (py - cState.ty.y) / cState.ty.k;
                let newK = cState.ty.k * k;
                cState.ty = d3.zoomIdentity.translate(py - r * newK, 0).scale(newK);
                if (onPanUpdate) onPanUpdate(cState);
                scheduleDraw();
            },
        };
        if (!yAxisOverlay._dragAttached) {
            d3.select(yAxisOverlay).call(d3.drag()
                .on("start", (event) => yAxisOverlay._handlers.start(event))
                .on("drag", (event) => yAxisOverlay._handlers.drag(event))
            ).on("wheel", (event) => yAxisOverlay._handlers.wheel(event));
            yAxisOverlay._dragAttached = true;
        }
    }

    // Handle X-Axis Drag for Horizontal Zoom (handlers forward like the Y axis)
    const xAxisOverlay = wrapperNode.parentElement ? wrapperNode.parentElement.querySelector('.x-axis-overlay') : null;
    if (xAxisOverlay) {
        xAxisOverlay._handlers = {
            drag: (event) => {
                let k = Math.exp(event.dx * 0.01);
                let px = event.x; // approximate mouse X
                let r = (px - cState.tx.x) / cState.tx.k;
                let newK = cState.tx.k * k;
                cState.tx = d3.zoomIdentity.translate(px - r * newK, 0).scale(newK);
                scheduleDraw();
            },
            wheel: (event) => {
                event.preventDefault();
                let k = Math.exp(-event.deltaY * 0.002);
                let px = d3.pointer(event)[0];
                let r = (px - cState.tx.x) / cState.tx.k;
                let newK = cState.tx.k * k;
                cState.tx = d3.zoomIdentity.translate(px - r * newK, 0).scale(newK);
                scheduleDraw();
            },
        };
        if (!xAxisOverlay._dragAttached) {
            d3.select(xAxisOverlay).call(d3.drag()
                .on("drag", (event) => xAxisOverlay._handlers.drag(event))
            ).on("wheel", (event) => xAxisOverlay._handlers.wheel(event));
            xAxisOverlay._dragAttached = true;
        }
    }

    // =============================================
    // MOBILE: Pinch-to-Zoom & Touch Pan
    // =============================================
    let touchState = {
        lastTouches: null,
        lastPinchDist: null,
        lastPinchMidX: null,
        lastMoveTime: 0,
        velY: 0,        // inertial velocity for smooth vertical scroll
    };

    function getTouchDist(t1, t2) {
        let dx = t1.clientX - t2.clientX;
        let dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchMidX(t1, t2) {
        return (t1.clientX + t2.clientX) / 2;
    }

    // Remove the previous render's touch handlers before adding new ones.
    // renderCanvasChart runs on every data update; without this each rebuild
    // added 3 more listeners, each keeping that render's whole dataset alive
    // (unbounded heap growth → out-of-memory after running for a long time).
    if (canvasNode._touchHandlers) {
        canvasNode._touchHandlers.forEach(([type, fn]) => canvasNode.removeEventListener(type, fn));
    }
    canvasNode._touchHandlers = [];
    const addTouchListener = (type, fn, options) => {
        canvasNode.addEventListener(type, fn, options);
        canvasNode._touchHandlers.push([type, fn]);
    };

    const drawingToolActive = () => state.activeTool && !state.activeTool.startsWith('cursor') && state.activeTool !== 'eraser';
    addTouchListener('touchstart', (e) => {
        if (drawingToolActive() || cState.boxDrag) return;   // tap = drawing click / box drag
        e.preventDefault();
        touched();
        touchState.velY = 0; // kill inertia on new touch
        touchState.accDx = 0; touchState.accDy = 0;
        if (e.touches.length === 1) {
            touchState.lastTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
            touchState.lastMoveTime = performance.now();
            touchState.lastPinchDist = null;
        } else if (e.touches.length === 2) {
            touchState.lastPinchDist = getTouchDist(e.touches[0], e.touches[1]);
            touchState.lastPinchMidX = getTouchMidX(e.touches[0], e.touches[1]);
            touchState.lastTouches = null;
        }
    }, { passive: false });

    addTouchListener('touchmove', (e) => {
        if (drawingToolActive() || cState.boxDrag) return;
        e.preventDefault();
        touched();
        const rect = canvasNode.getBoundingClientRect();

        if (e.touches.length === 1 && touchState.lastTouches) {
            // Single finger pan
            let t = e.touches[0];
            let prevT = touchState.lastTouches[0];
            let dx = t.clientX - prevT.x;
            let dy = t.clientY - prevT.y;
            let now = performance.now();
            let dt = Math.max(1, now - touchState.lastMoveTime);

            // Horizontal pan (X axis)
            cState.tx = d3.zoomIdentity.translate(cState.tx.x + dx, 0).scale(cState.tx.k);

            // Vertical pan (Y axis), 1:1 with the finger + inertia. A clearly
            // vertical gesture switches the price scale to manual first.
            touchState.accDx = (touchState.accDx || 0) + dx;
            touchState.accDy = (touchState.accDy || 0) + dy;
            if (cState.autoScaleY && Math.abs(touchState.accDy) > 10 && Math.abs(touchState.accDy) > Math.abs(touchState.accDx)) {
                freezeY();
                setTyY(touchState.accDy);
            } else if (!cState.autoScaleY) {
                setTyY((cState.ty.y || 0) + dy);
                touchState.velY = Math.max(-40, Math.min(40, dy / dt * 16)); // px per ~60fps frame
            }

            touchState.lastTouches = [{ x: t.clientX, y: t.clientY }];
            touchState.lastMoveTime = now;

            checkLoadMore();
            if (onPanUpdate) onPanUpdate(cState);
            scheduleDraw();

        } else if (e.touches.length === 2 && touchState.lastPinchDist !== null) {
            // Two finger pinch = horizontal zoom
            let newDist = getTouchDist(e.touches[0], e.touches[1]);
            let newMidX = getTouchMidX(e.touches[0], e.touches[1]) - rect.left;
            let scale = newDist / touchState.lastPinchDist;

            let px = newMidX;
            let r = (px - cState.tx.x) / cState.tx.k;
            let newK = Math.max(0.01, Math.min(100, cState.tx.k * scale));
            cState.tx = d3.zoomIdentity.translate(px - r * newK, 0).scale(newK);

            touchState.lastPinchDist = newDist;
            touchState.lastPinchMidX = newMidX + rect.left;

            if (onPanUpdate) onPanUpdate(cState);
            scheduleDraw();
        }
    }, { passive: false });

    addTouchListener('touchend', (e) => {
        // Start inertial scroll when finger lifts — gives a smooth "throw" feel
        if (Math.abs(touchState.velY) > 0.05 && !cState.autoScaleY) {
            let currentTy = cState.ty.y || 0;
            let v = touchState.velY;
            const friction = 0.92;
            const tick = () => {
                v *= friction;
                if (Math.abs(v) < 0.2) return;
                setTyY(currentTy + v);
                currentTy = cState.ty.y;
                if (onPanUpdate) onPanUpdate(cState);
                requestAnimationFrame(draw);
                requestAnimationFrame(tick);
            };
            tick();
        }
        touchState.lastTouches = null;
        touchState.lastPinchDist = null;
        touchState.velY = 0;
        d3.select(canvasNode).property("__zoom", cState.tx);
    }, { passive: false });

    // Resizing & Crosshair Logic
    let isResizingPane = null;
    let startDragY = 0;
    let startPaneHeight = 0;

    if (crosshairNode && ctxC) {
        d3.select(wrapperNode)
            .on("mousemove.crosshair", (event) => {
                let [mx, my] = d3.pointer(event, canvasNode);
                const x = xNow(), halfBw = x.bandwidth() / 2;
                ctxC.clearRect(0, 0, width, height);

                // Cursor updates for resizing
                let hoverPane = null;
                let sy = panesTop() + margin.top;   // top edge of the first pane (resize handle)
                for (let ind of activePanes) {
                    if (Math.abs(my - sy) <= 5) { hoverPane = ind; break; }
                    sy += subPaneHeights[ind] + subPaneGap;
                }


                // Hit detection for drawings
                let hitDrawingId = null;
                let hitAnchor = null;
                const HIT_RADIUS_SQ = 64; // 8px radius
                const allDrawings = state.drawings && state.drawings[state.symbol] ? state.drawings[state.symbol] : [];
                let currentYForHit = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));

                if (!cState.isDrawingLine && (!state.activeTool || state.activeTool.startsWith('cursor') || state.activeTool === 'eraser')) {
                    for (let i = allDrawings.length - 1; i >= 0; i--) {
                        let d = allDrawings[i];
                        if (d.type === 'horizontal') {
                            let py = currentYForHit(d.y);
                            if (Math.abs(my - margin.top - py) < 8) {
                                hitDrawingId = d.id; hitAnchor = 'body'; break;
                            }
                        } else if (d.type === 'vertical') {
                            let px = x(d.time) + halfBw;
                            if (Math.abs(mx - margin.left - px) < 8) {
                                hitDrawingId = d.id; hitAnchor = 'body'; break;
                            }
                        } else if (TWO_POINT_TOOLS.has(d.type)) {
                            const a = hitDrawing(d, mx - margin.left, my - margin.top, drawingGeom(x, currentYForHit), state.selectedDrawingId === d.id);
                            if (a) { hitDrawingId = d.id; hitAnchor = a; break; }
                        } else if (d.type === 'trendline') {
                            let px1 = x(d.time1) + halfBw; let py1 = currentYForHit(d.y1);
                            let px2 = x(d.time2) + halfBw; let py2 = currentYForHit(d.y2);

                            if (state.selectedDrawingId === d.id) {
                                if (distSq(mx - margin.left, my - margin.top, px1, py1) < HIT_RADIUS_SQ) { hitDrawingId = d.id; hitAnchor = 'start'; break; }
                                if (distSq(mx - margin.left, my - margin.top, px2, py2) < HIT_RADIUS_SQ) { hitDrawingId = d.id; hitAnchor = 'end'; break; }
                            }
                            if (distToSegmentSq(mx - margin.left, my - margin.top, px1, py1, px2, py2) < HIT_RADIUS_SQ) {
                                hitDrawingId = d.id; hitAnchor = 'body'; break;
                            }
                        }
                    }
                }

                if (cState.hoveredDrawingId !== hitDrawingId || cState.hoveredAnchor !== hitAnchor) {
                    cState.hoveredDrawingId = hitDrawingId;
                    cState.hoveredAnchor = hitAnchor;
                    scheduleDraw();
                }

                if (hoverPane || isResizingPane) {
                    crosshairNode.style.cursor = 'ns-resize';
                    wrapperNode.style.cursor = 'ns-resize';
                } else if (hitAnchor === 'start' || hitAnchor === 'end') {
                    crosshairNode.style.cursor = 'move';
                    wrapperNode.style.cursor = 'move';
                } else if (hitDrawingId) {
                    crosshairNode.style.cursor = 'pointer';
                    wrapperNode.style.cursor = 'pointer';
                } else {
                    let cStyle = 'crosshair';
                    if (state.activeTool === 'cursor_arrow') cStyle = 'default';
                    if (state.activeTool === 'cursor_dot') cStyle = 'none';      // a dot is drawn instead
                    if (state.activeTool === 'eraser') cStyle = 'cell';
                    crosshairNode.style.cursor = cStyle;
                    wrapperNode.style.cursor = cStyle;
                }

                if (isResizingPane) return; // Suspend crosshair during resize

                if (cState.isDrawingLine && cState.draftDrawing && cState.creatingDrawing) {
                    if (isTwoPoint(cState.draftDrawing.type)) {
                        let currentY = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));
                        cState.draftDrawing.time2 = invertX(mx - margin.left);
                        cState.draftDrawing.y2 = currentY.invert(my - margin.top);
                        scheduleDraw();
                    }
                }

                // Crosshair covers the main chart and every indicator pane below it
                const crossBottom = margin.top + panesBottom();
                if (my < margin.top || my > crossBottom) {
                    hideFootprintTooltip(wrapperNode);
                    // Blit cleared offscreen to hide crosshair
                    visibleCtxC.clearRect(0, 0, crosshairNode.width, crosshairNode.height);
                    return;
                }
                const inMainChart = my <= margin.top + chartHeight;
                const hoverPaneInfo = !inMainChart && cState.panes
                    ? cState.panes.find(p => my - margin.top >= p.top && my - margin.top <= p.top + p.height) : null;

                const showDashedCrosshair = !state.activeTool || state.activeTool === 'cursor' || state.activeTool === 'cursor_dot';

                if (showDashedCrosshair) {
                    ctxC.strokeStyle = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)";
                    ctxC.setLineDash([4, 4]);
                    ctxC.beginPath();
                    // Vertical guide straight down through all panes (MACD, RSI, …)
                    ctxC.moveTo(mx, margin.top); ctxC.lineTo(mx, crossBottom);
                    // Horizontal guide only in the chart/pane under the cursor
                    if (inMainChart || hoverPaneInfo) { ctxC.moveTo(margin.left, my); ctxC.lineTo(width - margin.right, my); }
                    ctxC.stroke();
                    ctxC.setLineDash([]);
                    // Dot cursor: small filled dot at the pointer (system cursor hidden)
                    if (state.activeTool === 'cursor_dot') {
                        ctxC.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
                        ctxC.beginPath(); ctxC.arc(mx, my, 3, 0, Math.PI * 2); ctxC.fill();
                    }

                    // Value label on the right axis: price, or the pane's indicator value
                    let axisText = null;
                    if (inMainChart) {
                        let currentY = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));
                        axisText = currentY.invert(my - margin.top).toFixed(5);
                    } else if (hoverPaneInfo) {
                        axisText = fmtVal(hoverPaneInfo.fromY(my - margin.top));
                    }
                    if (axisText !== null) {
                        ctxC.fillStyle = "#2563eb"; // Bright blue background
                        ctxC.fillRect(width - margin.right, my - 12, margin.right, 24);
                        ctxC.fillStyle = "#ffffff"; // White text
                        ctxC.textAlign = "left";
                        ctxC.textBaseline = "middle";
                        ctxC.font = "bold 12px sans-serif";
                        ctxC.fillText(axisText, width - margin.right + 6, my);
                    }

                    // Pane headers show the hovered candle's values (TradingView-style)
                    if (cState.panes && cState.panes.length && mx >= margin.left && mx <= width - margin.right) {
                        const hIdx = Math.floor(cState.tx.invertX(mx - margin.left) / xBase.step());
                        const hd = hIdx >= 0 && hIdx < dataset.length ? dataset[hIdx] : null;
                        if (hd) {
                            ctxC.save();
                            ctxC.translate(margin.left, margin.top);
                            for (const p of cState.panes) drawPaneHeader(ctxC, p, hd, colors, isDark);
                            ctxC.restore();
                        }
                    }
                }

                // Time Label (bottom time axis, below the last pane)
                if (mx >= margin.left && mx <= width - margin.right) {
                    let hoveredTime = invertX(mx - margin.left);
                    if (hoveredTime) {
                        let dateStr = d3.timeFormat("%b %d, %H:%M")(new Date(hoveredTime));
                        ctxC.font = "bold 11px sans-serif";
                        let textW = ctxC.measureText(dateStr).width + 16;
                        ctxC.fillStyle = "#2563eb";
                        ctxC.fillRect(mx - textW / 2, crossBottom, textW, 20);
                        ctxC.fillStyle = "#ffffff";
                        ctxC.textAlign = "center";
                        ctxC.textBaseline = "top";
                        ctxC.fillText(dateStr, mx, crossBottom + 4);
                    }
                }

                // Footprint hover details: what happened inside the hovered candle/row
                // (an HTML box so it shows above HTML panels drawn over the chart)
                const tipBounds = { minX: margin.left + 4, minY: margin.top + 4, maxX: width - margin.right - 4, maxY: margin.top + chartHeight - 4 };
                // Next-candle projection box: explain it in simple words on hover
                let projShown = false;
                const ph = cState.projHit;
                if (showDashedCrosshair && ph && ph.rect && !cState.isDrawingLine) {
                    const cx = mx - margin.left, cy = my - margin.top;
                    if (cx >= ph.rect.x && cx <= ph.rect.x + ph.rect.w && cy >= ph.rect.y && cy <= ph.rect.y + ph.rect.h) {
                        showHtmlTooltip(wrapperNode, ph.pp ? pathExplanationHtml(ph.pp, colors, isDark) : projectionExplanationHtml(ph.pr, colors, isDark), mx, my, tipBounds, isDark);
                        projShown = true;
                    }
                }
                // Economic calendar marker: list its events
                if (!projShown && cState.calHits?.length && !cState.isDrawingLine) {
                    const cx = mx - margin.left, cy = my - margin.top;
                    const hit = cState.calHits.find(h => Math.abs(cx - h.x) <= h.r && Math.abs(cy - h.y) <= (h.rh || h.r));
                    if (hit) { showHtmlTooltip(wrapperNode, calendarHtml(hit.events, colors, isDark), mx, my, tipBounds, isDark); projShown = true; }
                }
                // Whale Pulse bubble: its pressure, volume and how unusual it was
                if (!projShown && cState.wpHits?.length && !cState.isDrawingLine) {
                    const cx = mx - margin.left, cy = my - margin.top;
                    const near = (h) => (cx - h.x) ** 2 + (cy - h.y) ** 2 <= h.r * h.r;
                    const hit = cState.wpHits.find(h => (h.abs || h.deep) && near(h)) || cState.wpHits.find(near);   // small marks first
                    if (hit) {
                        const html = hit.abs ? absorptionHtml(hit.k, dataset.whalePulse, colors, isDark)
                            : hit.deep ? deepPressureHtml(hit.k, colors, isDark, Math.max(2, Math.min(20, Math.round(Number(state.indicatorSettings?.wpDeepBars) || 5))))
                            : whalePulseHtml(hit.k, dataset.whalePulse, colors, isDark);
                        showHtmlTooltip(wrapperNode, html, mx, my, tipBounds, isDark); projShown = true;
                    }
                }
                const mh = cState.modelHit;
                if (!projShown && showDashedCrosshair && mh && !cState.isDrawingLine) {
                    const cx = mx - margin.left, cy = my - margin.top;
                    if (cx >= mh.rect.x && cx <= mh.rect.x + mh.rect.w && cy >= mh.rect.y && cy <= mh.rect.y + mh.rect.h) {
                        showHtmlTooltip(wrapperNode, modelExplanationHtml(mh.mp, colors, isDark, canvasNode._cot && canvasNode._cot.forSymbol === state.symbol ? canvasNode._cot : null, canvasNode._sentiment && canvasNode._sentiment.forSymbol === state.symbol ? canvasNode._sentiment : null), mx, my, tipBounds, isDark);
                        projShown = true;
                    }
                }
                let fpTipShown = false;
                if (!projShown && showDashedCrosshair && state.chartType === 'footprint' && !cState.isDrawingLine
                    && state.footprintSettings?.hoverInfo !== false && dataset.length > 0
                    && mx >= margin.left && mx <= width - margin.right) {
                    const step = xBase.step();
                    const idx = Math.floor(cState.tx.invertX(mx - margin.left) / step);
                    const candle = idx >= 0 && idx < dataset.length ? dataset[idx] : null;
                    if (candle && candle.fp) {
                        // Only while the cursor is over that candle's column
                        const left = cState.tx.applyX(xBase(candle.time));
                        const colW = xBase.bandwidth() * cState.tx.k;
                        const cx = mx - margin.left;
                        if (cx >= left && cx <= left + colW) {
                            const curY = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));
                            const price = curY.invert(my - margin.top);
                            const rowIdx = Math.floor(price / candle.fp.row + 1e-7) - candle.fp.base;
                            showFootprintTooltip(wrapperNode, describeFootprint(candle, rowIdx), mx, my,
                                { minX: margin.left + 4, minY: margin.top + 4, maxX: width - margin.right - 4, maxY: margin.top + chartHeight - 4 },
                                colors, isDark);
                            fpTipShown = true;
                        }
                    }
                }
                if (!fpTipShown && !projShown) hideFootprintTooltip(wrapperNode);

                // Double-buffer blit: atomically swap offscreen crosshair to visible canvas
                visibleCtxC.clearRect(0, 0, crosshairNode.width, crosshairNode.height);
                visibleCtxC.drawImage(offCanvasC, 0, 0);
            })
            .on("mouseleave.crosshair", () => {
                hideFootprintTooltip(wrapperNode);
                if (!isResizingPane) {
                    ctxC.clearRect(0, 0, width, height);
                    visibleCtxC.clearRect(0, 0, crosshairNode.width, crosshairNode.height);
                }
            })
            .on("mouseup.resizer", () => {
                if (cState.isDrawingLine && cState.draftDrawing) {
                    cState.isDrawingLine = false;
                    cState.creatingDrawing = false;
                    if (onDrawComplete) onDrawComplete(finishDrawing(cState.draftDrawing));
                    cState.draftDrawing = null;
                }
            })
            .on("mousedown.resizer", (event) => {
                if (cState.boxDrag) return;              // dragging an info box
                let [mx, my] = d3.pointer(event, canvasNode);
                const x = xNow(), halfBw = x.bandwidth() / 2;
                let currentYForHit = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));
                let pTime = new Date(invertX(mx - margin.left));
                let pPrice = currentYForHit.invert(my - margin.top);

                if (state.manualTrade?.isSettingSL) {
                    state.manualTrade.setSl(pPrice.toFixed(5));
                    state.manualTrade.setIsSettingSL(false);
                    event.stopPropagation();
                    return;
                }

                if (state.manualTrade?.isSettingTP) {
                    state.manualTrade.setTp(pPrice.toFixed(5));
                    state.manualTrade.setIsSettingTP(false);
                    event.stopPropagation();
                    return;
                }

                // Handle Drawing Selection & Dragging
                if (cState.hoveredDrawingId) {
                    if (onDrawSelect) onDrawSelect(cState.hoveredDrawingId);

                    const allDrawings = state.drawings && state.drawings[state.symbol] ? state.drawings[state.symbol] : [];
                    const targetDrawing = allDrawings.find(d => d.id === cState.hoveredDrawingId);

                    if (targetDrawing) {
                        if (state.activeTool === 'eraser') {
                            if (onDrawDelete) onDrawDelete(targetDrawing.id);
                            event.stopPropagation();
                            return;
                        }

                        cState.isDrawingLine = true;
                        cState.draftDrawing = { ...targetDrawing };
                        cState.dragAnchor = cState.hoveredAnchor;
                        cState.dragStartMx = mx;
                        cState.dragStartMy = my;

                        let dragStartPx1 = targetDrawing.time1 ? x(targetDrawing.time1) : 0;
                        let dragStartPy1 = targetDrawing.y1 ? currentYForHit(targetDrawing.y1) : 0;
                        let dragStartPx2 = targetDrawing.time2 ? x(targetDrawing.time2) : 0;
                        let dragStartPy2 = targetDrawing.y2 ? currentYForHit(targetDrawing.y2) : 0;

                        d3.select(window)
                            .on("mousemove.resizer", (e2) => {
                                let [cx, cy] = d3.pointer(e2, canvasNode);

                                if (cState.dragAnchor === 'start') {
                                    cState.draftDrawing.time1 = invertX(cx - margin.left);
                                    cState.draftDrawing.y1 = currentYForHit.invert(cy - margin.top);
                                } else if (cState.dragAnchor === 'end') {
                                    cState.draftDrawing.time2 = invertX(cx - margin.left);
                                    cState.draftDrawing.y2 = currentYForHit.invert(cy - margin.top);
                                } else if (cState.dragAnchor === 'stop') {
                                    cState.draftDrawing.stop = currentYForHit.invert(cy - margin.top);
                                } else if (cState.dragAnchor === 'body') {
                                    if (targetDrawing.type === 'horizontal') {
                                        cState.draftDrawing.y = currentYForHit.invert(cy - margin.top);
                                    } else if (targetDrawing.type === 'vertical') {
                                        cState.draftDrawing.time = invertX(cx - margin.left);
                                    } else if (isTwoPoint(targetDrawing.type)) {
                                        if (targetDrawing.stop !== undefined && targetDrawing.stop !== null) {
                                            cState.draftDrawing.stop = currentYForHit.invert(currentYForHit(targetDrawing.stop) + (cy - my));
                                        }
                                        // Move both points by delta screen pixels to avoid scaling warp, then invert
                                        let dx = cx - mx; let dy = cy - my;
                                        cState.draftDrawing.time1 = invertX(dragStartPx1 + dx);
                                        cState.draftDrawing.y1 = currentYForHit.invert(dragStartPy1 + dy);
                                        cState.draftDrawing.time2 = invertX(dragStartPx2 + dx);
                                        cState.draftDrawing.y2 = currentYForHit.invert(dragStartPy2 + dy);
                                    }
                                }
                                scheduleDraw();
                            })
                            .on("mouseup.resizer", () => {
                                d3.select(window).on("mousemove.resizer", null).on("mouseup.resizer", null);
                                cState.isDrawingLine = false;
                                if (onDrawComplete) onDrawComplete(finishDrawing(cState.draftDrawing));
                                cState.draftDrawing = null;
                            });

                        event.stopPropagation();
                        return;
                    }
                } else {
                    if (onDrawSelect) onDrawSelect(null);
                }

                if (state.activeTool && !state.activeTool.startsWith('cursor') && state.activeTool !== 'eraser') {
                    if (mx < margin.left || mx > width - margin.right || my < margin.top || my > chartHeight + margin.top) return;

                    let currentY = yBase.copy().range(cState.autoScaleY ? [chartHeight, 0] : [chartHeight, 0].map(d => cState.ty.applyY(d)));
                    let pTime = new Date(invertX(mx - margin.left));
                    let pPrice = currentY.invert(my - margin.top);

                    if (state.activeTool === 'horizontal') {
                        if (onDrawComplete) onDrawComplete({ id: Date.now(), type: 'horizontal', y: pPrice });
                    } else if (state.activeTool === 'vertical') {
                        if (onDrawComplete) onDrawComplete({ id: Date.now(), type: 'vertical', time: pTime.getTime() });
                    } else if (isTwoPoint(state.activeTool)) {
                        // trendline, ray, rectangle, fib, measure, long/short: drag to the second point
                        cState.isDrawingLine = true;
                        cState.creatingDrawing = true;
                        cState.draftDrawing = { id: Date.now(), type: state.activeTool, time1: pTime.getTime(), y1: pPrice, time2: pTime.getTime(), y2: pPrice };
                        scheduleDraw();
                    }
                    event.stopPropagation();
                    return;
                }

                let sy = panesTop() + margin.top;   // top edge of the first pane (resize handle)
                for (let ind of activePanes) {
                    if (Math.abs(my - sy) <= 5) {
                        isResizingPane = ind;
                        startDragY = event.clientY;
                        startPaneHeight = subPaneHeights[ind];

                        d3.select(window)
                            .on("mousemove.resizer", (e2) => {
                                let dy = e2.clientY - startDragY;
                                let newHeight = Math.max(30, startPaneHeight - dy);
                                subPaneHeights[isResizingPane] = newHeight;

                                totalSubHeight = 0;
                                activePanes.forEach(i => { totalSubHeight += subPaneHeights[i] + subPaneGap; });
                                chartHeight = height - margin.top - margin.bottom - totalSubHeight - 30;

                                scheduleDraw();
                            })
                            .on("mouseup.resizer", () => {
                                d3.select(window).on("mousemove.resizer", null).on("mouseup.resizer", null);
                                if (onResizeEnd) onResizeEnd({ [isResizingPane]: subPaneHeights[isResizingPane] });
                                isResizingPane = null;
                            });

                        event.stopPropagation();
                        return;
                    }
                    sy += subPaneHeights[ind] + subPaneGap;
                }
            });
    }

    // Initial draw
    scheduleDraw();
}
