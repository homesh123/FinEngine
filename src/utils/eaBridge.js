// ─── Indicator signals → MT5 Receiver EA ─────────────────────────────────────
// Which indicator signals are sent to the local signal API (/api/v1/signal, the
// same endpoint the Signal Tester uses), where TradeSagar_Receiver_EA.mq5 picks
// them up and trades them. Settings live in this browser only (localStorage):
// the API is http://127.0.0.1:8000, i.e. the computer running the browser, so
// only the machine that runs the backend + MT5 can trade.
import { useEffect, useState } from 'react';
import { structureLevels } from '../hooks/useAccountSignals';

const KEY = 'ts_ea_bridge_v1';
const EVENT = 'ts-ea-bridge';
// Gold Move on by default — it was the only indicator sending to the EA before
export const EA_BRIDGE_DEFAULT = { enabled: true, sources: ['goldMove'] };

const shown = (k) => (s) => !!s.indicators?.[k] && !s.hiddenIndicators?.[k];

/**
 * Indicators that can send trades: [alert source, signal] pairs checked at each
 * candle close (entries only — exits are left to the EA's SL / TP / trailing),
 * and when the indicator counts as "on the chart".
 */
export const EA_BRIDGE_SOURCES = [
    { key: 'goldMove',       label: 'Gold Move', short: 'Gold Move',                 tests: [['goldMove', 'buy'], ['goldMove', 'sell']], on: shown('goldMove') },
    { key: 'pressure',       label: 'Pressure Chart (Pro)', short: 'Pressure',      tests: [['pressure', 'any']], on: (s) => s.chartType === 'pressure' },
    { key: 'smcPro',         label: 'SMC Pro', short: 'SMC Pro',                   tests: [['smcPro', 'any']], on: shown('smcPro') },
    { key: 'londonBreakout', label: 'London Breakout', short: 'London BO',           tests: [['londonBreakout', 'any']], on: shown('londonBreakout') },
    { key: 'qit',            label: 'Quantum Imbalance Trap', short: 'QIT',    tests: [['qit', 'long'], ['qit', 'short']], on: shown('qit') },
    { key: 'lsr',            label: 'Liquidity Sweep Reversal', short: 'LSR',  tests: [['lsr', 'any']], on: shown('lsr') },
    { key: 'macdHs',         label: 'MACD H&S Breakout', short: 'MACD H&S',         tests: [['macdHs', 'any']], on: shown('macdHs') },
    { key: 'livermore',      label: 'Livermore Gold Trend', short: 'Livermore',      tests: [['livermore', 'buy']], on: shown('livermore') },
    { key: 'ichimoku',       label: 'Ichimoku Cloud', short: 'Ichimoku',             tests: [['ichimoku', 'any']], on: shown('ichimoku') },
    { key: 'macd',           label: 'MACD signal-line cross', short: 'MACD Cross',    tests: [['macd', 'bull_cross'], ['macd', 'bear_cross']], on: shown('macd') },
];

export function getEaBridge() {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || 'null');
        return v && Array.isArray(v.sources) ? { ...EA_BRIDGE_DEFAULT, ...v } : EA_BRIDGE_DEFAULT;
    } catch {
        return EA_BRIDGE_DEFAULT;
    }
}

export function setEaBridge(patch) {
    const v = { ...getEaBridge(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable: this session only */ }
    window.dispatchEvent(new Event(EVENT));
}

export function useEaBridge() {
    const [v, setV] = useState(getEaBridge);
    useEffect(() => {
        const on = () => setV(getEaBridge());
        window.addEventListener(EVENT, on);
        window.addEventListener('storage', on);           // other tabs
        return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
    }, []);
    return v;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };

/**
 * Entry / SL / TP for a signal hit on candle i: the indicator's own levels,
 * else supply/demand or swing structure (as the Accounts page does), else
 * SL 1.5 × ATR and TP 2 × that distance. A level on the wrong side is dropped.
 */
export function tradeLevels(dataset, i, hit, settings) {
    const c = dataset[i];
    const buy = hit.side === 'buy';
    const entry = num(hit.vars?.entry) ?? c.close;
    let sl = num(hit.vars?.sl), tp = num(hit.vars?.tp);
    if (sl != null && (buy ? sl >= entry : sl <= entry)) sl = null;
    if (tp != null && (buy ? tp <= entry : tp >= entry)) tp = null;
    if (sl == null || tp == null) {
        const s = structureLevels(dataset, i, hit.side, entry, settings);
        if (sl == null && s.sl != null && (buy ? s.sl < entry : s.sl > entry)) sl = s.sl;
        if (tp == null && s.tp != null && (buy ? s.tp > entry : s.tp < entry)) tp = s.tp;
    }
    const atr = c.atr || 0;
    if (sl == null && atr > 0) sl = buy ? entry - 1.5 * atr : entry + 1.5 * atr;
    if (tp == null && sl != null) tp = buy ? entry + 2 * Math.abs(entry - sl) : entry - 2 * Math.abs(entry - sl);
    return { entry, sl: sl ?? 0, tp: tp ?? 0 };
}
