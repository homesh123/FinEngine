// /options: Sensibull-style option chain (INDIA_ALGO_TRADING.md H3), owner only, needs Upstox logged in.
// Underlying search + expiry chips; calls left / puts right around the strike; ATM row, spot divider, ITM shading,
// OI bars; hover (tap on phones) a side for Buy / Sell / Chart; tabs "LTP & OI" and "Greeks".
// Buy / Sell open the same OrderPanel as the chart (RiskEngine + paper by default).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, LineChart, Loader2 } from 'lucide-react';
import { indiaApi, OPTIONS_LAST_KEY as LAST_KEY } from '../utils/indiaApi';
import OrderPanel from './OrderPanel';

const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; } };

const compact = (v) => {
    if (v == null) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `${s}${(a / 1e5).toFixed(2)}L`;
    if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
    return `${v}`;
};
const num = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
const chgCls = (v) => (v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400');
const fmtExp = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function UnderlyingPicker({ value, onPick }) {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [list, setList] = useState([]);
    useEffect(() => {
        if (!open) return undefined;
        const t = setTimeout(() => indiaApi.optionUnderlyings(q).then(setList).catch(() => setList([])), 150);
        return () => clearTimeout(t);
    }, [q, open]);
    return (
        <div className="relative w-full sm:w-72">
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                <Search className="w-4 h-4 text-slate-400" />
                <input value={open ? q : value} onFocus={() => { setOpen(true); setQ(''); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
                    onChange={e => setQ(e.target.value)} placeholder="NIFTY, BANKNIFTY, RELIANCE…"
                    className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-slate-900 dark:text-white focus:outline-none" aria-label="Underlying" />
            </div>
            {open && list.length > 0 && (
                <div className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl p-1 ts-pop-in origin-top">
                    {list.map(u => (
                        <button key={u.instrument_key} onMouseDown={() => { onPick(u.symbol); setOpen(false); }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-white/10">
                            <span><span className="block text-sm font-semibold text-slate-900 dark:text-white">{u.symbol.split(':')[1]}</span>
                                <span className="block text-xs text-slate-500 truncate">{u.name}</span></span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${u.type === 'Index' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`}>{u.type}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// Buy / Sell / Chart on the hovered (or tapped) side of a row
function Actions({ c, onTrade, onChart }) {
    if (!c) return null;
    const b = 'h-6 min-w-[24px] px-1.5 rounded-md text-[11px] font-bold text-white shadow active:scale-95';
    return (
        <span className="absolute inset-y-0 right-1 left-1 flex items-center justify-center gap-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
            <button type="button" onClick={(e) => { e.stopPropagation(); onTrade(c, 'BUY'); }} className={`${b} bg-emerald-600`} aria-label={`Buy ${c.symbol}`}>B</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onTrade(c, 'SELL'); }} className={`${b} bg-red-600`} aria-label={`Sell ${c.symbol}`}>S</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onChart(c); }} className="h-6 w-6 rounded-md bg-slate-700 text-white flex items-center justify-center shadow active:scale-95" aria-label={`Chart ${c.symbol}`}><LineChart className="w-3.5 h-3.5" /></button>
        </span>
    );
}

const COLS = {
    oi: [['oi_change', 'OI chg'], ['oi', 'OI'], ['volume', 'Volume'], ['iv', 'IV'], ['ltp', 'LTP']],
    greeks: [['vega', 'Vega'], ['theta', 'Theta'], ['gamma', 'Gamma'], ['delta', 'Delta'], ['iv', 'IV']],
};

function Cell({ k, c, maxOi, side }) {
    const box = 'relative px-2 py-1.5 text-right tabular-nums';
    if (!c) return <div className={`${box} text-slate-300`}>—</div>;
    const v = c[k];
    if (k === 'oi') {
        const w = maxOi ? Math.min(100, (v || 0) / maxOi * 100) : 0;
        return (
            <div className={box}>
                <span className={`absolute inset-y-1 ${side === 'call' ? 'right-0' : 'left-0'} rounded-sm ${side === 'call' ? 'bg-red-500/15' : 'bg-emerald-500/15'}`} style={{ width: `${w}%` }} />
                <span className="relative">{compact(v)}</span>
            </div>
        );
    }
    if (k === 'oi_change') return <div className={`${box} ${chgCls(v)}`}>{compact(v)}</div>;
    if (k === 'volume') return <div className={`${box} text-slate-600 dark:text-slate-300`}>{compact(v)}</div>;
    if (k === 'ltp') return (
        <div className={box}>
            <span className="font-semibold text-slate-900 dark:text-white">{num(v)}</span>
            {c.change != null && <span className={`block text-[10px] ${chgCls(c.change)}`}>{c.change > 0 ? '+' : ''}{num(c.change)}</span>}
        </div>
    );
    const d = k === 'gamma' ? 4 : k === 'iv' ? 1 : 2;
    return <div className={`${box} text-slate-700 dark:text-slate-200`}>{num(v, d)}</div>;
}

export default function OptionsPage({ onClose, onOpenChart, isPhone }) {
    const last = readLast();
    const [underlying, setUnderlying] = useState(last.underlying || 'NSE:NIFTY');
    const [exp, setExp] = useState(null);
    const [expiry, setExpiry] = useState(last.expiry || null);
    const [chain, setChain] = useState(null);
    const [err, setErr] = useState('');
    const [tab, setTab] = useState('oi');
    const [all, setAll] = useState(false);
    const [hover, setHover] = useState(null);           // {strike, side}
    const [order, setOrder] = useState(null);           // {symbol, side}
    const atmRef = useRef(null);

    useEffect(() => {
        setExp(null); setChain(null); setErr('');
        indiaApi.optionExpiries(underlying).then(d => {
            setExp(d);
            setExpiry(cur => (d.expiries.some(e => e.date === cur) ? cur : d.expiries[0]?.date || null));
        }).catch(e => setErr(e.message));
    }, [underlying]);

    useEffect(() => {
        if (!expiry) return undefined;
        try { localStorage.setItem(LAST_KEY, JSON.stringify({ underlying, expiry })); } catch { /* storage unavailable */ }
        let alive = true;
        const load = () => indiaApi.optionChain(underlying, expiry).then(d => { if (alive) { setChain(d); setErr(''); } })
            .catch(e => { if (alive) setErr(e.message); });
        setChain(null); load();
        const t = setInterval(load, 4000);
        return () => { alive = false; clearInterval(t); };
    }, [underlying, expiry]);

    const rows = useMemo(() => {
        if (!chain) return [];
        const r = chain.rows;
        if (all || !chain.atm) return r;
        const i = r.findIndex(x => x.strike === chain.atm);
        return r.slice(Math.max(0, i - 10), i + 11);
    }, [chain, all]);
    const maxOi = useMemo(() => Math.max(1, ...rows.flatMap(r => [r.call?.oi || 0, r.put?.oi || 0])), [rows]);
    const atmSeen = useRef(null);
    useEffect(() => {                                      // scroll ATM into view once per underlying/expiry
        const id = `${underlying}|${expiry}`;
        if (chain && atmSeen.current !== id && atmRef.current) { atmRef.current.scrollIntoView({ block: 'center' }); atmSeen.current = id; }
    }, [chain, underlying, expiry]);

    const cols = COLS[tab];
    const spot = chain?.spot;
    const trade = (c, side) => setOrder({ symbol: c.instrument_key, side });
    const chart = (c) => onOpenChart(c.instrument_key);
    const sideProps = (strike, side) => ({
        onMouseEnter: () => !isPhone && setHover({ strike, side }),
        onClick: () => setHover(h => (h && h.strike === strike && h.side === side ? null : { strike, side })),
    });

    return (
        <div className="fixed inset-0 z-[300] flex bg-white dark:bg-slate-900 ts-sheet-in" role="main" aria-label="Option chain">
            <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200 dark:border-slate-800">
                    <div className="font-bold text-slate-800 dark:text-white mr-auto">Option chain</div>
                    <button onClick={onClose} className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="Close"><X className="w-5 h-5 text-slate-600 dark:text-slate-300" /></button>
                </div>

                <div className="px-4 pt-3 space-y-3 border-b border-slate-200 dark:border-white/10 pb-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <UnderlyingPicker value={underlying.split(':')[1] || underlying} onPick={setUnderlying} />
                        {chain && (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                <span><span className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{num(spot)}</span> spot</span>
                                <span>PCR <b className="text-slate-800 dark:text-slate-100">{chain.pcr ?? '—'}</b></span>
                                <span>Max pain <b className="text-slate-800 dark:text-slate-100">{chain.max_pain ?? '—'}</b></span>
                                <span>ATM <b className="text-slate-800 dark:text-slate-100">{chain.atm ?? '—'}</b></span>
                                <span>Lot <b className="text-slate-800 dark:text-slate-100">{chain.lot}</b></span>
                                <span>{chain.days} days to expiry</span>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1" role="tablist" aria-label="Expiry">
                        {(exp?.expiries || []).map(e => (
                            <button key={e.date} role="tab" aria-selected={expiry === e.date} onClick={() => setExpiry(e.date)}
                                className={`shrink-0 h-8 px-3 rounded-full text-xs font-semibold border transition-[transform,background-color] duration-100 active:scale-95 ${expiry === e.date
                                    ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'}`}>
                                {fmtExp(e.date)}{e.monthly && <span className="ml-1 opacity-70">M</span>}<span className="ml-1 opacity-60">{e.days}d</span>
                            </button>
                        ))}
                        {!exp && !err && <Loader2 className="w-4 h-4 animate-spin text-slate-400 my-2" />}
                    </div>
                    <div className="flex items-center gap-1">
                        {[['oi', 'LTP & OI'], ['greeks', 'Greeks']].map(([v, t]) => (
                            <button key={v} onClick={() => setTab(v)} className={`h-8 px-3 rounded-lg text-sm font-semibold ${tab === v ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10'}`}>{t}</button>
                        ))}
                        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> All strikes</label>
                    </div>
                </div>

                {err && <div className="m-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 p-3 text-sm">{err}</div>}
                <div className="flex-1 overflow-auto" onMouseLeave={() => !isPhone && setHover(null)}>
                    {!chain && !err && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
                    {chain && (
                        <table className="w-full text-xs min-w-[720px]">
                            <thead className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
                                <tr className="text-[10px] font-bold tracking-wide">
                                    <th colSpan={cols.length} className="py-1.5 text-red-600 dark:text-red-400 border-b border-slate-200 dark:border-white/10">CALLS</th>
                                    <th className="border-b border-slate-200 dark:border-white/10" />
                                    <th colSpan={cols.length} className="py-1.5 text-emerald-600 dark:text-emerald-400 border-b border-slate-200 dark:border-white/10">PUTS</th>
                                </tr>
                                <tr className="text-[11px] text-slate-500 border-b border-slate-200 dark:border-white/10">
                                    {cols.map(([k, t]) => <th key={'c' + k} className="px-2 py-1.5 text-right font-semibold">{t}</th>)}
                                    <th className="px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/5">Strike</th>
                                    {[...cols].reverse().map(([k, t]) => <th key={'p' + k} className="px-2 py-1.5 text-right font-semibold">{t}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => {
                                    const atm = r.strike === chain.atm;
                                    const spotHere = spot != null && i > 0 && rows[i - 1].strike < spot && r.strike >= spot;
                                    const callItm = spot != null && r.strike < spot;
                                    const putItm = spot != null && r.strike > spot;
                                    const hc = hover && hover.strike === r.strike && hover.side === 'call';
                                    const hp = hover && hover.strike === r.strike && hover.side === 'put';
                                    return (
                                        <React.Fragment key={r.strike}>
                                            {spotHere && (
                                                <tr><td colSpan={cols.length * 2 + 1} className="p-0">
                                                    <div className="relative h-0 border-t-2 border-indigo-500">
                                                        <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 px-2 rounded-full bg-indigo-600 text-white text-[10px] font-bold tabular-nums">Spot {num(spot)}</span>
                                                    </div>
                                                </td></tr>
                                            )}
                                            <tr ref={atm ? atmRef : undefined} className={`border-b border-slate-100 dark:border-white/5 cursor-pointer ${atm ? 'ring-1 ring-inset ring-indigo-400/60' : ''}`}>
                                                {cols.map(([k], j) => (
                                                    <td key={'c' + k} className={`relative p-0 ${callItm ? 'bg-amber-50/70 dark:bg-amber-500/5' : ''}`} {...sideProps(r.strike, 'call')}>
                                                        <Cell k={k} c={r.call} maxOi={maxOi} side="call" />
                                                        {j === cols.length - 1 && hc && <Actions c={r.call} onTrade={trade} onChart={chart} />}
                                                    </td>
                                                ))}
                                                <td className={`px-3 py-1.5 text-center font-bold tabular-nums ${atm ? 'bg-indigo-600 text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-white'}`}>{r.strike}</td>
                                                {[...cols].reverse().map(([k], j) => (
                                                    <td key={'p' + k} className={`relative p-0 ${putItm ? 'bg-amber-50/70 dark:bg-amber-500/5' : ''}`} {...sideProps(r.strike, 'put')}>
                                                        <Cell k={k} c={r.put} maxOi={maxOi} side="put" />
                                                        {j === 0 && hp && <Actions c={r.put} onTrade={trade} onChart={chart} />}
                                                    </td>
                                                ))}
                                            </tr>
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
                {chain && (
                    <div className="px-4 py-1.5 border-t border-slate-200 dark:border-white/10 text-[11px] text-slate-500 flex flex-wrap gap-x-4">
                        <span>Call OI {compact(chain.call_oi)} · Put OI {compact(chain.put_oi)}</span>
                        <span>Shaded = in the money · hover {isPhone ? '(tap)' : ''} a side for Buy / Sell / Chart</span>
                        <span className="ml-auto">Updated {new Date(chain.updated).toLocaleTimeString('en-IN')}</span>
                    </div>
                )}
            </div>
            {order && <OrderPanel symbol={order.symbol} side={order.side} sheet={isPhone} onClose={() => setOrder(null)} />}
        </div>
    );
}

