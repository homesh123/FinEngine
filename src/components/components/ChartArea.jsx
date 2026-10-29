import React, { useCallback, useEffect, useRef, useState } from 'react';
import { maLine } from '../utils/movingAverages';
import * as d3 from 'd3';
import { useAccountSignals } from '../hooks/useAccountSignals';
import { renderCanvasChart } from '../utils/canvasChartEngine';
import { fetchModelPrediction, MODEL_INTERVALS } from '../utils/modelPrediction';
import { fetchCalendar, fetchCot, fetchSentiment } from '../utils/marketContext';
import ChartContextMenu from './ChartContextMenu';
import { INDICATOR_CATALOG } from './IndicatorPicker';
import { addAlert, makeAlert } from '../utils/alerts/alertStore';
import { takeChartSnapshot } from '../utils/chartSnapshot';
import { Settings2, Crosshair, ChevronRight, ChevronDown, Eye, EyeOff, TrendingUp, ZoomIn, ZoomOut, X } from 'lucide-react';
import IndicatorSettingsModal from './IndicatorSettingsModal';
import MillionMovesDashboardWidget from './MillionMovesDashboardWidget';
import { playNotificationSound } from '../utils/notificationSound';
import { useNotifications } from '../hooks/useNotifications';
import { useGoldMoveNotifications } from '../hooks/useGoldMoveNotifications';
import { useEaSignalBridge } from '../hooks/useEaSignalBridge';
import { useIndiaSignalBridge } from '../hooks/useIndiaSignalBridge';
import { useAlertEngine } from '../hooks/useAlertEngine';
import { usePredictionSignal } from '../hooks/usePredictionSignal';
import { logPrediction } from '../utils/predictionLog';
import { footprintSourceSummary } from '../utils/footprintRenderer';
import { confirmDialog } from '../utils/confirmDialog';

// Footprint opens with columns about this wide, so the bid × ask numbers fit
const FOOTPRINT_COLUMN_PX = 90;

// Footer clock lives in its own component so the 1s tick re-renders only this
// span, not the whole ChartArea tree.
function LiveClock() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const tzOffset = new Date(now).getTimezoneOffset();
    const sign = tzOffset > 0 ? "-" : "+";
    const absOffset = Math.abs(tzOffset);
    const hrs = Math.floor(absOffset / 60);
    const mins = absOffset % 60;
    return (
        <div className="flex items-center">
            {new Date(now).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            <span className="ml-1">
                {`UTC${sign}${hrs}${mins > 0 ? ':' + mins.toString().padStart(2, '0') : ''}`}
            </span>
        </div>
    );
}

// Index of the first candle of the current trading session: right after the
// most recent trading break (gold's daily pause, weekend) within the last 30h,
// else the FX trading-day start (22:00 UTC = 17:00 New York).
function sessionStartIndex(data, tfMins) {
    const n = data.length;
    if (n < 2) return 0;
    const lastT = data[n - 1].time, tfMs = tfMins * 60000;
    const breakMs = Math.max(30 * 60000, tfMs * 2);
    for (let i = n - 1; i > 0 && lastT - data[i].time <= 30 * 3600000; i--) {
        if (data[i].time - data[i - 1].time >= breakMs) return i;
    }
    const DAY = 86400000, ROLL = 22 * 3600000;
    const dayStart = Math.floor((lastT - ROLL) / DAY) * DAY + ROLL;
    let i = n - 1;
    while (i > 0 && data[i - 1].time >= dayStart) i--;
    return i;
}

export default function ChartArea({ dataset, state, setState, layoutIndex, onLoadMore, addTrade, activePositions = [], livePriceFeed, tradingEnabled = true }) {
    // tradingEnabled: false for charts in background chart tabs — they keep
    // sending notifications, but auto-trading and webhooks run only on the
    // chart tab on screen (so two tabs never place the same trade twice).
    const wrapperRef = useRef(null);
    const canvasRef = useRef(null);
    const crosshairRef = useRef(null);
    const [activeSettings, setActiveSettings] = useState(null);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [isAutoScaled, setIsAutoScaled] = useState(true);
    const [isRendering, setIsRendering] = useState(false);
    const [activeRange, setActiveRange] = useState('1D');
    const prevChartId = useRef(null);
    // Default view (last 24h of candles + gap before the price axis) is applied
    // on first load and after every symbol/timeframe change, once that chart's
    // data has arrived (i.e. a dataset different from the one on screen when the
    // chart changed).
    const pendingDefaultZoom = useRef(true);
    const datasetAtChartChange = useRef(null);

    // Stable load-more callback for the chart engine. onLoadMore's identity
    // changes whenever ChartWrapper re-renders (e.g. its history-loading flag);
    // depending on it rebuilt the chart, the rebuild re-checked "oldest candle
    // visible → load more", and that looped continuously.
    const onLoadMoreRef = useRef(onLoadMore);
    onLoadMoreRef.current = onLoadMore;
    const stableLoadMore = useCallback(() => onLoadMoreRef.current?.(), []);

    // Prevent browser-level pinch zoom on mobile when chart is active
    useEffect(() => {
        const preventZoom = (e) => {
            if (e.touches && e.touches.length > 1) e.preventDefault();
        };
        const preventGesture = (e) => { e.preventDefault(); };

        document.addEventListener('touchstart', preventZoom, { passive: false });
        document.addEventListener('gesturestart', preventGesture, { passive: false });
        document.addEventListener('gesturechange', preventGesture, { passive: false });

        return () => {
            document.removeEventListener('touchstart', preventZoom);
            document.removeEventListener('gesturestart', preventGesture);
            document.removeEventListener('gesturechange', preventGesture);
        };
    }, []);


    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    // Manual Trading State
    const [sl, setSl] = useState('');
    const [tp, setTp] = useState('');
    const [isSettingSL, setIsSettingSL] = useState(false);
    const [isSettingTP, setIsSettingTP] = useState(false);

    // Notification State
    const { enabled: notifEnabled } = useNotifications();
    // Note: goldMoveLastNotifiedTime and goldMoveLastTPNotifiedTime were removed —
    // dedup for Gold Move notifications is now handled inside useGoldMoveNotifications.

    // Gold Move Notifications — handled by dedicated hook (fixes date-cutoff + SW fallback bugs)
    // Gold Move: only the EA signal bridge here (notifEnabled: false) — its
    // notifications now come from the Alerts panel ("Gold Move signal" alert).
    useGoldMoveNotifications({ dataset, state, notifEnabled: false, tradingEnabled });
    // Indicator signals → MT5 Receiver EA (Signal Tester → Auto-send to MT5 EA)
    useEaSignalBridge({ dataset, state, tradingEnabled });
    // NSE/BSE indicator signals → alert strategies in /india (owner, Upstox connected; paper by default)
    useIndiaSignalBridge({ dataset, state });

    // Alerts panel: check this chart's candles against the user's alerts
    usePredictionSignal(dataset, state);   // stamps ppSignal on its candle for the alerts below
    // Live track record: this chart's prediction for each closed candle (server checks it later)
    const livePp = state.chartType !== 'footprint' && state.indicators?.nextProjection ? dataset?.[dataset.length - 1]?.pathProjection : null;
    useEffect(() => {
        if (!livePp) return;
        logPrediction({ symbol: state.symbol, tf: Number(state.timeframe), kind: 'path', horizon: livePp.horizon, analogs: livePp.analogs,
            refTime: livePp.refTime, pUp: livePp.pUp, call: livePp.pUp >= 0.55 ? 1 : livePp.pUp <= 0.45 ? -1 : 0 });
    }, [livePp?.refTime, livePp?.horizon, livePp?.analogs, state.symbol, state.timeframe]);
    useAlertEngine({ dataset, state, notifEnabled });

    // Notification permission is requested once per page by useNotifications().

    // Broker accounts: indicator signals → /api/accounts/{id}/signal (see ALGO_TRADING.md)
    const algoAccounts = useAccountSignals({ dataset, state });

    // Latest values for the ResizeObserver, so the observer is created once
    // instead of being torn down and re-attached on every data tick.
    const resizeCtxRef = useRef({ dataset, state, onLoadMore: stableLoadMore });
    // Bumped when the wrapper gets real dimensions before the initial 1D zoom
    // was applied (mobile), so the main render effect retries it.
    const [layoutRetry, setLayoutRetry] = useState(0);
    resizeCtxRef.current = { dataset, state, onLoadMore: stableLoadMore };

    // Live ticks: update the price on the canvas node and redraw at most once per
    // animation frame. No React re-render and no full renderCanvasChart() rebuild.
    useEffect(() => {
        if (!livePriceFeed) return;
        let frame = null;
        const apply = (price) => {
            if (canvasRef.current) canvasRef.current._livePrice = price;
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                // Hidden chart (background chart tab): nothing to draw
                if (resizeCtxRef.current.dataset.length === 0 || !wrapperRef.current?.clientWidth) return;
                canvasRef.current?._triggerDraw?.();
            });
        };
        apply(livePriceFeed.get());
        const unsubscribe = livePriceFeed.subscribe(apply);
        return () => {
            unsubscribe();
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [livePriceFeed]);

    // Trained model (backend /api/predict): fetched while the projection is on,
    // every 30 s (the server caches per closed candle); drawn by the canvas engine
    const modelOn = !!state.indicators?.nextProjection && !state.hiddenIndicators?.nextProjection
        && state.chartType !== 'footprint' && !!MODEL_INTERVALS[state.timeframe];
    useEffect(() => {
        const node = canvasRef.current;
        if (node) node._modelPrediction = null;
        if (!modelOn) { node?._triggerDraw?.(); return; }
        let cancelled = false;
        const forChart = `${state.symbol}_${state.timeframe}`;
        const load = async () => {
            if (document.hidden) return;
            try {
                const mp = await fetchModelPrediction(state.symbol, state.timeframe);
                if (cancelled || !canvasRef.current) return;
                canvasRef.current._modelPrediction = mp ? { ...mp, forChart } : null;
                canvasRef.current._triggerDraw?.();
            } catch { /* backend offline - the chart-only projection still works */ }
        };
        load();
        const timer = setInterval(load, 30000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [modelOn, state.symbol, state.timeframe]);

    // Economic calendar (markers + news warning) every 15 min, and CFTC positioning
    // for the model hover (every 6 h) - stored on the canvas node, drawn by the engine
    const calendarOn = state.showCalendar !== false;
    useEffect(() => {
        if (!calendarOn) { if (canvasRef.current) { canvasRef.current._calendar = null; canvasRef.current._triggerDraw?.(); } return; }
        let cancelled = false, retry = null;
        const symbol = state.symbol;
        const load = async () => {
            clearTimeout(retry);
            try {
                const d = await fetchCalendar(symbol);
                if (cancelled || !canvasRef.current) return;
                canvasRef.current._calendar = { forSymbol: symbol, events: d.events || [] };
                canvasRef.current._triggerDraw?.();
            } catch {
                if (!cancelled) retry = setTimeout(load, 60000);   // backend restarting/offline: try again in 1 min
            }
        };
        load();
        const timer = setInterval(load, 15 * 60000);
        return () => { cancelled = true; clearInterval(timer); clearTimeout(retry); };
    }, [calendarOn, state.symbol]);
    useEffect(() => {
        if (!modelOn) return;
        let cancelled = false;
        const symbol = state.symbol;
        const load = async () => {
            try {
                const d = await fetchCot(symbol);
                if (!cancelled && canvasRef.current) canvasRef.current._cot = { ...d, forSymbol: symbol };
            } catch { /* optional */ }
            try {
                const s = await fetchSentiment(symbol);
                if (!cancelled && canvasRef.current) canvasRef.current._sentiment = { ...s, forSymbol: symbol };
            } catch { /* optional: needs Myfxbook login on the server */ }
        };
        load();
        const timer = setInterval(load, 3600000);       // CFTC is cached 6 h, sentiment 1 h on the backend
        return () => { cancelled = true; clearInterval(timer); };
    }, [modelOn, state.symbol]);

    // Candle-close countdown: draw() reads the clock itself, so a 1s redraw is
    // enough — no React re-render or full renderCanvasChart() rebuild needed.
    useEffect(() => {
        const timer = setInterval(() => {
            if (document.hidden || resizeCtxRef.current.dataset.length === 0 || !wrapperRef.current?.clientWidth) return;
            // Already redrawn within the last second (e.g. by a live tick)
            if (performance.now() - (canvasRef.current?._lastDrawAt || 0) < 900) return;
            canvasRef.current?._triggerDraw?.();
        }, 1000);
        return () => clearInterval(timer);
    }, []);


    // ResizeObserver: re-render chart when the wrapper container gets its real
    // dimensions. Critical on mobile where flex layout height resolves async
    // after first mount, leaving wrapperNode.clientHeight === 0 on the first render.
    useEffect(() => {
        if (!wrapperRef.current) return;
        let lastW = 0;
        let lastH = 0;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                // Only re-render if size actually changed meaningfully
                if (Math.abs(width - lastW) < 1 && Math.abs(height - lastH) < 1) return;
                // Shown again after being hidden (e.g. its chart tab was selected):
                // the engine still holds the data from when it was hidden, so
                // rebuild with the latest dataset instead of just resizing.
                const wasHidden = lastW < 1 || lastH < 1;
                lastW = width;
                lastH = height;
                if (wasHidden && width > 0 && height > 0 && resizeCtxRef.current.dataset.length > 0 && canvasRef.current?._cState) {
                    setLayoutRetry(n => n + 1);
                    return;
                }
                const { dataset, state, onLoadMore } = resizeCtxRef.current;
                if (width > 0 && height > 0 && canvasRef.current && dataset.length > 0) {
                    // Use the engine's resize handler instead of a full re-render.
                    // A full renderCanvasChart() call would recreate the canvas state
                    // and wipe the user's zoom/pan — causing the chart to jump/zoom on
                    // every resize event. _resizeChart() preserves the current zoom.
                    if (pendingDefaultZoom.current) {
                        setLayoutRetry(n => n + 1);
                    } else if (typeof canvasRef.current._resizeChart === 'function') {
                        canvasRef.current._resizeChart();
                    } else if (wrapperRef.current) {
                        // Fallback for older engine builds without _resizeChart
                        renderCanvasChart(canvasRef.current, wrapperRef.current, dataset, state, () => {}, () => {}, onLoadMore, () => {}, () => {}, () => {}, () => {});
                    }
                }
            }
        });
        observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, []);

    const handleZoomTo = (range) => {
        setActiveRange(range);
        if (!canvasRef.current || !canvasRef.current._zoomTo || dataset.length === 0) return;
        const tf = state.timeframe; // in minutes. (1D is 1440)
        let minsToFit = 0;

        switch (range) {
            case '1D': minsToFit = 24 * 60; break;
            case '5D': minsToFit = 5 * 24 * 60; break;
            case '1M': minsToFit = 30 * 24 * 60; break;
            case '3M': minsToFit = 90 * 24 * 60; break;
            case '6M': minsToFit = 180 * 24 * 60; break;
            case 'YTD':
                const now = new Date();
                const startOfYear = new Date(now.getFullYear(), 0, 1);
                minsToFit = (now - startOfYear) / 60000;
                break;
            case '1Y': minsToFit = 365 * 24 * 60; break;
            case '5Y': minsToFit = 5 * 365 * 24 * 60; break;
            case 'All': minsToFit = dataset.length * tf; break;
            default: minsToFit = 24 * 60;
        }

        // 1D on intraday charts = the current trading session, edge to edge
        if (range === '1D' && tf < 1440) {
            canvasRef.current._zoomTo(Math.max(12, dataset.length - sessionStartIndex(dataset, tf)), state.indicators?.nextProjection ? 8 : 3);
            return;
        }
        const barsToFit = Math.ceil(minsToFit / tf);
        canvasRef.current._zoomTo(barsToFit);
    };

    useEffect(() => {
        if (!wrapperRef.current || !canvasRef.current || !crosshairRef.current) return;

        // Switching footprint on/off also counts as a new chart (it needs its own zoom)
        const currentChartId = `${state.symbol}-${state.timeframe}-${state.chartType === 'footprint' ? 'fp' : 'std'}`;
        if (prevChartId.current !== currentChartId) {
            if (canvasRef.current._cState) {
                canvasRef.current._cState.tx = d3.zoomIdentity;
                canvasRef.current._cState.ty = d3.zoomIdentity;
                canvasRef.current._cState.autoScaleY = true;
            }
            canvasRef.current._lastDomain = null;
            // First mount: whatever data is present counts as this chart's data.
            datasetAtChartChange.current = prevChartId.current === null ? null : dataset;
            pendingDefaultZoom.current = true;
            prevChartId.current = currentChartId;
        }

        if (dataset.length === 0) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            return;
        }

        // Ensure the container has dimensions before rendering
        if (wrapperRef.current.clientWidth === 0) return;

        const setAlertCallback = (price) => {
            if (state.settingAlert) {
                setState(prev => ({
                    ...prev,
                    alerts: [...prev.alerts, { id: Date.now(), price: price, active: true }],
                    settingAlert: false
                }));
            }
        };

        const onResizeEnd = (newHeights) => {
            setState(prev => ({
                ...prev,
                subPaneHeights: { ...prev.subPaneHeights, ...newHeights }
            }));
        };

        const onDrawComplete = (newDrawing) => {
            setState(prev => {
                const s = prev.symbol;
                const d = prev.drawings[s] || [];
                const existingIndex = d.findIndex(x => x.id === newDrawing.id);
                let newArr = [...d];
                if (existingIndex >= 0) {
                    newArr[existingIndex] = newDrawing;
                } else {
                    newArr.push(newDrawing);
                }
                return {
                    ...prev,
                    drawings: {
                        ...prev.drawings,
                        [s]: newArr
                    },
                    activeTool: 'cursor'
                };
            });
        };

        const onDrawDelete = (drawingId) => {
            setState(prev => {
                const s = prev.symbol;
                const d = prev.drawings[s] || [];
                return {
                    ...prev,
                    drawings: {
                        ...prev.drawings,
                        [s]: d.filter(x => x.id !== drawingId)
                    }
                };
            });
        };


        const onPanUpdate = (cState) => {
            setIsAutoScaled(cState.autoScaleY);
            // Check if we are panned into the past to show "scroll to right"
            setCanScrollRight(cState.tx.x < 0);
        };

        const wasNewChart = prevChartId.current !== currentChartId;

        // Only show the "Rendering..." spinner if we are loading a completely new chart.
        // For live polling (where we just append data), don't show the flashing spinner.
        if (wasNewChart) {
            setIsRendering(true);
        }

        const onDrawSelect = (id) => {
            setState(prev => ({ ...prev, selectedDrawingId: id }));
        };

        const timer = setTimeout(() => {
            const chartState = {
                ...state,
                manualTrade: { sl, tp, isSettingSL, isSettingTP, setSl, setTp, setIsSettingSL, setIsSettingTP },
                activePositions: activePositions
            };
            // Main chart: on desktop its projection text is in the sidebar card while the sidebar is open
            canvasRef.current._projInTabs = layoutIndex === 0 && !!state.sidebarOpen && state.activeTab === 'chart';
            canvasRef.current._projInBox = layoutIndex === 0;   // phones: the floating prediction box (FloatingProjection) shows it
            renderCanvasChart(canvasRef.current, wrapperRef.current, dataset, chartState, setAlertCallback, onResizeEnd, stableLoadMore, onDrawComplete, onDrawDelete, onPanUpdate, onDrawSelect);
            if (wasNewChart) {
                setIsRendering(false);
            }
            // Default view (last 24h / one session) on first load and after every
            // symbol/timeframe switch — only once the new chart's data is here, not
            // on the previous chart's candles. Retries via the ResizeObserver if the
            // wrapper had 0 dimensions (common on mobile).
            if (pendingDefaultZoom.current && dataset.length > 0 && dataset !== datasetAtChartChange.current) {
                if (canvasRef.current && canvasRef.current._zoomTo) {
                    if (state.chartType === 'footprint') {
                        // Footprint needs wide candles to show the bid × ask numbers
                        const plotW = Math.max(200, (wrapperRef.current?.clientWidth || 800) - 70);
                        canvasRef.current._zoomTo(Math.max(6, Math.min(40, Math.floor(plotW / FOOTPRINT_COLUMN_PX))));
                        setActiveRange(null);
                    } else {
                        handleZoomTo('1D');
                    }
                    pendingDefaultZoom.current = false;
                }
            }
        }, 10);

        const handleKeyDown = (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedDrawingId) {
                onDrawDelete(state.selectedDrawingId);
                setState(prev => ({ ...prev, selectedDrawingId: null }));
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('keydown', handleKeyDown);
        };

    }, [dataset, state, setState, layoutIndex, activePositions, sl, tp, isSettingSL, isSettingTP, layoutRetry]); // re-render on data or state change (countdown redraw handled separately)

    const handleAutoToggle = () => {
        if (!canvasRef.current || !canvasRef.current._cState) return;
        canvasRef.current._cState.autoScaleY = !canvasRef.current._cState.autoScaleY;
        if (canvasRef.current._cState.autoScaleY) {
            canvasRef.current._cState.ty = d3.zoomIdentity; // reset Y zoom
        }
        setIsAutoScaled(canvasRef.current._cState.autoScaleY);
        if (canvasRef.current._triggerDraw) canvasRef.current._triggerDraw();
    };

    // ── Right-click menu ─────────────────────────────────────────────────────
    const [ctxMenu, setCtxMenu] = useState(null);         // { x, y, info } in wrapper coordinates
    const [flash, setFlash] = useState(null);             // short confirmation text
    const flashTimer = useRef(null);
    useEffect(() => () => clearTimeout(flashTimer.current), []);
    const showFlash = (t) => { setFlash(t); clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlash(null), 1800); };
    const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
    const onChartContextMenu = (e) => {
        const cv = canvasRef.current, wr = wrapperRef.current;
        if (!cv || !wr || !cv._pointInfo) return;
        const info = cv._pointInfo(e.clientX, e.clientY);
        if (!info.inChart) return;                        // axes / panes keep the browser menu
        e.preventDefault();
        const r = wr.getBoundingClientRect();
        setCtxMenu({ x: e.clientX - r.left, y: e.clientY - r.top, info });
    };
    const fmtPrice = (v) => (v == null ? '' : Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
    const resetChartView = () => {
        const cv = canvasRef.current;
        if (!cv) return;
        cv._resetView?.();
        if (dataset.length && cv._zoomTo) cv._zoomTo(Math.max(12, dataset.length - sessionStartIndex(dataset, state.timeframe)), state.indicators?.nextProjection ? 8 : 3);
        setIsAutoScaled(true);
        setCanScrollRight(false);
    };
    const ctxItems = (info) => {
        const price = info.price, p = fmtPrice(price);
        const drawings = (state.drawings && state.drawings[state.symbol]) || [];
        const activeInd = INDICATOR_CATALOG.filter(it => state.indicators?.[it.key]).length + (state.indicators?.nextProjection ? 1 : 0);
        const items = [
            { label: 'Reset chart view', icon: 'RotateCcw', hint: 'latest · auto-scale', onClick: resetChartView },
            'sep',
            { label: `Copy price ${p}`, icon: 'Copy', onClick: () => { navigator.clipboard?.writeText(p).then(() => showFlash(`Copied ${p}`), () => showFlash('Copy not allowed')); } },
            { label: `Add alert at ${p}`, icon: 'BellPlus', onClick: () => {
                addAlert(makeAlert({ name: `${state.symbol} crossing ${p}`, symbol: state.symbol, timeframe: '*', source: 'price', signal: 'crossing', value: Number(p), trigger: 'once_per_bar' }));
                showFlash(`Alert added: ${state.symbol} crossing ${p}`);
            } },
            { label: `Horizontal line at ${p}`, icon: 'Minus', onClick: () => {
                setState(prev => ({ ...prev, drawings: { ...prev.drawings, [prev.symbol]: [...(prev.drawings[prev.symbol] || []), { id: Date.now(), type: 'horizontal', y: price }] } }));
            } },
            'sep',
        ];
        if (info.drawingId) items.push({ label: 'Delete this drawing', icon: 'Trash2', danger: true, onClick: () => {
            setState(prev => ({ ...prev, selectedDrawingId: null, drawings: { ...prev.drawings, [prev.symbol]: (prev.drawings[prev.symbol] || []).filter(d => d.id !== info.drawingId) } }));
        } });
        items.push({ label: `Remove all drawings${drawings.length ? ` (${drawings.length})` : ''}`, icon: 'Eraser', danger: true, disabled: !drawings.length, onClick: async () => {
            if (!(await confirmDialog({ title: 'Remove all drawings?', message: `All ${drawings.length} drawing${drawings.length === 1 ? '' : 's'} on ${state.symbol} will be deleted. This can't be undone.`, confirmLabel: 'Remove drawings', danger: true }))) return;
            setState(prev => { const d = { ...prev.drawings }; delete d[prev.symbol]; return { ...prev, drawings: d, selectedDrawingId: null }; });
        } });
        items.push({ label: `Remove all indicators${activeInd ? ` (${activeInd})` : ''}`, icon: 'Layers', danger: true, disabled: !activeInd, onClick: () => {
            setState(prev => {
                const ind = { ...prev.indicators };
                for (const it of INDICATOR_CATALOG) ind[it.key] = false;
                ind.nextProjection = false;
                return { ...prev, indicators: ind };
            });
        } });
        items.push('sep');
        items.push({ label: 'Take screenshot', icon: 'Camera', onClick: async () => {
            const tf = ({ 1: '1m', 5: '5m', 15: '15m', 30: '30m', 45: '45m', 60: '1H', 240: '4H', 1440: '1D' })[state.timeframe] || `${state.timeframe}m`;
            try { const r = await takeChartSnapshot({ symbol: state.symbol, timeframe: tf, dark: state.theme === 'dark' }); showFlash(r.copied ? 'Screenshot saved & copied' : 'Screenshot saved'); }
            catch { showFlash('Screenshot failed'); }
        } });
        return items;
    };

    const handleZoomLatest = (factor) => {
        if (!canvasRef.current || !canvasRef.current._zoomAtLatest) return;
        canvasRef.current._zoomAtLatest(factor);
    };

    const handleScrollRight = () => {
        if (!canvasRef.current || !canvasRef.current._scrollToMostRecent) return;
        canvasRef.current._scrollToMostRecent();
        setCanScrollRight(false);
    };

    const titleMap = {
        maRibbon: "MA Ribbon",
        rsi: `RSI (${state.indicatorSettings.rsiPeriod ?? 14})`,
        demarker: `DeMarker (${state.indicatorSettings.demPeriod ?? 14})`,
        macd: `MACD (${state.indicatorSettings.macdFast}, ${state.indicatorSettings.macdSlow}, ${state.indicatorSettings.macdSig})`,
        sdPro: `Supply/Demand Pro`,
        qit: `Quantum Imbalance Trap`,
        fxProfile: `FX24HR Market Profile`,
        vbr: `Volume-Based Support & Resistance (${state.indicatorSettings?.vbrLookback || 200})`,
        goldMove: `Gold Move`,
        smcPro: `SMC Pro + Predictor`,
        lsr: `Liquidity Sweep Reversal`,
        cvd: `Order Flow CVD`,
        livermore: `Livermore Gold Trend`,
        mtfOb: `Multi-Timeframe Order Blocks`,
        sessions: `Market Sessions`,
        nextProjection: `Next-Candle Projection`,
        volume: `Volume (MA ${state.indicatorSettings?.volMaLen ?? 20})`,
        vwap: `VWAP (${state.indicatorSettings?.vwapAnchor || 'Session'})`,
        macdHs: `MACD H&S Breakout`,
        londonBreakout: `London Breakout`,
        btcTurtle: `BTC Turtle Breakout (H4)`,
        bollinger: `BB (${state.indicatorSettings?.bbLength ?? 20}, ${state.indicatorSettings?.bbMult ?? 2})`,
        movingAvg: [0, 1, 2].map(k => maLine(state.indicatorSettings || {}, k)).filter(L => L.on).map(L => `${L.type} ${L.len}`).join(' · ') || 'Moving Average',
        ichimoku: `Ichimoku (${state.indicatorSettings?.ichTenkan ?? 9}, ${state.indicatorSettings?.ichKijun ?? 26}, ${state.indicatorSettings?.ichSenkouB ?? 52}, ${state.indicatorSettings?.ichDisplacement ?? 26})`,
        whalePulse: `Whale Pulse (${state.indicatorSettings?.wpLookback ?? 20})`,
    };
    // Only chart indicators with a label are listed (e.g. tradersInterest is a
    // sidebar widget, not a chart overlay — it used to show as an empty row).
    const appliedIndicators = Object.keys(state.indicators).filter(k => state.indicators[k] && titleMap[k]);
    // Footprint data precision for the legend (e.g. "1s + 1m", row size)
    const fpInfo = state.chartType === 'footprint' ? footprintSourceSummary(dataset) : null;

    // Collapsible applied-indicator list (remembered per browser)
    const [legendCollapsed, setLegendCollapsed] = useState(() => {
        try { return localStorage.getItem('indicatorLegendCollapsed') === '1'; } catch { return false; }
    });
    const toggleLegend = () => {
        setLegendCollapsed(prev => {
            const next = !prev;
            try { localStorage.setItem('indicatorLegendCollapsed', next ? '1' : '0'); } catch { /* storage unavailable */ }
            return next;
        });
    };

    const removeIndicator = (ind) => {
        setState(prev => ({
            ...prev,
            indicators: { ...prev.indicators, [ind]: false },
            hiddenIndicators: { ...prev.hiddenIndicators, [ind]: false },
        }));
    };

    const toggleHide = (ind) => {
        setState(prev => ({
            ...prev,
            hiddenIndicators: {
                ...prev.hiddenIndicators,
                [ind]: !prev.hiddenIndicators?.[ind]
            }
        }));
    };



    return (
        <div ref={wrapperRef} data-chart-area className="w-full h-full relative group" onContextMenu={onChartContextMenu}>
            {ctxMenu && (
                <ChartContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems(ctxMenu.info)} onClose={closeCtxMenu}
                    bounds={{ width: wrapperRef.current?.clientWidth || 800, height: wrapperRef.current?.clientHeight || 600 }} />
            )}
            {flash && (
                <div role="status" className="absolute z-[80] left-1/2 -translate-x-1/2 top-3 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-lg ts-pop-in pointer-events-none">{flash}</div>
            )}
            {isRendering && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-darkbg/50 backdrop-blur-sm z-50">
                    <div className="flex items-center space-x-2 text-indigo-500 dark:text-indigo-400">
                        <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="font-semibold drop-shadow-sm">Rendering...</span>
                    </div>
                </div>
            )}
            <canvas ref={canvasRef} className="block absolute inset-0 z-0 bg-white dark:bg-darkbg" style={{ outline: 'none', touchAction: 'none' }} tabIndex={0} />
            <canvas ref={crosshairRef} data-snapshot-skip className="block absolute inset-0 z-[5] pointer-events-none" style={{ outline: 'none' }} />


            <div className="y-axis-overlay absolute right-0 top-[15px] w-[60px] z-10 cursor-ns-resize" style={{ bottom: '50px' }}></div>
            <div className="x-axis-overlay absolute left-[25px] bottom-[0px] h-[50px] z-10 cursor-ew-resize" style={{ right: '60px' }}></div>

            {/* We will overlay indicators using absolute positioning if needed, or keep them in DOM for now */}
            <div className="absolute top-2 left-2 flex flex-col gap-0.5 z-20 pointer-events-none">
                {/* Active Symbol & Timeframe */}
                <div className="flex items-center gap-1.5 pointer-events-auto w-max max-w-[calc(100vw-5rem)] flex-wrap px-1.5 py-0.5 mb-0.5 bg-white/75 dark:bg-darkbg/70 backdrop-blur-[2px] rounded">
                    <span className="text-xs font-black text-slate-800 dark:text-slate-200 drop-shadow-sm tracking-tight">
                        {state.symbol}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        • {
                            {1: '1m', 5: '5m', 15: '15m', 30: '30m', 45: '45m', 60: '1H', 240: '4H', 1440: '1D'}[state.timeframe] || `${state.timeframe}m`
                        }
                    </span>
                    {state.chartType === 'footprint' && fpInfo && (
                        <span
                            className="text-[10px] font-medium text-slate-500 dark:text-slate-400"
                            title="Recent candles use 1-second data built from MT5 ticks when available; older candles use the chart's 1-minute bars."
                        >
                            · Footprint {fpInfo.sources.join(' + ')} data · row {fpInfo.row} ({fpInfo.ticksPerRow} ticks)
                        </span>
                    )}
                    {state.chartType === 'footprint' && fpInfo?.coarse && (
                        <span
                            className="text-[10px] font-medium text-amber-500"
                            title="Each candle is a single lower-timeframe bar, so volume can't be split across price levels. With MT5 tick data (1s) or a higher timeframe (5m+) the footprint shows the real distribution."
                        >
                            · Approximate: no tick data for this timeframe — use 5m+ or MT5
                        </span>
                    )}
                    {appliedIndicators.length > 0 && (
                        <button
                            onClick={toggleLegend}
                            aria-expanded={!legendCollapsed}
                            title={legendCollapsed ? 'Show indicator list' : 'Hide indicator list'}
                            className="ts-tap flex items-center gap-0.5 ml-1 px-1 py-0.5 rounded text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors"
                        >
                            {legendCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {legendCollapsed && <span>{appliedIndicators.length} indicator{appliedIndicators.length > 1 ? 's' : ''}</span>}
                        </button>
                    )}
                </div>
                
                {!legendCollapsed && appliedIndicators.map(ind => {
                    const isHidden = state.hiddenIndicators?.[ind];
                    return (
                        <div key={ind} className={`flex items-center gap-2 ${isTouchDevice ? '' : 'group/ind'} pointer-events-auto w-max px-1.5 py-px bg-white/75 dark:bg-darkbg/70 backdrop-blur-[2px] rounded`}>
                            <span className={`text-[11px] font-semibold ${isHidden ? 'text-slate-500 dark:text-slate-400 line-through' : 'text-slate-700 dark:text-slate-300'}`}>
                                {titleMap[ind]}
                            </span>
                            <div className={`${isTouchDevice ? 'flex' : 'opacity-0 group-hover/ind:opacity-100 flex'} items-center gap-1 transition-all`}>
                                <button
                                    onClick={() => toggleHide(ind)}
                                    className="ts-tap text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5"
                                    title={isHidden ? "Show" : "Hide"}
                                >
                                    {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </button>
                                <button
                                    onClick={() => setActiveSettings(ind)}
                                    className="ts-tap text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5"
                                    title="Settings"
                                >
                                    <Settings2 className="w-3 h-3" />
                                </button>
                            </div>
                            {/* Remove from the chart (same as unticking it in Indicators) */}
                            <button
                                onClick={() => removeIndicator(ind)}
                                className="ts-tap text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-0.5 -ml-1 rounded"
                                title={`Remove ${titleMap[ind]}`}
                                aria-label={`Remove ${titleMap[ind]}`}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Algo trading: this chart feeds signals to N broker accounts */}
            {algoAccounts > 0 && (
                <div className="absolute bottom-14 left-3 z-20 pointer-events-none">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-white/85 dark:bg-darkbg/80 backdrop-blur-[2px] border border-emerald-500/40 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Algo on · {algoAccounts} account{algoAccounts > 1 ? 's' : ''}
                    </div>
                </div>
            )}

            {/* Million Moves Dashboard */}
            {state.indicators.goldMove && state.indicatorSettings?.gmShowDashboard && (
                <MillionMovesDashboardWidget state={state} />
            )}

            {/* Bottom Right Controls */}
            <div className="absolute bottom-8 right-4 flex gap-2 z-10">
                {canScrollRight && (
                    <button
                        onClick={handleScrollRight}
                        className="bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded-full shadow-md border border-slate-200 dark:border-slate-700 backdrop-blur transition-all"
                        title="Scroll to most recent"
                    >
                        <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                )}

                <button
                    onClick={() => handleZoomLatest(1 / 1.5)}
                    className="bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded-full shadow-md border border-slate-200 dark:border-slate-700 backdrop-blur transition-all"
                    title="Zoom out"
                    aria-label="Zoom out"
                >
                    <ZoomOut className="w-3.5 h-3.5" />
                </button>

                <button
                    onClick={() => handleZoomLatest(1.5)}
                    className="bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded-full shadow-md border border-slate-200 dark:border-slate-700 backdrop-blur transition-all"
                    title="Zoom in on current candle"
                    aria-label="Zoom in on current candle"
                >
                    <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <button
                    onClick={handleAutoToggle}
                    className={`p-1 rounded-full shadow-md border backdrop-blur transition-all ${isAutoScaled
                        ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30'
                        : 'bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 border-slate-200 dark:border-slate-700'
                        }`}
                    title="Toggle Auto Scale (Double-click Y-Axis to enable)"
                >
                    <Crosshair className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Bottom Toolbar (Date Range & Time) */}
            <div className="absolute bottom-0 left-0 right-0 h-6 px-2 flex items-center justify-between text-[10px] font-medium text-slate-500 bg-white/50 dark:bg-darkbg/50 backdrop-blur z-20 pointer-events-auto border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center space-x-3">
                    {['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'].map(range => (
                        <button
                            key={range}
                            onClick={() => handleZoomTo(range)}
                            className={`ts-tap transition-colors ${activeRange === range ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'hover:text-indigo-600 dark:hover:text-indigo-400'}`}
                        >
                            {range}
                        </button>
                    ))}
                </div>

                <LiveClock />
            </div>

            <IndicatorSettingsModal
                activeIndicator={activeSettings}
                state={state}
                setState={setState}
                onClose={() => setActiveSettings(null)}
            />
        </div>
    );
}
