// Indian stock order panel (INDIA_ALGO_TRADING.md H4), modelled on Upstox "Place order": side panel on desktop,
// bottom sheet on phones. Owner only, shown only while Upstox is connected and the chart symbol is NSE/BSE.
// Orders go to /api/india/orders -> RiskEngine -> paper broker (default) or Upstox (live, when enabled in /india).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Minus, Plus, ChevronDown, AlertTriangle, CheckCircle2, Info, LayoutDashboard } from 'lucide-react';
import { indiaApi, inr, getExecution, setExecution, openOptionsFor } from '../utils/indiaApi';
import { navigate } from '../utils/route';
import { confirmDialog } from '../utils/confirmDialog';

const TYPES = [['MARKET', 'Market'], ['LIMIT', 'Limit'], ['SL', 'Stop-loss limit'], ['SL-M', 'Stop-loss market']];
const field = 'h-10 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm tabular-nums text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800/60';
const label = 'text-xs font-semibold text-slate-500 dark:text-slate-400';

function useQuote(symbol) {
    const [q, setQ] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let alive = true;
        const load = () => indiaApi.quote(symbol).then(d => { if (alive) { setQ(d); setErr(''); } })
            .catch(e => { if (alive) setErr(e.message); });
        setQ(null); load();
        const t = setInterval(load, 2000);
        return () => { alive = false; clearInterval(t); };
    }, [symbol]);
    return [q, err];
}

// Open position in this instrument for the chosen account (paper / live), refreshed every 3 s.
function usePosition(instrumentKey, execution, bump) {
    const [pos, setPos] = useState(null);
    useEffect(() => {
        if (!instrumentKey) return undefined;
        let alive = true;
        const load = () => indiaApi.positions(execution)
            .then(ps => { if (alive) setPos(ps.find(p => p.instrument_key === instrumentKey && p.qty) || null); }).catch(() => {});
        load();
        const t = setInterval(load, 3000);
        return () => { alive = false; clearInterval(t); };
    }, [instrumentKey, execution, bump]);
    return pos;
}

async function exitPosition(p, execution) {
    if (!(await confirmDialog({ title: `Exit ${p.symbol}?`, message: `${p.qty > 0 ? 'Sell' : 'Buy'} ${Math.abs(p.qty)} at market (${execution === 'live' ? 'LIVE Upstox' : 'paper'}).`,
        confirmLabel: 'Exit position', danger: execution === 'live' }))) return null;
    return indiaApi.close({ execution, instrument_key: p.instrument_key, product: p.product });
}

const prefsKey = (s) => `ts_india_ticket:${s}`;
const readPrefs = (s) => { try { return JSON.parse(localStorage.getItem(prefsKey(s))) || {}; } catch { return {}; } };

function PositionBar({ pos, onExit, compact }) {
    if (!pos) return null;
    const long = pos.qty > 0;
    const pnl = pos.pnl || 0;
    return (
        <div className={`flex items-center gap-2 rounded-xl border ${long ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/80 dark:bg-emerald-500/10' : 'border-red-200 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10'} ${compact ? 'px-2 py-1' : 'px-3 py-2'}`}>
            <span className={`text-[10px] font-bold tracking-wide ${long ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{long ? 'LONG' : 'SHORT'}</span>
            <span className="text-xs tabular-nums text-slate-700 dark:text-slate-200">{Math.abs(pos.qty)} @ {pos.avg_price?.toFixed(2)}</span>
            <span className={`text-xs font-bold tabular-nums ${pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{pnl >= 0 ? '+' : ''}{inr(pnl)}</span>
            <button type="button" onClick={onExit} className="ml-auto h-6 px-2 rounded-md text-[11px] font-bold bg-white/80 dark:bg-slate-800 text-slate-800 dark:text-white border border-slate-200 dark:border-white/10 active:scale-95">Exit</button>
        </div>
    );
}

function Seg({ value, onChange, options, tone }) {
    return (
        <div className="grid gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
            {options.map(([v, text]) => (
                <button key={v} type="button" onPointerDown={() => onChange(v)} onClick={() => onChange(v)} aria-pressed={value === v}
                    className={`h-9 rounded-lg text-sm font-semibold transition-[transform,background-color] duration-100 active:scale-[0.97] ${value === v
                        ? (tone?.(v) || 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm')
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                    {text}
                </button>
            ))}
        </div>
    );
}

function Section({ title, sub, children }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-t border-slate-200/80 dark:border-white/10">
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center justify-between py-3 text-left">
                <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
                    {sub && <span className="block text-xs text-slate-500">{sub}</span>}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <div className="pb-3">{children}</div>}
        </div>
    );
}

function Depth({ q }) {
    const rows = Array.from({ length: 5 }, (_, i) => [q.bids?.[i], q.asks?.[i]]);
    const o = q.ohlc || {};
    return (
        <div className="text-xs tabular-nums">
            <div className="grid grid-cols-4 gap-x-2 pb-1 font-semibold text-slate-500">
                <span>Bid</span><span className="text-right">Qty</span><span>Ask</span><span className="text-right">Qty</span>
            </div>
            {rows.map(([b, a], i) => (
                <div key={i} className="grid grid-cols-4 gap-x-2 py-0.5">
                    <span className="text-emerald-600 dark:text-emerald-400">{b ? b.price.toFixed(2) : '—'}</span>
                    <span className="text-right text-slate-600 dark:text-slate-300">{b ? b.qty.toLocaleString('en-IN') : ''}</span>
                    <span className="text-red-600 dark:text-red-400">{a ? a.price.toFixed(2) : '—'}</span>
                    <span className="text-right text-slate-600 dark:text-slate-300">{a ? a.qty.toLocaleString('en-IN') : ''}</span>
                </div>
            ))}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 pt-2 border-t border-slate-200/70 dark:border-white/10 text-slate-600 dark:text-slate-300">
                <span>Open <b className="float-right">{o.open ?? '—'}</b></span><span>High <b className="float-right">{o.high ?? '—'}</b></span>
                <span>Low <b className="float-right">{o.low ?? '—'}</b></span><span>Prev close <b className="float-right">{o.close ?? '—'}</b></span>
                <span>Lower circuit <b className="float-right">{q.lower_circuit ?? '—'}</b></span><span>Upper circuit <b className="float-right">{q.upper_circuit ?? '—'}</b></span>
            </div>
        </div>
    );
}

export default function OrderPanel({ symbol, side: initialSide = 'BUY', onClose, sheet = false }) {
    const [q, qErr] = useQuote(symbol);
    const [side, setSide] = useState(initialSide);
    const [product, setProduct] = useState(() => readPrefs(symbol).product || 'INTRADAY');
    const [lots, setLots] = useState(() => readPrefs(symbol).lots || 1);
    const [type, setType] = useState(() => readPrefs(symbol).type || 'MARKET');
    const [sl, setSl] = useState('');
    const [tg, setTg] = useState('');
    const [limits, setLimits] = useState(null);
    const [price, setPrice] = useState('');
    const [trigger, setTrigger] = useState('');
    const [validity, setValidity] = useState('DAY');
    const [execution, setExec] = useState(getExecution);
    const [liveOk, setLiveOk] = useState(false);
    const [funds, setFunds] = useState(null);
    const [margin, setMargin] = useState(null);
    const [review, setReview] = useState(false);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const ref = useRef(Date.now().toString(36) + Math.random().toString(36).slice(2));

    useEffect(() => setSide(initialSide), [initialSide]);
    useEffect(() => {
        const p = readPrefs(symbol);
        setLots(p.lots || 1); setProduct(p.product || 'INTRADAY'); setType(p.type || 'MARKET');
        setPrice(''); setTrigger(''); setSl(''); setTg(''); setResult(null); setReview(false);
    }, [symbol]);
    useEffect(() => { try { localStorage.setItem(prefsKey(symbol), JSON.stringify({ lots, product, type })); } catch { /* storage unavailable */ } }, [symbol, lots, product, type]);
    useEffect(() => { indiaApi.settings().then(s => { setLiveOk(!!s.limits.live_enabled); setLimits(s.limits); }).catch(() => {}); }, []);
    useEffect(() => { const esc = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
    const pos = usePosition(q?.instrument_key, execution, result);
    useEffect(() => { indiaApi.funds(execution).then(setFunds).catch(() => setFunds(null)); }, [execution, result]);

    const lot = q?.lot || 1;
    const qty = Math.max(1, lots) * lot;
    const needPrice = type === 'LIMIT' || type === 'SL';
    const needTrigger = type === 'SL' || type === 'SL-M';
    const px = needPrice ? +price || 0 : q?.ltp || 0;
    const value = qty * px;
    const buy = side === 'BUY';
    const maxLots = funds && limits && px ? Math.floor((funds.available * limits.capital_pct / 100) / (px * lot)) : null;
    const entry = needTrigger && !needPrice ? +trigger || px : px;
    const slN = +sl || 0, tgN = +tg || 0;
    const risk = slN && entry ? Math.abs(entry - slN) * qty : 0;
    const reward = tgN && entry ? Math.abs(tgN - entry) * qty : 0;
    const pct = (v) => (entry ? `${((v - entry) / entry * 100).toFixed(2)}%` : '');
    const bracketErr = execution === 'live' && (slN || tgN) ? 'Stop-loss / target: paper only for now'
        : slN && (buy ? slN >= entry : slN <= entry) ? `Stop-loss must be ${buy ? 'below' : 'above'} entry`
        : tgN && (buy ? tgN <= entry : tgN >= entry) ? `Target must be ${buy ? 'above' : 'below'} entry` : '';

    useEffect(() => {                       // broker margin estimate (debounced)
        if (!q) return undefined;
        const t = setTimeout(() => indiaApi.margin({ symbol, side, qty, product, price: needPrice ? +price || 0 : 0 })
            .then(d => setMargin(d.required)).catch(() => setMargin(null)), 400);
        return () => clearTimeout(t);
    }, [symbol, side, qty, product, price, needPrice, !!q]); // eslint-disable-line react-hooks/exhaustive-deps

    const invalid = !q ? 'Loading price…' : needPrice && !(+price > 0) ? 'Enter a limit price'
        : needTrigger && !(+trigger > 0) ? 'Enter a trigger price' : execution === 'live' && !liveOk ? 'Live trading is off in /india settings'
        : bracketErr;

    const chooseExec = async (v) => {
        if (v === 'live' && !(await confirmDialog({ title: 'Switch to live orders?', message: 'Orders will be sent to your Upstox account with real money.', confirmLabel: 'Use live', danger: true }))) return;
        setExec(v); setExecution(v); setReview(false);
    };

    const place = async () => {
        setBusy(true); setResult(null);
        try {
            const r = await indiaApi.place({ symbol, side, qty, product, order_type: type, price: needPrice ? +price : 0,
                trigger_price: needTrigger ? +trigger : 0, validity, execution, client_ref: ref.current,
                stop_loss: slN || 0, target: tgN || 0 });
            setResult(r);
            ref.current = Date.now().toString(36) + Math.random().toString(36).slice(2);   // next order gets a new ref
            if (r.ok) { setReview(false); setSl(''); setTg(''); }
        } catch (e) { setResult({ ok: false, reason: e.message }); }
        finally { setBusy(false); }
    };

    const tone = buy ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700';
    const chg = q?.change || 0;
    const prev = q && q.ltp - chg;
    const shell = sheet
        ? 'fixed inset-x-0 bottom-0 z-[350] max-h-[88dvh] rounded-t-2xl ts-sheet-up shadow-2xl'
        : 'relative h-full w-[340px] shrink-0 border-l border-slate-200 dark:border-borderdark ts-sheet-in';

    const body = (
        <aside className={`${shell} flex flex-col bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl`} aria-label="Place order">
            {sheet && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />}
            {/* header */}
            <div className="flex items-start gap-2 px-4 pt-3 pb-2">
                <div className="min-w-0 flex-1">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Place order · {execution === 'paper' ? 'Paper' : 'Live'}</div>
                    <div className="text-base font-bold text-slate-900 dark:text-white truncate">{q?.symbol || symbol}</div>
                    <div className="text-xs text-slate-500 truncate">{q?.name}</div>
                </div>
                <div className="text-right">
                    <div className="text-base font-bold tabular-nums text-slate-900 dark:text-white">{q ? inr(q.ltp) : '—'}</div>
                    {q && <div className={`text-xs tabular-nums ${chg >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {chg >= 0 ? '+' : ''}{chg.toFixed(2)} ({prev ? ((chg / prev) * 100).toFixed(2) : '0.00'}%)</div>}
                </div>
                <button onClick={onClose} className="p-1.5 -mr-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Close order panel">
                    <X className="w-5 h-5 text-slate-500" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
                <PositionBar pos={pos} onExit={async () => { const r = await exitPosition(pos, execution); if (r) setResult(r); }} />
                <Seg value={side} onChange={(v) => { setSide(v); setReview(false); }} options={[['BUY', 'Buy'], ['SELL', 'Sell']]}
                    tone={(v) => (v === 'BUY' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-red-600 text-white shadow-sm')} />
                <Seg value={product} onChange={(v) => { setProduct(v); setReview(false); }}
                    options={[['DELIVERY', q?.fo && q?.segment !== 'EQ' ? 'Carry (NRML)' : 'Delivery'], ['INTRADAY', 'Intraday']]} />

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <div className="flex justify-between mb-1"><span className={label}>{lot > 1 ? 'Lots' : 'Quantity'}</span>
                            {lot > 1 ? <span className="text-[11px] text-slate-400">{lots} × {lot} = {qty}</span>
                                : maxLots > 0 && <button type="button" onClick={() => setLots(maxLots)} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">Max {maxLots.toLocaleString('en-IN')}</button>}</div>
                        <div className="flex items-center h-10 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                            <button type="button" onClick={() => setLots(l => Math.max(1, l - 1))} className="h-full px-2.5 text-slate-500 active:scale-90" aria-label="Less"><Minus className="w-4 h-4" /></button>
                            <input inputMode="numeric" value={lots} onChange={e => setLots(Math.max(1, parseInt(e.target.value.replace(/\D/g, ''), 10) || 1))}
                                className="w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums text-slate-900 dark:text-white focus:outline-none" aria-label="Quantity" />
                            <button type="button" onClick={() => setLots(l => l + 1)} className="h-full px-2.5 text-slate-500 active:scale-90" aria-label="More"><Plus className="w-4 h-4" /></button>
                        </div>
                    </div>
                    <div>
                        <div className="mb-1"><span className={label}>Price</span></div>
                        <select value={type} onChange={e => { setType(e.target.value); setReview(false); }} className={field} aria-label="Order type">
                            {TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                        </select>
                    </div>
                </div>
                {(needPrice || needTrigger) && (
                    <div className="grid grid-cols-2 gap-3">
                        {needPrice ? <label className="block"><span className={label}>Limit price</span>
                            <input inputMode="decimal" value={price} placeholder={q?.ltp?.toFixed(2)} onChange={e => setPrice(e.target.value)} className={`${field} mt-1`} /></label> : <div />}
                        {needTrigger && <label className="block"><span className={label}>Trigger price</span>
                            <input inputMode="decimal" value={trigger} placeholder={q?.ltp?.toFixed(2)} onChange={e => setTrigger(e.target.value)} className={`${field} mt-1`} /></label>}
                    </div>
                )}

                <Section title="Stop-loss & target" sub={slN || tgN ? `${slN ? `SL ${slN}` : ''}${slN && tgN ? ' · ' : ''}${tgN ? `Target ${tgN}` : ''}` : 'Exit orders placed after the fill (paper)'} >
                    <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block"><span className={label}>Stop-loss {slN ? <span className="text-red-500">{pct(slN)}</span> : null}</span>
                                <input inputMode="decimal" value={sl} placeholder={entry ? (buy ? entry * 0.99 : entry * 1.01).toFixed(2) : ''} onChange={e => setSl(e.target.value)} className={`${field} mt-1`} /></label>
                            <label className="block"><span className={label}>Target {tgN ? <span className="text-emerald-600">{pct(tgN)}</span> : null}</span>
                                <input inputMode="decimal" value={tg} placeholder={entry ? (buy ? entry * 1.02 : entry * 0.98).toFixed(2) : ''} onChange={e => setTg(e.target.value)} className={`${field} mt-1`} /></label>
                        </div>
                        <div className="flex gap-1.5">
                            {[[1, 2], [0.5, 1], [2, 4]].map(([a, b]) => (
                                <button key={a} type="button" disabled={!entry} onClick={() => {
                                    const f = (x) => (Math.round(x / (q?.tick_size || 0.05)) * (q?.tick_size || 0.05)).toFixed(2);
                                    setSl(f(buy ? entry * (1 - a / 100) : entry * (1 + a / 100))); setTg(f(buy ? entry * (1 + b / 100) : entry * (1 - b / 100)));
                                }} className="flex-1 h-7 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 active:scale-95">SL {a}% · TP {b}%</button>
                            ))}
                        </div>
                        {(risk > 0 || reward > 0) && (
                            <div className="flex justify-between text-xs tabular-nums text-slate-600 dark:text-slate-300">
                                <span>Risk <b className="text-red-600">{inr(risk, 0)}</b></span>
                                <span>Reward <b className="text-emerald-600">{inr(reward, 0)}</b></span>
                                {risk > 0 && reward > 0 && <span>R:R <b>1 : {(reward / risk).toFixed(1)}</b></span>}
                            </div>
                        )}
                    </div>
                </Section>
                <Section title="Market depth">{q ? <Depth q={q} /> : <div className="text-xs text-slate-500">Loading…</div>}</Section>
                <Section title="Additional settings" sub="Validity and paper / live">
                    <div className="space-y-3">
                        <div><div className={`${label} mb-1`}>Validity</div><Seg value={validity} onChange={setValidity} options={[['DAY', 'Day'], ['IOC', 'Immediate or cancel']]} /></div>
                        <div><div className={`${label} mb-1`}>Send to</div>
                            <Seg value={execution} onChange={chooseExec} options={[['paper', 'Paper (practice)'], ['live', 'Live Upstox']]}
                                tone={(v) => (v === 'live' ? 'bg-amber-500 text-white shadow-sm' : null)} />
                            {execution === 'live' && !liveOk && <p className="mt-1 text-xs text-amber-600">Turn on live trading in the dashboard settings first.</p>}
                        </div>
                    </div>
                </Section>

                {q && !q.market_open && (
                    <div className="flex gap-2 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/70 dark:bg-indigo-500/10 p-3 text-xs text-indigo-800 dark:text-indigo-200">
                        <Info className="w-4 h-4 shrink-0" />
                        <span>{execution === 'paper' ? 'Market is closed. Paper orders fill at the last price.' : 'Market is closed (09:15–15:30 IST). Live orders are refused until it opens.'}</span>
                    </div>
                )}
                {qErr && <div className="text-xs text-red-600">{qErr}</div>}
                {result && (
                    <div className={`flex gap-2 rounded-xl p-3 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
                        {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                        <span>{result.ok
                            ? `${result.order.intent.side} ${result.order.intent.qty} ${result.order.intent.symbol}: ${result.order.status}${result.order.avg_price ? ` @ ${inr(result.order.avg_price)}` : ''}. ${result.order.message || ''}`
                            : result.reason}</span>
                    </div>
                )}
                <button type="button" onClick={() => navigate('/india')} className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 py-1">
                    <LayoutDashboard className="w-3.5 h-3.5" /> Positions, orders & risk settings
                </button>
            </div>

            {/* footer: required margin + review / confirm */}
            <div className="border-t border-slate-200 dark:border-white/10 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2 bg-slate-50/80 dark:bg-slate-900/80">
                <div className="flex justify-between text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    <span>Required <b className="text-slate-900 dark:text-white">{margin != null ? inr(margin) : inr(value)}</b>
</span>
                    <span>Available <b className="text-slate-900 dark:text-white">{funds ? inr(funds.available, 0) : '—'}</b></span>
                </div>
                {review && !invalid && (
                    <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 p-3 text-xs space-y-1 tabular-nums text-slate-700 dark:text-slate-200">
                        <div className="flex justify-between"><span>{side} · {product === 'INTRADAY' ? 'Intraday' : 'Delivery'} · {TYPES.find(t => t[0] === type)[1]}</span><b>{qty} qty</b></div>
                        <div className="flex justify-between"><span>{needPrice ? 'Limit' : 'At market'}{needTrigger ? ` · trigger ${trigger}` : ''}</span><b>{needPrice ? inr(+price) : `≈ ${inr(q.ltp)}`}</b></div>
                        <div className="flex justify-between"><span>Order value</span><b>{inr(value)}</b></div>
                        {(slN > 0 || tgN > 0) && <div className="flex justify-between"><span>Exits after fill</span><b>{slN ? `SL ${slN}` : ''}{slN && tgN ? ' · ' : ''}{tgN ? `TP ${tgN}` : ''}</b></div>}
                        <div className="flex justify-between"><span>Sent to</span><b className={execution === 'live' ? 'text-amber-600' : ''}>{execution === 'live' ? 'LIVE Upstox account' : 'Paper account'}</b></div>
                    </div>
                )}
                <div className="flex gap-2">
                    {review && <button type="button" onClick={() => setReview(false)} className="h-11 px-4 rounded-xl text-sm font-semibold bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white active:scale-[0.98]">Edit</button>}
                    <button type="button" disabled={!!invalid || busy} onClick={() => (review ? place() : setReview(true))}
                        className={`flex-1 h-11 rounded-xl text-sm font-bold text-white ${tone} disabled:opacity-50 transition-transform duration-100 active:scale-[0.98]`}>
                        {invalid || (busy ? 'Placing…' : review ? `Place ${side.toLowerCase()} order` : `Review ${side.toLowerCase()} order`)}
                    </button>
                </div>
            </div>
        </aside>
    );

    if (!sheet) return body;
    return (
        <>
            <div className="fixed inset-0 z-[349] bg-black/40 ts-scrim-in" onClick={onClose} />
            {body}
        </>
    );
}

// SELL / BUY chips on the chart (like Upstox): bid on the sell chip, ask on the buy chip, spread between.
export function TradeChips({ symbol, onOpen }) {
    const [q] = useQuote(symbol);
    const execution = getExecution();
    const [bump, setBump] = useState(0);
    const pos = usePosition(q?.instrument_key, execution, bump);
    const bid = q?.bids?.[0]?.price || q?.ltp;
    const ask = q?.asks?.[0]?.price || q?.ltp;
    const spread = useMemo(() => (bid && ask ? Math.max(0, ask - bid) : null), [bid, ask]);
    const chip = 'flex flex-col items-start justify-center h-9 px-2.5 rounded-lg text-white text-[11px] font-bold leading-tight shadow-md transition-transform duration-100 active:scale-95';
    return (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
        <div className="relative flex items-stretch gap-1 rounded-xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-1 shadow-lg border border-white/50 dark:border-white/10">
            <button type="button" onClick={() => onOpen('SELL')} className={`${chip} bg-red-600 hover:bg-red-700`} aria-label="Sell">
                <span className="opacity-80 text-[9px] tracking-wide">SELL</span><span className="tabular-nums">{bid ? bid.toFixed(2) : '—'}</span>
            </button>
            <div className="flex items-center px-1 text-[10px] tabular-nums text-slate-500 dark:text-slate-400" title="Spread">{spread != null ? spread.toFixed(2) : ''}</div>
            <button type="button" onClick={() => onOpen('BUY')} className={`${chip} bg-emerald-600 hover:bg-emerald-700`} aria-label="Buy">
                <span className="opacity-80 text-[9px] tracking-wide">BUY</span><span className="tabular-nums">{ask ? ask.toFixed(2) : '—'}</span>
            </button>
            {q?.fo && q.segment !== 'FO' && (
                <button type="button" onClick={() => { openOptionsFor(q.symbol); navigate('/options'); }} title="Option chain"
                    className="flex items-center px-2 rounded-lg text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 hover:bg-indigo-100 active:scale-95">Options</button>
            )}
            <span className={`absolute -top-1.5 -right-1.5 px-1 rounded text-[8px] font-bold tracking-wide ${execution === 'live' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'}`}>{execution === 'live' ? 'LIVE' : 'PAPER'}</span>
        </div>
        {pos && <div className="backdrop-blur-md rounded-xl shadow-md"><PositionBar compact pos={pos} onExit={async () => { await exitPosition(pos, execution); setBump(b => b + 1); }} /></div>}
        </div>
    );
}
