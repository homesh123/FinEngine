import { useEffect, useRef } from 'react';
import { ALERT_SOURCES, describeCondition, normSymbol, renderMessage, tfLabel } from '../utils/alerts/alertSources';
import { getAlertState, markFired, markMonitored, updateAlert, DEFAULT_MESSAGE } from '../utils/alerts/alertStore';
import { deliverAlert } from '../utils/alerts/alertDelivery';
import { predictionSignalsOn } from './usePredictionSignal';

// Is this source shown on the chart? (Pressure is a chart type, Prediction signals a projection option)
const shownOn = (src, state) => (src === 'pressure' ? state.chartType === 'pressure'
    : src === 'prediction' ? predictionSignalsOn(state)
    : !!state.indicators?.[src] && !state.hiddenIndicators?.[src]);

/**
 * Checks the alerts from the Alerts panel against this chart's candles.
 * Runs in every chart (each chart tab), so alerts keep working for background
 * tabs; an alert watched by two charts on the same symbol/timeframe fires once
 * (the shared store records the candle it fired on).
 *
 * Alerts are evaluated in the browser: the app must be open (any tab can be in
 * the background) for them to fire.
 */
// Prices in messages: 2 decimals for large prices (gold, indices), 5 for FX
const px = (v) => (v == null || Number.isNaN(v) ? '' : Math.abs(v) >= 100 ? v.toFixed(2) : Number(v.toFixed(5)).toString());

// Signals that notify automatically when their indicator is on the chart
// (Alerts panel → Settings → "Notify on signals from applied indicators").
const AUTO_SIGNALS = {
    goldMove: [['goldMove', 'any']],
    livermore: [['livermore', 'buy'], ['livermore', 'exit']],
    btcTurtle: [['btcTurtle', 'buy'], ['btcTurtle', 'exit']],
    lsr: [['lsr', 'any']],
    qit: [['qit', 'long'], ['qit', 'short']],
    macdHs: [['macdHs', 'any']],
    smcPro: [['smcPro', 'any']],
    londonBreakout: [['londonBreakout', 'any'], ['londonBreakout', 'tp1'], ['londonBreakout', 'exit']],
    pressure: [['pressure', 'any']],
    prediction: [['prediction', 'any']],   // Projection → Buy/sell signals
    ichimoku: [['ichimoku', 'any']],
    whalePulse: [['whalePulse', 'large']],    // large bubbles only (smaller ones would be noisy)          // the Pressure chart type (not an indicator)
    macd: [['macd', 'bull_cross'], ['macd', 'bear_cross']],
    rsi: [['rsi', 'cross_above', 70], ['rsi', 'cross_below', 30]],
    demarker: [['demarker', 'cross_above', 0.7], ['demarker', 'cross_below', 0.3]],
};
// Shared by every chart in the page: one notification per signal and candle,
// however many tabs show the same symbol/timeframe. Old keys are pruned.
const autoFired = new Map();
const AUTO_NOTIFY = { popup: true, sound: true, email: false, webhook: false };

export function useAlertEngine({ dataset, state, notifEnabled }) {
    // Candles that closed before this chart started watching never fire
    // ("once per bar close"), so opening the app doesn't replay old signals.
    const watchStartRef = useRef({ key: null, lastTime: 0 });

    useEffect(() => {
        if (!dataset || dataset.length < 3) return;
        const { alerts, settings } = getAlertState();
        if (!settings.enabled) return;

        const sym = normSymbol(state.symbol);
        const tf = Number(state.timeframe);
        const chartKey = `${sym}|${tf}`;
        const n = dataset.length;
        const live = dataset[n - 1];
        if (watchStartRef.current.key !== chartKey) watchStartRef.current = { key: chartKey, lastTime: live.time };
        // Stale data (market closed, feed stopped): nothing is happening now
        if (Date.now() - live.time > tf * 60000 * 3 + 120000) return;

        const now = Date.now();
        for (const a of alerts) {
            if (!a.enabled) continue;
            if (a.expiresAt && now > a.expiresAt) { updateAlert(a.id, { enabled: false }); continue; }
            if (a.symbol !== '*' && normSymbol(a.symbol) !== sym) continue;
            if (a.timeframe !== '*' && Number(a.timeframe) !== tf) continue;
            const src = ALERT_SOURCES[a.source];
            const sig = src?.signals[a.signal];
            if (!sig) continue;
            if (src.requiresFootprint && state.chartType !== 'footprint') continue;
            if (a.onlyWhenShown && a.source !== 'price' && a.source !== 'footprint'
                && !shownOn(a.source, state)) continue;
            markMonitored(a.id);

            const closeMode = a.trigger === 'once_per_bar_close';
            const i = closeMode ? n - 2 : n - 1;
            const bar = dataset[i];
            if (closeMode && dataset[n - 1].time <= watchStartRef.current.lastTime) continue;   // closed before we watched
            if (a.lastFired?.[chartKey] === bar.time) continue;                                  // already fired on this candle
            const value = Number(a.value);
            const hit = sig.test(dataset, i, value);
            if (!hit) continue;

            const vars = hit.vars || {};
            const ctx = {
                ticker: state.symbol, interval: tfLabel(tf),
                signal: vars.signal || sig.label, side: hit.side || '',
                open: px(bar.open), high: px(bar.high), low: px(bar.low), close: px(bar.close), volume: bar.volume,
                time: new Date(bar.time).toLocaleString(),
                entry: vars.entry || px(bar.close), sl: vars.sl || '', tp: vars.tp || '',
                value: vars.value ?? (sig.needsValue ? value : ''),
                alert_name: a.name || describeCondition(a), condition: describeCondition(a),
                barTime: bar.time,
            };
            markFired(a.id, chartKey, bar.time, a.trigger === 'only_once');
            const title = a.name || describeCondition(a);
            deliverAlert(a, `${title} — ${state.symbol} ${tfLabel(tf)}`, renderMessage(a.message || DEFAULT_MESSAGE, ctx), ctx, { soundAndPopup: notifEnabled });
        }

        // ── Automatic: signals from indicators applied (and visible) on this chart
        if (settings.autoIndicatorAlerts === false) return;
        if (dataset[n - 1].time <= watchStartRef.current.lastTime) return;   // no candle has closed since we started watching
        const i = n - 2, bar = dataset[i];
        for (const [ind, list] of Object.entries(AUTO_SIGNALS)) {
            if (!shownOn(ind, state)) continue;
            for (const [source, signal, value] of list) {
                const src = ALERT_SOURCES[source], sig = src?.signals[signal];
                if (!sig) continue;
                // the user's own alert for the same thing already covers it
                if (alerts.some(a => a.enabled && a.source === source && (a.signal === signal || a.signal === 'any')
                    && (a.symbol === '*' || normSymbol(a.symbol) === sym) && (a.timeframe === '*' || Number(a.timeframe) === tf))) continue;
                const key = `${source}|${signal}|${chartKey}|${bar.time}`;
                if (autoFired.has(key)) continue;
                let hit = null;
                try { hit = sig.test(dataset, i, value); } catch { hit = null; }
                if (!hit) continue;
                autoFired.set(key, now);
                if (autoFired.size > 500) for (const [k, t] of autoFired) if (now - t > 2 * 86400000) autoFired.delete(k);
                const vars = hit.vars || {};
                const what = vars.signal || sig.label;
                const levels = [vars.entry && `entry ${vars.entry}`, vars.sl && `SL ${vars.sl}`, vars.tp && `TP ${vars.tp}`].filter(Boolean).join(' · ');
                const ctx = { ticker: state.symbol, interval: tfLabel(tf), side: hit.side || '', barTime: bar.time };
                const title = `${src.label}: ${what} — ${state.symbol} ${tfLabel(tf)}`;
                const message = `${what} on ${state.symbol} ${tfLabel(tf)} at ${px(bar.close)}${levels ? ` (${levels})` : ''}.`;
                deliverAlert({ id: `auto-${source}-${signal}`, notify: AUTO_NOTIFY }, title, message, ctx, { soundAndPopup: notifEnabled });
            }
        }
    }, [dataset, state.symbol, state.timeframe, state.chartType, state.indicators, state.hiddenIndicators, state.indicatorSettings?.ppSignals, notifEnabled]);
}
