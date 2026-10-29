// /india: Indian trading dashboard (INDIA_ALGO_TRADING.md C5), owner only. Paper / live switch, funds and day P&L,
// tabs Positions · Orders · Activity (risk decisions) · Settings (risk limits, live on/off), and an always-visible
// kill switch. Strategies (C4/C6) plug in here later.
import React, { useCallback, useEffect, useState } from 'react';
import { X, Power, RefreshCw, AlertTriangle, Layers } from 'lucide-react';
import { navigate } from '../utils/route';
import { indiaApi, inr, getExecution, setExecution } from '../utils/indiaApi';
import { confirmDialog } from '../utils/confirmDialog';
import { StrategiesTab, AgentTab, NotifySettings } from './IndiaStrategies';

const TABS = [['strategies', 'Strategies'], ['positions', 'Positions'], ['orders', 'Orders'], ['activity', 'Activity'], ['agent', 'AI agent'], ['holdings', 'Holdings'], ['settings', 'Settings']];
const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2 whitespace-nowrap tabular-nums';
const pnlColor = (v) => (v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-600 dark:text-red-400' : '');
const ts = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return iso; } };

const LIMIT_FIELDS = [
    ['paper_capital', 'Paper capital (₹)'], ['capital_pct', 'Max order value (% of funds)'], ['max_positions', 'Max open positions'],
    ['daily_loss_pct', 'Daily loss limit (%)'], ['max_orders_day', 'Max orders per day'], ['max_orders_sec', 'Max orders per second'],
    ['price_band_pct', 'Limit price band (% from last)'], ['no_entry_before', 'No entries before (IST)'], ['no_entry_after', 'No intraday entries after (IST)'],
    ['max_dd_pct', 'Max drawdown from peak (%) → kill switch'], ['max_consec_losses', 'Losses in a row → strategy off'],
    ['min_reward_vs_charges', 'Min target ÷ round-trip charges'], ['skip_results_days', 'No new stock position within N days of its results (0 = off)'],
];

function Table({ head, rows, empty }) {
    if (!rows.length) return <div className="py-16 text-center text-sm text-slate-500">{empty}</div>;
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
            <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-white/5"><tr>{head.map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-slate-800 dark:text-slate-200">{rows}</tbody>
            </table>
        </div>
    );
}

export default function IndiaDashboard({ onClose, onOpenChart }) {
    const [tab, setTab] = useState(() => { try { return localStorage.getItem('ts_india_tab') || 'strategies'; } catch { return 'strategies'; } });
    const [execution, setExec] = useState(getExecution);
    const [data, setData] = useState({ positions: [], orders: [], holdings: [], decisions: [], funds: null, settings: null });
    const [eq, setEq] = useState(null);
    const [events, setEvents] = useState([]);
    useEffect(() => {
        const load = () => indiaApi.events(14).then(setEvents).catch(() => setEvents([]));
        load(); const t = setInterval(load, 10 * 60 * 1000); return () => clearInterval(t);
    }, []);
    const [err, setErr] = useState('');
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [positions, orders, decisions, funds, settings] = await Promise.all([
                indiaApi.positions(execution), indiaApi.orders(), indiaApi.decisions(), indiaApi.funds(execution), indiaApi.settings()]);
            const holdings = tab === 'holdings' ? await indiaApi.holdings().catch(() => []) : data.holdings;
            if (execution === 'paper') indiaApi.equity().then(setEq).catch(() => setEq(null)); else setEq(null);
            setData({ positions, orders: orders.filter(o => o.intent.execution === execution), decisions, funds, settings, holdings });
            setErr('');
        } catch (e) { setErr(e.message); }
    }, [execution, tab]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
    useEffect(() => { if (data.settings && !draft) setDraft(data.settings.limits); }, [data.settings, draft]);

    const kill = data.settings?.kill;
    const dayPnl = data.positions.reduce((s, p) => s + (p.pnl || 0), 0);
    const openPos = data.positions.filter(p => p.qty);

    const chooseExec = async (v) => {
        if (v === 'live' && !(await confirmDialog({ title: 'Show the live Upstox account?', message: 'Close and order buttons here then act on real money.', confirmLabel: 'Show live', danger: true }))) return;
        setExec(v); setExecution(v);
    };
    const act = async (fn) => { setBusy(true); try { const r = await fn(); if (r && r.ok === false) setErr(r.reason); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
    const toggleKill = async () => {
        const on = !kill;
        if (on && !(await confirmDialog({ title: 'Turn the kill switch on?', message: 'Cancels open orders, squares off intraday positions and blocks new entries until you turn it off.', confirmLabel: 'Kill switch on', danger: true }))) return;
        act(() => indiaApi.kill(on));
    };
    const closePos = async (p) => {
        if (!(await confirmDialog({ title: `Close ${p.symbol}?`, message: `${p.qty > 0 ? 'Sell' : 'Buy'} ${Math.abs(p.qty)} at market (${execution}).`, confirmLabel: 'Close position', danger: execution === 'live' }))) return;
        act(() => indiaApi.close({ execution, instrument_key: p.instrument_key, product: p.product }));
    };
    const saveSettings = async () => {
        if (draft.live_enabled && !data.settings.limits.live_enabled &&
            !(await confirmDialog({ title: 'Enable live trading?', message: 'Orders marked Live will be sent to your Upstox account. Upstox needs your static IP registered.', confirmLabel: 'Enable live', danger: true }))) return;
        act(async () => { const s = await indiaApi.saveSettings(draft); setDraft(s.limits); });
    };

    return (
        <div className="fixed inset-0 z-[300] flex flex-col bg-white dark:bg-slate-900 ts-sheet-in" role="main" aria-label="India trading dashboard">
            <div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200 dark:border-slate-800">
                <div className="font-bold text-slate-800 dark:text-white mr-auto">Indian trading</div>
                <button onClick={() => navigate('/options')} className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 active:scale-[0.97]">
                    <Layers className="w-4 h-4" /><span className="hidden sm:inline">Option chain</span>
                </button>
                <div className="flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
                    {[['paper', 'Paper'], ['live', 'Live']].map(([v, t]) => (
                        <button key={v} onClick={() => chooseExec(v)} className={`px-3 h-7 rounded-md ${execution === v ? (v === 'live' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm') : 'text-slate-500'}`}>{t}</button>
                    ))}
                </div>
                <button onClick={toggleKill} disabled={busy} className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold active:scale-[0.97] ${kill ? 'bg-red-600 text-white' : 'border border-red-300 text-red-600 dark:border-red-500/40 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'}`}>
                    <Power className="w-4 h-4" />{kill ? 'Kill switch ON' : 'Kill switch'}
                </button>
                <button onClick={onClose} className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="Close"><X className="w-5 h-5 text-slate-600 dark:text-slate-300" /></button>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto p-4 space-y-4">
                    {kill && <div className="flex gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 p-3 text-sm"><AlertTriangle className="w-4 h-4 mt-0.5" />Kill switch is on: new entries are blocked, exits still work.</div>}
                    {eq?.halt && <div className="flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 p-3 text-sm"><AlertTriangle className="w-4 h-4 mt-0.5" />Trading paused for today: {eq.halt}. It resumes automatically next trading day.</div>}
                    {err && <div className="rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 p-3 text-sm">{err}</div>}

                    {eq && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            {[['Equity (paper)', inr(eq.equity, 0)], ["Today's P&L", <span className={pnlColor(eq.day_pnl)}>{inr(eq.day_pnl, 0)}</span>],
                              ['Charges paid', inr(eq.charges, 0)], [`Est. tax (${Math.round(eq.tax_rate * 1000) / 10}%)`, inr(eq.tax_estimate, 0)],
                              ['Drawdown from peak', `${eq.dd_from_peak_pct.toFixed(2)}%`]].map(([k, v]) => (
                                <div key={k} className="rounded-xl bg-slate-50 dark:bg-white/5 p-3">
                                    <div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div>
                                    <div className="text-base font-bold tabular-nums text-slate-900 dark:text-white">{v}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {events.length > 0 && (
                        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3">
                            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Upcoming events · next 14 days</div>
                            <div className="flex flex-wrap gap-1.5">
                                {events.slice(0, 16).map((e, i) => (
                                    <span key={i} title={e.note} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${
                                        e.kind === 'holiday' ? 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
                                        : e.kind === 'results' ? 'bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-200'
                                        : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'}`}>
                                        <b className="tabular-nums">{new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</b>{e.title}
                                    </span>
                                ))}
                            </div>
                            <p className="mt-2 text-[11px] text-slate-500">Shown for awareness. Tested on 2022–26: skipping these days made the option strategies worse (they earn the extra premium), so Option Pilot keeps trading through them; stock strategies avoid new positions just before company results.</p>
                        </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[['Available', inr(data.funds?.available, 0)], ['Used', inr(data.funds?.used, 0)],
                          ['P&L', <span className={pnlColor(dayPnl)}>{inr(dayPnl)}</span>], ['Open positions', openPos.length]].map(([k, v]) => (
                            <div key={k} className="rounded-xl border border-slate-200 dark:border-white/10 p-3">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div>
                                <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{v}</div>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/10 overflow-x-auto">
                        {TABS.map(([v, t]) => (
                            <button key={v} onClick={() => { setTab(v); try { localStorage.setItem('ts_india_tab', v); } catch { /* storage unavailable */ } }} className={`px-3 h-9 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === v ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}>{t}</button>
                        ))}
                        <button onClick={load} className="ml-auto p-2 text-slate-400 hover:text-slate-700" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
                    </div>

                    {tab === 'strategies' && <StrategiesTab liveOk={!!data.settings?.limits?.live_enabled} onOpenChart={onOpenChart} />}
                    {tab === 'agent' && <AgentTab agentKill={!!data.settings?.agent_kill} onChanged={load} />}

                    {tab === 'positions' && <Table head={['Symbol', 'Product', 'Qty', 'Avg', 'LTP', 'P&L', '']} empty="No positions yet. Use Buy / Sell on an NSE or BSE chart."
                        rows={data.positions.map(p => (
                            <tr key={p.instrument_key + p.product}>
                                <td className={`${td} font-semibold`}>{p.symbol}</td><td className={td}>{p.product}</td>
                                <td className={`${td} ${pnlColor(p.qty)}`}>{p.qty}</td><td className={td}>{inr(p.avg_price)}</td><td className={td}>{inr(p.ltp)}</td>
                                <td className={`${td} font-semibold ${pnlColor(p.pnl)}`}>{inr(p.pnl)}</td>
                                <td className={td}>{p.qty ? <button disabled={busy} onClick={() => closePos(p)} className="h-7 px-3 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">Close</button> : <span className="text-xs text-slate-400">Closed</span>}</td>
                            </tr>))} />}

                    {tab === 'orders' && <Table head={['Time', 'Symbol', 'Side', 'Qty', 'Type', 'Price', 'Status', '']} empty="No orders yet."
                        rows={data.orders.map(o => (
                            <tr key={o.id}>
                                <td className={td}>{ts(o.ts_created)}</td><td className={`${td} font-semibold`}>{o.intent.symbol}</td>
                                <td className={`${td} font-semibold ${o.intent.side === 'BUY' ? 'text-emerald-600' : 'text-red-600'}`}>{o.intent.side}</td>
                                <td className={td}>{o.filled_qty}/{o.intent.qty}</td><td className={td}>{o.intent.order_type} · {o.intent.product}</td>
                                <td className={td}>{o.avg_price ? inr(o.avg_price) : o.intent.price ? inr(o.intent.price) : 'Market'}</td>
                                <td className={td} title={o.message}>{o.status}</td>
                                <td className={td}>{['open', 'new'].includes(o.status) && <button disabled={busy} onClick={() => act(() => indiaApi.cancel(o.id))} className="h-7 px-3 rounded-lg text-xs font-semibold text-red-600 bg-red-50 dark:bg-red-500/10">Cancel</button>}</td>
                            </tr>))} />}

                    {tab === 'holdings' && <Table head={['Instrument', 'Qty', 'Avg', 'LTP', 'P&L']} empty="No holdings in your Upstox account (live data)."
                        rows={data.holdings.map(h => (
                            <tr key={h.instrument_key}>
                                <td className={`${td} font-semibold`}>{h.instrument_key}</td><td className={td}>{h.qty}</td><td className={td}>{inr(h.avg_price)}</td><td className={td}>{inr(h.ltp)}</td>
                                <td className={`${td} ${pnlColor((h.ltp - h.avg_price) * h.qty)}`}>{inr((h.ltp - h.avg_price) * h.qty)}</td>
                            </tr>))} />}

                    {tab === 'activity' && <Table head={['Time', 'Source', 'Symbol', 'Side', 'Price', 'Outcome', 'Reason']} empty="Every order attempt and its risk decision shows here."
                        rows={data.decisions.map(d => (
                            <tr key={d.id}>
                                <td className={td}>{ts(d.ts)}</td><td className={td}>{d.source}</td><td className={`${td} font-semibold`}>{d.symbol}</td><td className={td}>{d.side}</td>
                                <td className={td}>{d.price ? inr(d.price) : '—'}</td>
                                <td className={`${td} font-semibold ${d.outcome === 'executed' ? 'text-emerald-600' : d.outcome === 'blocked' || d.outcome === 'rejected' ? 'text-red-600' : ''}`}>{d.outcome}</td>
                                <td className="px-3 py-2 text-xs text-slate-500 min-w-[220px]">{d.reason}</td>
                            </tr>))} />}

                    {tab === 'settings' && draft && (
                        <div className="space-y-4 max-w-xl">
                            <p className="text-sm text-slate-500">These limits run before every order (manual, strategy or AI agent). Exits are always allowed.</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {LIMIT_FIELDS.map(([k, t]) => (
                                    <label key={k} className="block"><span className="text-xs font-semibold text-slate-500">{t}</span>
                                        <input value={draft[k] ?? ''} onChange={e => setDraft({ ...draft, [k]: e.target.value })}
                                            className="mt-1 h-10 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm tabular-nums text-slate-900 dark:text-white" /></label>
                                ))}
                            </div>
                            <label className="flex items-center gap-3 rounded-xl border border-amber-300 dark:border-amber-500/40 p-3">
                                <input type="checkbox" checked={!!draft.live_enabled} onChange={e => setDraft({ ...draft, live_enabled: e.target.checked })} className="w-4 h-4" />
                                <span className="text-sm"><b>Allow live orders</b> to Upstox. Off = only paper orders are accepted.</span>
                            </label>
                            <button disabled={busy} onClick={saveSettings} className="h-10 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-[0.98]">Save settings</button>
                            <NotifySettings />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
