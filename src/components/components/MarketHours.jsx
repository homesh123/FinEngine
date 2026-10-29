import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock as ClockIcon, X, ChevronDown, Settings2 } from 'lucide-react';
import { getMarketState, withSeasonalHours } from '../utils/clock/market-hours';
import { Clock, GOLDEN_HOURS, formatDuration } from '../utils/clock/clock';
import MARKETS from '../utils/clock/markets.json';
import AdsterraBanner from './AdsterraBanner';
import { useProMode } from '../hooks/useProMode';

// Which stock exchanges are open now, in the sidebar; on desktop the forex24hr.com
// 24-hour market clock opens in a half-screen panel. Same data and code as the site.

// Your choices: hidden exchanges, pre-open hour on the clock, card collapsed (this browser only)
const CFG_KEY = 'ts_markets_cfg_v1';
export const readCfg = () => { try { return { hidden: [], preOpen: true, collapsed: false, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { hidden: [], preOpen: true, collapsed: false }; } };
export const ALL = MARKETS.filter(m => m.display !== false);
const userTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const tzLabel = () => {
    const off = -new Date().getTimezoneOffset(), h = Math.trunc(off / 60), m = Math.abs(off % 60);
    return `${userTz()}, UTC${off >= 0 ? '+' : '−'}${Math.abs(h)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
};

function readMarkets(hidden = []) {
    const rows = ALL.filter(m => !hidden.includes(m.id)).map(m => withSeasonalHours(m)).map(m => ({ label: m.label, ...getMarketState(m) }))
        .sort((a, b) => Number(b.open) - Number(a.open) || a.minutesToChange - b.minutesToChange);
    return { rows, overlap: getMarketState(GOLDEN_HOURS) };
}

/** Re-reads the market states every 30 s. */
function useMarkets(hidden) {
    const [m, setM] = useState(() => readMarkets(hidden));
    useEffect(() => {
        setM(readMarkets(hidden));
        const t = setInterval(() => setM(readMarkets(hidden)), 30000);
        return () => clearInterval(t);
    }, [hidden]);
    return m;
}

const overlapText = (o) => (o.open ? `London–New York overlap now (busiest forex hours) · ends in ${formatDuration(o.minutesToChange)}`
    : `London–New York overlap in ${formatDuration(o.minutesToChange)}`);

/** Sidebar: two short lines, plus the clock button on desktop. */
export function MarketHoursCard({ dark }) {
    const [cfg, setCfgState] = useState(readCfg);
    const setCfg = (patch) => setCfgState(c => { const n = { ...c, ...patch }; try { localStorage.setItem(CFG_KEY, JSON.stringify(n)); } catch { /* storage unavailable */ } return n; });
    const { rows, overlap } = useMarkets(cfg.hidden);
    const [open, setOpen] = useState(false);
    const openRows = rows.filter(r => r.open), next = rows.find(r => !r.open);
    const closing = openRows.slice().sort((a, b) => a.minutesToChange - b.minutesToChange)[0];
    return (
        <div className="mx-3 mt-2 mb-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/40 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${openRows.length ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden />
                <span className="flex-1 min-w-0">
                    <b className="text-slate-800 dark:text-slate-100">{openRows.length ? `${openRows.length} of ${rows.length} exchanges open` : 'All exchanges closed'}</b>
                    {closing ? ` · ${closing.label} closes in ${formatDuration(closing.minutesToChange)}` : next ? ` · ${next.label} opens in ${formatDuration(next.minutesToChange)}` : ''}
                </span>
                <button type="button" onClick={() => setOpen(true)} title="Market clock — which exchanges are open, on a 24-hour clock" aria-label="Open market clock"
                    className="hidden md:inline-flex shrink-0 w-7 h-7 -my-1 -mr-1 items-center justify-center rounded-md text-slate-500 hover:text-indigo-600 hover:bg-white dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-indigo-300">
                    <ClockIcon size={15} />
                </button>
                <button type="button" onClick={() => setCfg({ collapsed: !cfg.collapsed })} aria-label={cfg.collapsed ? 'Show market details' : 'Hide market details'} aria-expanded={!cfg.collapsed}
                    className="shrink-0 w-7 h-7 -my-1 -mr-1 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-white dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
                    <ChevronDown size={15} className={`transition-transform ${cfg.collapsed ? '-rotate-90' : ''}`} />
                </button>
            </div>
            {!cfg.collapsed && <div className={overlap.open ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : ''}>{overlapText(overlap)}</div>}
            {open && <MarketClockPanel dark={dark} cfg={cfg} setCfg={setCfg} onClose={() => setOpen(false)} />}
        </div>
    );
}

/** The 24-hour clock on a canvas sized to its parent's width; returns the canvas ref. */
function useMarketClock(dark, cfg) {
    const canvasRef = useRef(null);
    useEffect(() => {
        if (!canvasRef.current) return undefined;
        const clock = new Clock(canvasRef.current, {
            color: dark ? '#ffffff' : '#1a1a1a', h_size: 18, m_size: 11, label_size: 8,
            events: MARKETS.map(m => withSeasonalHours({ ...m, display: m.display !== false && !cfg.hidden.includes(m.id) })),
            showPreOpen: cfg.preOpen, currentTheme: dark ? 'dark' : 'light',
            userTimeZone: userTz(),          // the computer's own time zone
        });
        clock.start();
        return () => clock.stop();
    }, [dark, cfg.hidden, cfg.preOpen]);
    return canvasRef;
}

/** Live mode sidebar: every exchange as text, open first (the clock's arc labels are unreadable at sidebar width). */
export function MarketClockSidebar() {
    const [cfg] = useState(readCfg);
    const { rows, overlap } = useMarkets(cfg.hidden);
    const openN = rows.filter(r => r.open).length;
    return (
        <div className="px-3 pt-2 pb-3 text-[11px] text-slate-600 dark:text-slate-400">
            <div className="flex items-baseline justify-between mb-1">
                <span className="font-semibold text-slate-800 dark:text-slate-100 text-xs">Markets · {openN} of {rows.length} open</span>
                <span className="text-[10px]">{tzLabel()}</span>
            </div>
            <div className={`mb-2 rounded-lg px-2 py-1 font-semibold ${overlap.open ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                {overlapText(overlap)}
            </div>
            {rows.map(r => (
                <div key={r.label} className="flex justify-between gap-2 py-0.5 border-b border-slate-100 dark:border-slate-800">
                    <span className={r.open ? 'text-slate-800 dark:text-slate-100' : ''}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${r.open ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} aria-hidden />{r.label}
                    </span>
                    <span className={`tabular-nums ${r.open ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                        {r.open ? 'Open' : 'Closed'} · {r.open ? 'closes' : 'opens'} in {formatDuration(r.minutesToChange)}
                    </span>
                </div>
            ))}
        </div>
    );
}

/** Desktop: the 24-hour market clock (coloured arcs = exchanges, green = open) beside the full list. */
function MarketClockPanel({ dark, cfg, setCfg, onClose }) {
    const { rows, overlap } = useMarkets(cfg.hidden);
    const [editing, setEditing] = useState(false);
    const { isProMode } = useProMode();
    const canvasRef = useMarketClock(dark, cfg);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return createPortal(
        <div className={dark ? 'dark' : undefined}>
            <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4 ts-scrim-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
                <div role="dialog" aria-label="Market clock"
                    className="w-[min(960px,60vw)] min-w-[620px] max-h-[88vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col ts-pop-in">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
                        <div>
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Market clock</h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">24-hour clock in your time zone ({tzLabel()}) · green arcs = open now · hover an arc for its hours</p>
                        </div>
                        <button type="button" onClick={() => setEditing(v => !v)} aria-label="Choose exchanges" aria-pressed={editing} title="Choose which exchanges to show"
                            className={`ml-auto mr-1 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${editing ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}><Settings2 size={16} /></button>
                        <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"><X size={16} /></button>
                    </div>
                    <div className="flex min-h-0 flex-1">
                        <div className="p-4 flex items-center justify-center" style={{ width: 'min(60vh, 55%)' }}>
                            <div className="w-full"><canvas ref={canvasRef} /></div>
                        </div>
                        <div className="flex-1 min-w-0 overflow-y-auto border-l border-slate-200 dark:border-slate-700 p-3 text-[12px]">
                            <div className={`mb-2 rounded-lg px-2.5 py-1.5 font-semibold ${overlap.open ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                                {overlapText(overlap)}
                            </div>
                            {editing && (
                                <div className="mb-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                                    <div className="font-semibold text-slate-700 dark:text-slate-200 mb-1">Show these exchanges</div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                        {ALL.map(m => (
                                            <label key={m.id} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                                                <input type="checkbox" className="rounded border-slate-300 dark:border-slate-600 text-indigo-600"
                                                    checked={!cfg.hidden.includes(m.id)}
                                                    onChange={e => setCfg({ hidden: e.target.checked ? cfg.hidden.filter(id => id !== m.id) : [...cfg.hidden, m.id] })} />
                                                {m.label}
                                            </label>
                                        ))}
                                    </div>
                                    <label className="mt-1.5 flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                                        <input type="checkbox" className="rounded border-slate-300 dark:border-slate-600 text-indigo-600" checked={cfg.preOpen} onChange={e => setCfg({ preOpen: e.target.checked })} />
                                        Show the pre-open hour on the clock
                                    </label>
                                </div>
                            )}
                            {!isProMode && <div className="mb-2"><AdsterraBanner size="300x250" maxWidth={300} /></div>}
                            <table className="w-full">
                                <tbody>
                                    {rows.map(r => (
                                        <tr key={r.label} className="border-b border-slate-100 dark:border-slate-800">
                                            <td className="py-1 pr-2 text-slate-800 dark:text-slate-100 font-medium">
                                                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${r.open ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} aria-hidden />{r.label}
                                            </td>
                                            <td className={`py-1 text-right tabular-nums ${r.open ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                                {r.open ? 'Open' : 'Closed'} · {r.open ? 'closes' : 'opens'} in {formatDuration(r.minutesToChange)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">Regular stock-exchange hours; public holidays are not included. Same clock as <a href="https://forex24hr.com/" target="_blank" rel="noopener" className="underline">forex24hr.com</a>.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
