// At each candle close, sends the first enabled indicator signal on the closed
// candle to the MT5 Receiver EA (via the Signal Tester's endpoint). Active chart
// only; one signal per symbol / timeframe / candle; the first data of a chart
// only primes it, so opening the app or switching chart never replays a signal.
import { useEffect, useRef } from 'react';
import { ALERT_SOURCES, tfLabel } from '../utils/alerts/alertSources';
import { EA_BRIDGE_SOURCES, tradeLevels, useEaBridge } from '../utils/eaBridge';
import { useSignalSender } from './useSignalSender';

const sentBars = new Map();          // `${symbol}|${tf}|${candle time}` → sent at (shared by all charts)

export function useEaSignalBridge({ dataset, state, tradingEnabled }) {
    const cfg = useEaBridge();
    const { sendSignal } = useSignalSender();
    const watchRef = useRef({ key: null, lastTime: null });

    useEffect(() => {
        if (!tradingEnabled || !cfg.enabled || !cfg.sources.length || !dataset || dataset.length < 3) return;
        const n = dataset.length, i = n - 2, bar = dataset[i];
        const tf = Number(state.timeframe);
        const symbol = String(state.symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const key = `${symbol}|${tf}`;
        const w = watchRef.current;
        if (w.key !== key) { watchRef.current = { key, lastTime: bar.time }; return; }   // prime, don't replay
        if (bar.time === w.lastTime) return;                                              // this candle already checked
        w.lastTime = bar.time;
        // stale feed (market closed): nothing is happening now
        if (Date.now() - dataset[n - 1].time > tf * 60000 * 3 + 120000) return;

        const barKey = `${key}|${bar.time}`;
        if (sentBars.has(barKey)) return;
        for (const src of EA_BRIDGE_SOURCES) {
            if (!cfg.sources.includes(src.key) || !src.on(state)) continue;
            for (const [source, signal] of src.tests) {
                const def = ALERT_SOURCES[source]?.signals[signal];
                if (!def) continue;
                let hit = null;
                try { hit = def.test(dataset, i, def.defaultValue); } catch { hit = null; }
                if (!hit || (hit.side !== 'buy' && hit.side !== 'sell')) continue;
                const lv = tradeLevels(dataset, i, hit, state.indicatorSettings);
                sentBars.set(barKey, Date.now());
                if (sentBars.size > 300) for (const [k, t] of sentBars) if (Date.now() - t > 2 * 86400000) sentBars.delete(k);
                // MT5 order comment: which indicator and timeframe (MT5 keeps 31 chars)
                const comment = `TS ${src.short} ${tfLabel(tf)}`;
                console.log(`[EA bridge] ${comment}: ${hit.side.toUpperCase()} ${symbol} @ ${lv.entry} SL ${lv.sl} TP ${lv.tp}`);
                sendSignal({ symbol, action: hit.side.toUpperCase(), price: lv.entry, stop_loss: lv.sl, take_profit: lv.tp, comment }).catch(() => {});
                return;                                    // one trade signal per candle
            }
        }
    }, [dataset, state.symbol, state.timeframe, state.chartType, state.indicators, state.hiddenIndicators, state.indicatorSettings, tradingEnabled, cfg, sendSignal]);
}
