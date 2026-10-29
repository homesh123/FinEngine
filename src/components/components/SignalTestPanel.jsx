/**
 * SignalTestPanel.jsx
 * --------------------
 * Pro Mode only test panel for manually firing BUY / SELL / CLOSE signals
 * to the local TradeSagar signal API and verifying the response.
 *
 * Rendered inside App.jsx when isProMode is true.
 */

import React, { useState } from 'react';
import { useSignalSender } from '../hooks/useSignalSender';
import { EA_BRIDGE_SOURCES, setEaBridge, useEaBridge } from '../utils/eaBridge';
import { Zap, CheckCircle, XCircle, Loader, Trash2, History, ChevronDown, ChevronUp } from 'lucide-react';

export default function SignalTestPanel({ defaultSymbol = 'XAUUSD', defaultPrice = '', inline = false }) {
    const { sendSignal, clearSignal, fetchHistory, lastSignal, status, errorMsg } = useSignalSender();
    const bridge = useEaBridge();

    const [symbol,     setSymbol]     = useState(defaultSymbol);
    const [action,     setAction]     = useState('BUY');
    const [price,      setPrice]      = useState(defaultPrice);
    const [stopLoss,   setStopLoss]   = useState('');
    const [takeProfit, setTakeProfit] = useState('');
    const [history,    setHistory]    = useState(null);
    const [showHist,   setShowHist]   = useState(false);
    const [collapsed,  setCollapsed]  = useState(false);

    const handleSend = async () => {
        try {
            await sendSignal({ symbol, action, price, stop_loss: stopLoss, take_profit: takeProfit, comment: 'TS Manual' });
        } catch (_) {}
    };

    const handleHistory = async () => {
        try {
            const h = await fetchHistory();
            setHistory(h);
            setShowHist(true);
        } catch (e) {
            alert('History fetch failed: ' + e.message);
        }
    };

    const handleClear = async () => {
        await clearSignal(symbol);
        alert(`Signal cleared for ${symbol}`);
    };

    const statusColor = {
        idle:    'text-slate-500',
        sending: 'text-amber-400',
        ok:      'text-emerald-400',
        error:   'text-red-400',
    }[status];

    const actionDef = {
        BUY:   { active: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-500/30', inactive: 'text-emerald-600 dark:text-emerald-500 hover:bg-emerald-500/10' },
        SELL:  { active: 'bg-red-600 hover:bg-red-500 text-white shadow-sm shadow-red-500/30',             inactive: 'text-red-500 dark:text-red-400 hover:bg-red-500/10' },
        CLOSE: { active: 'bg-amber-600 hover:bg-amber-500 text-white shadow-sm shadow-amber-500/30',       inactive: 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10' },
    };

    const fireBtnColor = {
        BUY:   'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20',
        SELL:  'bg-red-600 hover:bg-red-500 shadow-red-500/20',
        CLOSE: 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/20',
    }[action];

    const inputClass = "w-full bg-slate-50 dark:bg-panelbg border border-slate-200 dark:border-borderdark rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-mono placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-all";

    const containerClass = inline
        ? "mx-3 mb-3 bg-white dark:bg-cardbg border border-slate-200 dark:border-borderdark rounded-xl overflow-hidden"
        : "fixed bottom-14 right-4 z-[200] w-72 bg-white dark:bg-cardbg border border-slate-200 dark:border-borderdark rounded-xl shadow-2xl overflow-hidden";

    return (
        <div className={containerClass}>
            {/* Header */}
            <div
                className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-borderdark cursor-pointer select-none"
                onClick={() => setCollapsed(c => !c)}
            >
                <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 tracking-wide">Signal Tester</span>
                    <span className="text-[9px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-md font-semibold tracking-wider">PRO</span>
                </div>
                {collapsed
                    ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    : <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                }
            </div>

            {!collapsed && (
                <div className="p-3 space-y-3">
                    {/* Indicator signals → MT5 Receiver EA */}
                    <div className="rounded-lg border border-slate-200 dark:border-borderdark p-2">
                        <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                            Auto-send to MT5 EA
                            <input type="checkbox" checked={bridge.enabled} onChange={e => setEaBridge({ enabled: e.target.checked })} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                        </label>
                        {bridge.enabled && (
                            <div className="mt-1.5 grid grid-cols-1 gap-1">
                                {EA_BRIDGE_SOURCES.map(src => (
                                    <label key={src.key} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                                        <input type="checkbox" checked={bridge.sources.includes(src.key)} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600"
                                            onChange={e => setEaBridge({ sources: e.target.checked ? [...bridge.sources, src.key] : bridge.sources.filter(k => k !== src.key) })} />
                                        {src.label}
                                    </label>
                                ))}
                            </div>
                        )}
                        <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
                            At each candle close, a ticked indicator that is on the active chart sends BUY/SELL with entry, SL and TP
                            (its own levels, else structure or ATR) — one signal per candle. The EA applies its own lot size,
                            break-even, trailing and drawdown limits. Works on the computer that runs the backend and MT5.
                        </p>
                    </div>

                    {/* Symbol */}
                    <div className="flex items-center gap-2.5">
                        <label className="text-[10px] font-medium text-slate-500 w-14 shrink-0 uppercase tracking-wider">Symbol</label>
                        <input
                            value={symbol}
                            onChange={e => setSymbol(e.target.value.toUpperCase())}
                            className={inputClass}
                            placeholder="XAUUSD"
                        />
                    </div>

                    {/* Action */}
                    <div className="flex items-center gap-2.5">
                        <label className="text-[10px] font-medium text-slate-500 w-14 shrink-0 uppercase tracking-wider">Action</label>
                        <div className="flex gap-1 flex-1 bg-slate-50 dark:bg-panelbg rounded-lg p-0.5 border border-slate-200 dark:border-borderdark">
                            {['BUY', 'SELL', 'CLOSE'].map(a => (
                                <button
                                    key={a}
                                    onClick={() => setAction(a)}
                                    className={`flex-1 py-1 rounded-md text-[10px] font-bold transition-all duration-150 ${
                                        action === a ? actionDef[a].active : `text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 ${actionDef[a].inactive}`
                                    }`}
                                >
                                    {a}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Price */}
                    <div className="flex items-center gap-2.5">
                        <label className="text-[10px] font-medium text-slate-500 w-14 shrink-0 uppercase tracking-wider">Price</label>
                        <input
                            type="number"
                            value={price}
                            onChange={e => setPrice(e.target.value)}
                            className={inputClass}
                            placeholder="2650.50"
                        />
                    </div>

                    {/* SL / TP */}
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="text-[10px] font-medium text-slate-500 block mb-1 uppercase tracking-wider">Stop Loss</label>
                            <input
                                type="number"
                                value={stopLoss}
                                onChange={e => setStopLoss(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-panelbg border border-slate-200 dark:border-borderdark rounded-lg px-2.5 py-1.5 text-xs text-red-400 font-mono placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
                                placeholder="2640"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] font-medium text-slate-500 block mb-1 uppercase tracking-wider">Take Profit</label>
                            <input
                                type="number"
                                value={takeProfit}
                                onChange={e => setTakeProfit(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-panelbg border border-slate-200 dark:border-borderdark rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 font-mono placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                                placeholder="2670"
                            />
                        </div>
                    </div>

                    {/* Send Button */}
                    <button
                        onClick={handleSend}
                        disabled={status === 'sending'}
                        className={`w-full py-2 rounded-xl text-xs font-semibold text-white transition-all duration-150 flex items-center justify-center gap-2 shadow-lg ${fireBtnColor} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {status === 'sending' ? (
                            <><Loader className="w-3.5 h-3.5 animate-spin" /> Sending...</>
                        ) : (
                            <><Zap className="w-3.5 h-3.5" /> Fire {action} Signal</>
                        )}
                    </button>

                    {/* Status */}
                    <div className={`flex items-start gap-1.5 text-[10px] ${statusColor} min-h-[16px]`}>
                        {status === 'ok'    && <><CheckCircle className="w-3 h-3 mt-px shrink-0" /><span>Signal sent: {lastSignal?.signal_id}</span></>}
                        {status === 'error' && <><XCircle className="w-3 h-3 mt-px shrink-0" /><span>{errorMsg}</span></>}
                    </div>

                    {/* Last signal details */}
                    {lastSignal && status === 'ok' && (
                        <div className="bg-slate-50 dark:bg-panelbg border border-slate-200 dark:border-borderdark rounded-lg p-2 text-[10px] font-mono text-slate-400 space-y-0.5">
                            <div><span className="text-slate-600">id:</span> {lastSignal.signal_id}</div>
                            <div><span className="text-slate-600">sym:</span> {lastSignal.symbol} | <span className="text-slate-600">action:</span> <span className={lastSignal.action === 'BUY' ? 'text-emerald-400' : lastSignal.action === 'SELL' ? 'text-red-400' : 'text-amber-400'}>{lastSignal.action}</span></div>
                            <div><span className="text-slate-600">price:</span> {lastSignal.price} | <span className="text-slate-600">sl:</span> {lastSignal.stop_loss} | <span className="text-slate-600">tp:</span> {lastSignal.take_profit}</div>
                        </div>
                    )}

                    {/* Utility row */}
                    <div className="flex gap-2 pt-1 border-t border-slate-200 dark:border-borderdark">
                        <button
                            onClick={handleClear}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-slate-50 dark:bg-panelbg hover:bg-slate-100 dark:hover:bg-surfacebg border border-slate-200 dark:border-borderdark text-slate-500 hover:text-red-400 rounded-lg text-[10px] font-medium transition-all duration-150"
                            title="Clear active signal for symbol"
                        >
                            <Trash2 className="w-3 h-3" /> Clear Signal
                        </button>
                        <button
                            onClick={handleHistory}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-slate-50 dark:bg-panelbg hover:bg-slate-100 dark:hover:bg-surfacebg border border-slate-200 dark:border-borderdark text-slate-500 hover:text-indigo-400 rounded-lg text-[10px] font-medium transition-all duration-150"
                            title="View last 50 signals"
                        >
                            <History className="w-3 h-3" /> History
                        </button>
                    </div>

                    {/* History panel */}
                    {showHist && history && (
                        <div className="bg-slate-50 dark:bg-panelbg border border-slate-200 dark:border-borderdark rounded-lg p-2 max-h-36 overflow-y-auto space-y-1.5 custom-scrollbar">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Last {history.length} Signals</span>
                                <button onClick={() => setShowHist(false)} className="text-[10px] text-slate-600 hover:text-slate-400 w-4 h-4 flex items-center justify-center">✕</button>
                            </div>
                            {history.length === 0 && <p className="text-[10px] text-slate-600">No signals yet.</p>}
                            {history.map(s => (
                                <div key={s.signal_id} className="text-[10px] font-mono text-slate-400 border-b border-slate-200 dark:border-borderdark pb-1 last:border-0 last:pb-0">
                                    <span className={s.action === 'BUY' ? 'text-emerald-400' : s.action === 'SELL' ? 'text-red-400' : 'text-amber-400'}>{s.action}</span>
                                    {' '}{s.symbol} @ {s.price} · SL {s.stop_loss} · TP {s.take_profit}
                                    <div className="text-slate-600">{s.signal_id}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
