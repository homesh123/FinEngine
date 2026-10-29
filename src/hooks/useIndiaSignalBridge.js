// INDIA_ALGO_TRADING.md C4: at each candle close on an NSE/BSE chart, sends the indicator signals that enabled
// alert strategies watch (same stock + timeframe + indicator on the chart) to /api/india/signal. The server sizes
// and places the trade (paper by default) through the RiskEngine. Owner only, Upstox connected only.
// shortcut: needs the chart open in a browser; a server-side signal engine (task F4) removes that.
import { useEffect, useRef, useState } from 'react';
import { ALERT_SOURCES } from '../utils/alerts/alertSources';
import { EA_BRIDGE_SOURCES } from '../utils/eaBridge';
import { indiaApi } from '../utils/indiaApi';
import { useBrokerSession, isIndiaSymbol } from './useBrokerSession';

const sent = new Map();                 // `${symbol}|${tf}|${indicator}|${bar time}` -> sent at (pruned, bounded)
let cache = { at: 0, list: [] };        // enabled alert strategies, shared by all charts, refreshed every 60 s
let loading = null;

async function alertStrategies() {
    if (Date.now() - cache.at < 60000) return cache.list;
    if (!loading) {
        loading = indiaApi.strategies()
            .then(list => { cache = { at: Date.now(), list: list.filter(s => s.enabled && !['agent', 'option_agent'].includes(s.indicator)) }; return cache.list; })
            .catch(() => cache.list)
            .finally(() => { loading = null; });
    }
    return loading;
}
export const refreshIndiaStrategies = () => { cache = { at: 0, list: [] }; };

export function useIndiaSignalBridge({ dataset, state }) {
    const broker = useBrokerSession();
    const [mine, setMine] = useState([]);
    const watch = useRef({ key: null, lastTime: null });
    const symbol = String(state.symbol || '').toUpperCase();
    const tf = Number(state.timeframe);
    const active = broker.ready && isIndiaSymbol(symbol);

    useEffect(() => {
        if (!active) { setMine([]); return undefined; }
        let alive = true;
        const load = () => alertStrategies().then(l => { if (alive) setMine(l.filter(s => s.symbol.toUpperCase() === symbol && s.timeframe === tf)); });
        load();
        const t = setInterval(load, 60000);
        return () => { alive = false; clearInterval(t); };
    }, [active, symbol, tf]);

    useEffect(() => {
        if (!active || !mine.length || !dataset || dataset.length < 3) return;
        const n = dataset.length, i = n - 2, bar = dataset[i];
        const key = `${symbol}|${tf}`;
        const w = watch.current;
        if (w.key !== key) { watch.current = { key, lastTime: bar.time }; return; }   // prime: never replay old candles
        if (bar.time === w.lastTime) return;
        w.lastTime = bar.time;
        if (Date.now() - dataset[n - 1].time > tf * 60000 * 3 + 120000) return;       // stale feed (market closed)

        for (const ind of new Set(mine.map(s => s.indicator))) {
            const src = EA_BRIDGE_SOURCES.find(x => x.key === ind);
            if (!src || !src.on(state)) continue;                                     // indicator not on this chart
            const id = `${key}|${ind}|${bar.time}`;
            if (sent.has(id)) continue;
            for (const [source, signal] of src.tests) {
                const def = ALERT_SOURCES[source]?.signals[signal];
                let hit = null;
                try { hit = def?.test(dataset, i, def.defaultValue); } catch { hit = null; }
                if (!hit || (hit.side !== 'buy' && hit.side !== 'sell')) continue;
                sent.set(id, Date.now());
                if (sent.size > 300) for (const [k, t] of sent) if (Date.now() - t > 2 * 86400000) sent.delete(k);
                indiaApi.signal({ symbol, timeframe: tf, indicator: ind, side: hit.side.toUpperCase(), price: bar.close,
                    bar_time: String(bar.time), atr: bar.atr || null }).catch(() => {});
                break;
            }
        }
    }, [dataset, mine, active, symbol, tf, state]);

    return mine;                            // strategies watching this chart (for the "algo on" badge)
}
