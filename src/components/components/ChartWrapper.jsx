import BoatLoader from './BoatLoader';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';



import { useMarketWebSocket } from '../hooks/useMarketWebSocket';







// Maximum candles held in React state (dataset). Older candles beyond this limit



// are evicted from the front to keep memory usage bounded.



const MAX_DATASET_CANDLES = 15000;







// Minimum milliseconds between live-poll aggregations used in HTTP-fallback mode.



const POLL_INTERVAL_MS = 30000; // 30s between HTTP fallback refreshes



import ChartArea from './ChartArea';
import OceanChart from './OceanChart';
import { FloatingProjection } from './ProjectionCard';



import { fetchTwelveData } from '../utils/api';
import { fetchCalendar } from '../utils/marketContext';



import DataWorker from '../workers/dataWorker?worker';



import { Clock, ChevronDown, Wifi, WifiOff } from 'lucide-react';



import DOMPanel from './DOMPanel';



import { useDispatch, useSelector, useStore } from 'react-redux';



import { setChartCache, prependChartCache } from '../store/chartDataSlice';







// One base (raw) interval per timeframe, shared by the HTTP load, the WS feed and
// the raw-data cache. Timeframes with the same base (e.g. 1m–45m all use 1min)
// reuse the same raw candles, so switching between them is an instant re-aggregate.
function baseIntervalFor(tf) {
    if (tf >= 1440) return '1h';
    if (tf >= 240) return '15min';
    if (tf >= 60) return '5min';
    return '1min';
}
const baseCacheKey = (symbol, tf) => `base:${symbol}_${baseIntervalFor(tf)}`;
// Base-interval prefetches in flight, shared across chart panels.
const prefetchInFlight = new Set();

// Merge live candles into a raw candle array (replace same-time, append newer).
function mergeCandles(existing, incoming, maxLen) {
    let merged = [...existing];
    incoming.forEach(nc => {
        const idx = merged.findLastIndex(c => c.time === nc.time);   // live candles are at the end
        if (idx >= 0) merged[idx] = nc;
        else if (nc.time > merged[merged.length - 1].time) merged.push(nc);
    });
    if (merged.length > maxLen) merged = merged.slice(-maxLen);
    return merged;
}

// Memoized: App re-renders often (sidebar data, polling); a chart only needs to
// re-render when its own props change — important with several chart tabs.
export default React.memo(ChartWrapper);

// background: this chart's tab is not on screen (it keeps running so its
// notifications fire, but recalculates less often).
function ChartWrapper({ symbol, initialTimeframe, state, setState, layoutIndex, onRawData, onDataset, refreshCounter, addTrade, activePositions, tradingEnabled = true, background = false }) {



    const [localTimeframe, setLocalTimeframe] = useState(initialTimeframe);



    const [showTimeframeDropdown, setShowTimeframeDropdown] = useState(false);



    const dropdownRef = useRef(null);



    const dispatch = useDispatch();



    // Re-render only when THIS chart's candles change. Subscribing to the whole
    // cache re-rendered every chart (all chart tabs) on every other chart's live
    // update — work that grew with the square of the number of charts.
    const reduxStore = useStore();
    const getCache = useCallback(() => reduxStore.getState().chartData.cache, [reduxStore]);
    const chartDataCache = getCache();   // as of this render
    // Always-current cache for callbacks and async code (never a stale snapshot)
    const chartDataCacheRef = useMemo(() => ({ get current() { return reduxStore.getState().chartData.cache; } }), [reduxStore]);



    



    useEffect(() => {



        setLocalTimeframe(initialTimeframe);



    }, [initialTimeframe]);







    const timeframe = localTimeframe;
    // Re-render when this chart's own candles change (see getCache above)
    useSelector(st => st.chartData.cache[`${symbol}_${timeframe}`]);







    const [dataset, setDataset] = useState([]);



    const [loading, setLoading] = useState(false);



    const [historicalLoading, setHistoricalLoading] = useState(false);



    const [error, setError] = useState(null);



    const workerRef = useRef(null);
    // Job coalescing state for the aggregation worker (see dispatchWorker)
    const workerBusyRef = useRef(false);
    const workerPendingRef = useRef(null);
    const workerInFlightKeyRef = useRef(null); // symbol_timeframe of the running job



    const prevSymbolRef = useRef(symbol);



    const prevTimeframeRef = useRef(initialTimeframe);



    // Timestamp of the last successful live-poll worker dispatch



    const lastPollRef = useRef(0);



    // WebSocket state — falls back to HTTP poll automatically
    const [httpFallbackActive, setHttpFallbackActive] = useState(false);

    // Live tick price — updated every ~1s from WS TICK_UPDATE.
    // Used by canvasChartEngine to update the price label without re-aggregating.
    // Live tick price feed. Ticks arrive every ~0.5s; routing them through React
    // state re-rendered this whole subtree and rebuilt the canvas on every tick.
    // ChartArea subscribes and just redraws the price label (once per frame).
    const livePriceFeed = useMemo(() => {
        let price = 0;
        const subs = new Set();
        return {
            get: () => price,
            set: (p) => { if (p === price) return; price = p; subs.forEach(fn => fn(p)); },
            subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
        };
    }, []);

    // Cache key for current symbol+timeframe — updated before WS connects so onHistory can use it
    const cacheKeyRef = useRef(`${symbol}_${timeframe}`);
    const baseKeyRef = useRef(baseCacheKey(symbol, timeframe));
    useEffect(() => { cacheKeyRef.current = `${symbol}_${timeframe}`; baseKeyRef.current = baseCacheKey(symbol, timeframe); }, [symbol, timeframe]);

    useEffect(() => {



        workerRef.current = new DataWorker();
        // Fresh worker: jobs posted to a terminated worker will never be answered
        workerBusyRef.current = false;
        workerPendingRef.current = null;
        workerInFlightKeyRef.current = null;



        return () => { if (workerRef.current) workerRef.current.terminate(); };



    }, []);







    // Separate worker dedicated to historical page loads — avoids racing with the main worker



    const histWorkerRef = useRef(null);



    useEffect(() => {



        histWorkerRef.current = new DataWorker();



        return () => { if (histWorkerRef.current) histWorkerRef.current.terminate(); };



    }, []);    // ── Stable refs for values that change frequently but don't need function recreation ──



    // This breaks the dep chain: state.indicatorSettings → dispatchWorker → loadData → effects



    const indicatorSettingsRef = useRef(state.indicatorSettings);



    const tickSizeRef = useRef(state.tickSize);
    // Footprint rows are only built when the footprint chart is shown (main chart
    // only — split layouts show candlesticks in the other panels)
    const footprintOn = state.chartType === 'footprint' && layoutIndex === 0;
    const footprintRef = useRef(footprintOn);
    footprintRef.current = footprintOn;
    const fpSettingsRef = useRef(state.footprintSettings);
    fpSettingsRef.current = state.footprintSettings;
    // 1-second intrabar bars from MT5 ticks for recent candles (null when unavailable)
    const intrabarRef = useRef(null);
    // 1-minute intrabar bars for 1H+ footprints (their base bars are 5m/15m/1h)
    const intrabar1mRef = useRef(null);
    // Auto row size, fixed once per symbol/timeframe/ATR settings (TradingView
    // computes it when the chart type, symbol or timeframe is selected)
    const fixedRowRef = useRef({ key: null, row: null });
    const fpRowKey = () => {
        const fs = fpSettingsRef.current || {};
        return `${symbol}_${timeframe}_${fs.rowMode || 'auto'}_${fs.atrLength ?? 14}`;
    };



    const brokerContextRef = useRef(state.brokerContext);



    useEffect(() => { indicatorSettingsRef.current = state.indicatorSettings; }, [state.indicatorSettings]);
    // Future-candle projection is only calculated while it is switched on
    const projectionOn = !!state.indicators?.nextProjection;
    const projectionRef = useRef(projectionOn);
    projectionRef.current = projectionOn;
    // Pressure Chart (Pro): zones / signals are calculated in the worker while it is shown
    const pressureOn = state.chartType === 'pressure' || state.chartType === 'ocean';   // ocean view draws the pressure analysis
    const pressureRef = useRef(pressureOn);
    pressureRef.current = pressureOn;
    const newsRef = useRef([]);          // high-impact USD event times (signal news filter)



    useEffect(() => { tickSizeRef.current = state.tickSize; }, [state.tickSize]);



    useEffect(() => { brokerContextRef.current = state.brokerContext; }, [state.brokerContext]);







    // ── Shared worker dispatch ────────────────────────────────────────────────



    // Uses refs for settings/tickSize so this function is STABLE (never recreates



    // unless timeframe or onDataset changes). This stops the cascade:



    //   state.indicatorSettings changes → dispatchWorker recreates → loadData



    //   recreates → fallback effect re-fires → repeated full HTTP fetches.




    const dispatchWorker = useCallback((rawData) => {
        if (!workerRef.current || !rawData || rawData.length === 0) return;

        const jobKey = `${symbol}_${timeframe}`;
        const message = {
            type: 'AGGREGATE',
            payload: {
                rawData,
                timeframe,
                tickSize: tickSizeRef.current,
                indicatorSettings: indicatorSettingsRef.current,
                footprint: footprintRef.current,
                footprintSettings: fpSettingsRef.current,
                intrabar: footprintRef.current ? intrabarRef.current : null,
                intrabar1m: footprintRef.current ? intrabar1mRef.current : null,
                fixedRow: footprintRef.current && fixedRowRef.current.key === fpRowKey() ? fixedRowRef.current.row : null,
                projection: projectionRef.current,
                pressure: pressureRef.current,
                news: pressureRef.current ? newsRef.current : null,
                symbol,
            }
        };

        workerRef.current.onmessage = (e) => {
            const { type, payload } = e.data;
            workerBusyRef.current = false;
            const resultKey = workerInFlightKeyRef.current;

            // Start the newest waiting job (if any) right away.
            if (workerPendingRef.current) {
                const next = workerPendingRef.current;
                workerPendingRef.current = null;
                workerBusyRef.current = true;
                workerInFlightKeyRef.current = next.key;
                workerRef.current.postMessage(next.message);
            }

            // Show this result if it belongs to the chart on screen — even when a
            // newer job is queued (it's valid, just a moment older). Dropping it
            // in that case starved the chart when updates arrived faster than a
            // calculation finished (loader forever). Only results for a previous
            // symbol/timeframe are discarded.
            if (resultKey !== cacheKeyRef.current) return;

            if (type === 'AGGREGATE_DONE') {
                // Remember the first Auto row size for this symbol/timeframe
                const lastFp = footprintRef.current && payload.length ? payload[payload.length - 1].fp : null;
                if (lastFp && fixedRowRef.current.key !== fpRowKey()) {
                    fixedRowRef.current = { key: fpRowKey(), row: { row: lastFp.row, tick: lastFp.tick, ticksPerRow: lastFp.ticksPerRow } };
                }
                setDataset(payload);
                if (onDataset) onDataset(payload);
                setLoading(false);
            } else if (type === 'ERROR') {
                setError(payload);
                setLoading(false);
            }
        };

        // Coalesce: at most one job runs at a time and only the latest waiting job
        // is kept. Live ticks can arrive faster than an aggregation finishes
        // (~0.5s), and a plain FIFO queue would make a timeframe switch wait
        // behind every queued tick.
        if (workerBusyRef.current) {
            workerPendingRef.current = { message, key: jobKey };
            return;
        }
        workerBusyRef.current = true;
        workerInFlightKeyRef.current = jobKey;
        workerRef.current.postMessage(message);
    }, [symbol, timeframe, onDataset]); // ← stable: no state.* objects in deps







    // ── WebSocket live update handler ─────────────────────────────────────────



    // chartDataCache removed from deps — we read it via the Redux selector directly.



    // dispatchWorker is now stable, so handleWsUpdate is also stable.



    // Live candle updates can arrive every ~0.5s. Re-running every indicator on the
    // whole dataset (worker) and rebuilding the chart that often saturated the
    // main thread (stutter while panning). The live price/current candle is drawn
    // from the tick feed anyway, so full recalculation runs at most every 2s —
    // immediately when a new candle opens — always with the latest data.
    // Background chart tabs: every 10s (a new candle still recalculates at once)
    const AGG_THROTTLE_MS = background ? 10000 : 2000;
    const lastAggAtRef = useRef(0);
    const aggTimerRef = useRef(null);
    const latestRawRef = useRef(null);
    const scheduleAggregate = useCallback((raw, immediate) => {
        latestRawRef.current = raw;
        const run = () => {
            aggTimerRef.current = null;
            lastAggAtRef.current = Date.now();
            dispatchWorker(latestRawRef.current);
        };
        const wait = AGG_THROTTLE_MS - (Date.now() - lastAggAtRef.current);
        if (immediate || wait <= 0) {
            clearTimeout(aggTimerRef.current);
            run();
        } else if (!aggTimerRef.current) {
            aggTimerRef.current = setTimeout(run, wait);
        }
    }, [dispatchWorker, AGG_THROTTLE_MS]);
    // A pending throttled run belongs to the old symbol/timeframe — drop it.
    useEffect(() => () => {
        clearTimeout(aggTimerRef.current);
        aggTimerRef.current = null;
    }, [symbol, timeframe]);

    const handleWsUpdate = useCallback((incomingCandles) => {
        const cacheKey = `${symbol}_${timeframe}`;
        const baseKey = baseCacheKey(symbol, timeframe);
        // Read the live cache (another chart tab may have just updated the shared base data)
        const cache = getCache();
        const cachedRaw = cache[cacheKey];
        if (!cachedRaw || cachedRaw.length === 0) return;

        const merged = mergeCandles(cachedRaw, incomingCandles, MAX_DATASET_CANDLES);
        if (onRawData) onRawData(merged);
        dispatch(setChartCache({ key: cacheKey, data: merged }));
        // Keep the shared base-interval cache live too (without this timeframe's
        // scroll-back history), so other timeframes on the same base start fresh.
        const baseRaw = getCache()[baseKey];
        if (baseRaw && baseRaw.length > 0) {
            dispatch(setChartCache({ key: baseKey, data: mergeCandles(baseRaw, incomingCandles, MAX_DATASET_CANDLES) }));
        }
        // New candle opened → recalculate now; otherwise throttle (see scheduleAggregate)
        const newBar = merged[merged.length - 1].time > cachedRaw[cachedRaw.length - 1].time;
        scheduleAggregate(merged, newBar);
    }, [symbol, timeframe, getCache, dispatch, onRawData, scheduleAggregate]);

    // WebSocket interval string — same base interval as the HTTP load, so live
    // candles merge into raw data of the same resolution.
    const wsInterval = baseIntervalFor(timeframe);







    const { isConnected: wsConnected, sendHistoryRequest } = useMarketWebSocket({
        onHistory: (historyData) => {
            console.log(`[WS History] Received ${historyData.length} candles`);
            if (onRawData) onRawData(historyData);
            dispatch(setChartCache({ key: cacheKeyRef.current, data: historyData }));
            dispatch(setChartCache({ key: baseKeyRef.current, data: historyData }));
            // Keep the loader up until the worker has produced the aggregated
            // dataset (it clears `loading` itself) — clearing it here left a
            // blank chart with no loader while aggregation was still running.
            if (historyData.length > 0) dispatchWorker(historyData);
            else setLoading(false);
        },



        symbol,



        interval: wsInterval,



        onUpdate: handleWsUpdate,



        // onTick: TICK_UPDATE arrives every 1s from backend.









        onTick: ({ price }) => { if (price > 0) livePriceFeed.set(price); },



        onFallback: () => setHttpFallbackActive(true),



        enabled: true,



    });








    const cacheKey = `${symbol}_${timeframe}`;
    const baseKey = baseCacheKey(symbol, timeframe);

    const loadData = useCallback(async (isInitial = false) => {
        const isNewChart = prevSymbolRef.current !== symbol || prevTimeframeRef.current !== timeframe;
        const baseInterval = baseIntervalFor(timeframe);

        // Only show loading spinner + clear chart on a genuine new symbol/timeframe.
        // Background refreshes must NOT flash the loading state or blank the chart.
        let hasCache = false;
        if (isNewChart) {
            // Reuse raw candles from this timeframe, or from any timeframe that shares
            // the same base interval (e.g. 15m → 5m both aggregate 1min data).
            let cachedRaw = getCache()[cacheKey];
            if (!cachedRaw || cachedRaw.length === 0) {
                cachedRaw = getCache()[baseKey];
                if (cachedRaw && cachedRaw.length > 0) {
                    dispatch(setChartCache({ key: cacheKey, data: cachedRaw }));
                }
            }
            hasCache = !!(cachedRaw && cachedRaw.length > 0);

            setError(null);
            // Clear the previous timeframe's candles; the re-aggregated data paints as
            // soon as the worker finishes. No loader overlay when we have a cache.
            setDataset([]);
            if (prevSymbolRef.current !== symbol) livePriceFeed.set(0); // reset on new symbol
            if (hasCache) {
                console.log(`[ChartWrapper] Using cached data for ${cacheKey} (${cachedRaw.length} candles)`);
                if (onRawData) onRawData(cachedRaw);
                setLoading(false);
                dispatchWorker(cachedRaw);
            } else {
                setLoading(true);
            }
        }

        prevSymbolRef.current = symbol;
        prevTimeframeRef.current = timeframe;

        try {
            const cachedRaw = getCache()[cacheKey];
            if (!isNewChart && cachedRaw && cachedRaw.length > 0) {
                // ── HTTP-fallback refresh (WS unavailable) ─────────────────────
                // Throttle: only run every POLL_INTERVAL_MS (30s).
                // Fetch just 10 latest candles — enough to catch any new closes —
                // merge into cache, and re-aggregate. Zero HTTP when WS is working.
                const now = Date.now();
                if (now - lastPollRef.current < POLL_INTERVAL_MS) return;
                lastPollRef.current = now;

                try {
                    const fresh = await fetchTwelveData(symbol, baseInterval, 10, brokerContextRef.current);
                    const merged = mergeCandles(cachedRaw, fresh, MAX_DATASET_CANDLES);
                    if (onRawData) onRawData(merged);
                    dispatch(setChartCache({ key: cacheKey, data: merged }));
                    const baseRaw = getCache()[baseKey];
                    if (baseRaw && baseRaw.length > 0) {
                        dispatch(setChartCache({ key: baseKey, data: mergeCandles(baseRaw, fresh, MAX_DATASET_CANDLES) }));
                    }
                    dispatchWorker(merged);
                } catch (e) {
                    // Network error — re-aggregate with what we have
                    console.warn('[Fallback poll] fetch failed, using cache:', e.message);
                    dispatchWorker(cachedRaw);
                }

            } else if (hasCache) {
                // Served from cache — live WS updates keep it fresh, nothing to fetch.
            } else if (wsConnected) {
                // WebSocket connected — ask for history explicitly. The socket only
                // auto-requests history when it (re)connects, which doesn't happen
                // when the new timeframe uses the same WS interval as the old one.
                // (If the interval did change, the socket is reconnecting and its
                // onopen handler sends the request instead; this call is a no-op.)
                if (!isNewChart) setLoading(true);
                sendHistoryRequest(5000);
            } else {
                // Fallback: HTTP initial load (WS not connected)
                // Initial full load — fetch 5000 candles via HTTP once per base interval.
                // All live updates after this come from WebSocket (CANDLES_UPDATE).
                if (!isNewChart) setLoading(true);
                const rawData = await fetchTwelveData(symbol, baseInterval, 5000, brokerContextRef.current);
                if (onRawData) onRawData(rawData);
                dispatch(setChartCache({ key: cacheKey, data: rawData }));
                dispatch(setChartCache({ key: baseKey, data: rawData }));
                dispatchWorker(rawData);
            }
        } catch (e) {
            console.error(e);
            if (symbol.toUpperCase() === 'GOLD') {
                setState(prev => ({ ...prev, symbol: 'XAU/USD' }));
                return;
            }
            setError(e.message || e.toString());
            setLoading(false);
        }
    }, [symbol, timeframe, getCache, dispatch, onRawData, dispatchWorker, setState, wsConnected, sendHistoryRequest]);

    // Background prefetch: once this chart has data, quietly fetch the other base
    // intervals for the symbol so switching to a timeframe in another group
    // (e.g. 15m → 1H → 4H → 1D) paints from cache instead of showing the loader.
    // Any staleness is corrected when the WS for that interval connects and
    // sends fresh history.
    const hasData = dataset.length > 0;
    useEffect(() => {
        if (!hasData) return;
        let cancelled = false;
        const run = async () => {
            for (const tf of [1, 60, 240, 1440]) {
                if (cancelled) return;
                const key = baseCacheKey(symbol, tf);
                if (key === baseCacheKey(symbol, timeframe)) continue;
                if (prefetchInFlight.has(key) || chartDataCacheRef.current[key]?.length) continue;
                prefetchInFlight.add(key);
                try {
                    const raw = await fetchTwelveData(symbol, baseIntervalFor(tf), 5000, brokerContextRef.current);
                    if (raw && raw.length > 0 && !chartDataCacheRef.current[key]?.length) {
                        dispatch(setChartCache({ key, data: raw }));
                    }
                } catch {
                    // Non-fatal: that timeframe will just load normally when selected
                } finally {
                    prefetchInFlight.delete(key);
                }
            }
        };
        const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500));
        const cancelIdle = window.cancelIdleCallback || clearTimeout;
        const handle = idle(() => { run(); }, { timeout: 5000 });
        return () => { cancelled = true; cancelIdle(handle); };
    }, [symbol, hasData, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

    // Full HTTP fetch — only when symbol / timeframe / tickSize primitive changes.



    // Uses a stable loadDataRef so this effect never re-fires due to loadData recreation.



    const loadDataRef = useRef(loadData);



    useEffect(() => { loadDataRef.current = loadData; }, [loadData]);







    useEffect(() => {



        loadDataRef.current(true);



    // eslint-disable-next-line react-hooks/exhaustive-deps



    }, [symbol, timeframe, state.tickSize]);







    // Settings-only re-aggregation: re-run worker on cached data when settings change.



    // No HTTP call. Uses JSON.stringify to detect actual value changes (not ref changes).



    const prevSettingsJsonRef = useRef('');



    useEffect(() => {



        const json = JSON.stringify(state.indicatorSettings);



        if (json === prevSettingsJsonRef.current) return; // no actual change



        prevSettingsJsonRef.current = json;



        const cacheKey = `${symbol}_${timeframe}`;



        const cachedRaw = chartDataCache[cacheKey];



        if (!cachedRaw || cachedRaw.length === 0) return;



        dispatchWorker(cachedRaw);



    // eslint-disable-next-line react-hooks/exhaustive-deps



    }, [state.indicatorSettings]);

    // Projection switched on → calculate it now (not at the next data update)
    const prevProjectionRef = useRef(projectionOn);
    useEffect(() => {
        if (prevProjectionRef.current === projectionOn) return;
        prevProjectionRef.current = projectionOn;
        if (!projectionOn) return;
        const raw = chartDataCache[`${symbol}_${timeframe}`];
        if (raw && raw.length > 0) dispatchWorker(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectionOn]);

    // Pressure Chart switched on/off → recalculate; while on, keep the news times
    // for its "no signal 15 min around high-impact USD news" rule
    const prevPressureRef = useRef(pressureOn);
    useEffect(() => {
        if (prevPressureRef.current !== pressureOn) {
            prevPressureRef.current = pressureOn;
            const raw = chartDataCache[`${symbol}_${timeframe}`];
            if (raw && raw.length > 0) dispatchWorker(raw);
        }
        if (!pressureOn) return undefined;
        let cancelled = false;
        const load = () => fetchCalendar(symbol)
            .then(d => { if (!cancelled) newsRef.current = (d.events || []).filter(e => e.impact === 'High' && (e.cur === 'USD' || e.cur === 'All')).map(e => e.t); })
            .catch(() => {});
        load();
        const timer = setInterval(load, 15 * 60000);
        return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pressureOn, symbol]);

    // Footprint switched on/off or a calculation setting changed → recalculate.
    // (Display-only settings just redraw.)
    const fpS = state.footprintSettings || {};
    const footprintKey = footprintOn
        ? JSON.stringify([fpS.rowMode, fpS.atrLength, fpS.ticksPerRow, fpS.vaPct, fpS.imbalancePct, fpS.stackedLevels])
        : 'off';
    const prevFootprintKeyRef = useRef(footprintKey);
    useEffect(() => {
        if (prevFootprintKeyRef.current === footprintKey) return;
        prevFootprintKeyRef.current = footprintKey;
        const raw = chartDataCache[`${symbol}_${timeframe}`];
        if (raw && raw.length > 0) dispatchWorker(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [footprintKey]);

    // ── Intrabar (1-second) data for the footprint ───────────────────────────
    // Like TradingView, recent candles use the finest data available: 1-second
    // bars built from MT5 ticks. Older candles (and setups without MT5 ticks)
    // fall back to the chart's 1-minute bars. A short tail is merged every 10s.
    useEffect(() => {
        intrabarRef.current = null;
        if (!footprintOn) return;
        let cancelled = false;
        const apiSymbol = symbol.replace('/', '');
        const windowMin = Math.min(720, Math.max(60, timeframe * 120));
        const trim = (d) => {
            const cutoff = d.t[d.t.length - 1] - windowMin * 60000;
            let i = 0;
            while (i < d.t.length && d.t[i] < cutoff) i++;
            if (i === 0) return d;
            return { t: d.t.slice(i), o: d.o.slice(i), h: d.h.slice(i), l: d.l.slice(i), c: d.c.slice(i), v: d.v.slice(i) };
        };
        const merge = (old, fresh) => {
            if (!old || !old.t.length) return fresh;
            let keep = old.t.length;
            while (keep > 0 && old.t[keep - 1] >= fresh.t[0]) keep--;
            const cat = (k) => old[k].slice(0, keep).concat(fresh[k]);
            return { t: cat('t'), o: cat('o'), h: cat('h'), l: cat('l'), c: cat('c'), v: cat('v') };
        };
        const load = async (minutes, initial) => {
            try {
                const res = await fetch(`/api/footprint/intrabar?symbol=${encodeURIComponent(apiSymbol)}&minutes=${minutes}`);
                if (!res.ok || cancelled) return;
                const d = await res.json();
                if (cancelled) return;
                if (!d.available || !d.t || !d.t.length) {
                    if (initial) intrabarRef.current = null;
                    return;
                }
                const fresh = { t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v };
                intrabarRef.current = trim(initial ? fresh : merge(intrabarRef.current, fresh));
                const raw = chartDataCacheRef.current[`${symbol}_${timeframe}`];
                if (raw && raw.length) {
                    if (initial) dispatchWorker(raw);
                    else scheduleAggregate(raw, false);
                }
            } catch { /* intrabar is optional — keep using 1-minute bars */ }
        };
        // Fetch everything since the last 1s bar (plus the current candle), so a
        // gap left while the tab was hidden or the computer slept is filled in
        // instead of those candles falling back to 1-minute bars for good.
        const refresh = () => {
            if (document.hidden) return;
            const last = intrabarRef.current?.t?.length ? intrabarRef.current.t[intrabarRef.current.t.length - 1] : null;
            if (last === null) return;      // no 1s data on this server (e.g. no MT5)
            const gapMin = Math.ceil((Date.now() - last) / 60000);
            load(Math.min(windowMin, Math.max(timeframe * 2 + 2, gapMin + timeframe + 1)), false);
        };
        // Recent 2 h first (shows real tick footprints quickly), then the full window
        // in the background — the server only reads the extra ticks once (cache)
        load(Math.min(windowMin, 120), true).then(() => {
            if (!cancelled && windowMin > 120 && intrabarRef.current) load(windowMin, false);
        });
        const timer = setInterval(refresh, 10000);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
            intrabarRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [footprintOn, symbol, timeframe]);

    // ── 1-minute intrabar layer for 1H+ footprints ───────────────────────────
    // TradingView falls back 1s → 1m → 60m. Our 1H/4H/1D charts aggregate
    // 5m/15m/1h base bars, so candles without 1s data would be coarse: fetch
    // the latest 5000 1-minute bars as a middle layer and refresh the tail.
    useEffect(() => {
        intrabar1mRef.current = null;
        fixedRowRef.current = { key: null, row: null };
        if (!footprintOn || baseIntervalFor(timeframe) === '1min') return;
        let cancelled = false;
        const MAX_BARS = 6000;
        const toCols = (rows) => ({
            t: rows.map(r => r.time), o: rows.map(r => r.open), h: rows.map(r => r.high),
            l: rows.map(r => r.low), c: rows.map(r => r.close), v: rows.map(r => r.volume || 0),
        });
        const merge = (old, fresh) => {
            if (!old || !old.t.length) return fresh;
            let keep = old.t.length;
            while (keep > 0 && old.t[keep - 1] >= fresh.t[0]) keep--;
            const from = Math.max(0, keep + fresh.t.length - MAX_BARS);
            const cat = (k) => old[k].slice(from, keep).concat(fresh[k]);
            return { t: cat('t'), o: cat('o'), h: cat('h'), l: cat('l'), c: cat('c'), v: cat('v') };
        };
        const load = async (limit, initial) => {
            try {
                const rows = await fetchTwelveData(symbol, '1min', limit, brokerContextRef.current);
                if (cancelled || !rows || !rows.length) return;
                const fresh = toCols([...rows].sort((a, b) => a.time - b.time));
                intrabar1mRef.current = initial ? fresh : merge(intrabar1mRef.current, fresh);
                const raw = chartDataCacheRef.current[`${symbol}_${timeframe}`];
                if (raw && raw.length) {
                    if (initial) dispatchWorker(raw);
                    else scheduleAggregate(raw, false);
                }
            } catch { /* optional — candles keep using the base bars */ }
        };
        // Tail refresh covers everything since the last 1m bar (hidden tab / sleep)
        const refresh = () => {
            const d = intrabar1mRef.current;
            if (document.hidden || !d || !d.t.length) return;
            const gapMin = Math.ceil((Date.now() - d.t[d.t.length - 1]) / 60000);
            load(Math.min(5000, Math.max(timeframe * 2 + 5, gapMin + 5)), false);
        };
        load(5000, true);
        const timer = setInterval(refresh, 30000);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
            intrabar1mRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [footprintOn, symbol, timeframe]);







    // HTTP-fallback polling — only fires when WS is unavailable.



    // Uses loadDataRef to avoid loadData being in deps (which would cascade).



    useEffect(() => {



        if (!httpFallbackActive) return;



        loadDataRef.current();



    // eslint-disable-next-line react-hooks/exhaustive-deps



    }, [refreshCounter, httpFallbackActive]);







    const historyBlockedRef = useRef({ oldest: null, until: 0 });

    const loadMoreHistory = useCallback(async () => {



        if (historicalLoading || dataset.length === 0) {



            console.log('[History] Skipped — loading:', historicalLoading, 'dataset empty:', dataset.length === 0);



            return;



        }



        // Backoff: a page that failed / returned nothing isn't re-requested for
        // 60s. Without this, the chart's "oldest candle visible → load more"
        // check re-fired the same failing request in a tight loop.
        const oldestNow = dataset[0].time;
        if (historyBlockedRef.current.oldest === oldestNow && Date.now() < historyBlockedRef.current.until) return;
        const blockHistory = () => { historyBlockedRef.current = { oldest: oldestNow, until: Date.now() + 60000 }; };

        setHistoricalLoading(true);



        const cacheKey = `${symbol}_${timeframe}`;



        try {



            const oldestTime = dataset[0].time;



            // end_date = 1ms before the oldest candle we have (UTC ISO string for backend)



            const endDateStr = new Date(oldestTime - 1).toISOString().replace('T', ' ').substring(0, 19);







            // Pick a base interval that gives enough coverage for each timeframe



            // 5000 candles of base interval must span more than one page of the chart timeframe



            let baseInterval = "1min";      // default: 5000 candles = ~3.5 days



            if (timeframe >= 5)   baseInterval = "5min";   // 5min base: 5000 = ~17 days (3m stays on 1min)



            if (timeframe >= 15)  baseInterval = "15min";  // 15min base: 5000 = ~52 days



            if (timeframe >= 60)  baseInterval = "1h";     // 1h base: 5000 = ~208 days



            if (timeframe >= 240) baseInterval = "4h";     // 4h base: 5000 = ~833 days



            if (timeframe >= 1440) baseInterval = "1day";  // daily base: 5000 = ~13 years







            console.log(`[History] Fetching: symbol=${symbol} tf=${timeframe} baseInterval=${baseInterval} end_date=${endDateStr}`);







            const rawData = await fetchTwelveData(symbol, baseInterval, 5000, state.brokerContext, endDateStr);







            console.log(`[History] Raw data received: ${rawData?.length ?? 0} candles, oldest current candle time: ${new Date(oldestTime).toISOString()}`);







            if (!rawData || rawData.length === 0) {



                console.log('[History] No data returned from API');
            blockHistory();



                setHistoricalLoading(false);



                return;



            }







            const filtered = rawData.filter(c => c.time < oldestTime);



            console.log(`[History] Filtered (before oldest): ${filtered.length} candles`);







            if (filtered.length === 0) {



                console.log('[History] No candles older than current oldest — nothing to prepend');
            blockHistory();



                setHistoricalLoading(false);



                return;



            }







            // Cache the new historical page in Redux



            dispatch(prependChartCache({ key: cacheKey, data: filtered }));







            // Use the dedicated historical worker to avoid racing with the main chart worker



            histWorkerRef.current.onmessage = (e) => {



                const { type, payload } = e.data;



                if (type === 'AGGREGATE_DONE') {



                    console.log(`[History] Worker aggregated: ${payload?.length ?? 0} new candles`);



                    if (payload && payload.length > 0) {



                        setDataset(prev => {



                            // Merge: new older candles first, then existing, dedup by time



                            const existingTimes = new Set(prev.map(c => c.time));



                            const newCandles = payload.filter(c => !existingTimes.has(c.time));



                            const merged = [...newCandles, ...prev];



                            // Cap total candles to avoid runaway memory on deep history scrolls



                            const capped = merged.length > MAX_DATASET_CANDLES ? merged.slice(0, MAX_DATASET_CANDLES) : merged;



                            console.log(`[History] Prepending ${newCandles.length} unique new candles (total was ${prev.length}, now ${capped.length})`);



                            return capped;



                        });



                    }



                    setHistoricalLoading(false);



                } else if (type === 'ERROR') {



                    console.error('[History] Worker error:', payload);



                    setHistoricalLoading(false);



                }



            };







            histWorkerRef.current.postMessage({



                type: 'AGGREGATE',



                payload: {



                    rawData: filtered,



                    timeframe,



                    tickSize: state.tickSize,



                    indicatorSettings: state.indicatorSettings,
                    // Same row size as the chart on screen, so rows stay aligned at the join
                    footprint: footprintRef.current,
                    footprintSettings: dataset[dataset.length - 1]?.fp
                        ? { ...fpSettingsRef.current, rowMode: 'manual', ticksPerRow: dataset[dataset.length - 1].fp.ticksPerRow, projection: false }
                        : fpSettingsRef.current



                }



            });



        } catch (e) {



            console.error('[History] Failed to load history:', e);
            blockHistory();



            setHistoricalLoading(false);



        }



    }, [dataset, historicalLoading, symbol, timeframe, state.tickSize, state.indicatorSettings, dispatch]);

    // Livermore needs weeks of history (EMA 200 on the chart timeframe, daily EMA 50 filter); the
    // initial load of an intraday chart is only ~3.5 days of 1-minute candles. Load one older page
    // (15-minute base on 15m-45m charts ≈ 52 days) once per symbol/timeframe so its signals match
    // the tested strategy from the first view.
    const livermoreWarmRef = useRef('');
    useEffect(() => {
        if (!(state.indicators?.livermore || state.indicators?.btcTurtle) || historicalLoading || dataset.length < 2) return;
        const key = `${symbol}_${timeframe}`;
        if (livermoreWarmRef.current === key) return;
        const days = state.indicators?.btcTurtle ? 150 : 45;   // BTC Turtle: EMA200 + 55-bar channel on H4
        if ((dataset[dataset.length - 1].time - dataset[0].time) / 864e5 >= days) { livermoreWarmRef.current = key; return; }
        livermoreWarmRef.current = key;
        loadMoreHistory();
    }, [state.indicators?.livermore, state.indicators?.btcTurtle, symbol, timeframe, dataset, historicalLoading, loadMoreHistory]);







    // Close dropdown on click outside



    useEffect(() => {



        const handleClickOutside = (event) => {



            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {



                setShowTimeframeDropdown(false);



            }



        };



        document.addEventListener('mousedown', handleClickOutside);



        return () => document.removeEventListener('mousedown', handleClickOutside);



    }, []);







    const timeframes = [



        { label: '1m', value: 1 },



        { label: '5m', value: 5 },



        { label: '15m', value: 15 },



        { label: '30m', value: 30 },



        { label: '45m', value: 45 },



        { label: '1H', value: 60 },



        { label: '4H', value: 240 },



        { label: '1D', value: 1440 }



    ];







    // Stable object identity: a new object every render made ChartArea fully
    // rebuild the canvas chart on any re-render of this component.
    const chartState = useMemo(() => ({
        ...state,
        timeframe,
        chartType: (layoutIndex > 0 && state.chartType === 'footprint') ? 'candlestick' : state.chartType,
    }), [state, timeframe, layoutIndex]);

    return (



        <div className="flex-1 flex flex-col relative w-full h-full overflow-hidden bg-white dark:bg-darkbg border-r border-b border-slate-200 dark:border-slate-800 last:border-r-0">



            {error && (



                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 dark:bg-darkbg/80 backdrop-blur-sm z-50">



                    <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded text-sm max-w-md text-center mb-4">



                        {error}



                    </div>



                    <button 



                        onClick={loadData}



                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow transition-colors font-semibold"



                    >



                        Retry Now



                    </button>



                </div>



            )}



            



            {loading && dataset.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-darkbg z-40">
                    <BoatLoader />
                </div>



            )}











            {state.layout !== 'single' && (



                <div className="absolute top-2 left-2 z-50 flex items-center gap-2" ref={dropdownRef}>



                    <button 



                        onClick={() => setShowTimeframeDropdown(!showTimeframeDropdown)}



                        className="bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center space-x-1"



                    >



                        <span className="font-semibold">{timeframes.find(t => t.value === timeframe)?.label || 'TF'}</span>



                        <ChevronDown size={12} />



                    </button>



                    {/* WebSocket live status indicator */}



                    <span



                        title={wsConnected ? 'Live (WebSocket)' : httpFallbackActive ? 'Polling (HTTP fallback)' : 'Connecting...'}



                        className="flex items-center gap-1 text-[10px] font-medium opacity-70"



                    >



                        {wsConnected



                            ? <Wifi size={11} className="text-emerald-400" />



                            : <WifiOff size={11} className="text-amber-400" />}



                    </span>



                    {showTimeframeDropdown && (



                        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-xl py-1 min-w-[60px]">



                            {timeframes.map(tf => (



                                <button



                                    key={tf.value}



                                    onClick={() => {



                                        setLocalTimeframe(tf.value);



                                        setShowTimeframeDropdown(false);



                                        if (layoutIndex === 0) {



                                            setState(prev => ({ ...prev, timeframe: tf.value }));



                                        }



                                    }}



                                    className={`w-full text-left px-3 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 ${timeframe === tf.value ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-300'}`}



                                >



                                    {tf.label}



                                </button>



                            ))}



                        </div>



                    )}



                </div>



            )}







            {/* Main Area: Chart + Optional DOM */}



            <div className="flex-1 flex flex-row relative w-full h-full overflow-hidden">



                <div className="flex-1 relative">



                    <ChartArea 



                        dataset={dataset} 



                        state={chartState}
                        livePriceFeed={livePriceFeed}



                        setState={setState} 



                        layoutIndex={layoutIndex} 



                        onLoadMore={loadMoreHistory} 
                        tradingEnabled={tradingEnabled}



                        addTrade={addTrade}



                        activePositions={activePositions}



                    />
                    {state.chartType === 'ocean' && <OceanChart dataset={dataset} state={chartState} livePriceFeed={livePriceFeed} />}
                    {layoutIndex === 0 && state.chartType !== 'ocean' && <FloatingProjection dataset={dataset} state={chartState} />}



                </div>



                



                {/* DOM Panel (Only render on main chart if showDOM is true) */}



                {state.showDOM && layoutIndex === 0 && (



                    <DOMPanel symbol={symbol} currentPrice={dataset.length > 0 ? dataset[dataset.length - 1].close : null} tickSize={state.tickSize} />



                )}



            </div>



        </div>



    );



}



