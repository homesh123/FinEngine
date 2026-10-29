import React, { useState, useEffect, useRef } from 'react';
import { useDraggable } from '../hooks/useDraggable';
import { LIVE_MODE } from '../utils/liveMode';
import { fetchTwelveData } from '../utils/api';

const getTwelveDataInterval = (tf) => {
    const m = {
        '1': '1min', '3': '3min', '5': '5min', '15': '15min', '30': '30min', '45': '45min',
        '60': '1h', '120': '2h', '240': '4h', '720': '12h', '1D': '1day', '1W': '1week', '1M': '1month',
        '1440': '1day'
    };
    return m[tf] || '1h';
};

const calculateMetrics = (data) => {
    // Not enough data: unknown (shown as "—"), not a fake bearish / low reading
    if (!data || data.length < 100) return { dir: null, percentVol: null, rsiVal: null };

    // Backend returns data oldest-to-newest already — DO NOT reverse!
    let candles = data.slice();
    let n = candles.length;

    let closes = candles.map(d => parseFloat(d.close));
    let highs = candles.map(d => parseFloat(d.high));
    let lows = candles.map(d => parseFloat(d.low));

    // ---- Pine Script ta.rma equivalent ----
    // RMA(src, len): first valid value at index (firstValid + len - 1) = SMA of first `len` valid values
    // then alpha * src[i] + (1 - alpha) * prev
    const rma = (src, len) => {
        let out = new Array(src.length).fill(NaN);
        // Find first non-NaN index
        let start = 0;
        while (start < src.length && isNaN(src[start])) start++;
        if (start + len > src.length) return out;

        // Initial SMA seed
        let sum = 0;
        for (let i = start; i < start + len; i++) sum += src[i];
        out[start + len - 1] = sum / len;

        // Exponential smoothing
        let alpha = 1 / len;
        for (let i = start + len; i < src.length; i++) {
            out[i] = alpha * src[i] + (1 - alpha) * out[i - 1];
        }
        return out;
    };

    // ---- Pine Script ta.sma equivalent ----
    const sma = (src, len) => {
        let out = new Array(src.length).fill(NaN);
        for (let i = len - 1; i < src.length; i++) {
            if (isNaN(src[i])) continue;
            let sum = 0, valid = true;
            for (let j = 0; j < len; j++) {
                if (isNaN(src[i - j])) { valid = false; break; }
                sum += src[i - j];
            }
            if (valid) out[i] = sum / len;
        }
        return out;
    };

    // ---- Step 1: True Range, +DM, -DM ----
    let tr = new Array(n).fill(0);
    let plusDM = new Array(n).fill(0);
    let minusDM = new Array(n).fill(0);

    tr[0] = highs[0] - lows[0]; // first bar: just range
    for (let i = 1; i < n; i++) {
        tr[i] = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        let up = highs[i] - highs[i - 1];
        let down = lows[i - 1] - lows[i];
        plusDM[i] = (up > down && up > 0) ? up : 0;
        minusDM[i] = (down > up && down > 0) ? down : 0;
    }

    // ---- Step 2: Smooth TR, +DM, -DM with RMA(14) ----
    let trSmooth = rma(tr, 14);
    let pDMSmooth = rma(plusDM, 14);
    let mDMSmooth = rma(minusDM, 14);

    // ---- Step 3: +DI, -DI, DX ----
    let dx = new Array(n).fill(NaN);
    let lastDiPlus = NaN, lastDiMinus = NaN;
    for (let i = 0; i < n; i++) {
        if (isNaN(trSmooth[i]) || trSmooth[i] === 0) continue;
        let diPlus = 100 * pDMSmooth[i] / trSmooth[i];
        let diMinus = 100 * mDMSmooth[i] / trSmooth[i];
        let denom = diPlus + diMinus;
        dx[i] = denom === 0 ? 0 : 100 * Math.abs(diPlus - diMinus) / denom;
        lastDiPlus = diPlus; lastDiMinus = diMinus;
    }

    // ---- Step 4: ADX = RMA(DX, 14) ----
    let adx = rma(dx, 14);

    // ---- Step 5: Median = SMA(ADX, 14) ----
    let median = sma(adx, 14);

    // ---- Step 6: Get latest valid values ----
    let lastAdx = NaN, lastMedian = NaN;
    for (let i = n - 1; i >= 0; i--) { if (!isNaN(adx[i])) { lastAdx = adx[i]; break; } }
    for (let i = n - 1; i >= 0; i--) { if (!isNaN(median[i])) { lastMedian = median[i]; break; } }

    // Trend per Wilder's DMI: ADX measures strength only, the direction comes from
    // +DI vs -DI. (The original "ADX > 1.2 × its average = bullish" rule painted
    // strong DOWN trends green and sideways markets red.)
    //   ADX >= 20 and +DI > -DI → up · ADX >= 20 and -DI > +DI → down · ADX < 20 → range
    let dir = null;
    if (!isNaN(lastAdx) && !isNaN(lastDiPlus) && !isNaN(lastDiMinus)) {
        dir = lastAdx < 20 ? 'range' : lastDiPlus >= lastDiMinus ? 'up' : 'down';
    }
    void lastMedian;   // kept for reference (original threshold); not used for the colour

    // ---- Volatility (ATR-based, matching Pine Script) ----
    let atr10 = rma(tr, 10);
    let atrrArr = atr10.map(v => isNaN(v) ? NaN : 3 * v);
    let smaAtrr = sma(atrrArr, 20);

    // Std dev of atrr over 20
    let lastSmaAtrr = NaN;
    for (let i = n - 1; i >= 0; i--) { if (!isNaN(smaAtrr[i])) { lastSmaAtrr = smaAtrr[i]; break; } }

    let lastAtrr = NaN;
    for (let i = n - 1; i >= 0; i--) { if (!isNaN(atrrArr[i])) { lastAtrr = atrrArr[i]; break; } }

    let percentVol = null;
    if (!isNaN(lastSmaAtrr) && !isNaN(lastAtrr)) {
        // Calculate stdev of atrr over last 20 bars
        let validAtrrEnd = -1;
        for (let i = n - 1; i >= 0; i--) { if (!isNaN(atrrArr[i])) { validAtrrEnd = i; break; } }
        if (validAtrrEnd >= 19) {
            let variance = 0;
            for (let i = validAtrrEnd - 19; i <= validAtrrEnd; i++) {
                variance += Math.pow((isNaN(atrrArr[i]) ? 0 : atrrArr[i]) - lastSmaAtrr, 2);
            }
            let stdAtr = Math.sqrt(variance / 20) * 2;
            let topDev = lastSmaAtrr + stdAtr;
            let bottomDev = lastSmaAtrr - stdAtr;
            let calcDev = topDev === bottomDev ? 0 : (lastAtrr - bottomDev) / (topDev - bottomDev);
            percentVol = 40 * calcDev + 30;
        }
    }

    // ---- RSI ----
    let gains = new Array(n).fill(0);
    let losses = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        let chg = closes[i] - closes[i - 1];
        gains[i] = chg > 0 ? chg : 0;
        losses[i] = chg < 0 ? -chg : 0;
    }
    let avgGain = rma(gains, 14);
    let avgLoss = rma(losses, 14);

    let lastGain = NaN, lastLoss = NaN;
    for (let i = n - 1; i >= 0; i--) { if (!isNaN(avgGain[i])) { lastGain = avgGain[i]; break; } }
    for (let i = n - 1; i >= 0; i--) { if (!isNaN(avgLoss[i])) { lastLoss = avgLoss[i]; break; } }

    let rsiVal = null;
    if (!isNaN(lastGain) && !isNaN(lastLoss)) {
        if (lastLoss === 0) rsiVal = 100;
        else rsiVal = 100 - (100 / (1 + lastGain / lastLoss));
    }

    return {
        dir, adx: lastAdx, diPlus: lastDiPlus, diMinus: lastDiMinus,
        percentVol,
        rsiVal
    };
};

export default function MillionMovesDashboardWidget({ state }) {
    const drag = useDraggable(LIVE_MODE ? 'goldMove-live' : 'goldMove');   // live mode: own position, starts bottom-left
    const [metrics, setMetrics] = useState(null);
    // Phones: start minimised so the dashboard doesn't cover the chart (tap the eye to open)
    const [isMinimized, setIsMinimized] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    const { symbol = "XAU/USD", indicatorSettings = {} } = state;
    const {
        gmShowDashboard,
        gmDashboardLocation,
        gmDashboardSize
    } = indicatorSettings;

    // Stable fetch key — prevents re-running on every indicatorSettings reference change
    const prevFetchKeyRef = useRef('');
    useEffect(() => {
        if (!symbol || !gmShowDashboard) return;
        const fetchKey = JSON.stringify({ symbol, timeframe: state.timeframe });
        if (fetchKey === prevFetchKeyRef.current) {
            // Symbol/TF unchanged — still set up the 60s interval to refresh indicators
        } else {
            prevFetchKeyRef.current = fetchKey;
        }

        let isMounted = true;
        const fetchAll = async () => {
            try {
                const timeframes = ['1', '3', '5', '15', '30', '60', '120', '240', '720', '1D'];
                // one failed timeframe shows "—" instead of breaking the whole dashboard
                const reqs = timeframes.map(tf => fetchTwelveData(symbol, getTwelveDataInterval(tf), 500).catch(() => null));
                const results = await Promise.all(reqs);

                if (isMounted) {
                    const parsed = timeframes.reduce((acc, tf, i) => {
                        acc[tf] = calculateMetrics(results[i]);
                        return acc;
                    }, {});

                    const currentTfData = await fetchTwelveData(symbol, getTwelveDataInterval(state.timeframe), 500).catch(() => null);
                    const currentMetrics = calculateMetrics(currentTfData);

                    setMetrics({
                        tfData: parsed,
                        base: currentMetrics
                    });
                }
            } catch (error) {
                console.error('Failed to fetch dashboard data:', error);
            }
        };

        fetchAll();
        const interval = setInterval(fetchAll, 60000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, state.timeframe, gmShowDashboard]);

    if (!gmShowDashboard || !metrics) return null;

    let posClass = "";
    if (!LIVE_MODE && gmDashboardLocation === "Top Right") posClass = "top-4 right-2 md:right-[85px]";
    else if (LIVE_MODE || gmDashboardLocation === "Bottom Left") posClass = "bottom-[60px] left-2 md:left-4";
    else posClass = "bottom-[90px] right-2 md:right-[85px]";

    let scale = "scale-100";
    if (gmDashboardSize === "Tiny") scale = "scale-75";
    else if (gmDashboardSize === "Small") scale = "scale-90";
    else if (gmDashboardSize === "Large") scale = "scale-110";

    const vol = metrics.base.percentVol;
    // Pine Script: >= 70 "Very High", >= 50 "High", >= 30 "Low", < 30 "Very Low"
    const volStatus = vol == null ? '—' : vol >= 70 ? "Very High" : vol >= 50 ? "High" : vol >= 30 ? "Low" : "Very Low";
    const rsi = metrics.base.rsiVal ?? 50;
    const rsiKnown = metrics.base.rsiVal != null;

    // Exact TradingView styling for RSI
    // TradingView colours in dark mode; darker equivalents so they read on white
    let rsiColor = !rsiKnown ? "text-slate-500 dark:text-slate-400" : rsi > 75 ? "text-teal-600 dark:text-[#00ffcc]" : rsi < 25 ? "text-rose-600 dark:text-[#e43a72]" : rsi > 50 ? "text-emerald-600 dark:text-[#30b56a]" : "text-slate-500 dark:text-[#b0b2b9]";

    const tfData = metrics.tfData;
    const bullColor = "text-[#00ffcc]";
    const bearColor = "text-[#e43a72]";
    return (
        <div ref={drag.boxRef} style={drag.boxStyle} className={`absolute ${posClass} z-30 origin-bottom-right ${scale} pointer-events-auto`}>
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl shadow-xl dark:shadow-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col font-sans p-3 gap-3 w-[290px]">
                {/* Header */}
                <div {...drag.handleProps} className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700/50 select-none">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.8)]"></div>
                        <span className="text-slate-800 dark:text-slate-100 font-bold text-xs uppercase tracking-wider">Gold Move</span>
                    </div>
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                        title={isMinimized ? "Show Dashboard" : "Hide Dashboard"}
                    >
                        {isMinimized ? (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        ) : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        )}
                    </button>
                </div>

                {!isMinimized && (
                    <>
                        {/* Metrics: Volatility & RSI */}
                        <div className="flex gap-2">
                            <div className="flex-1 bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2 flex flex-col items-center justify-center border border-slate-200 dark:border-slate-700/30">
                                <span className="text-slate-500 dark:text-slate-400 text-[9px] uppercase tracking-widest mb-0.5">Volatility</span>
                                <span className="text-amber-600 dark:text-amber-400 font-bold text-xs">{volStatus}</span>
                            </div>
                            <div className="flex-1 bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2 flex flex-col items-center justify-center border border-slate-200 dark:border-slate-700/30">
                                <span className="text-slate-500 dark:text-slate-400 text-[9px] uppercase tracking-widest mb-0.5">RSI (14)</span>
                                <span className={`font-bold text-xs ${rsiColor}`}>{rsiKnown ? rsi.toFixed(1) : '—'}</span>
                            </div>
                        </div>

                        {/* Trend Heatmap */}
                        <div>
                            <span className="text-slate-500 dark:text-slate-400 text-[9px] uppercase tracking-widest mb-2 block text-center" title="Green = up trend, red = down trend (ADX ≥ 20, direction from +DI / −DI), grey = no clear trend. Hover a box for its values.">Trend Heatmap</span>
                            <div className="grid grid-cols-5 gap-1.5">
                                {[
                                    { k: '1', l: '1m' }, { k: '3', l: '3m' }, { k: '5', l: '5m' }, { k: '15', l: '15m' }, { k: '30', l: '30m' },
                                    { k: '60', l: '1H' }, { k: '120', l: '2H' }, { k: '240', l: '4H' }, { k: '720', l: '12H' }, { k: '1D', l: '1D' }
                                ].map(tf => {
                                    const m = tfData[tf.k] || {};
                                    const dir = m.dir;               // 'up' | 'down' | 'range' | null
                                    const st = dir === 'up'
                                        ? { box: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-400 shadow-[0_0_4px_#34d399]', word: 'Up trend' }
                                        : dir === 'down'
                                        ? { box: 'bg-rose-500/10 border-rose-500/30', text: 'text-rose-700 dark:text-rose-400', dot: 'bg-rose-400 shadow-[0_0_4px_#fb7185]', word: 'Down trend' }
                                        : { box: 'bg-slate-500/10 border-slate-500/25', text: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400', word: dir === 'range' ? 'No clear trend (ADX < 20)' : 'No data' };
                                    const tip = dir ? `${tf.l}: ${st.word} · ADX ${m.adx.toFixed(0)} · +DI ${m.diPlus.toFixed(0)} / −DI ${m.diMinus.toFixed(0)}` : `${tf.l}: no data`;

                                    return (
                                        <div key={tf.k} title={tip} className={`flex flex-col items-center justify-center py-1.5 rounded-lg border transition-colors ${st.box}`}>
                                            <span className={`text-[11px] font-bold ${st.text}`}>{tf.l}</span>
                                            <div className={`mt-1 w-1.5 h-1.5 rounded-full ${st.dot}`}></div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
