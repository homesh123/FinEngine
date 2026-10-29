import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CANDLE_THEMES, candleColors } from '../utils/candleThemes';
import { confirmDialog } from '../utils/confirmDialog';
import { createPortal } from 'react-dom';
import FootprintSettingsPanel from './FootprintSettingsPanel';
import PressureSettingsPanel from './PressureSettingsPanel';
import { footprintSettings } from '../utils/footprint';
import { Search, Check, ChevronDown, Activity, Settings2, Bell, BellOff, AlarmClock, Sun, Moon, LineChart, Briefcase, Volume2, VolumeX, PanelRight, Share2, Maximize2, Minimize2 } from 'lucide-react';
import { searchSymbols } from '../utils/api';
import { useBrokerSession } from '../hooks/useBrokerSession';
import UpstoxBadge from './UpstoxBadge';
import { navigate } from '../utils/route';
import IndicatorPicker from './IndicatorPicker';
import { GRID_DEFAULTS, SESSION_LINE_DEFAULTS } from '../utils/chartGrid';
import { useNotifications } from '../hooks/useNotifications';
import { useAlertStore } from '../utils/alerts/alertStore';
import { resumeAudioContext, isAudioRunning } from '../utils/notificationSound';
import { useProMode } from '../hooks/useProMode';
import { LIVE_MODE } from '../utils/liveMode';

export default function Toolbar({ state, setState, reloadData, loading, onOpenAlerts, layoutActions }) {
    const broker = useBrokerSession();          // Indian symbols in search only for the owner with Upstox connected
    const [layoutMsg, setLayoutMsg] = useState('');
    const [indMenuOpen, setIndMenuOpen] = useState(false);
    const indMenuRef = useRef(null);
    const indMenuMobileRef = useRef(null);
    const [fpMenuOpen, setFpMenuOpen] = useState(false);
    const fpMenuRef = useRef(null);
    const fpMenuMobileRef = useRef(null);
    const { enabled: notifEnabled, toggle: toggleNotif } = useNotifications();
    const { alerts: userAlerts, settings: alertSettings } = useAlertStore();
    const activeAlerts = alertSettings.enabled ? userAlerts.filter(a => a.enabled).length : 0;
    const alertsButton = (mobile) => (
        <button
            onClick={onOpenAlerts}
            title={`Alerts (${activeAlerts} on)`}
            aria-label="Alerts"
            className={`relative ${mobile ? 'flex w-7 h-7' : 'hidden lg:flex w-7 h-7'} items-center justify-center rounded-lg border transition-colors shrink-0 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700`}
        >
            <AlarmClock className="w-3.5 h-3.5" />
            {activeAlerts > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-indigo-600 text-white text-[9px] leading-[14px] text-center font-bold">{activeAlerts}</span>
            )}
        </button>
    );
    const { isProMode } = useProMode();
    // Full-screen mode (browser Fullscreen API; hidden where unsupported, e.g. iPhone Safari)
    const canFullscreen = typeof document !== 'undefined' && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    const [isFullscreen, setIsFullscreen] = useState(() => !!(typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement)));
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('webkitfullscreenchange', onChange);
        return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('webkitfullscreenchange', onChange); };
    }, []);
    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            } else {
                const el = document.documentElement;
                await (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
            }
        } catch { /* blocked by the browser */ }
    };

    // Chart-only controls are hidden on the Investment / Options Algo tabs
    const isChartTab = state.activeTab === 'chart';

    useEffect(() => {
        const handleClickOutside = (event) => {
            const isOutsideFp = (!fpMenuRef.current || !fpMenuRef.current.contains(event.target)) && 
                                (!fpMenuMobileRef.current || !fpMenuMobileRef.current.contains(event.target));
            if (isOutsideFp) setFpMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleIndicatorToggle = (ind) => {
        setState(prev => ({
            ...prev,
            indicators: {
                ...prev.indicators,
                [ind]: !prev.indicators[ind]
            }
        }));
    };

    const [localSymbol, setLocalSymbol] = useState(state.symbol);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const searchRef = useRef(null);
    const suggestRef = useRef(null);       // the suggestion list (rendered in a portal)
    const [suggestPos, setSuggestPos] = useState(null);
    const debounceTimeout = useRef(null);

    // Sync local symbol if state changes externally
    useEffect(() => {
        setLocalSymbol(state.symbol);
    }, [state.symbol]);

    useEffect(() => {
        const handleClickOutsideSearch = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target) && !suggestRef.current?.contains(event.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutsideSearch);
        return () => document.removeEventListener('mousedown', handleClickOutsideSearch);
    }, []);

    // The suggestion list is rendered at page level (portal) so the toolbar rows
    // and tab bar below the search box can't cover it on phones; keep it under
    // the box and inside the screen.
    useEffect(() => {
        if (!showSuggestions) return undefined;
        const place = () => {
            const r = searchRef.current?.getBoundingClientRect();
            if (!r) return;
            const w = Math.min(256, window.innerWidth - 16);
            setSuggestPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), width: w });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [showSuggestions]);

    const fetchSuggestions = async (query) => {
        if (!query.trim()) {
            setSuggestions([]);
            return;
        }
        setIsSearching(true);
        // Owner + Upstox connected: NSE/BSE stocks and indices first, then the usual (MT5) symbols
        const [india, results] = await Promise.all([
            broker.ready ? searchSymbols(query, 'upstox') : Promise.resolve([]),
            searchSymbols(query),
        ]);
        // Cap to 10 results for a clean UI
        setSuggestions(india.length ? [...india.slice(0, 7), ...results].slice(0, 10) : results.slice(0, 10));
        setIsSearching(false);
    };

    const handleSymbolChange = (e) => {
        const val = e.target.value.toUpperCase();
        setLocalSymbol(val);
        setShowSuggestions(true);
        
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        debounceTimeout.current = setTimeout(() => {
            fetchSuggestions(val);
        }, 300);
    };

    const getDefaultTickSize = (sym) => {
        return 1;
    };

    const handleSymbolSelect = (sym) => {
        setLocalSymbol(sym);
        setShowSuggestions(false);
        setState(prev => ({ ...prev, symbol: sym, tickSize: getDefaultTickSize(sym) }));
    };

    const handleSymbolSubmit = () => {
        if (localSymbol.trim() && localSymbol.trim() !== state.symbol) {
            let sym = localSymbol.trim().toUpperCase();
            setState(prev => ({ ...prev, symbol: sym, tickSize: getDefaultTickSize(sym) }));
            setShowSuggestions(false);
        }
    };
    const renderChartSettings = (isMobile) => (
        <div className={`relative ${isMobile ? 'flex lg:hidden' : 'hidden lg:flex'}`} ref={isMobile ? fpMenuMobileRef : fpMenuRef}>
            <button 
                onClick={() => setFpMenuOpen(!fpMenuOpen)}
                className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 h-7"
                title="Chart Settings"
            >
                <Settings2 size={14} />
            </button>
            {fpMenuOpen && (
                // Mobile: a fixed sheet (the toolbar row scrolls sideways and would clip
                // or hide a dropdown); desktop: dropdown under the button. Both scroll.
                <div className={`${isMobile
                    ? 'fixed left-2 right-2 top-[92px] max-h-[calc(100dvh-100px)] z-[200] ts-pop-in origin-top'
                    : 'absolute top-8 right-0 md:left-0 md:right-auto w-64 max-h-[calc(100dvh-90px)] z-50 ts-pop-in origin-top-left'} overflow-y-auto overscroll-contain custom-scrollbar bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-3`}>
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 pb-2 border-b border-slate-100 dark:border-slate-700">Chart Settings</h3>
                    
                    <div className="flex flex-col gap-2 mb-3">
                        {(() => {
                            const g = { ...GRID_DEFAULTS, ...(state.grid || {}) };
                            const setG = (patch) => setState(prev => ({ ...prev, grid: { ...GRID_DEFAULTS, ...(prev.grid || {}), ...patch } }));
                            return (
                                <div className="flex flex-col gap-1.5">
                                    <label className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                                        Grid lines
                                        <input type="checkbox" checked={!!g.gridShow} onChange={() => setG({ gridShow: !g.gridShow })} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                                    </label>
                                    {g.gridShow && (
                                        <div className="flex items-center gap-2 pl-2">
                                            <input type="color" value={g.gridColor} onChange={e => setG({ gridColor: e.target.value })}
                                                aria-label="Grid colour" title="Grid colour"
                                                className="w-7 h-6 p-0 border border-slate-300 dark:border-slate-600 rounded cursor-pointer bg-transparent" />
                                            <input type="range" min="10" max="100" step="5" value={g.gridOpacity} onChange={e => setG({ gridOpacity: Number(e.target.value) })}
                                                aria-label="Grid opacity" title="Grid opacity" className="flex-1 accent-indigo-600" />
                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 w-8 text-right tabular-nums">{g.gridOpacity}%</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                        <label className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                            Show Session Lines
                            <input type="checkbox" checked={state.layers.sessionLines} onChange={() => setState(prev => ({ ...prev, layers: {...prev.layers, sessionLines: !prev.layers.sessionLines}}))} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                        </label>
                        {state.layers.sessionLines !== false && (() => {
                            const L = { ...SESSION_LINE_DEFAULTS, ...state.layers };
                            const setL = (patch) => setState(prev => ({ ...prev, layers: { ...prev.layers, ...patch } }));
                            return (
                                <div className="flex items-center gap-2 pl-2 -mt-0.5">
                                    <input type="color" value={L.sessionLineColor} onChange={e => setL({ sessionLineColor: e.target.value })}
                                        aria-label="Session line colour" title="Session line colour"
                                        className="w-7 h-6 p-0 border border-slate-300 dark:border-slate-600 rounded cursor-pointer bg-transparent" />
                                    <input type="range" min="10" max="100" step="5" value={L.sessionLineOpacity} onChange={e => setL({ sessionLineOpacity: Number(e.target.value) })}
                                        aria-label="Session line opacity" title="Session line opacity" className="flex-1 accent-indigo-600" />
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 w-8 text-right tabular-nums">{L.sessionLineOpacity}%</span>
                                </div>
                            );
                        })()}
                        {/* One switch for both versions: order-flow odds on footprint charts,
                            candle-pattern odds on the other chart types */}
                        <label
                            className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer"
                            title="Beside the live candle: its typical range and the odds it closes up or down, from what followed similar candles on this chart. Shows how often its past calls were right; a direction only appears with a proven edge. Statistics, not a guarantee."
                        >
                            Next-candle projection
                            <input type="checkbox"
                                checked={state.chartType === 'footprint' ? footprintSettings(state.footprintSettings).projection : !!state.indicators.nextProjection}
                                onChange={() => setState(prev => (prev.chartType === 'footprint'
                                    ? { ...prev, footprintSettings: { ...footprintSettings(prev.footprintSettings), projection: !footprintSettings(prev.footprintSettings).projection } }
                                    : { ...prev, indicators: { ...prev.indicators, nextProjection: !prev.indicators.nextProjection } }))}
                                className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                        </label>
                        {/* Projection options (standard charts): length, trendline, support / resistance */}
                        {state.chartType !== 'footprint' && state.indicators.nextProjection && (() => {
                            const PS = state.indicatorSettings || {};
                            const setPS = (patch) => setState(prev => ({ ...prev, indicatorSettings: { ...prev.indicatorSettings, ...patch } }));
                            return (
                                <div className="flex flex-col gap-1.5 pl-3 -mt-0.5 border-l-2 border-slate-200 dark:border-slate-700">
                                    <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                                        Projection length
                                        <select value={String(PS.ppHorizon ?? 5)} onChange={e => setPS({ ppHorizon: Number(e.target.value) })} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 rounded px-1 py-0.5">
                                            <option value="0">0 · current candle</option>
                                            <option value="1">1 · next candle</option>
                                            <option value="3">3 candles</option>
                                            <option value="5">5 candles</option>
                                            <option value="10">10 candles</option>
                                        </select>
                                    </label>
                                    <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400" title="How many past moments that looked most like now are used. Fewer = closer matches but noisier; more = smoother but less specific.">
                                        Similar past moments
                                        <select value={String(PS.ppAnalogs ?? 30)} onChange={e => setPS({ ppAnalogs: Number(e.target.value) })} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 rounded px-1 py-0.5">
                                            <option value="10">10</option>
                                            <option value="30">30</option>
                                            <option value="50">50</option>
                                        </select>
                                    </label>
                                    <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer" title="Line through the last two rising swing lows (uptrend) or falling swing highs (downtrend) of this timeframe, shown while price hasn't closed through it">
                                        Trendline (this timeframe)
                                        <input type="checkbox" checked={PS.ppTrend !== false} onChange={e => setPS({ ppTrend: e.target.checked })} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                                    </label>
                                    <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer" title="The 2 nearest levels above and below price where several swing highs / lows cluster; more touches = stronger">
                                        Support / resistance levels
                                        <input type="checkbox" checked={PS.ppSR !== false} onChange={e => setPS({ ppSR: e.target.checked })} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                                    </label>
                                    <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer" title="A BUY or SELL only when the Traders Interest meter is strong and aligned, the prediction agrees, the Pressure trend is not against it and the levels leave room (reward at least 1.5x the risk). Shows stop loss, take profit and a lot size for your balance. Can also be used in Alerts. Experimental: no proven edge in our tests yet. Only on 15m and higher. Not advice.">
                                        <span>Buy / sell signals<span className="ml-1 align-middle rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Experimental</span></span>
                                        <input type="checkbox" checked={!!PS.ppSignals} onChange={e => setPS({ ppSignals: e.target.checked })} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                                    </label>
                                    {PS.ppSignals && (
                                        <div className="flex flex-col gap-1 pl-2">
                                            <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-300/90">Not a proven edge yet — check the live record before trading. Shown on 15m and higher only.</p>
                                            <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400" title="Used for the lot size">
                                                Account balance ($)
                                                <input type="number" min="10" max="10000000" step="10" value={PS.sigBalance ?? 1000} onChange={e => setPS({ sigBalance: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 rounded px-1 py-0.5 text-right" />
                                            </label>
                                            <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400" title="Money lost if the stop loss is hit, as a % of the balance. 0.5-1% is a safe range.">
                                                Risk per trade (%)
                                                <input type="number" min="0.1" max="5" step="0.1" value={PS.sigRiskPct ?? 1} onChange={e => setPS({ sigRiskPct: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 rounded px-1 py-0.5 text-right" />
                                            </label>
                                            <label className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400" title="Your broker leverage; lots are reduced if margin would exceed 30% of the balance">
                                                Leverage (1:x)
                                                <input type="number" min="1" max="3000" step="1" value={PS.sigLeverage ?? 100} onChange={e => setPS({ sigLeverage: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 rounded px-1 py-0.5 text-right" />
                                            </label>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                        <label
                            className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer"
                            title="Markers at the bottom of the chart for high/medium-impact news of this symbol's currencies (Forex Factory). Hover a marker for details."
                        >
                            Economic calendar
                            <input type="checkbox" checked={state.showCalendar !== false}
                                onChange={() => setState(prev => ({ ...prev, showCalendar: prev.showCalendar === false }))}
                                className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                        </label>
                        {/* Pro-only options (grid, session lines, projection and calendar are for everyone) */}
                        {isProMode && (<>
                        <label className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                            Show DOM Panel
                            <input type="checkbox" checked={state.showDOM} onChange={() => setState(prev => ({ ...prev, showDOM: !prev.showDOM }))} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                        </label>
                        <label className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                            Show Traders Interest
                            <input type="checkbox" checked={state.showTradersInterest !== false} onChange={() => setState(prev => ({ ...prev, showTradersInterest: prev.showTradersInterest === false }))} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                        </label>
                        {!LIVE_MODE && <label className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer" title="Show the Signal Tester panel in the sidebar (hidden by default). Auto-send to MT5 EA keeps working with the indicators you ticked.">
                            Show Signal Tester
                            <input type="checkbox" checked={state.showSignalTester === true} onChange={() => setState(prev => ({ ...prev, showSignalTester: prev.showSignalTester !== true }))} className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                        </label>}
                        </>)}
                    </div>

                    {/* Candle colours (themes, custom) and Layout save / load / reset */}
                    {(() => {
                        const dark = state.theme === 'dark';
                        const theme = CANDLE_THEMES[state.candleTheme] ? state.candleTheme : 'default';
                        const cc = state.candleColors || {};
                        const setCC = (patch) => setState(prev => ({ ...prev, candleColors: { ...(prev.candleColors || {}), ...patch } }));
                        // two little candles drawn with the theme's colours
                        const Preview = ({ k }) => {
                            const c = candleColors({ candleTheme: k, candleColors: state.candleColors }, dark, dark ? '#05080f' : '#ffffff');
                            const C = ({ body, border, wick, h, y0 }) => (<g><line x1="0" x2="0" y1={y0 - 3} y2={y0 + h + 3} stroke={wick} strokeWidth="1" /><rect x="-3.5" y={y0} width="7" height={h} fill={body} stroke={border} strokeWidth="1" rx="0.5" /></g>);
                            return (<svg width="26" height="20" viewBox="-6 0 26 20" aria-hidden className="shrink-0 rounded bg-white dark:bg-[#05080f] ring-1 ring-slate-200 dark:ring-slate-700">
                                <g transform="translate(2,0)"><C body={c.upBody} border={c.upBorder} wick={c.upWick} h={8} y0={6} /></g>
                                <g transform="translate(12,0)"><C body={c.downBody} border={c.downBorder} wick={c.downWick} h={9} y0={5} /></g>
                            </svg>);
                        };
                        const sw = "w-6 h-6 p-0 border border-slate-300 dark:border-slate-600 rounded-full cursor-pointer bg-transparent overflow-hidden [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full";
                        const btn = "flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors";
                        const flash = (m) => { setLayoutMsg(m); setTimeout(() => setLayoutMsg(''), 2500); };
                        return (
                            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-2">
                                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Candle colours</div>
                                <div className="flex items-center gap-2">
                                    <Preview k={theme} />
                                    <select value={theme} onChange={e => setState(prev => ({ ...prev, candleTheme: e.target.value }))} aria-label="Candle colour theme"
                                        className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 rounded-md px-1.5 py-1">
                                        {Object.entries(CANDLE_THEMES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                                    </select>
                                </div>
                                {theme === 'custom' && (
                                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5 pl-1 text-[11px] text-slate-600 dark:text-slate-400">
                                        <span />
                                        <span className="text-center">Up</span><span className="text-center">Down</span>
                                        {[['Body', 'upBody', 'downBody'], ['Outline', 'upBorder', 'downBorder'], ['Wick', 'upWick', 'downWick']].map(([label, u, d]) => (
                                            <React.Fragment key={label}>
                                                <span>{label}</span>
                                                <input type="color" aria-label={`Up candle ${label.toLowerCase()} colour`} value={cc[u] || cc.upBorder || '#22c55e'} onChange={e => setCC({ [u]: e.target.value })} className={sw} />
                                                <input type="color" aria-label={`Down candle ${label.toLowerCase()} colour`} value={cc[d] || cc.downBorder || '#ef4444'} onChange={e => setCC({ [d]: e.target.value })} className={sw} />
                                            </React.Fragment>
                                        ))}
                                    </div>
                                )}
                                {layoutActions && (<>
                                    <div className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Layout <span className="font-normal text-[10px] text-slate-400">· saved in this browser</span></div>
                                    <div className="flex gap-1.5">
                                        <button type="button" onClick={() => flash(layoutActions.save() ? 'Layout saved' : 'Could not save (browser storage blocked)')}
                                            className={`${btn} border-indigo-200 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100`}>Save</button>
                                        <button type="button" disabled={!layoutActions.hasSaved} onClick={() => flash(layoutActions.load() ? 'Saved layout loaded' : 'No saved layout yet')}
                                            className={`${btn} border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40`}>Load saved</button>
                                        <button type="button" onClick={async () => {
                                            if (await confirmDialog({ title: 'Reset the chart layout?', message: 'Removes the indicators you added and restores the defaults (Gold Move and Supply / Demand), candles and the default colours. Your symbol, timeframe and drawings stay. A saved layout is kept.', confirmLabel: 'Reset layout', danger: true })) { layoutActions.reset(); flash('Layout reset to default'); }
                                        }} className={`${btn} border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}>Reset</button>
                                    </div>
                                    {layoutMsg && <div role="status" className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{layoutMsg}</div>}
                                </>)}
                            </div>
                        );
                    })()}

                    {/* Chart patterns: harmonics, head & shoulders, double tops/bottoms, triangles/wedges (all users) */}
                    {(() => {
                        const S = state.indicatorSettings || {};
                        const setS = (patch) => setState(prev => ({ ...prev, indicatorSettings: { ...prev.indicatorSettings, ...patch } }));
                        const row = "flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 cursor-pointer";
                        const cb = "rounded border-slate-300 dark:border-slate-600 text-indigo-600";
                        return (
                            <div className="mb-3 pt-2 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-2">
                                <label className={row} title="Find common chart patterns on the price swings and mark them on the chart with their name">
                                    <span className="font-semibold text-slate-700 dark:text-slate-300">Chart patterns</span>
                                    <input type="checkbox" checked={!!S.ptEnabled} onChange={e => setS({ ptEnabled: e.target.checked })} className={cb} />
                                </label>
                                {S.ptEnabled && (
                                    <div className="flex flex-col gap-2 pl-2 border-l-2 border-slate-100 dark:border-slate-700">
                                        <label className={row}>Harmonic (Gartley, Bat, Butterfly, Crab, Cypher)
                                            <input type="checkbox" checked={S.ptHarmonic !== false} onChange={e => setS({ ptHarmonic: e.target.checked })} className={cb} /></label>
                                        <label className={row}>Head &amp; Shoulders (and inverse)
                                            <input type="checkbox" checked={S.ptHeadShoulders !== false} onChange={e => setS({ ptHeadShoulders: e.target.checked })} className={cb} /></label>
                                        <label className={row}>Double Top / Bottom
                                            <input type="checkbox" checked={S.ptDouble !== false} onChange={e => setS({ ptDouble: e.target.checked })} className={cb} /></label>
                                        <label className={row}>Triangles &amp; Wedges
                                            <input type="checkbox" checked={S.ptTriangles !== false} onChange={e => setS({ ptTriangles: e.target.checked })} className={cb} /></label>
                                        <label className={row}>Flag &amp; Pole
                                            <input type="checkbox" checked={S.ptFlags !== false} onChange={e => setS({ ptFlags: e.target.checked })} className={cb} /></label>
                                        <label className={row}>Cup and Handle
                                            <input type="checkbox" checked={S.ptCup !== false} onChange={e => setS({ ptCup: e.target.checked })} className={cb} /></label>
                                        <label className={row} title="Patterns still forming at the current candle: shows the zone where they would complete">Potential patterns (projected zones)
                                            <input type="checkbox" checked={S.ptPotential !== false} onChange={e => setS({ ptPotential: e.target.checked })} className={cb} /></label>
                                        <label className={row}>Swing size
                                            <select value={S.ptSensitivity || 'medium'} onChange={e => setS({ ptSensitivity: e.target.value })}
                                                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded px-1.5 py-1">
                                                <option value="low">Large swings (fewer)</option>
                                                <option value="medium">Medium</option>
                                                <option value="high">Small swings (more)</option>
                                            </select></label>
                                        <p className="text-[10px] text-slate-400 leading-snug">Shapes found automatically on this chart's price swings. "Potential" zones show where a pattern still forming would complete; "forming" ones can still change. Not trade signals. Shown on standard charts (not footprint).</p>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {state.chartType === 'footprint' && (
                        <FootprintSettingsPanel state={state} setState={setState} />
                    )}
                    {state.chartType === 'pressure' && (
                        <PressureSettingsPanel state={state} setState={setState} />
                    )}
                </div>
            )}
        </div>
    );

    const renderIndicators = (isMobile) => (
        <div className={`relative ${isMobile ? 'flex lg:hidden' : 'hidden lg:flex'}`} ref={isMobile ? indMenuMobileRef : indMenuRef}>
            <button 
                onClick={() => setIndMenuOpen(!indMenuOpen)} 
                title="Indicators"
                className={`flex items-center gap-1 h-7 px-2 rounded-lg border text-xs font-medium transition-all duration-150 shrink-0 ${
                    indMenuOpen
                    ? 'bg-slate-100 dark:bg-surfacebg text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                    : 'text-slate-500 dark:text-slate-400 border-slate-200/80 dark:border-borderdark hover:bg-slate-100 dark:hover:bg-surfacebg hover:text-slate-600 dark:hover:text-slate-300'
                }`}
            >
                <Activity className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Indicators</span>
            </button>
        </div>
    );

    return (
        <>
        <div className="flex items-center justify-between px-3 py-0 bg-white dark:bg-cardbg border-b border-slate-200/80 dark:border-borderdark shrink-0 w-full gap-2 relative z-50 h-11">
            
            {/* Left: Fixed content (Brand, Search) */}
            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                <div className="mr-1 xl:mr-4 ml-1 hidden lg:flex items-center gap-2 shrink-0">
                    <img src={state.theme === 'dark' ? '/logo.svg' : '/logo-light.svg'} alt="" width="26" height="26" className="shrink-0" />
                    <span className="hidden xl:inline font-brand font-semibold text-xl tracking-[-0.02em] text-slate-900 dark:text-white cursor-default">Trade<span className="text-emerald-600 dark:text-emerald-400">Sagar</span></span>
                </div>
                
                {/* Mobile / tablet logo: the boat only (the wordmark is on the desktop header) */}
                <div className="lg:hidden mr-1 ml-0.5 flex items-center gap-1.5 shrink-0">
                    <img src={state.theme === 'dark' ? '/logo.svg' : '/logo-light.svg'} alt="TradeSagar" width="22" height="22" className="shrink-0" />
                </div>
                
                {/* Mode Selector (Dropdown) — Charts and Investment for everyone; "Algo trading (India)" opens /india
                    for the owner while Upstox is connected */}
                <div className="flex shrink-0">
                    <select 
                        value={state.activeTab}
                        onChange={e => (e.target.value === 'india' ? navigate('/india') : setState(prev => ({ ...prev, activeTab: e.target.value })))}
                        className="bg-slate-100 dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold text-xs rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-800 focus:outline-none h-[26px] cursor-pointer"
                        title="Select Mode"
                    >
                        <option value="chart">Charts</option>
                        <option value="investment">Investment</option>
                        {broker.ready && <option value="india">Algo trading (India)</option>}
                    </select>
                </div>

                {isChartTab && (<>
                <div className="h-4 w-px bg-slate-200 dark:bg-borderdark mx-1.5 shrink-0"></div>
                
                <div ref={searchRef} className="relative flex items-center bg-slate-100/80 dark:bg-panelbg rounded-lg px-2.5 border border-slate-200/80 dark:border-borderdark h-[28px] min-w-[84px] sm:min-w-[110px]">
                    <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 mr-1.5 shrink-0" />
                    <input 
                        type="text" 
                        value={localSymbol} 
                        onChange={handleSymbolChange}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSymbolSubmit()}
                        className="bg-transparent text-sm text-slate-800 dark:text-slate-200 font-bold w-[4.5rem] min-[400px]:w-20 sm:w-24 focus:outline-none uppercase min-w-0" 
                        placeholder="Symbol"
                        autoComplete="off"
                        spellCheck="false"
                    />
                    
                    {showSuggestions && (localSymbol.trim() !== '') && suggestPos && createPortal(
                        <div className={state.theme === 'dark' ? 'dark' : undefined}>
                        <div ref={suggestRef} style={{ top: suggestPos.top, left: suggestPos.left, width: suggestPos.width }}
                            className="fixed bg-white dark:bg-cardbg border border-slate-200 dark:border-borderdark rounded-md shadow-2xl z-[350] overflow-hidden flex flex-col max-h-[300px]">
                            {isSearching ? (
                                <div className="p-3 text-xs text-slate-500 flex items-center">
                                    <Activity className="w-3 h-3 animate-spin mr-2" /> Searching...
                                </div>
                            ) : suggestions.length > 0 ? (
                                <div className="overflow-y-auto custom-scrollbar">
                                    {suggestions.map((item, idx) => (
                                        <div 
                                            key={`${item.symbol}-${idx}`}
                                            onClick={() => handleSymbolSelect(item.symbol)}
                                            className="px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer border-b border-slate-100 dark:border-slate-800/50 last:border-0 flex items-center justify-between group"
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{item.symbol}</span>
                                                <span className="text-[10px] text-slate-500 truncate max-w-[140px]" title={item.name}>{item.name}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="flex gap-1">
                                                    {item.fo && <span className="text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20 px-1 rounded" title="Has futures & options">F&O</span>}
                                                    <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-1 rounded">{item.type}</span>
                                                </span>
                                                <span className="text-[9px] text-slate-400 dark:text-slate-600 mt-0.5">{item.exchange}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-3 text-xs text-slate-500">No matching symbols</div>
                            )}
                        </div>
                        </div>,
                        document.body,
                    )}
                </div>
                </>)}
            </div>
                
            {/* Middle: Scrollable content (Timeframes, Chart Type) */}
            <div className="flex items-center gap-1.5 flex-1 overflow-x-auto no-scrollbar pr-2 pb-0.5" style={{ WebkitOverflowScrolling: 'touch' }}>
                {isChartTab && (<>
                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1 shrink-0"></div>
                
                {/* Timeframe — compact dropdown on laptops, button strip on wide screens */}
                <select
                    value={state.timeframe}
                    onChange={e => setState(prev => ({ ...prev, timeframe: parseInt(e.target.value) }))}
                    aria-label="Timeframe"
                    className="hidden lg:block 2xl:hidden shrink-0 bg-slate-100 dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-800 focus:outline-none h-[26px]"
                >
                    {[['1m', 1], ['3m', 3], ['5m', 5], ['15m', 15], ['30m', 30], ['45m', 45], ['1H', 60], ['4H', 240], ['1D', 1440]].map(([label, value]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </select>
                <div className="hidden 2xl:flex shrink-0 items-center gap-0.5 bg-slate-100/70 dark:bg-panelbg rounded-lg p-0.5 border border-slate-200/60 dark:border-borderdark">
                    {[
                        { label: '1m', value: 1 },
                        { label: '3m', value: 3 },
                        { label: '5m', value: 5 },
                        { label: '15m', value: 15 },
                        { label: '30m', value: 30 },
                        { label: '45m', value: 45 },
                        { label: '1H', value: 60 },
                        { label: '4H', value: 240 },
                        { label: '1D', value: 1440 }
                    ].map(tf => (
                        <button
                            key={tf.value}
                            onClick={() => setState(prev => ({ ...prev, timeframe: tf.value }))}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all duration-150 ${
                                state.timeframe === tf.value
                                    ? 'bg-white dark:bg-surfacebg text-indigo-600 dark:text-indigo-400 shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            {tf.label}
                        </button>
                    ))}
                </div>

                <div className="hidden lg:block h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>
                {/* Layout Setup */}
                <select 
                    value={state.layout} 
                    onChange={e => setState(prev => ({ ...prev, layout: e.target.value }))}
                    title="Layout: 1 chart, 2 charts (multi-timeframe) or 3 charts (1H / 4H / 15m)"
                    className="hidden lg:block shrink-0 bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-800 focus:outline-none h-[26px]"
                >
                    <option value="single">1 chart</option>
                    <option value="split">2 charts</option>
                    <option value="tri-split">3 charts</option>
                </select>

                <div className="hidden lg:block h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>
                
                {/* Chart Type Setup */}
                <select 
                    value={state.chartType} 
                    onChange={e => setState(prev => ({ ...prev, chartType: e.target.value }))}
                    className="hidden lg:block shrink-0 bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-800 focus:outline-none h-[26px]"
                >
                    <option value="footprint">Footprint</option>
                    {isProMode && <option value="pressure">Pressure</option>}
                    <option value="ocean">Ocean (story)</option>
                    <option value="candlestick">Candles</option>
                    <option value="heikin-ashi">Heikin-Ashi</option>
                    <option value="line">Line</option>
                    <option value="ohlc">OHLC</option>
                </select>
                </>)}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1 md:gap-1.5 shrink-0">

                {isChartTab && (<>
                {renderChartSettings(false)}
                {renderIndicators(false)}
                <div className="hidden lg:block h-5 w-px bg-slate-200/80 dark:bg-borderdark mx-1"></div>

                {/* Alerts panel (TradingView-style alert manager) — Pro only */}
                {alertsButton(false)}

                {/* Desktop Notification + Sound toggles */}
                <button
                    onClick={toggleNotif}
                    title={notifEnabled ? 'Disable notifications' : 'Enable notifications'}
                    className={`hidden lg:flex items-center justify-center w-7 h-7 rounded-lg border transition-all duration-150 shrink-0 ${
                        notifEnabled
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
                        : 'text-slate-500 dark:text-slate-400 border-slate-200/80 dark:border-borderdark hover:bg-slate-100 dark:hover:bg-surfacebg hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                >
                    {notifEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                </button>

                <button
                    onClick={() => { resumeAudioContext(); }}
                    title="Enable notification sound (unlock audio)"
                    className={`hidden lg:flex items-center justify-center w-7 h-7 rounded-lg border transition-all duration-150 shrink-0 ${
                        isAudioRunning()
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
                        : 'text-slate-500 dark:text-slate-400 border-slate-200/80 dark:border-borderdark hover:bg-slate-100 dark:hover:bg-surfacebg hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                >
                    {isAudioRunning() ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </button>

                {/* MT5 Account Manager — Pro only */}
                {isProMode && (
                <button 
                    onClick={() => navigate('/accounts')}
                    className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200/80 dark:border-borderdark text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surfacebg hover:text-slate-600 dark:hover:text-slate-300 transition-all duration-150 shrink-0"
                    title="Manage MT5 Accounts for Algo Trading"
                >
                    <Settings2 className="w-3.5 h-3.5" />
                </button>
                )}

                {/* Upstox (Indian stocks) — owner only: connected user + log out */}
                <div className="hidden lg:flex"><UpstoxBadge /></div>

                <div className="hidden lg:block h-5 w-px bg-slate-200/80 dark:bg-borderdark mx-1"></div>
                </>)}

                {canFullscreen && (
                    <button
                        onClick={toggleFullscreen}
                        title={isFullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
                        aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                        className="flex w-7 h-7 shrink-0 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-surfacebg border border-transparent hover:border-slate-200/80 dark:hover:border-borderdark transition-all duration-150"
                    >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                )}
                <button
                    onClick={() => setState(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}
                    className="flex w-7 h-7 shrink-0 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-surfacebg border border-transparent hover:border-slate-200/80 dark:hover:border-borderdark transition-all duration-150"
                    title="Toggle Theme"
                >
                    {state.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>

                <button 
                    onClick={async () => {
                        const url = window.location.href;
                        if (navigator.share) {
                            try { await navigator.share({ title: 'TradeSagar', url }); } catch (e) {}
                        } else {
                            navigator.clipboard.writeText(url);
                            alert('Link copied to clipboard!');
                        }
                    }}
                    className="hidden sm:flex w-7 h-7 shrink-0 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-surfacebg border border-transparent hover:border-slate-200/80 dark:hover:border-borderdark transition-all duration-150"
                    title="Share Chart Link"
                >
                    <Share2 className="w-4 h-4" />
                </button>

                {isProMode && isChartTab && (
                <button 
                    onClick={() => setState(prev => ({ ...prev, sidebarOpen: !prev.sidebarOpen }))} 
                    className={`hidden lg:flex p-1.5 rounded-lg border transition-colors shrink-0 ${
                        state.sidebarOpen 
                        ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/50' 
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                    }`}
                    title="Toggle Sidebar"
                >
                    <PanelRight className="w-4 h-4" />
                </button>
                )}
            </div>
        </div>
        
        {/* Mobile / tablet sub-bar (chart tab): pickers left, chart tools + alert toggles right */}
        {state.activeTab === 'chart' && (
            <div className="flex lg:hidden items-center p-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 w-full gap-2 relative z-[110]">
                <div className="flex items-center gap-2 flex-1 overflow-x-auto no-scrollbar min-w-0" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <select
                        value={state.timeframe}
                        onChange={e => setState(prev => ({ ...prev, timeframe: parseInt(e.target.value) }))}
                        aria-label="Timeframe"
                        className="bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-700 focus:outline-none h-7 min-w-[60px] shrink-0"
                    >
                        {[
                            { label: '1m', value: 1 }, { label: '3m', value: 3 }, { label: '5m', value: 5 }, { label: '15m', value: 15 },
                            { label: '30m', value: 30 }, { label: '45m', value: 45 }, { label: '1H', value: 60 },
                            { label: '4H', value: 240 }, { label: '1D', value: 1440 }
                        ].map(tf => (
                            <option key={tf.value} value={tf.value}>{tf.label}</option>
                        ))}
                    </select>

                    <select
                        value={state.chartType}
                        onChange={e => setState(prev => ({ ...prev, chartType: e.target.value }))}
                        aria-label="Chart type"
                        className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-700 focus:outline-none h-7 min-w-[100px] shrink-0"
                    >
                        <option value="footprint">Order Flow</option>
                        {isProMode && <option value="pressure">Pressure</option>}
                    <option value="ocean">Ocean (story)</option>
                        <option value="candlestick">Candles</option>
                        <option value="heikin-ashi">Heikin-Ashi</option>
                        <option value="line">Line</option>
                        <option value="ohlc">OHLC</option>
                    </select>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {renderIndicators(true)}
                    {renderChartSettings(true)}
                    <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-0.5"></div>
                    {alertsButton(true)}
                    {isProMode && (
                        <button
                            onClick={() => navigate('/accounts')}
                            title="Algo trading accounts"
                            aria-label="Algo trading accounts"
                            className="flex items-center justify-center w-7 h-7 rounded-lg border transition-colors shrink-0 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                        >
                            <Briefcase className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <UpstoxBadge compact />
                    <button
                        onClick={toggleNotif}
                        title={notifEnabled ? 'Disable notifications' : 'Enable notifications'}
                        aria-label="Notifications"
                        className={`flex items-center justify-center w-7 h-7 rounded-lg border transition-colors shrink-0 ${notifEnabled ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}
                    >
                        {notifEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={() => { resumeAudioContext(); }}
                        title="Enable notification sound (unlock audio)"
                        aria-label="Notification sound"
                        className={`flex items-center justify-center w-7 h-7 rounded-lg border transition-colors shrink-0 ${isAudioRunning() ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}
                    >
                        {isAudioRunning() ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>
        )}
        {indMenuOpen && (
            <IndicatorPicker indicators={state.indicators} isProMode={isProMode} dark={state.theme === 'dark'}
                onToggle={handleIndicatorToggle} onClose={() => setIndMenuOpen(false)}
                onRemoveAll={(keys) => setState(prev => ({
                    ...prev,
                    indicators: { ...prev.indicators, ...Object.fromEntries(keys.map(k => [k, false])) },
                    hiddenIndicators: {},
                }))} />
        )}
        </>
    );
}
