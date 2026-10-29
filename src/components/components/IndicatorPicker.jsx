import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Activity } from 'lucide-react';
import { confirmDialog, currentConfirm } from '../utils/confirmDialog';

// Indicators overlay: search on top, groups kept, A→Z inside each group.
// `pro: true` entries only appear in Pro mode (as before).
export const INDICATOR_CATALOG = [
    // Overlays
    { key: 'btcTurtle', group: 'Overlays', name: 'BTC Turtle Breakout', desc: 'H4 55-bar breakout above EMA200, ATR stop, channel exit (same as the BTC EA)', pro: true },
    { key: 'bollinger', group: 'Overlays', name: 'Bollinger Bands', desc: 'Moving average ± standard deviations' },
    { key: 'fxProfile', group: 'Overlays', name: 'FX24HR Market Profile', desc: 'Volume profile per session/day: POC, value area, naked POCs' },
    { key: 'goldMove', group: 'Overlays', name: 'Gold Move', desc: 'Trend signals with SL/TP and dashboard' },
    { key: 'londonBreakout', group: 'Overlays', name: 'London Breakout (Big Ben)', desc: 'Asian range breakout at the London open with SL/TP', pro: true },
    { key: 'lsr', group: 'Overlays', name: 'Liquidity Sweep Reversal', desc: 'Sweeps of PDH/PDL and swing liquidity' },
    { key: 'livermore', group: 'Overlays', name: 'Livermore Gold Trend PRO', desc: 'Pine v12 strategy: EMA/ADX/RSI, trailing stop', pro: true },
    { key: 'maRibbon', group: 'Overlays', name: 'MA Ribbon', desc: 'Stack of moving averages' },
    { key: 'ichimoku', group: 'Overlays', name: 'Ichimoku Cloud', desc: 'Tenkan, Kijun, cloud and Chikou, with strong BUY / SELL signals' },
    { key: 'whalePulse', group: 'Overlays', name: 'Whale Pulse (Big Trades)', desc: 'Big buy/sell bubbles, absorption and deep pressure' },
    { key: 'movingAvg', group: 'Overlays', name: 'Moving Averages', desc: 'Up to 3 lines (EMA, SMA, WMA, Hull, SMMA, VWMA), ribbon and golden / death crosses' },
    { key: 'macdHs', group: 'Overlays', name: 'MACD H&S Breakout', desc: 'Head & shoulders with MACD zero-line confirmation' },
    { key: 'sessions', group: 'Overlays', name: 'Market Sessions', desc: 'Sydney, Tokyo, London, New York ranges' },
    { key: 'mtfOb', group: 'Overlays', name: 'Multi-Timeframe Order Blocks', desc: 'Order blocks from higher timeframes' },
    { key: 'qit', group: 'Overlays', name: 'Quantum Imbalance Trap', desc: 'Imbalance traps with entry, SL and targets', pro: true },
    { key: 'smcPro', group: 'Overlays', name: 'SMC Pro + Predictor', desc: 'Order blocks & supply/demand with confirmed entries', pro: true },
    { key: 'sdPro', group: 'Overlays', name: 'Supply/Demand Pro', desc: 'Base + impulse supply and demand zones' },
    { key: 'vbr', group: 'Overlays', name: 'Volume-Based Support & Resistance', desc: 'Support (green) and resistance (red) where heavy volume traded' },
    { key: 'vwap', group: 'Overlays', name: 'VWAP', desc: 'Volume-weighted average price with bands' },
    // Oscillators
    { key: 'demarker', group: 'Oscillators', name: 'DeMarker (14)', desc: 'Exhaustion oscillator 0–1' },
    { key: 'macd', group: 'Oscillators', name: 'MACD', desc: '12/26/9 with 4-colour histogram' },
    { key: 'rsi', group: 'Oscillators', name: 'RSI (14)', desc: 'Relative strength with MA' },
    // Volume
    { key: 'cvd', group: 'Volume', name: 'Order Flow CVD', desc: 'Cumulative volume delta' },
    { key: 'volume', group: 'Volume', name: 'Volume', desc: 'In its own pane or on the chart, high-volume highlight, relative volume and average' },
];
const GROUP_ORDER = ['Overlays', 'Oscillators', 'Volume'];
// On the chart too, but switched on elsewhere (Chart Settings) — still counted
// and cleared by "Remove all", like the on-chart list shows them
const ALSO_ON_CHART = ['nextProjection'];

export default function IndicatorPicker({ indicators, isProMode, onToggle, onRemoveAll, onClose, dark }) {
    const [q, setQ] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
        // Escape closes the panel - unless a confirmation dialog is open on top of it
        const onKey = (e) => { if (e.key === 'Escape' && !currentConfirm()) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const groups = useMemo(() => {
        const needle = q.trim().toLowerCase();
        const visible = INDICATOR_CATALOG.filter(it => (!it.pro || isProMode)
            && (!needle || it.name.toLowerCase().includes(needle) || it.desc.toLowerCase().includes(needle)));
        return GROUP_ORDER.map(g => ({
            g, items: visible.filter(it => it.group === g).sort((a, b) => a.name.localeCompare(b.name)),
        })).filter(x => x.items.length);
    }, [q, isProMode]);

    const activeCount = INDICATOR_CATALOG.filter(it => (!it.pro || isProMode) && indicators[it.key]).length
        + ALSO_ON_CHART.filter(k => indicators[k]).length;

    return createPortal(
        <div className={dark ? 'dark' : undefined}>
            <div className="fixed inset-0 z-[320] flex items-stretch sm:items-start justify-center bg-black/50 backdrop-blur-[2px] sm:pt-[10vh] ts-scrim-in"
                onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
                <div role="dialog" aria-label="Indicators"
                    className="w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[75vh] flex flex-col bg-white dark:bg-slate-900 sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden ts-pop-in">
                    <div className="flex items-center justify-between px-4 h-12 border-b border-slate-200 dark:border-slate-700 shrink-0">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white"><Activity className="w-4 h-4 text-indigo-500" /> Indicators</div>
                        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
                        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus-within:border-indigo-500">
                            <Search className="w-4 h-4 text-slate-400 shrink-0" />
                            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search indicators"
                                aria-label="Search indicators"
                                className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none" />
                            {q && <button onClick={() => setQ('')} aria-label="Clear search" className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {groups.length === 0 && <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No indicator matches "{q}".</p>}
                        {groups.map(({ g, items }) => (
                            <div key={g}>
                                <div className="sticky top-0 px-4 py-1.5 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 border-y border-slate-200 dark:border-slate-700/60">{g}</div>
                                {items.map(it => {
                                    const on = !!indicators[it.key];
                                    return (
                                        <label key={it.key} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${on ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                                            <span className="flex-1 min-w-0">
                                                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                                                    {it.name}
                                                    {it.pro && <span className="text-[9px] font-bold px-1 py-px rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">PRO</span>}
                                                </span>
                                                <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{it.desc}</span>
                                            </span>
                                            <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(it.key)} />
                                            <span aria-hidden className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                                <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${on ? 'left-4' : 'left-0.5'}`} />
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between px-4 h-12 border-t border-slate-200 dark:border-slate-700 shrink-0">
                        <span className="text-xs text-slate-500 dark:text-slate-400">{activeCount} on the chart</span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={async () => {
                                    if (await confirmDialog({ title: 'Remove all indicators?', message: `All ${activeCount} indicator${activeCount === 1 ? '' : 's'} will be removed from this chart. Their settings are kept, so you can add them back any time.`, confirmLabel: 'Remove all', danger: true }))
                                        onRemoveAll([...INDICATOR_CATALOG.map(it => it.key), ...ALSO_ON_CHART]);
                                }}
                                disabled={activeCount === 0}
                                className="h-8 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-40 disabled:hover:bg-transparent">
                                Remove all
                            </button>
                            <button onClick={onClose} className="h-8 px-4 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">Done</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
