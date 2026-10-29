// Indicator signals → broker accounts (Algo Trading Account Manager).
//
// Every chart checks, at each candle close, the signals each algo-enabled
// account has selected (same definitions as the Alerts panel, ALERT_SOURCES)
// and posts hits to /api/accounts/{id}/signal. The backend decides whether to
// trade (risk rules, limits, duplicates across tabs) and logs the outcome —
// see ALGO_TRADING.md.
import { useEffect, useRef, useState } from 'react';
import { ALERT_SOURCES, normSymbol } from '../utils/alerts/alertSources';
import { getTradeToken, tradingApi } from '../utils/tradingApi';
import { findSupplyDemandZones } from '../utils/dataEngine';

// ── One shared poller for the account list, however many charts are open ──
const POLL_MS = 30000;
let accounts = [];
let timer = null;
const subscribers = new Set();

async function refresh() {
    if (!getTradeToken()) { accounts = []; subscribers.forEach(fn => fn(accounts)); return; }
    try {
        const r = await tradingApi.list();
        accounts = (r.accounts || []).filter(a => a.settings?.algo_enabled && a.status?.state === 'connected');
    } catch {
        accounts = [];
    }
    subscribers.forEach(fn => fn(accounts));
}
const onChanged = () => { refresh(); };

function subscribe(fn) {
    subscribers.add(fn);
    if (subscribers.size === 1) {
        refresh();
        timer = setInterval(refresh, POLL_MS);
        window.addEventListener('ts-accounts-changed', onChanged);
        window.addEventListener('ts-trade-token', onChanged);
    } else {
        fn(accounts);
    }
    return () => {
        subscribers.delete(fn);
        if (subscribers.size === 0) {
            clearInterval(timer); timer = null;
            window.removeEventListener('ts-accounts-changed', onChanged);
            window.removeEventListener('ts-trade-token', onChanged);
        }
    };
}

// ── SL / TP when the indicator gives none ───────────────────────────────────
// 1) Supply/Demand Pro zones of this chart's timeframe (same logic as the
//    overlay): buy → stop just below the nearest unbroken demand zone under
//    the entry, target at the nearest supply zone above; sell is the mirror.
// 2) Otherwise swing support/resistance (3-bar pivots, last 150 candles).
// 3) Otherwise none — the server falls back to ATR (see ALGO_TRADING.md).
function pivots(c, end, lookback = 150, k = 3) {
    const highs = [], lows = [];
    for (let j = Math.max(k, end - lookback); j <= end - k; j++) {
        let ph = true, pl = true;
        for (let m = 1; m <= k; m++) {
            if (!(c[j].high > c[j - m].high && c[j].high >= c[j + m].high)) ph = false;
            if (!(c[j].low < c[j - m].low && c[j].low <= c[j + m].low)) pl = false;
        }
        if (ph) highs.push(c[j].high);
        if (pl) lows.push(c[j].low);
    }
    return { highs, lows };
}

export function structureLevels(dataset, i, side, entry, settings) {
    const closed = dataset.slice(0, i + 1);           // never look at the live candle
    const atr = dataset[i]?.atr || 0;
    const pad = atr * 0.1;                              // small buffer beyond the level
    const buy = side === 'buy';
    const below = (arr) => arr.filter(v => v < entry).reduce((a, v) => (a == null || v > a ? v : a), null);
    const above = (arr) => arr.filter(v => v > entry).reduce((a, v) => (a == null || v < a ? v : a), null);

    let sl = null, tp = null, slBasis = null, tpBasis = null;
    try {
        const zones = findSupplyDemandZones(closed, settings || {}).filter(z => !z.breached);
        const demand = zones.filter(z => z.type === 'demand'), supply = zones.filter(z => z.type === 'supply');
        if (buy) {
            const d = below(demand.map(z => z.distal)); if (d != null) { sl = d - pad; slBasis = 'demand zone'; }
            const t = above(supply.map(z => z.proximal)); if (t != null) { tp = t; tpBasis = 'supply zone'; }
        } else {
            const d = above(supply.map(z => z.distal)); if (d != null) { sl = d + pad; slBasis = 'supply zone'; }
            const t = below(demand.map(z => z.proximal)); if (t != null) { tp = t; tpBasis = 'demand zone'; }
        }
    } catch { /* fall through to swings */ }

    if (sl == null || tp == null) {
        const { highs, lows } = pivots(closed, closed.length - 1);
        if (buy) {
            if (sl == null) { const v = below(lows); if (v != null) { sl = v - pad; slBasis = 'swing support'; } }
            if (tp == null) { const v = above(highs); if (v != null) { tp = v; tpBasis = 'swing resistance'; } }
        } else {
            if (sl == null) { const v = above(highs); if (v != null) { sl = v + pad; slBasis = 'swing resistance'; } }
            if (tp == null) { const v = below(lows); if (v != null) { tp = v; tpBasis = 'swing support'; } }
        }
    }
    return { sl, tp, slBasis, tpBasis };
}

const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/** Returns the number of accounts this chart is feeding signals to. */
export function useAccountSignals({ dataset, state }) {
    const [list, setList] = useState(accounts);
    const lastBarRef = useRef(null);   // time of the live candle last evaluated

    useEffect(() => subscribe(setList), []);

    // Accounts this chart can feed (symbol / timeframe filters)
    const sym = normSymbol(state.symbol);
    const tf = Number(state.timeframe);
    const relevant = list.filter(a => {
        const s = a.settings;
        if (s.timeframe && Number(s.timeframe) !== tf) return false;
        if (s.symbols?.length && !s.symbols.some(x => normSymbol(x) === sym)) return false;
        return true;
    });

    useEffect(() => {
        const n = dataset?.length || 0;
        if (n < 3) return;
        const liveTime = dataset[n - 1].time;
        const prev = lastBarRef.current;
        lastBarRef.current = liveTime;
        // Only act when a new candle has opened (i.e. the previous one closed).
        // The first data after mount/symbol change is just recorded, so an old
        // signal is never traded on page load.
        if (prev === null || prev === liveTime || liveTime < prev || !relevant.length) return;

        const i = n - 2; // last closed candle
        const c = dataset[i];
        for (const acc of relevant) {
            for (const sel of acc.settings.signals || []) {
                const src = ALERT_SOURCES[sel.source];
                const def = src?.signals?.[sel.signal];
                if (!def) continue;
                if (src.requiresFootprint && state.chartType !== 'footprint') continue;
                let hit = null;
                try {
                    hit = def.test(dataset, i, sel.value ?? def.defaultValue);
                } catch { hit = null; }
                if (!hit) continue;
                const v = hit.vars || {};
                const entry = num(v.entry) ?? c.close;
                let sl = num(v.sl), tp = num(v.tp), slBasis = sl ? 'indicator' : null, tpBasis = tp ? 'indicator' : null;
                if (hit.side && (sl == null || tp == null)) {
                    const lv = structureLevels(dataset, i, hit.side, entry, state.indicatorSettings);
                    if (sl == null && lv.sl != null) { sl = lv.sl; slBasis = lv.slBasis; }
                    if (tp == null && lv.tp != null) { tp = lv.tp; tpBasis = lv.tpBasis; }
                }
                tradingApi.signal(acc.id, {
                    source: sel.source,
                    signal: sel.signal,
                    side: hit.side || null,
                    symbol: state.symbol,
                    timeframe: tf,
                    candle_time: c.time,
                    entry,
                    sl,
                    tp,
                    sl_basis: slBasis,
                    tp_basis: tpBasis,
                    message: `${src.label}: ${def.label}`,
                }).catch(() => { /* outcome (incl. errors) is in the account's log */ });
            }
        }
    }, [dataset, relevant, state.symbol, state.chartType, state.indicatorSettings, tf]);

    // Forget the candle marker when the chart switches symbol/timeframe
    useEffect(() => { lastBarRef.current = null; }, [state.symbol, tf]);

    return relevant.length;
}

export const notifyAccountsChanged = () => window.dispatchEvent(new Event('ts-accounts-changed'));
