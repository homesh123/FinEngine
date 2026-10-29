// Right-panel card: the last 10 Indian trades (paper / live) with the strategy that placed them
// (INDIA_ALGO_TRADING.md E8). Shown only while Upstox is connected (owner); refreshes every 10 s.
import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { indiaApi } from '../utils/indiaApi';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { navigate } from '../utils/route';

const KIND = { agent: 'AI agent', option_agent: 'Option Pilot' };
const strategyName = (s) => `#${s.id} ${KIND[s.indicator] || s.indicator} ${s.symbol.split(':')[1] || s.symbol}`;

function who(o, names) {
    const it = o.intent;
    const src = it.source || '';
    const base = it.strategy_id ? (names[it.strategy_id] || `Strategy #${it.strategy_id}`) : src === 'manual' ? 'Manual' : src || 'Manual';
    if (src === 'bracket') return `${base} · stop/target`;
    if (src.startsWith('option:') && src.split(':')[2]) return `${base} · ${src.split(':')[2]}`;
    if (src === 'kill') return 'Kill switch';
    return base;
}

export default function RecentTradesCard() {
    const broker = useBrokerSession();
    const [rows, setRows] = useState(null);
    const [names, setNames] = useState({});

    useEffect(() => {
        if (!broker.ready) return undefined;
        let alive = true;
        const load = () => Promise.all([indiaApi.orders(40), indiaApi.strategies()])
            .then(([orders, strategies]) => {
                if (!alive) return;
                setNames(Object.fromEntries(strategies.map(s => [s.id, strategyName(s)])));
                setRows(orders.filter(o => o.status === 'complete' || o.status === 'open').slice(0, 10));
            }).catch(() => {});
        load();
        const t = setInterval(load, 10000);
        return () => { alive = false; clearInterval(t); };
    }, [broker.ready]);

    if (!broker.ready) return null;
    return (
        <div className="mx-3 mt-2 mb-1 rounded-xl border border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg">
            <div className="flex items-center px-3 pt-2.5 pb-1.5">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Recent trades</span>
                <span className="ml-1.5 text-[10px] text-slate-400">India · last 10</span>
                <button onClick={() => navigate('/india')} className="ml-auto flex items-center gap-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                    Dashboard <ArrowUpRight className="w-3 h-3" />
                </button>
            </div>
            {rows === null ? <div className="px-3 pb-3 text-[11px] text-slate-400">Loading…</div>
                : rows.length === 0 ? <div className="px-3 pb-3 text-[11px] text-slate-500">No trades yet. Strategies on Paper auto trade here in market hours.</div>
                : (
                    <ul className="divide-y divide-slate-100 dark:divide-white/5">
                        {rows.map(o => {
                            const it = o.intent;
                            const buy = it.side === 'BUY';
                            const px = o.avg_price || it.price;
                            return (
                                <li key={o.id} className="px-3 py-1.5 text-[11px] leading-tight">
                                    <div className="flex items-center gap-1.5">
                                        <span className={`px-1 rounded text-[9px] font-bold text-white ${buy ? 'bg-emerald-600' : 'bg-red-600'}`}>{it.side}</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">{it.qty} {(it.symbol || it.instrument_key).replace(/^(NSE|BSE):/, '')}</span>
                                        <span className="ml-auto tabular-nums text-slate-600 dark:text-slate-300">{px ? px.toFixed(2) : 'MKT'}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
                                        <span className="truncate">{who(o, names)}{it.exit ? ' · exit' : ''}</span>
                                        <span className={`ml-auto shrink-0 ${o.status === 'open' ? 'text-amber-600' : ''}`}>
                                            {o.status === 'open' ? 'waiting' : it.execution === 'live' ? 'LIVE' : 'paper'} · {new Date(o.ts_created).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
        </div>
    );
}
