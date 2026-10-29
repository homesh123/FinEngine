import { createPortal } from 'react-dom';
import React, { useState, useEffect, useRef } from 'react';
import { useMtfStats } from '../hooks/useMtfStats';
import { Settings2, X, Info } from 'lucide-react';
import GaugeWidget from './GaugeWidget';

const selVal = (tf) => ({ '1h': '60', '2h': '120', '4h': '240' })[tf] || tf;   // '1h' and '60' are the same option
const leanOf = (v) => (v > 10 ? 'Buy' : v < -10 ? 'Sell' : 'Neutral');

export default function TradersInterestWidget({ dataset, state, setState, compact = false }) {
    const [showSettings, setShowSettings] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [hoverAt, setHoverAt] = useState(null);       // fixed position of the hover summary
    const hoverRef = useRef(null);
    const onHover = () => {
        const r = hoverRef.current?.getBoundingClientRect();
        if (!r || window.innerWidth < 768) return;           // phones: use the ⓘ button
        const w = 288, left = r.left - w - 10 >= 8 ? r.left - w - 10 : Math.min(window.innerWidth - w - 8, r.right + 10);
        setHoverAt({ left, top: Math.max(8, Math.min(r.top, window.innerHeight - 330)) });
    };
    useEffect(() => {
        if (!showSettings && !showInfo) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { setShowSettings(false); setShowInfo(false); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showSettings, showInfo]);
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    const { indicatorSettings = {} } = state;
    const { tiLookback = 14, tiTf1 = '1h', tiTf2 = '4h', tiEnable1 = true, tiEnable2 = true } = indicatorSettings;

    const handleUpdate = (field, value) => {
        setState(prev => ({
            ...prev,
            indicatorSettings: {
                ...prev.indicatorSettings,
                [field]: value
            }
        }));
    };

    const stats = useMtfStats(dataset, state);

    const getScoreColor = (score) => {
        if (score > 40) return "#26a69a";
        if (score > 10) return "#80cbc4";
        if (score < -40) return "#ff5252";
        if (score < -10) return "#ef9a9a";
        return "#9e9e9e";
    };

    const c_buy_strong = "#26a69a";
    const c_sell_strong = "#ff5252";
    const scoreColor = getScoreColor(stats.score);
    const sigColor = stats.score > 40 ? "#4ade80" : stats.score < -40 ? "#f87171" : "#9ca3af";

    const ups = stats.parts.filter(p => p.s > 10).length, downs = stats.parts.filter(p => p.s < -10).length;
    const agreement = !stats.parts.length ? 'Waiting for chart data.' : ups === stats.parts.length ? `All ${ups} timeframes lean up — aligned.`
        : downs === stats.parts.length ? `All ${downs} timeframes lean down — aligned.`
        : ups && downs ? `Timeframes disagree (${ups} up, ${downs} down) — mixed, be careful.`
        : `No clear agreement (${ups} up, ${downs} down, ${stats.parts.length - ups - downs} neutral).`;
    const meaning = stats.score > 40 ? 'buyers are clearly in control'
        : stats.score > 10 ? 'buyers have a small edge'
        : stats.score < -40 ? 'sellers are clearly in control'
        : stats.score < -10 ? 'sellers have a small edge'
        : 'neither side is in control';
    const nextStep = stats.signalTxt === 'BUY' ? 'Signal BUY (score above +40).'
        : stats.signalTxt === 'SELL' ? 'Signal SELL (score below −40).'
        : 'Signal WAIT — BUY needs above +40, SELL below −40.';
    const leanCls = (v) => (v > 10 ? 'text-emerald-600 dark:text-emerald-400' : v < -10 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400');

    return (
        <div className="w-full flex flex-col gap-2" ref={hoverRef} onMouseEnter={onHover} onMouseLeave={() => setHoverAt(null)}>
            {hoverAt && !showInfo && !showSettings && createPortal(
                <div className={state.theme === 'dark' ? 'dark' : undefined}>
                    <div role="tooltip" style={{ left: hoverAt.left, top: hoverAt.top }}
                        className="fixed z-[330] w-72 pointer-events-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 backdrop-blur shadow-2xl p-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 ts-pop-in">
                        <div className="font-bold text-slate-800 dark:text-slate-100 text-xs">Traders Interest <span className="font-normal text-slate-500 dark:text-slate-400">· multi-timeframe meter</span></div>
                        <p className="mt-0.5">Buyer vs seller pressure on {stats.parts.length} timeframes (RSI + momentum). Score runs from −100 to +100.</p>
                        <p className="mt-1.5"><b className={leanCls(stats.score)}>Score {stats.score >= 0 ? '+' : ''}{stats.score.toFixed(1)} · {stats.trendLabel}</b> — {meaning}. {nextStep}</p>
                        <div className="mt-1.5 rounded-lg border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                            {stats.parts.map(p => (
                                <div key={p.tf + (p.chart ? 'c' : '')} className="flex justify-between px-2 py-1">
                                    <span>{p.tf}{p.chart ? ' (chart)' : ''}</span>
                                    <span className={`font-semibold tabular-nums ${leanCls(p.s)}`}>{p.s >= 0 ? '+' : ''}{p.s.toFixed(1)} · {leanOf(p.s)}</span>
                                </div>
                            ))}
                        </div>
                        <p className="mt-1.5">{agreement}</p>
                        <p className="mt-1 text-slate-500 dark:text-slate-400">Buy {stats.buyPct.toFixed(1)}% / Sell {stats.sellPct.toFixed(1)}% is the same score shown as a split. Click ⓘ for how it works.</p>
                    </div>
                </div>,
                document.body,
            )}
            {/* sidebar (compact): gauge and readings share one card below */}
            {!compact && (
            <div className="hidden md:block">
                <GaugeWidget score={stats.score} />
            </div>
            )}
            {/* compact = sidebar under the ad: gauge above, mobile-style rows below */}
            
            <div className="w-full mt-0 bg-slate-50 dark:bg-slate-900/40 rounded-none md:rounded-lg border-y md:border border-slate-200 dark:border-slate-700/50">
            <div className="flex items-center justify-between bg-slate-100 dark:bg-black/40 border-b border-slate-200 dark:border-slate-700 p-2 rounded-none md:rounded-t-lg">
                <div 
                    className="flex items-center gap-2 cursor-pointer flex-1"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    <span className="text-slate-400">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}>
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-bold text-xs">Traders Interest</span>
                    {isCollapsed && <span className="font-bold text-[11px] brightness-[.62] dark:brightness-100" style={{ color: scoreColor }}>{stats.trendLabel}</span>}
                </div>
                <div className="flex items-center gap-2">
                    {!compact && <span className="text-slate-500 dark:text-slate-400 font-bold text-[10px]">Triple TF</span>}
                    <button onClick={() => setShowInfo(true)} className="ts-tap text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 p-0.5 rounded transition-colors" title="What is this? (multi-timeframe meter)" aria-label="About Traders Interest">
                        <Info className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setShowSettings(true)} className="ts-tap text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 p-0.5 rounded transition-colors" title="Settings">
                        <Settings2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {!isCollapsed && (
                <>
                    {/* Sidebar: gauge left, readings right — one card instead of gauge + meter */}
                    {compact && (
                        <div className="flex items-center gap-2.5 px-2 py-1.5 bg-white dark:bg-cardbg rounded-b-lg">
                            <GaugeWidget score={stats.score} svgOnly />
                            <div className="min-w-0 flex-1 text-[11px] leading-snug">
                                <div className="text-sm font-semibold tracking-tight brightness-[.62] dark:brightness-100" style={{ color: scoreColor }}>{stats.trendLabel}</div>
                                <div className="text-slate-500 dark:text-slate-400 tabular-nums">Score <b className="brightness-[.62] dark:brightness-100" style={{ color: scoreColor }}>{stats.score >= 0 ? '+' : ''}{stats.score.toFixed(1)}</b> · <span className="whitespace-nowrap">Signal <b className="brightness-[.62] dark:brightness-100" style={{ color: sigColor }}>{stats.signalTxt}</b></span></div>
                                <div className="text-slate-500 dark:text-slate-400 tabular-nums">Buy <b className="text-emerald-700 dark:text-emerald-400">{stats.buyPct.toFixed(0)}%</b> · Sell <b className="text-red-700 dark:text-red-400">{stats.sellPct.toFixed(0)}%</b></div>
                            </div>
                        </div>
                    )}
                    {/* Mobile Ultra-Compact View */}
                    {!compact && <div className="md:hidden p-1.5 px-2 bg-slate-50 dark:bg-slate-900/20 text-[10px]">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-slate-500">Score: <span className="font-bold brightness-[.62] dark:brightness-100" style={{ color: scoreColor }}>{stats.score.toFixed(1)}</span></span>
                            <span className="text-slate-500">Buy: <span className="font-bold brightness-[.62] dark:brightness-100" style={{ color: c_buy_strong }}>{stats.buyPct.toFixed(1)}%</span></span>
                            <span className="text-slate-500">Sell: <span className="font-bold brightness-[.62] dark:brightness-100" style={{ color: c_sell_strong }}>{stats.sellPct.toFixed(1)}%</span></span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-500">Trend: <span className="font-bold brightness-[.62] dark:brightness-100" style={{ color: scoreColor }}>{stats.trendLabel}</span></span>
                            <span className="text-slate-500">Signal: <span className="font-bold brightness-[.62] dark:brightness-100" style={{ color: sigColor }}>{stats.signalTxt}</span></span>
                        </div>
                    </div>}

                    {/* Desktop Table View */}
                    <table className={`hidden ${compact ? '' : 'md:table'} w-full text-xs text-left border-collapse border-transparent`}>
                        <tbody>
                            <tr className="border-b border-slate-200 dark:border-slate-700/50">
                                <td className="p-1.5 px-2 text-slate-600 dark:text-slate-300">Score</td>
                                <td className="p-1.5 px-2 font-bold text-right brightness-[.62] dark:brightness-100" style={{ color: scoreColor }}>{stats.score.toFixed(1)}</td>
                            </tr>
                            <tr className="border-b border-slate-200 dark:border-slate-700/50">
                                <td className="p-1.5 px-2 text-slate-600 dark:text-slate-300">Buy%</td>
                                <td className="p-1.5 px-2 font-bold text-right brightness-[.62] dark:brightness-100" style={{ color: c_buy_strong }}>{stats.buyPct.toFixed(1)}%</td>
                            </tr>
                            <tr className="border-b border-slate-200 dark:border-slate-700/50">
                                <td className="p-1.5 px-2 text-slate-600 dark:text-slate-300">Sell%</td>
                                <td className="p-1.5 px-2 font-bold text-right brightness-[.62] dark:brightness-100" style={{ color: c_sell_strong }}>{stats.sellPct.toFixed(1)}%</td>
                            </tr>
                            <tr className="border-b border-slate-200 dark:border-slate-700/50">
                                <td className="p-1.5 px-2 text-slate-600 dark:text-slate-300">Trend</td>
                                <td className="p-1.5 px-2 font-bold text-right brightness-[.62] dark:brightness-100" style={{ color: scoreColor }}>{stats.trendLabel}</td>
                            </tr>
                            <tr>
                                <td className="p-1.5 px-2 text-slate-600 dark:text-slate-300 pb-2">Signal</td>
                                <td className="p-1.5 px-2 font-bold text-right pb-2 brightness-[.62] dark:brightness-100" style={{ color: sigColor }}>{stats.signalTxt}</td>
                            </tr>
                        </tbody>
                    </table>
                </>
            )}

            {showInfo && createPortal(
                <div className={state.theme === 'dark' ? 'dark' : undefined}>
                <div className="fixed inset-0 z-[320] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] sm:p-4 ts-scrim-in"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setShowInfo(false); }}>
                <div role="dialog" aria-label="About Traders Interest" className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-t-2xl sm:rounded-2xl shadow-2xl ts-pop-in text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">What is Traders Interest? <span className="font-normal text-slate-500 dark:text-slate-400">(multi-timeframe meter)</span></h3>
                        <button onClick={() => setShowInfo(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={14} /></button>
                    </div>
                    <p>It measures whether <b>buyers or sellers are in control</b> across three timeframes at once ("MTF" = multi-timeframe): this chart's timeframe plus {tiEnable1 ? ({ '15': '15m', '30': '30m', '60': '1h', '1h': '1h', '120': '2h', '240': '4h', '4h': '4h', '1D': '1D', '1W': '1W' })[tiTf1] || tiTf1 : '—'} and {tiEnable2 ? ({ '15': '15m', '30': '30m', '60': '1h', '1h': '1h', '120': '2h', '240': '4h', '4h': '4h', '1D': '1D', '1W': '1W' })[tiTf2] || tiTf2 : '—'} (change them with the gear icon).</p>
                    <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1">What it checks on each timeframe</div>
                        <ul className="list-disc ml-4 space-y-1">
                            <li><b>RSI ({tiLookback})</b> — are recent up-moves bigger than down-moves? Above 50 = buyers stronger. Contributes RSI − 50 (−50 … +50).</li>
                            <li><b>Momentum</b> — how far price moved over the last {tiLookback} candles compared with normal volatility (2 × ATR). Contributes −50 … +50.</li>
                        </ul>
                        <p className="mt-1">The two parts are added (−100 … +100) and the three timeframes are averaged into the <b>Score</b>.</p>
                    </div>
                    <table className="w-full border-collapse">
                        <tbody className="[&_td]:py-1 [&_td]:border-b [&_td]:border-slate-100 dark:[&_td]:border-slate-700">
                            <tr><td className="font-semibold">Score above +40</td><td className="text-emerald-600 dark:text-emerald-400 font-semibold">Strong Buy · signal BUY</td></tr>
                            <tr><td className="font-semibold">+10 to +40</td><td className="text-emerald-600 dark:text-emerald-400">Weak Buy · WAIT</td></tr>
                            <tr><td className="font-semibold">−10 to +10</td><td>Neutral · WAIT</td></tr>
                            <tr><td className="font-semibold">−40 to −10</td><td className="text-red-600 dark:text-red-400">Weak Sell · WAIT</td></tr>
                            <tr><td className="font-semibold">Below −40</td><td className="text-red-600 dark:text-red-400 font-semibold">Strong Sell · signal SELL</td></tr>
                        </tbody>
                    </table>
                    <p><b>Buy %</b> = (Score + 100) ÷ 2 and <b>Sell %</b> = 100 − Buy % — the same score shown as a split, not a count of real orders. The gauge shows the same score.</p>
                    <p className="text-slate-500 dark:text-slate-400">Agreement across timeframes matters most: a strong score means all three point the same way. It describes the current pressure, it does not predict the future — use it with your own analysis.</p>
                </div>
                </div>
                </div>,
                document.body,
            )}
            {showSettings && createPortal(
                <div className={state.theme === 'dark' ? 'dark' : undefined}>
                <div className="fixed inset-0 z-[320] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4 ts-scrim-in"
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
                <div role="dialog" aria-label="Traders Interest settings" className="w-full sm:max-w-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-t-2xl sm:rounded-2xl shadow-2xl ts-pop-in">
                    <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-100 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Traders Interest settings</h3>
                        <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={14} /></button>
                    </div>
                    
                    <div className="flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-slate-600 dark:text-slate-400">Lookback Period</span>
                            <input 
                                type="number" 
                                value={tiLookback} 
                                onChange={e => handleUpdate('tiLookback', parseInt(e.target.value) || 14)} 
                                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 w-16 px-1 py-1 rounded text-center" 
                            />
                        </div>
                        
                        <div className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-100 dark:border-slate-800">
                            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-bold mb-1">
                                <input type="checkbox" checked={tiEnable1} onChange={e => handleUpdate('tiEnable1', e.target.checked)} className="rounded" />
                                Enable Ref 1 MTF
                            </label>
                            <div className="flex justify-between items-center pl-5">
                                <span className="text-[10px] text-slate-500">Ref 1 Timeframe</span>
                                <select 
                                    value={selVal(tiTf1)} 
                                    onChange={e => handleUpdate('tiTf1', e.target.value)}
                                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-700 dark:text-slate-300 rounded px-1 py-0.5"
                                >
                                    <option value="15">15m</option>
                                    <option value="30">30m</option>
                                    <option value="60">1h</option>
                                    <option value="240">4h</option>
                                    <option value="1D">1D</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-100 dark:border-slate-800">
                            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-bold mb-1">
                                <input type="checkbox" checked={tiEnable2} onChange={e => handleUpdate('tiEnable2', e.target.checked)} className="rounded" />
                                Enable Ref 2 MTF
                            </label>
                            <div className="flex justify-between items-center pl-5">
                                <span className="text-[10px] text-slate-500">Ref 2 Timeframe</span>
                                <select 
                                    value={selVal(tiTf2)} 
                                    onChange={e => handleUpdate('tiTf2', e.target.value)}
                                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-700 dark:text-slate-300 rounded px-1 py-0.5"
                                >
                                    <option value="60">1h</option>
                                    <option value="120">2h</option>
                                    <option value="240">4h</option>
                                    <option value="1D">1D</option>
                                    <option value="1W">1W</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                </div>
                </div>,
                document.body,
            )}
        </div>
        </div>
    );
}
