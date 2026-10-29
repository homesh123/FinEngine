// /india → Strategies and Agent tabs (INDIA_ALGO_TRADING.md C4 / C5 part 2 / E3). Owner only.
// Strategies: approvals queue, one card per strategy (on/off, stats, Test now, Open chart, edit, delete) and a
// 4-step setup sheet (What → When → Size & exits → Run as). Two kinds: indicator signals from the chart, or the
// AI agent (our own model). Paper by default; live is refused by the server until enabled in Settings.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, Play, LineChart, Trash2, Pencil, Bot, Bell, Check, ChevronLeft, Sparkles, Power, Search, Target } from 'lucide-react';
import { indiaApi, inr } from '../utils/indiaApi';
import { EA_BRIDGE_SOURCES } from '../utils/eaBridge';
import { getTradeToken } from '../utils/tradingApi';
import { confirmDialog } from '../utils/confirmDialog';
import { refreshIndiaStrategies } from '../hooks/useIndiaSignalBridge';

const INDICATORS = EA_BRIDGE_SOURCES.filter(s => s.key !== 'pressure');
const indLabel = (k) => (k === 'agent' ? 'AI agent' : k === 'option_agent' ? 'Option Pilot' : INDICATORS.find(s => s.key === k)?.label || k);
// zero-to-hero strategies are advise only (the server enforces it too)
const TFS = [[15, '15m'], [30, '30m'], [60, '1H'], [240, '4H'], [1440, '1D']];
const SCALP_TFS = [[1, '1m'], [3, '3m'], [5, '5m']];          // Scalp mode only (AI agent: 5m)
const tfLabel = (v) => [...SCALP_TFS, ...TFS].find(t => t[0] === v)?.[1] || `${v}m`;
const MODES = {
    day: { label: 'Day trade', desc: 'Intraday. Entries 09:20–14:30, closed the same day.', window: '09:20-14:30', trades: 3 },
    swing: { label: 'Swing', desc: 'Delivery, held for days. Long only.', window: '09:20-15:15', trades: 2 },
    scalp: { label: 'Scalp', desc: 'Intraday, more trades, tight stops. Also 1m / 3m / 5m candles.', window: '09:20-14:30', trades: 6 },
};
const RUN = {
    advise: { label: 'Advise only', desc: 'Logs what it would do. No orders.', tone: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200' },
    approve: { label: 'Ask me first', desc: 'Each trade waits for your Approve (15 min).', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' },
    paper: { label: 'Paper auto', desc: 'Trades the paper account by itself.', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
    live: { label: 'Live auto', desc: 'Real money. Only after good paper results.', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
};
const chip = 'inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold';
const field = 'h-10 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm tabular-nums text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1';

function Pick({ value, onChange, options, cols }) {
    return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols || options.length}, minmax(0, 1fr))` }}>
            {options.map(([v, title, desc]) => (
                <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
                    className={`text-left rounded-xl border px-3 py-2 transition-[transform,background-color] duration-100 active:scale-[0.98] ${value === v
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
                    {desc && <span className="block text-[11px] text-slate-500 leading-snug">{desc}</span>}
                </button>
            ))}
        </div>
    );
}

function StockSearch({ value, onPick }) {
    const [q, setQ] = useState('');
    const [list, setList] = useState([]);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open || !q.trim()) { setList([]); return undefined; }
        const t = setTimeout(() => fetch(`/api/upstox/symbols?query=${encodeURIComponent(q)}&limit=8`, { headers: { 'X-Trade-Token': getTradeToken() } })
            .then(r => r.json()).then(setList).catch(() => setList([])), 150);
        return () => clearTimeout(t);
    }, [q, open]);
    return (
        <div className="relative">
            <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                <Search className="w-4 h-4 text-slate-400" />
                <input value={open ? q : value} placeholder="Search NSE / BSE stock" onFocus={() => { setOpen(true); setQ(''); }}
                    onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={e => setQ(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-slate-900 dark:text-white focus:outline-none" />
            </div>
            {open && list.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl p-1">
                    {list.map(r => (
                        <button key={r.instrument_key} type="button" onMouseDown={() => onPick(r.symbol)}
                            className="w-full flex justify-between gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-white/10">
                            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900 dark:text-white">{r.symbol}</span>
                                <span className="block text-xs text-slate-500 truncate">{r.instrument_name}</span></span>
                            {r.fo && <span className="text-[10px] font-bold text-indigo-600 self-center">F&O</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function UnderlyingSelect({ value, onPick }) {
    const [list, setList] = useState([]);
    useEffect(() => { indiaApi.optionUnderlyings('').then(setList).catch(() => setList([])); }, []);
    return (
        <select value={value} onChange={e => onPick(e.target.value)} className={field}>
            {!list.some(u => u.symbol === value) && <option value={value}>{value}</option>}
            {list.map(u => <option key={u.instrument_key} value={u.symbol}>{u.symbol.split(':')[1]} · {u.type}</option>)}
        </select>
    );
}

const blank = (kind) => kind === 'option' ? ({
    kind, symbol: 'NSE:NIFTY', timeframe: 15, indicator: 'option_agent', signal: 'any', mode: 'day',
    sizing: { type: 'amount', value: 5000, max_trades: 2, min_conf: 0.65, min_days: 2 }, stop: { type: 'pct', value: 35 }, target: { type: 'rr', value: 2 },
    entry_window: '09:30-14:00', enabled: true, execution: 'paper',
}) : ({
    kind, symbol: 'NSE:RELIANCE', timeframe: 15, indicator: kind === 'agent' ? 'agent' : 'goldMove', signal: 'any', mode: 'day',
    sizing: { type: 'capital_pct', value: 10, max_trades: 3, min_conf: 0.6 }, stop: { type: 'pct', value: 1 }, target: { type: 'rr', value: 2 },
    entry_window: '09:20-14:30', enabled: true, execution: 'paper',
});

function Wizard({ initial, liveOk, onClose, onSaved }) {
    const [s, setS] = useState(initial);
    const [step, setStep] = useState(initial.id ? 1 : 0);
    const [ltp, setLtp] = useState(null);
    const [capital, setCapital] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const agent = s.indicator === 'agent';
    const opt = s.indicator === 'option_agent';
    const up = (patch) => setS(x => ({ ...x, ...patch }));
    const upIn = (k, patch) => setS(x => ({ ...x, [k]: { ...x[k], ...patch } }));

    useEffect(() => { indiaApi.quote(s.symbol).then(q => setLtp(q.ltp)).catch(() => setLtp(null)); }, [s.symbol]);
    useEffect(() => { indiaApi.funds(s.execution === 'live' ? 'live' : 'paper').then(f => setCapital(f.capital)).catch(() => {}); }, [s.execution]);

    const example = useMemo(() => {                                   // mirrors backend strategies.plan()
        if (!ltp) return null;
        const dist = s.stop.type === 'pct' ? ltp * s.stop.value / 100 : null;
        if (!dist) return { note: 'Stop uses ATR of the chart at signal time' };
        const money = s.sizing.type === 'amount' ? +s.sizing.value : (capital || 0) * s.sizing.value / 100;
        const qty = Math.floor(s.sizing.type === 'risk_pct' ? money / dist : money / ltp);
        const tdist = s.target.type === 'rr' ? dist * s.target.value : ltp * s.target.value / 100;
        return { qty, sl: ltp - dist, tp: ltp + tdist, risk: qty * dist, reward: qty * tdist, value: qty * ltp };
    }, [ltp, s.stop, s.target, s.sizing, capital]);

    const save = async () => {
        if (s.execution === 'live' && !(await confirmDialog({ title: 'Run this strategy live?', message: 'It will place real orders in your Upstox account by itself.', confirmLabel: 'Run live', danger: true }))) return;
        setBusy(true); setErr('');
        try {
            const { kind, stats, created_at, updated_at, ...body } = s;                   // eslint-disable-line no-unused-vars
            await indiaApi.saveStrategy(body); refreshIndiaStrategies(); onSaved();
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };

    const steps = ['Type', 'What', 'When', 'Size & exits', 'Run as'];
    const sentence = opt && (s.sizing.setups || []).includes('ZH')
        ? `Zero to hero (advise only) logs, on the day before each ${s.symbol} expiry, the far-OTM option it would buy and scores it at expiry — it never places an order`
        : opt
        ? `Option Pilot checks ${s.symbol} at 15:10–15:25 each day and opens a skew credit spread or volatility-premium iron condor when its setup is present and it is at least ${Math.round(s.sizing.min_conf * 100)}% confident, risking at most ₹${Number(s.sizing.value).toLocaleString('en-IN')} per structure`
        : agent
        ? `The AI agent watches ${s.symbol} on ${tfLabel(s.timeframe)} and ${s.signal === 'any' ? 'buys or sells' : s.signal === 'buy' ? 'only buys' : 'only sells'} when it is at least ${Math.round(s.sizing.min_conf * 100)}% confident`
        : `${s.signal === 'sell' ? 'Sell' : s.signal === 'buy' ? 'Buy' : 'Buy or sell'} ${s.symbol} when ${indLabel(s.indicator)} gives a signal on ${tfLabel(s.timeframe)}`;

    return (
        <div className="fixed inset-0 z-[350] flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/40 ts-scrim-in" onClick={onClose} />
            <div className="relative w-full md:max-w-xl max-h-[92dvh] flex flex-col rounded-t-2xl md:rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ts-sheet-up">
                <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                    {step > (initial.id ? 1 : 0) && <button onClick={() => setStep(step - 1)} className="p-1 -ml-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Back"><ChevronLeft className="w-5 h-5 text-slate-500" /></button>}
                    <div className="mr-auto">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Step {step + 1} of {steps.length} · {steps[step]}</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white">{initial.id ? 'Edit strategy' : 'New strategy'}</div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Close"><X className="w-5 h-5 text-slate-500" /></button>
                </div>
                <div className="flex gap-1 px-4 pb-3">{steps.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-white/10'}`} />)}</div>

                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
                    {step === 0 && (
                        <Pick value={opt ? 'option' : agent ? 'agent' : 'alert'} cols={1} onChange={(v) => setS(v === 'option' ? blank(v) : { ...blank(v), symbol: opt ? 'NSE:RELIANCE' : s.symbol })} options={[
                            ['alert', '📈 Indicator signals', 'Trade when a TradeSagar indicator (Gold Move, SMC Pro, Ichimoku…) signals on the chart.'],
                            ['agent', '🤖 AI agent', 'Our own model studies the stock and proposes trades with a confidence and a reason.'],
                            ['option', '🎯 Option Pilot', 'Trades the two option setups that held up on 5 years of real NSE prices: skew credit spreads (NIFTY) and volatility-premium iron condors (NIFTY, BANKNIFTY). Defined risk, decided at the close, learns from its own results.'],
                        ]} />
                    )}
                    {step === 1 && opt && (<>
                        <div><span className={lbl}>Underlying (index or F&O stock)</span><UnderlyingSelect value={s.symbol} onPick={(v) => up({ symbol: v })} /></div>
                        <div><span className={lbl}>Setup</span>
                            <Pick value={(s.sizing.setups || ['S1', 'S2']).join('+')} cols={1}
                                onChange={(v) => up({ sizing: { ...s.sizing, setups: v.split('+') }, ...(v === 'ZH' ? { execution: 'advise' } : {}) })}
                                options={[['S1', 'Skew credit spread', 'Bull put / bear call when the 25-delta skew is extreme (validated rules per index).'],
                                          ['S2', 'Volatility-premium iron condor', 'When options are rich (IV ≥ 1.1× realised vol), close to expiry.'],
                                          ['S1+S2', 'Both', 'Whichever setup is present; one position at a time.'],
                                          ['ZH', 'Zero to hero (advise only)', 'Failed in research — logs what it would buy the day before expiry and scores it. Never trades.']]} />
                            <p className="mt-1 text-xs text-slate-500">Option Pilot decides once a day at 15:10–15:25 (as backtested), picks the expiry its rules need, and checks stop / take-profit at each close. Thresholds come from the research for this index.</p></div>
                    </>)}
                    {step === 1 && !opt && (<>
                        <div><span className={lbl}>Stock</span><StockSearch value={s.symbol} onPick={(v) => up({ symbol: v })} />
                            {ltp && <p className="mt-1 text-xs text-slate-500">Last price {inr(ltp)}</p>}</div>
                        <div><span className={lbl}>Style</span>
                            <Pick value={s.mode} cols={1} onChange={(v) => up({ mode: v, entry_window: MODES[v].window, sizing: { ...s.sizing, max_trades: MODES[v].trades }, ...(v === 'swing' && s.signal === 'any' ? { signal: 'buy' } : {}), ...(v !== 'scalp' && s.timeframe < 15 ? { timeframe: 15 } : {}) })}
                                options={Object.entries(MODES).map(([k, m]) => [k, m.label, m.desc])} /></div>
                        <div><span className={lbl}>Candles</span>
                            <Pick value={s.timeframe} onChange={(v) => up({ timeframe: v })}
                                options={[...(s.mode === 'scalp' ? (agent ? SCALP_TFS.slice(2) : SCALP_TFS) : []), ...(agent ? TFS.slice(0, 4) : TFS)].map(([v, t]) => [v, t])}
                                cols={s.mode === 'scalp' ? (agent ? 5 : 7) : (agent ? 4 : 5)} />
                            {s.mode === 'scalp' && s.timeframe < 15 && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">1–5 minute candles are noisy and charges eat small targets: trades whose target is under 5× the charges are skipped. Start on paper.</p>}
                            {s.mode !== 'scalp' && <p className="mt-1 text-[11px] text-slate-500">1m / 3m / 5m are available in Scalp style.</p>}</div>
                    </>)}
                    {step === 2 && (<>
                        {!agent && !opt && <div><span className={lbl}>Indicator</span>
                            <select value={s.indicator} onChange={e => up({ indicator: e.target.value })} className={field}>
                                {INDICATORS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                            </select></div>}
                        {(agent || opt) && <div><span className={lbl}>Minimum confidence: {Math.round(s.sizing.min_conf * 100)}%</span>
                            <input type="range" min="55" max="85" step="5" value={Math.round(s.sizing.min_conf * 100)} onChange={e => upIn('sizing', { min_conf: +e.target.value / 100 })} className="w-full accent-indigo-600" />
                            <p className="text-xs text-slate-500">Higher = fewer, surer trades. The agent also says HOLD whenever its track record shows no edge.</p></div>}
                        {!opt && <div><span className={lbl}>Direction</span>
                            <Pick value={s.signal} onChange={(v) => up({ signal: v })} options={[['any', 'Buy & sell'], ['buy', 'Buy only'], ['sell', 'Sell only']].filter(o => s.mode !== 'swing' || o[0] === 'buy')} /></div>}
                        {opt && <p className="text-xs text-slate-500 rounded-lg bg-slate-50 dark:bg-white/5 p-2.5">Decision time is fixed at <b>15:10–15:25 IST</b> — the research decided at the close, so other times aren't validated.</p>}
                        {!opt && <div className="grid grid-cols-2 gap-3">
                            <label><span className={lbl}>New entries from (IST)</span><input value={s.entry_window.split('-')[0]} onChange={e => up({ entry_window: `${e.target.value}-${s.entry_window.split('-')[1]}` })} className={field} /></label>
                            <label><span className={lbl}>until</span><input value={s.entry_window.split('-')[1]} onChange={e => up({ entry_window: `${s.entry_window.split('-')[0]}-${e.target.value}` })} className={field} /></label>
                        </div>}
                        <p className="text-xs text-slate-500">{opt ? 'Every structure is defined-risk (a bought wing caps the loss). Stops, take-profits and deltas come from the validated research for this index — see the strategy card.' : 'An opposite signal closes the open trade. Exits are always allowed.'}</p>
                    </>)}
                    {step === 3 && opt && (<>
                        <label><span className={lbl}>Max loss per trade (₹) — lots are sized so the worst case (wing width − credit) stays within it</span>
                            <input type="number" value={s.sizing.value} onChange={e => upIn('sizing', { value: +e.target.value })} className={field} /></label>
                        <label><span className={lbl}>Max trades per day</span><input type="number" min="1" value={s.sizing.max_trades} onChange={e => upIn('sizing', { max_trades: +e.target.value })} className={field} /></label>
                        <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3 text-xs text-slate-600 dark:text-slate-300">Example: a NIFTY bull put spread 100 points wide for a 30-point credit risks 70 points × 65 = ₹4,550 per lot, so ₹{Number(s.sizing.value).toLocaleString('en-IN')} allows {Math.floor(s.sizing.value / 4550)} lot(s).</div>
                    </>)}
                    {step === 3 && !opt && (<>
                        <div><span className={lbl}>Size of each trade</span>
                            <Pick value={s.sizing.type} onChange={(v) => upIn('sizing', { type: v, value: v === 'amount' ? 50000 : v === 'capital_pct' ? 10 : 0.5 })}
                                options={[['amount', '₹ amount'], ['capital_pct', '% of capital'], ['risk_pct', '% risk']]} />
                            <input type="number" value={s.sizing.value} onChange={e => upIn('sizing', { value: +e.target.value })} className={`${field} mt-2`} /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><span className={lbl}>Stop-loss</span>
                                <Pick value={s.stop.type} onChange={(v) => upIn('stop', { type: v, value: v === 'pct' ? 1 : 1.5 })} options={[['pct', '%'], ['atr', '× ATR']]} />
                                <input type="number" step="0.1" value={s.stop.value} onChange={e => upIn('stop', { value: +e.target.value })} className={`${field} mt-2`} /></div>
                            <div><span className={lbl}>Target</span>
                                <Pick value={s.target.type} onChange={(v) => upIn('target', { type: v, value: v === 'rr' ? 2 : 2 })} options={[['rr', 'R:R'], ['pct', '%']]} />
                                <input type="number" step="0.1" value={s.target.value} onChange={e => upIn('target', { value: +e.target.value })} className={`${field} mt-2`} /></div>
                        </div>
                        <label><span className={lbl}>Max trades per day</span><input type="number" min="1" value={s.sizing.max_trades} onChange={e => upIn('sizing', { max_trades: +e.target.value })} className={field} /></label>
                        <div><span className={lbl}>Trailing stop-loss</span>
                            <Pick value={s.stop.trail || 'off'} onChange={(v) => upIn('stop', { trail: v, trail_r: s.stop.trail_r || 1, activate_r: s.stop.activate_r || 1 })}
                                options={[['off', 'Off', 'Fixed stop and target'], ['breakeven', 'Breakeven', 'Stop to entry after +1R'], ['trail', 'Trail', 'After +1R, stay 1R behind the best price']]} />
                            <p className="mt-1 text-[11px] text-slate-500">Trailing locks profit but can cut winners short — test it on paper; it isn't better for every strategy.</p></div>
                        {example && (example.note ? <p className="text-xs text-slate-500">{example.note}</p> : (
                            <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3 text-xs tabular-nums text-slate-600 dark:text-slate-300 space-y-1">
                                <div className="font-semibold text-slate-800 dark:text-slate-100">Example buy at {inr(ltp)}</div>
                                <div className="flex justify-between"><span>Quantity</span><b>{example.qty} ({inr(example.value, 0)})</b></div>
                                <div className="flex justify-between"><span>Stop-loss / target</span><b>{example.sl.toFixed(2)} / {example.tp.toFixed(2)}</b></div>
                                <div className="flex justify-between"><span>Risk / reward</span><b><span className="text-red-600">{inr(example.risk, 0)}</span> / <span className="text-emerald-600">{inr(example.reward, 0)}</span></b></div>
                                {example.qty < 1 && <div className="text-red-600">Too small for one share — raise the size.</div>}
                            </div>))}
                    </>)}
                    {step === 4 && (<>
                        <Pick value={s.execution} cols={1} onChange={(v) => ((s.sizing.setups || []).includes('ZH') ? v === 'advise' : (v !== 'live' || liveOk)) && up({ execution: v })}
                            options={Object.entries(RUN).filter(([k]) => !(s.sizing.setups || []).includes('ZH') || k === 'advise').map(([k, r]) => [k, r.label + (k === 'live' && !liveOk ? ' (locked)' : ''),
                                opt && k === 'live' ? 'Multi-leg option orders need broker basket/GTT support (not built yet): runs on paper for now.' : k === 'live' && !liveOk ? 'Turn on live trading in Settings after good paper results.' : r.desc])} />
                        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 p-3 text-sm text-indigo-900 dark:text-indigo-100">
                            <Sparkles className="inline w-4 h-4 mr-1" />{sentence}.{opt ? ` Decides at 15:10–15:25 IST, one position at a time. ${RUN[s.execution].label}.` : <> Size {s.sizing.type === 'amount' ? inr(s.sizing.value, 0) : `${s.sizing.value}% ${s.sizing.type === 'risk_pct' ? 'risk' : 'of capital'}`},
                            stop {s.stop.value}{s.stop.type === 'pct' ? '%' : '× ATR'}, target {s.target.type === 'rr' ? `${s.target.value}R` : `${s.target.value}%`}, max {s.sizing.max_trades} trades a day, entries {s.entry_window} IST. {RUN[s.execution].label}.</>}
                        </div>
                        {!agent && !opt && <p className="text-xs text-slate-500">Signals come from the chart: keep {s.symbol} {tfLabel(s.timeframe)} open with {indLabel(s.indicator)} on (the strategy card has an Open chart button).</p>}
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={e => up({ enabled: e.target.checked })} className="w-4 h-4" /> Turn on now</label>
                    </>)}
                    {err && <div className="rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 p-3 text-sm">{err}</div>}
                </div>
                <div className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-slate-200 dark:border-white/10">
                    {step < steps.length - 1
                        ? <button onClick={() => setStep(step + 1)} className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-bold active:scale-[0.98]">Next</button>
                        : <button disabled={busy} onClick={save} className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50 active:scale-[0.98]">{busy ? 'Saving…' : initial.id ? 'Save changes' : 'Create strategy'}</button>}
                </div>
            </div>
        </div>
    );
}

export function StrategiesTab({ liveOk, onOpenChart }) {
    const [list, setList] = useState(null);
    const [approvals, setApprovals] = useState([]);
    const [catalog, setCatalog] = useState({});
    useEffect(() => { indiaApi.pilotCatalog().then(c => setCatalog(Object.fromEntries(c.map(x => [x.name, x])))).catch(() => {}); }, []);
    const [edit, setEdit] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = () => Promise.all([indiaApi.strategies(), indiaApi.approvals()])
        .then(([l, a]) => { setList(l); setApprovals(a); }).catch(e => setMsg({ err: true, text: e.message }));
    useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

    const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); setMsg(ok ? { text: ok(r) } : null); refreshIndiaStrategies(); await load(); } catch (e) { setMsg({ err: true, text: e.message }); } finally { setBusy(false); } };
    const toggle = (s) => run(() => indiaApi.saveStrategy({ ...s, enabled: !s.enabled }));
    const del = async (s) => { if (await confirmDialog({ title: 'Delete this strategy?', message: `${s.symbol} · ${indLabel(s.indicator)}. Its past orders stay in the journal.`, confirmLabel: 'Delete', danger: true })) run(() => indiaApi.deleteStrategy(s.id)); };
    const test = (s) => run(() => indiaApi.testStrategy(s.id, s.signal === 'sell' ? 'SELL' : 'BUY'),
        (r) => `Test (paper): ${r.outcome}${r.reason ? ` — ${r.reason}` : ''}`);
    const decide = async (a, yes) => {
        if (yes && a.request.execution === 'live' && !(await confirmDialog({ title: 'Place this live order?', message: a.reason, confirmLabel: 'Approve live', danger: true }))) return;
        run(() => indiaApi.decide(a.id, yes), (r) => (yes ? (r.ok ? 'Approved — order placed' : `Not placed: ${r.reason}`) : 'Rejected'));
    };

    return (
        <div className="space-y-4">
            {msg && <div className={`rounded-xl p-3 text-sm ${msg.err ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'}`}>{msg.text}</div>}

            {approvals.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Bell className="w-4 h-4 text-indigo-600" /> Waiting for your approval</div>
                    {approvals.map(a => (
                        <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/60 dark:bg-indigo-500/10 p-3">
                            <span className={`${chip} ${a.request.side === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>{a.request.side}</span>
                            <span className="flex-1 min-w-[200px] text-sm text-slate-800 dark:text-slate-100">{a.reason}
                                <span className="block text-[11px] text-slate-500">Expires {new Date(a.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {a.request.execution}</span></span>
                            <button disabled={busy} onClick={() => decide(a, false)} className="h-9 px-3 rounded-lg text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10">Reject</button>
                            <button disabled={busy} onClick={() => decide(a, true)} className="h-9 px-4 rounded-lg text-sm font-bold bg-indigo-600 text-white"><Check className="inline w-4 h-4 mr-1" />Approve</button>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                <div className="mr-auto text-sm text-slate-500">Paper first: strategies trade the paper account until you turn live on.</div>
                <button onClick={() => setEdit(blank('alert'))} className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold active:scale-[0.97]"><Plus className="w-4 h-4" />New strategy</button>
            </div>

            {list && list.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/15 p-8 text-center space-y-3">
                    <div className="text-base font-bold text-slate-900 dark:text-white">Automate your first idea</div>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">Pick a stock and either an indicator signal or the AI agent. It runs on paper, so you can watch how it would have traded before any real money.</p>
                    <div className="flex justify-center gap-2">
                        <button onClick={() => setEdit(blank('alert'))} className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-semibold">📈 Indicator strategy</button>
                        <button onClick={() => setEdit(blank('agent'))} className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-semibold">🤖 AI agent strategy</button>
                        <button onClick={() => setEdit(blank('option'))} className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-semibold">🎯 Option Pilot</button>
                    </div>
                </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
                {(list || []).map(s => (
                    <div key={s.id} className={`rounded-2xl border p-4 space-y-3 ${s.enabled ? 'border-slate-200 dark:border-white/10' : 'border-slate-200/60 dark:border-white/5 opacity-70'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.indicator === 'agent' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' : s.indicator === 'option_agent' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'}`}>
                                {s.indicator === 'agent' ? <Bot className="w-5 h-5" /> : s.indicator === 'option_agent' ? <Target className="w-5 h-5" /> : <LineChart className="w-5 h-5" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{s.name || `${s.symbol} · ${s.indicator === 'option_agent' ? 'options' : tfLabel(s.timeframe)}`}</div>
                                <div className="text-xs text-slate-500 truncate">{s.indicator === 'option_agent' ? `Option Pilot · skew spread / iron condor · max loss ₹${Number(s.sizing.value).toLocaleString('en-IN')}` : `${indLabel(s.indicator)} · ${s.signal === 'any' ? 'buy & sell' : `${s.signal} only`}`} · {s.entry_window}</div>
                            </div>
                            <button role="switch" aria-checked={s.enabled} disabled={busy} onClick={() => toggle(s)} aria-label={s.enabled ? 'Turn strategy off' : 'Turn strategy on'}
                                className="shrink-0 flex items-center gap-2 group">
                                <span className={`text-[11px] font-semibold ${s.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>{s.enabled ? 'On' : 'Off'}</span>
                                <span className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 ${s.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'} group-active:opacity-80`}>
                                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out ${s.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                                </span>
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <span className={`${chip} bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200`}>{s.indicator === 'option_agent' ? ((s.sizing?.setups || []).includes('ZH') ? 'Zero to hero · far-OTM, day before expiry' : (s.sizing?.setups || []).join(' · ').replace('S1', 'S1 skew spread').replace('S2', 'S2 iron condor') || 'S1 · S2') : MODES[s.mode]?.label}</span>
                            {s.indicator === 'option_agent' && <span className={`${chip} bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200`}>Held to expiry · decides 15:10–15:25</span>}
                            <span className={`${chip} ${RUN[s.execution]?.tone}`}>{RUN[s.execution]?.label}</span>
                            {s.stats.pending > 0 && <span className={`${chip} bg-indigo-600 text-white`}>{s.stats.pending} to approve</span>}
                        </div>
                        {catalog[s.name]?.rejected && (
                            <div className="rounded-lg px-2.5 py-1.5 text-[11px] leading-snug bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200" title={catalog[s.name].evidence}>
                                <b>Failed in research</b> — every version lost in 2025–26 (PF 0.04–0.55). Advise only: it logs what it would buy and scores it at expiry; no orders.
                            </div>
                        )}
                        {catalog[s.name] && !catalog[s.name].rejected && (() => {
                            const c = catalog[s.name], t = c.test;
                            return (
                                <div className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-snug ${c.provisional ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'}`}
                                    title={c.evidence}>
                                    <b>{c.provisional ? 'Provisional' : 'Validated'}</b> on real NSE prices 2022–26 (exact 2026 charges). Untouched 2025–26: PF {t.pf.toFixed(2)} · RF {t.rf.toFixed(1)} · Sharpe {t.sharpe.toFixed(2)} · max DD {t.max_dd_pct.toFixed(1)}% · {Math.round(t.win * 100)}% wins · {t.n} trades
                                </div>
                            );
                        })()}
                        <div className="grid grid-cols-3 gap-2 text-center">
                            {[['Trades today', s.stats.trades_today], ['Open qty', s.stats.open_qty], ['Paper P&L', <span className={s.stats.pnl > 0 ? 'text-emerald-600' : s.stats.pnl < 0 ? 'text-red-600' : ''}>{inr(s.stats.pnl, 0)}</span>]].map(([k, v]) => (
                                <div key={k} className="rounded-lg bg-slate-50 dark:bg-white/5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div><div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{v}</div></div>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <button disabled={busy} onClick={() => test(s)} className="flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-white/10 active:scale-95"><Play className="w-3.5 h-3.5" />Test now (paper)</button>
                            {!['agent', 'option_agent'].includes(s.indicator) && <button onClick={() => onOpenChart(s)} className="flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-white/10 active:scale-95"><LineChart className="w-3.5 h-3.5" />Open chart</button>}
                            <button onClick={() => setEdit(s)} className="flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-white/10 active:scale-95"><Pencil className="w-3.5 h-3.5" />Edit</button>
                            <button disabled={busy} onClick={() => del(s)} className="ml-auto h-8 w-8 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                    </div>
                ))}
            </div>
            {edit && <Wizard initial={edit} liveOk={liveOk} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
        </div>
    );
}

function OptionPilotPanel() {
    const [st, setSt] = useState(null);
    const [ideas, setIdeas] = useState([]);
    const [u, setU] = useState('NSE:NIFTY');
    const [idea, setIdea] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = () => Promise.all([indiaApi.pilotStatus(), indiaApi.pilotIdeas()]).then(([a, b]) => { setSt(a); setIdeas(b); }).catch(() => {});
    useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
    const ask = async () => { setBusy(true); setIdea(null); try { setIdea(await indiaApi.pilotAsk(u)); load(); } catch (e) { setIdea({ action: 'ERROR', reason: e.message }); } finally { setBusy(false); } };
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    return (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 p-4 space-y-3">
            <div className="flex items-start gap-3">
                <Target className="w-8 h-8 text-amber-600" />
                <div className="flex-1">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">Option Pilot</div>
                    <div className="text-xs text-slate-500">Trades only what held up on 5 years of real NSE option prices (research/india/OPTION_RESEARCH.md): <b>S1</b> skew credit spread on NIFTY when the 25-delta risk reversal is extreme, <b>S2</b> iron condor when options are rich (IV ≥ 1.1 × realised vol). Decides at the close; every structure is scored in R and the agent tightens itself after losing streaks.</div>
                </div>
            </div>
            {st && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    {[['Ideas scored', st.ideas_closed], ['Win rate', pct(st.win_rate)], ['Avg result', st.avg_r == null ? '—' : `${st.avg_r > 0 ? '+' : ''}${st.avg_r}R`],
                      ['Learned model', st.model ? `on ${st.model.n}` : `${st.needs} to go`], ...(st.conf_bump ? [['Self-tightened', `+${Math.round(st.conf_bump * 100)}% conf`]] : [])].map(([k, v]) => (
                        <div key={k} className="rounded-lg bg-slate-50 dark:bg-white/5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div><div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{v}</div></div>
                    ))}
                </div>
            )}
            {st?.zero_hero?.n > 0 && (
                <div className="text-xs rounded-lg bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-200 px-3 py-2">
                    Zero to hero (advice, kept apart from learning): {st.zero_hero.wins}/{st.zero_hero.n} winners · average {st.zero_hero.avg_r > 0 ? '+' : ''}{Math.round(st.zero_hero.avg_r * 100)}% · best {st.zero_hero.best > 0 ? '+' : ''}{Math.round(st.zero_hero.best * 100)}%
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                <div className="flex-1 min-w-[200px]"><UnderlyingSelect value={u} onPick={setU} /></div>
                <button disabled={busy} onClick={ask} className="h-10 px-4 rounded-lg bg-amber-500 text-white text-sm font-bold disabled:opacity-50">{busy ? 'Reading chain…' : 'Ask Option Pilot'}</button>
            </div>
            {idea && (
                <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3 text-sm space-y-2">
                    {idea.action === 'ERROR' ? <p className="text-red-600 text-xs">{idea.reason}</p> : <p className="text-xs text-slate-600 dark:text-slate-300">{idea.view}</p>}
                    {(idea.setups || []).map(x => (
                        <div key={x.setup} className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-white dark:bg-slate-900 p-2.5 space-y-1">
                            <div className="flex items-center gap-2"><span className={`${chip} bg-amber-500 text-white`}>{x.setup}</span><b className="text-slate-900 dark:text-white">{x.name}</b><span className="text-xs text-slate-500">· {pct(x.confidence)} confident · expiry {x.expiry} ({x.dte}d)</span></div>
                            <div className="flex flex-wrap gap-1.5 text-xs tabular-nums">{x.legs.map(l => <span key={l.key} className={`px-1.5 py-0.5 rounded ${l.side === 'SELL' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>{l.side} {l.symbol} @ {l.ltp} (Δ {Number(l.delta).toFixed(2)})</span>)}</div>
                            <div className="text-xs tabular-nums text-slate-600 dark:text-slate-300">Credit {x.credit} · max loss {x.max_loss} per unit</div>
                            <p className="text-xs text-slate-500">{x.reason}</p>
                        </div>
                    ))}
                </div>
            )}
            {st?.open_structures?.length > 0 && (
                <div className="text-xs space-y-1"><div className="font-semibold text-slate-500">Open structures (paper)</div>
                    {st.open_structures.map(o => <div key={o.gid} className="tabular-nums text-slate-700 dark:text-slate-200">{o.name} · {o.lots} lot(s) · credit {o.credit} · expiry {o.expiry}</div>)}
                </div>
            )}
            {ideas.length > 0 && (
                <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500">Recent ideas</div>
                    {ideas.slice(0, 8).map(i => (
                        <div key={i.id} className="flex items-center gap-2 text-xs tabular-nums">
                            <span className={`w-6 font-bold ${i.contract.startsWith('STRUCT:') ? 'text-amber-600' : i.side > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{i.contract.startsWith('STRUCT:') ? i.contract.split('-').pop().replace('t', '') : i.side > 0 ? 'CE' : 'PE'}</span>
                            <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{i.underlying.split(':')[1]} {i.contract.startsWith('STRUCT:') ? `structure, credit ${i.entry}` : `${i.contract.split('|')[1]} @ ${i.entry}`} · {pct(i.confidence)}{i.traded ? ' · traded' : ''}</span>
                            <span className={i.outcome_r == null ? 'text-slate-400' : i.outcome_r > 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>{i.outcome_r == null ? 'open' : `${i.outcome_r > 0 ? '+' : ''}${i.outcome_r}R`}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const VERDICT = {
    right: ['✓ right', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'],
    wrong: ['✗ wrong', 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'],
    flat: ['– no follow-through', 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'],
    missed: ['missed a move', 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'],
    stayed_out: ['✓ stayed out', 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'],
};
function verdictChip(r) {
    if (r.provider !== 'own') return null;
    const v = VERDICT[r.verdict];
    if (!v) return r.verdict === 'n/a' ? null : <span className={`${chip} bg-slate-50 text-slate-400 dark:bg-white/5`}>scoring after 12 candles</span>;
    return <span className={`${chip} ${v[1]}`}>{v[0]}{r.outcome_r ? ` ${r.outcome_r > 0 ? '+' : ''}${r.outcome_r}R` : ''}</span>;
}

export function AgentTab({ agentKill, onChanged }) {
    const [runs, setRuns] = useState([]);
    const [acc, setAcc] = useState(null);
    const [sym, setSym] = useState('NSE:RELIANCE');
    const [tf, setTf] = useState(15);
    const [view, setView] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = () => Promise.all([indiaApi.agentRuns(), indiaApi.agentAccuracy()]).then(([r, a]) => { setRuns(r); setAcc(a); }).catch(() => {});
    useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
    const ask = async () => { setBusy(true); setView(null); try { setView(await indiaApi.agentAsk(sym, tf)); load(); } catch (e) { setView({ action: 'ERROR', reason: e.message }); } finally { setBusy(false); } };
    const kill = async () => {
        if (!agentKill && !(await confirmDialog({ title: 'Stop the AI agent?', message: 'Agent strategies stop analysing and trading until you turn it back on. Open positions stay.', confirmLabel: 'Stop agent', danger: true }))) return;
        await indiaApi.agentKill(!agentKill); onChanged();
    };
    const tone = (a) => (a === 'BUY' ? 'text-emerald-600' : a === 'SELL' ? 'text-red-600' : 'text-slate-500');
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 dark:border-white/10 p-4">
                <Bot className="w-8 h-8 text-violet-600" />
                <div className="flex-1 min-w-[220px]">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">Own model (prediction.py) · runs on your server, no API cost</div>
                    <div className="text-xs text-slate-500">Agent strategies ask it once per closed candle in market hours. It answers BUY / SELL / HOLD with a confidence, and HOLD whenever its walk-forward track record shows no edge. First use of a stock trains a model (1–5 min).</div>
                </div>
                <button onClick={kill} className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-bold ${agentKill ? 'bg-red-600 text-white' : 'border border-red-300 text-red-600 dark:border-red-500/40 dark:text-red-400'}`}>
                    <Power className="w-4 h-4" />{agentKill ? 'Agent stopped — start' : 'Stop agent'}
                </button>
            </div>
            <OptionPilotPanel />
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-3">
                <div className="text-sm font-bold text-slate-900 dark:text-white">Ask the stock agent</div>
                <div className="flex flex-wrap gap-2">
                    <div className="flex-1 min-w-[200px]"><StockSearch value={sym} onPick={setSym} /></div>
                    <select value={tf} onChange={e => setTf(+e.target.value)} className={field.replace('w-full', 'w-24')}>{TFS.slice(0, 4).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                    <button disabled={busy} onClick={ask} className="h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-bold disabled:opacity-50">{busy ? 'Thinking…' : 'Ask'}</button>
                </div>
                {view && (
                    <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3 text-sm">
                        <span className={`font-bold ${tone(view.action)}`}>{view.action}</span>
                        {view.confidence > 0 && <span className="ml-2 text-slate-500">{Math.round(view.confidence * 100)}% confident</span>}
                        <p className="mt-1 text-slate-600 dark:text-slate-300">{view.reason}</p>
                    </div>
                )}
            </div>
            <div>
                <div className="text-sm font-bold text-slate-900 dark:text-white mb-1">Recent agent thinking</div>
                <p className="text-xs text-slate-500 mb-2">Each call is checked against what the price did next (+1 ATR before −1 ATR within 12 candles). A stock whose live record drops below 50 % after 20 calls is put on HOLD and its model retrains; confidence is scaled by live vs backtest accuracy.</p>
                {acc && acc.overall.calls > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3 text-xs">
                        <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/10"><b>All</b> {acc.overall.right}/{acc.overall.right + acc.overall.wrong} right{acc.overall.hit_rate != null ? ` (${Math.round(acc.overall.hit_rate * 100)}%)` : ''} · avg {acc.overall.avg_r?.toFixed(2)}R · {acc.overall.missed}/{acc.overall.holds} HOLDs missed a move</span>
                        {acc.by_symbol.filter(x => x.calls).map(x => (
                            <span key={x.symbol + x.timeframe} className={`px-2 py-1 rounded-lg ${x.hit_rate != null && x.hit_rate < 0.5 && x.calls >= 20 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-slate-100 dark:bg-white/10'}`}>
                                {x.symbol.split(':')[1]} {tfLabel(x.timeframe)} {x.right}/{x.right + x.wrong}</span>
                        ))}
                    </div>
                )}
                {runs.length === 0 ? <div className="py-10 text-center text-sm text-slate-500">Nothing yet. Ask the agent, or create an AI agent strategy.</div> : (
                    <div className="space-y-2">
                        {runs.map(r => (
                            <div key={r.id} className="flex gap-3 rounded-xl border border-slate-200 dark:border-white/10 p-3">
                                <div className="w-14 shrink-0 text-center">
                                    <div className={`text-sm font-bold ${tone(r.suggestion?.action)}`}>{r.suggestion?.action}</div>
                                    <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${Math.round((r.confidence || 0) * 100)}%` }} /></div>
                                    <div className="text-[10px] text-slate-500">{Math.round((r.confidence || 0) * 100)}%</div>
                                </div>
                                <div className="min-w-0 text-xs">
                                    <div className="font-semibold text-slate-800 dark:text-slate-100">{r.suggestion?.symbol} · {tfLabel(r.suggestion?.timeframe)} <span className="font-normal text-slate-500">{new Date(r.ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
                                    <div className="text-slate-600 dark:text-slate-300">{r.rationale}</div>
                                    <div className="mt-1">{verdictChip(r)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}


// /india → Settings: trade alerts (E8). Email via the server's SMTP; browser alerts while the app is open.
export function NotifySettings() {
    const [n, setN] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { indiaApi.notifySettings().then(d => setN({ ...d, email: d.email || 'homesh123@gmail.com' })).catch(e => setMsg({ err: true, text: e.message })); }, []);
    if (!n) return msg ? <div className="text-sm text-red-600">{msg.text}</div> : null;
    const up = (k, v) => setN(x => ({ ...x, [k]: v }));
    const save = async () => { setBusy(true); try { setN({ ...n, ...(await indiaApi.saveNotifySettings(n)) }); setMsg({ text: 'Saved' }); } catch (e) { setMsg({ err: true, text: e.message }); } finally { setBusy(false); } };
    const test = async () => { setBusy(true); try { await indiaApi.saveNotifySettings(n); await indiaApi.notifyTest(); setMsg({ text: `Test email sent to ${n.email}` }); } catch (e) { setMsg({ err: true, text: e.message }); } finally { setBusy(false); } };
    const ask = () => { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* unsupported */ } };
    const rows = [['entries', 'A strategy or agent enters a trade'], ['exits', 'A trade is closed (stop, target, opposite signal, expiry)'],
        ['approvals', 'A trade waits for your approval'], ['blocked', 'The risk engine blocked a strategy trade']];
    return (
        <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-white/10 p-4">
            <div><div className="text-sm font-bold text-slate-900 dark:text-white">Trade alerts</div>
                <p className="text-xs text-slate-500">Emails come from the server, so they arrive even when no browser is open. While TradeSagar is open you also get a browser notification, a pop-up and a sound.</p></div>
            <label className="block"><span className={lbl}>Email to</span>
                <input type="email" value={n.email} onChange={e => up('email', e.target.value)} className={field} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={n.email_on} onChange={e => up('email_on', e.target.checked)} className="w-4 h-4" /> Send emails</label>
            <div className="grid sm:grid-cols-2 gap-2">
                {rows.map(([k, t]) => (
                    <label key={k} className="flex items-center gap-2 text-sm rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2"><input type="checkbox" checked={!!n[k]} onChange={e => up(k, e.target.checked)} className="w-4 h-4" />{t}</label>
                ))}
            </div>
            {!n.email_ready && <p className="text-xs text-amber-600">Email is not configured on the server yet (SMTP settings in backend/.env).</p>}
            {msg && <div className={`text-sm ${msg.err ? 'text-red-600' : 'text-emerald-600'}`}>{msg.text}</div>}
            <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={save} className="h-10 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-[0.98]">Save alerts</button>
                <button disabled={busy || !n.email} onClick={test} className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-semibold">Send test email</button>
                {'Notification' in window && Notification.permission !== 'granted' && <button onClick={ask} className="h-10 px-4 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-semibold">Allow browser notifications</button>}
            </div>
        </div>
    );
}
