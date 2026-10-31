import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowRight, Bell, BellRing, Calculator, CheckCircle2, Clock, ExternalLink, Eye, EyeOff,
    FileText, History, Landmark, LineChart, Moon, Newspaper, RefreshCw, ScanSearch, Send, ShieldCheck, Sun, Target, XCircle,
} from 'lucide-react';
import { ageText, snapshotJson } from '../utils/dataSource';
import {
    DEFAULT_RULES, breakEvenWinRate, loadOrders, markToMarket, positionSize, riskCheck, sameDay, saveOrders, timeMachine,
} from '../utils/dayTrader';

// The day-trader-skill desk (eleven skills, run top to bottom), fed by the
// snapshot scripts/daytrader.py publishes. Each skill hands its result to the
// next: the scanner picks the stock, the exit planner's trade goes to the Time
// Machine, the sizer's shares to the risk manager, an approved trade to the
// (paper-only) order desk, and open orders to the alerts.

const SKILLS = [
    { key: 'scanner', icon: ScanSearch, title: 'Scanner', desc: 'Breakouts, flags and oversold bounces across the watchlist.' },
    { key: 'news', icon: Newspaper, title: 'News Desk', desc: 'Headlines and SEC filings for the stock.' },
    { key: 'entry', icon: Clock, title: 'Entry Timer', desc: 'Has the setup triggered? Watch it and get pinged.' },
    { key: 'exit', icon: Target, title: 'Exit Planner', desc: 'Stop-loss and profit target, set before you are in.' },
    { key: 'timemachine', icon: History, title: 'Time Machine', desc: 'Replays the rest of the day 10,000 times.' },
    { key: 'budget', icon: Calculator, title: 'Position Sizer', desc: 'Shares that fit your account and max loss.' },
    { key: 'risk', icon: ShieldCheck, title: 'Risk Manager', desc: 'Blocks any trade that breaks your limits.' },
    { key: 'broker', icon: Send, title: 'Order Desk', desc: 'Paper orders only; nothing goes in without your yes.' },
    { key: 'alerts', icon: Bell, title: 'Alerts', desc: 'Stop, target and before-the-close pings.' },
    { key: 'analyst', icon: FileText, title: 'Earnings Analyst', desc: 'Latest reported numbers from SEC filings.' },
    { key: 'congress', icon: Landmark, title: 'Congress Tracker', desc: 'New stock-trade disclosures by House members.' },
];

const REFRESH_MS = 60000;
const SETTINGS_KEY = 'dtSettings';

const money = (v, d = 2) => (v == null || Number.isNaN(+v) ? '—' : `$${(+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);
const big = (v) => {
    if (v == null) return '—';
    const a = Math.abs(v);
    return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;
};

function savedTheme() {
    try { return JSON.parse(localStorage.getItem('chartState') || '{}').theme === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

function loadSettings() {
    try { return { account: 5000, maxRisk: 50, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { account: 5000, maxRisk: 50 }; }
}

function notify(title, body) {
    try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: './favicon.png' });
    } catch { /* not supported */ }
}

// ── small UI pieces ──────────────────────────────────────────────────────────

const Card = ({ children, className = '' }) => (
    <div className={`rounded-xl border border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg p-4 md:p-5 ${className}`}>{children}</div>
);

const Stat = ({ label, value, tone = '' }) => (
    <div className="flex flex-col rounded-lg bg-slate-50 dark:bg-surfacebg px-3 py-2 min-w-0">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`font-mono font-bold text-sm truncate ${tone || 'text-slate-800 dark:text-slate-100'}`}>{value}</span>
    </div>
);

const Empty = ({ children }) => (
    <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-borderdark text-sm text-slate-500 dark:text-slate-400">{children}</div>
);

function NextButton({ to, onGo, children }) {
    return (
        <button onClick={() => onGo(to)} className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
            {children} <ArrowRight size={15} />
        </button>
    );
}

function NumberField({ label, value, onChange, step = '0.01', prefix }) {
    return (
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {label}
            <div className="flex items-center rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg focus-within:ring-1 focus-within:ring-emerald-500">
                {prefix && <span className="pl-2.5 text-slate-400">{prefix}</span>}
                <input type="number" step={step} value={Number.isFinite(value) ? value : ''} onChange={e => onChange(parseFloat(e.target.value))}
                    className="w-full bg-transparent px-2.5 py-2 text-sm font-mono text-slate-800 dark:text-slate-100 focus:outline-none" />
            </div>
        </label>
    );
}

/** Today's 5-minute closes with the trade's entry / stop / target lines. */
function IntradayChart({ bars, trade, orHigh, orLow, height = 180 }) {
    if (!bars?.length) return null;
    const W = 1100, H = height, padR = 52;
    const closes = bars.map(b => b[4]);
    const levels = [trade?.entry, trade?.stop, trade?.target, orHigh, orLow].filter(v => v > 0);
    const lo = Math.min(...bars.map(b => b[3]), ...levels), hi = Math.max(...bars.map(b => b[2]), ...levels);
    const y = v => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
    const x = i => (i / 77) * (W - padR);
    const path = closes.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join('');
    const line = (v, col, label, dash) => v > 0 && (
        <g key={label}>
            <line x1="0" x2={W - padR} y1={y(v)} y2={y(v)} stroke={col} strokeDasharray={dash} strokeWidth="1" />
            <text x={W - padR + 4} y={y(v) + 3} fontSize="10" fill={col}>{label}</text>
        </g>
    );
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label="Today's 5-minute price">
            {orHigh > 0 && orLow > 0 && <rect x="0" width={x(3)} y={y(orHigh)} height={Math.max(1, y(orLow) - y(orHigh))} fill="rgba(99,102,241,0.15)" />}
            {line(trade?.target, '#16a34a', 'Target', '')}
            {line(trade?.entry, '#94a3b8', 'Entry', '4 3')}
            {line(trade?.stop, '#dc2626', 'Stop', '6 4')}
            <path d={path} fill="none" stroke="#10b981" strokeWidth="1.6" />
        </svg>
    );
}

const SETUP_TONE = {
    orb_long: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
    orb_short: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
    bull_flag: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    oversold_bounce: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
};

const TRIGGER_TEXT = {
    waiting: ['Waiting', 'No 5-minute close through the entry yet.', 'text-amber-600 dark:text-amber-400'],
    triggered: ['Triggered', 'A 5-minute bar closed through the entry.', 'text-green-600 dark:text-green-400'],
    target_hit: ['Target hit', 'Triggered earlier and has already reached the target.', 'text-green-600 dark:text-green-400'],
    stopped: ['Stopped out', 'Triggered earlier and then hit the stop.', 'text-red-600 dark:text-red-400'],
};

// ── the eleven skills ────────────────────────────────────────────────────────

function ScannerView({ desk, symbol, onPick, onGo }) {
    const rows = desk.scanner || [];
    if (!rows.length) return <Empty>No prices in the snapshot yet.</Empty>;
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Scan: opening-range breakouts, flags and bounces</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Opening range = first 15 minutes. RVOL compares today's volume with the same time of day over the last 20 sessions. Click a row to work that stock.
            </p>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-borderdark">
                            <th className="py-2 pr-3">Symbol</th><th className="py-2 pr-3 text-right">Price</th><th className="py-2 pr-3 text-right">Day</th>
                            <th className="py-2 pr-3 text-right">15-min range</th><th className="py-2 pr-3 text-right">VWAP</th>
                            <th className="py-2 pr-3 text-right">RVOL</th><th className="py-2 pr-3 text-right">RSI 5m</th><th className="py-2">Setups</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.symbol} onClick={() => onPick(r.symbol)}
                                className={`cursor-pointer border-b border-slate-100 dark:border-borderdark/60 hover:bg-slate-50 dark:hover:bg-surfacebg ${symbol === r.symbol ? 'bg-emerald-50 dark:bg-emerald-500/10' : ''}`}>
                                <td className="py-2 pr-3 font-bold text-slate-800 dark:text-white">{r.symbol}</td>
                                <td className="py-2 pr-3 text-right font-mono">{money(r.price)}</td>
                                <td className={`py-2 pr-3 text-right font-mono ${r.change_pct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{pct(r.change_pct, 2)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-xs">{r.or_low} – {r.or_high}</td>
                                <td className={`py-2 pr-3 text-right font-mono ${r.above_vwap ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{r.vwap}</td>
                                <td className={`py-2 pr-3 text-right font-mono ${r.rvol >= 1.5 ? 'font-bold text-emerald-600 dark:text-emerald-400' : ''}`}>{r.rvol ?? '—'}×</td>
                                <td className="py-2 pr-3 text-right font-mono">{r.rsi5m}</td>
                                <td className="py-2">
                                    <div className="flex flex-wrap gap-1">
                                        {r.setups.length ? r.setups.map(s => (
                                            <span key={s.type} title={s.detail} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SETUP_TONE[s.type]}`}>{s.label}</span>
                                        )) : <span className="text-[11px] text-slate-400">—</span>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {symbol && <NextButton to="news" onGo={onGo}>Check the news on {symbol}</NextButton>}
        </Card>
    );
}

function NewsView({ desk, symbol, onGo }) {
    const items = desk.news?.[symbol] || [];
    const filings = desk.filings?.[symbol] || [];
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white mb-3">Headlines · {symbol}</h2>
                {items.length === 0 ? <Empty>No recent headlines in the snapshot.</Empty> : (
                    <ul className="space-y-3">
                        {items.map((n, i) => (
                            <li key={i}>
                                <a href={n.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-sm text-slate-800 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400">{n.title}</a>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">{n.publisher}{n.published && ` · ${ageText(n.published)}`}</div>
                                {n.summary && <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">{n.summary}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white mb-3">SEC filings (last 45 days) · {symbol}</h2>
                {filings.length === 0 ? <Empty>{desk.filings?.[symbol] ? 'No filings in the last 45 days.' : 'Not available for this symbol (ETFs have no company filings).'}</Empty> : (
                    <ul className="divide-y divide-slate-100 dark:divide-borderdark">
                        {filings.map((f, i) => (
                            <li key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${f.form === '8-K' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' : 'bg-slate-100 text-slate-600 dark:bg-surfacebg dark:text-slate-300'}`}>{f.form}</span>
                                    <span className="truncate text-slate-700 dark:text-slate-200">{f.description}</span>
                                </span>
                                <a href={f.url} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">{f.filed} <ExternalLink size={11} /></a>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">8-K = a material event (earnings, deals, leadership changes). Form 4 = an insider bought or sold.</p>
            </Card>
            <div className="lg:col-span-2"><NextButton to="entry" onGo={onGo}>Time the entry</NextButton></div>
        </div>
    );
}

function EntryView({ desk, symbol, intraday, watched, onToggleWatch, onGo }) {
    const plan = desk.plans?.[symbol];
    const scan = desk.scanner?.find(r => r.symbol === symbol);
    if (!plan || !scan) return <Empty>No plan for {symbol}.</Empty>;
    const [label, text, tone] = TRIGGER_TEXT[plan.trigger_state] || TRIGGER_TEXT.waiting;
    const dist = plan.direction === 'long' ? plan.entry - scan.price : scan.price - plan.entry;
    return (
        <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-bold text-slate-800 dark:text-white">Entry Timer · {symbol} ({plan.direction})</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{plan.basis}</p>
                </div>
                <button onClick={() => onToggleWatch(symbol)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border ${watched ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 dark:border-borderdark text-slate-600 dark:text-slate-300'}`}>
                    {watched ? <Eye size={15} /> : <EyeOff size={15} />} {watched ? 'Watching' : 'Watch & alert me'}
                </button>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Status" value={label} tone={tone} />
                <Stat label="Entry trigger" value={money(plan.entry)} />
                <Stat label="Last price" value={money(scan.price)} />
                <Stat label={plan.trigger_state === 'waiting' ? 'Distance to trigger' : 'Triggered at'} value={plan.trigger_state === 'waiting' ? money(dist) : `${plan.triggered_at} ET`} />
            </div>
            <p className={`mt-2 text-sm ${tone}`}>{text}</p>
            <div className="mt-3"><IntradayChart bars={intraday?.today} trade={plan} orHigh={scan.or_high} orLow={scan.or_low} /></div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Shaded box = opening range. Prices update each time the snapshot is republished.</p>
            <NextButton to="exit" onGo={onGo}>Plan the exit</NextButton>
        </Card>
    );
}

function ExitView({ symbol, trade, setTrade, plan, onGo }) {
    if (!trade) return <Empty>Pick a stock in the Scanner first.</Empty>;
    const risk = Math.abs(trade.entry - trade.stop);
    const rr = risk ? Math.abs(trade.target - trade.entry) / risk : 0;
    const set = (k) => (v) => setTrade(t => ({ ...t, [k]: v }));
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Exit Planner · {symbol}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Decide where you're wrong (stop) and where you take profit (target) before you buy. Default: 2 × your risk.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Direction
                    <select value={trade.direction} onChange={e => setTrade(t => ({ ...t, direction: e.target.value }))}
                        className="rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg px-2.5 py-2 text-sm">
                        <option value="long">Long (buy)</option><option value="short">Short (sell)</option>
                    </select>
                </label>
                <NumberField label="Entry" prefix="$" value={trade.entry} onChange={set('entry')} />
                <NumberField label="Stop-loss" prefix="$" value={trade.stop} onChange={set('stop')} />
                <NumberField label="Target" prefix="$" value={trade.target} onChange={set('target')} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setTrade(t => ({ ...t, target: +(t.direction === 'short' ? t.entry - 2 * risk : t.entry + 2 * risk).toFixed(2) }))}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-surfacebg text-slate-600 dark:text-slate-300">Target = 2R</button>
                <button onClick={() => setTrade(t => ({ ...t, target: +(t.direction === 'short' ? t.entry - risk : t.entry + risk).toFixed(2) }))}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-surfacebg text-slate-600 dark:text-slate-300">Target = 1R</button>
                {plan && <button onClick={() => setTrade({ direction: plan.direction, entry: plan.entry, stop: plan.stop, target: plan.target })}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-surfacebg text-slate-600 dark:text-slate-300">Reset to the scanner's plan</button>}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="Risk / share" value={money(risk)} tone="text-red-600 dark:text-red-400" />
                <Stat label="Reward / share" value={money(Math.abs(trade.target - trade.entry))} tone="text-green-600 dark:text-green-400" />
                <Stat label="Reward : risk" value={`${rr.toFixed(2)}R · break-even ${Math.round(breakEvenWinRate(rr || 1) * 100)}% wins`} />
            </div>
            <NextButton to="timemachine" onGo={onGo}>Run the Time Machine</NextButton>
        </Card>
    );
}

function TimeMachineView({ desk, symbol, trade, intraday, replay, setReplay, onGo }) {
    const lib = intraday?.library;
    const live = !desk.session?.complete && desk.session?.date === intraday?.session_date;
    const defaultStart = live ? Math.min(intraday?.today?.length || 3, 77) : 3;
    const [start, setStart] = useState(defaultStart);
    const [busy, setBusy] = useState(false);
    useEffect(() => setStart(defaultStart), [symbol, defaultStart]);
    if (!trade) return <Empty>Plan a trade in the Exit Planner first.</Empty>;
    if (!lib) return <Empty>Loading {symbol}'s replay library…</Empty>;
    if (!lib.sessions) return <Empty>Not enough complete sessions to replay {symbol}.</Empty>;
    const hhmm = (b) => { const m = 570 + b * 5; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    const run = () => {
        setBusy(true);
        setTimeout(() => {   // let the spinner paint
            setReplay({ symbol, trade: { ...trade }, start, result: timeMachine({ library: lib, startBar: start, trade }) });
            setBusy(false);
        }, 20);
    };
    const r = replay?.symbol === symbol ? replay.result : null;
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Time Machine · {symbol}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Rebuilds the rest of the day 10,000 times from real 5-minute moves {symbol} made at the same time of day over the last {lib.sessions} sessions.
                Each replay ends at the target (win), the stop (planned loss) or the close.
            </p>
            <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Enter at (ET)
                    <select value={start} onChange={e => setStart(+e.target.value)} className="rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg px-2.5 py-2 text-sm">
                        {Array.from({ length: 75 }, (_, i) => i + 3).map(b => <option key={b} value={b}>{hhmm(b)}{live && b === defaultStart ? ' (now)' : ''}</option>)}
                    </select>
                </label>
                <div className="text-xs text-slate-500 dark:text-slate-400 pb-2">
                    {trade.direction} {money(trade.entry)} · stop {money(trade.stop)} · target {money(trade.target)}
                </div>
                <button onClick={run} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-60">
                    <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Replay 10,000 times
                </button>
            </div>
            {r && (
                <div className="mt-4">
                    <div className="flex h-6 rounded-md overflow-hidden text-[11px] font-bold text-white">
                        <div className="bg-green-600 flex items-center justify-center" style={{ width: `${r.pWin * 100}%` }}>{r.pWin > 0.08 && `Win ${Math.round(r.pWin * 100)}%`}</div>
                        <div className="bg-slate-400 dark:bg-slate-600 flex items-center justify-center" style={{ width: `${r.pOpen * 100}%` }}>{r.pOpen > 0.08 && `Close ${Math.round(r.pOpen * 100)}%`}</div>
                        <div className="bg-red-600 flex items-center justify-center" style={{ width: `${r.pLoss * 100}%` }}>{r.pLoss > 0.08 && `Stop ${Math.round(r.pLoss * 100)}%`}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Stat label="Hit target" value={`${(r.pWin * 100).toFixed(1)}%`} tone="text-green-600 dark:text-green-400" />
                        <Stat label="Hit stop" value={`${(r.pLoss * 100).toFixed(1)}%`} tone="text-red-600 dark:text-red-400" />
                        <Stat label="Neither (close decides)" value={`${(r.pOpen * 100).toFixed(1)}%`} />
                        <Stat label="Expected per trade" value={`${r.expectancy >= 0 ? '+' : ''}${r.expectancy.toFixed(2)}R`} tone={r.expectancy > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
                    </div>
                    <p className={`mt-3 text-sm font-semibold ${r.expectancy > 0.1 ? 'text-green-700 dark:text-green-400' : r.expectancy > -0.1 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'}`}>{r.verdict}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">At {r.rr.toFixed(1)}R you need to win {Math.round(r.breakEven * 100)}% of the time to break even. Replays reuse the past; they are odds, not a forecast.</p>
                </div>
            )}
            <NextButton to="budget" onGo={onGo}>Size it</NextButton>
        </Card>
    );
}

function SizerView({ trade, settings, setSettings, sizing, onGo }) {
    if (!trade) return <Empty>Plan a trade in the Exit Planner first.</Empty>;
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Position Sizer</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Shares = max loss ÷ risk per share, capped by your cash. Saved in this browser.</p>
            <div className="grid grid-cols-2 gap-3 max-w-md">
                <NumberField label="Account size" prefix="$" step="100" value={settings.account} onChange={v => setSettings(s => ({ ...s, account: v }))} />
                <NumberField label="Max loss on this trade" prefix="$" step="5" value={settings.maxRisk} onChange={v => setSettings(s => ({ ...s, maxRisk: v }))} />
            </div>
            {sizing ? (
                <>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Stat label="Shares" value={sizing.shares} tone="text-emerald-600 dark:text-emerald-400" />
                        <Stat label="Cost" value={money(sizing.cost)} />
                        <Stat label="Loss if stopped" value={money(sizing.risk)} tone="text-red-600 dark:text-red-400" />
                        <Stat label="Of account" value={`${sizing.riskPct.toFixed(2)}%`} />
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        {money(settings.maxRisk)} ÷ {money(sizing.perShare)} risk per share = {sizing.byRisk} shares
                        {sizing.limitedBy === 'cash' && `, but your cash only buys ${sizing.byCash}`}.
                    </p>
                </>
            ) : <Empty>Enter an account size, a max loss and a stop different from the entry.</Empty>}
            <NextButton to="risk" onGo={onGo}>Risk check</NextButton>
        </Card>
    );
}

function RiskView({ check, onGo }) {
    if (!check) return <Empty>Size the trade first.</Empty>;
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-3">Risk Manager</h2>
            <ul className="space-y-2">
                {check.checks.map(c => (
                    <li key={c.rule} className="flex items-start gap-2 text-sm">
                        {c.pass ? <CheckCircle2 size={17} className="text-green-600 dark:text-green-400 shrink-0 mt-0.5" /> : <XCircle size={17} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />}
                        <span><b className="text-slate-800 dark:text-slate-100">{c.rule}</b> <span className="text-slate-500 dark:text-slate-400">— {c.detail}</span></span>
                    </li>
                ))}
            </ul>
            <p className={`mt-3 text-sm font-bold ${check.approved ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {check.approved ? 'Approved: the Order Desk can send this to your paper account.' : 'Blocked: fix the failing rules before this trade can go to the Order Desk.'}
            </p>
            {check.approved && <NextButton to="broker" onGo={onGo}>Go to the Order Desk</NextButton>}
        </Card>
    );
}

function OrderView({ symbol, trade, sizing, check, orders, onPlace, onClose }) {
    const [confirm, setConfirm] = useState('');
    const ready = check?.approved && sizing?.shares > 0;
    return (
        <div className="space-y-4">
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white mb-1">Order Desk · paper account</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Paper only: orders are recorded in this browser and filled at your entry price. No broker is connected and no real money moves.</p>
                {ready ? (
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="text-sm text-slate-700 dark:text-slate-200">
                            <b>{trade.direction === 'short' ? 'SELL SHORT' : 'BUY'} {sizing.shares} {symbol}</b> @ {money(trade.entry)} · stop {money(trade.stop)} · target {money(trade.target)}
                        </div>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                            <span>Type <b>yes</b> to send</span>
                            <input value={confirm} onChange={e => setConfirm(e.target.value)} className="w-24 rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg px-2.5 py-2 text-sm" />
                        </label>
                        <button disabled={confirm.trim().toLowerCase() !== 'yes'} onClick={() => { onPlace(); setConfirm(''); }}
                            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">Send to paper</button>
                    </div>
                ) : <Empty>The Risk Manager has to approve a sized trade first.</Empty>}
            </Card>
            <Card>
                <h3 className="font-bold text-slate-800 dark:text-white mb-2">Paper orders</h3>
                {orders.length === 0 ? <Empty>No paper orders yet.</Empty> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-borderdark">
                                <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Order</th><th className="py-2 pr-3 text-right">Stop / target</th>
                                <th className="py-2 pr-3 text-right">Last / exit</th><th className="py-2 pr-3 text-right">P&amp;L</th><th className="py-2" />
                            </tr></thead>
                            <tbody>
                                {[...orders].reverse().map(o => (
                                    <tr key={o.id} className="border-b border-slate-100 dark:border-borderdark/60">
                                        <td className="py-2 pr-3 text-xs text-slate-500">{new Date(o.placedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                                        <td className="py-2 pr-3 font-semibold">{o.direction === 'short' ? 'Short' : 'Long'} {o.shares} {o.symbol} @ {money(o.entry)}</td>
                                        <td className="py-2 pr-3 text-right font-mono text-xs">{o.stop} / {o.target}</td>
                                        <td className="py-2 pr-3 text-right font-mono">{o.status === 'closed' ? `${money(o.exit)} (${o.exitReason})` : money(o.last ?? o.entry)}</td>
                                        <td className={`py-2 pr-3 text-right font-mono ${(o.pnl || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{money(o.pnl || 0)}</td>
                                        <td className="py-2 text-right">{o.status === 'open' && <button onClick={() => onClose(o.id)} className="text-xs font-semibold text-slate-500 hover:text-red-600">Close</button>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}

function AlertsView({ permission, onEnable, log, orders, watches, minutesToClose }) {
    const open = orders.filter(o => o.status === 'open');
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Alerts</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                While this page is open it re-reads the snapshot every minute and pings you when an open paper order reaches its stop or target, a watched setup triggers, or the close is 15 minutes away.
            </p>
            {permission !== 'granted' ? (
                <button onClick={onEnable} disabled={permission === 'denied' || permission === 'unsupported'}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">
                    <BellRing size={15} /> {permission === 'denied' ? 'Notifications are blocked in this browser' : permission === 'unsupported' ? 'Notifications not supported here' : 'Enable notifications'}
                </button>
            ) : <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5"><BellRing size={15} /> Notifications on.</p>}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                <Stat label="Open paper orders" value={open.length ? open.map(o => o.symbol).join(', ') : 'none'} />
                <Stat label="Watched setups" value={watches.length ? watches.join(', ') : 'none'} />
                <Stat label="To the close" value={minutesToClose > 0 ? `${Math.round(minutesToClose)} min` : 'market closed'} />
            </div>
            <h3 className="mt-4 text-sm font-bold text-slate-800 dark:text-white">Fired alerts</h3>
            {log.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">None yet.</p> : (
                <ul className="mt-1 space-y-1 text-sm">
                    {[...log].reverse().map((a, i) => <li key={i}><span className="text-xs text-slate-500 mr-2">{new Date(a.at).toLocaleTimeString()}</span>{a.text}</li>)}
                </ul>
            )}
        </Card>
    );
}

const METRIC_LABEL = { revenue: 'Revenue', net_income: 'Net income', eps_diluted: 'EPS (diluted)', operating_income: 'Operating income', operating_cash_flow: 'Operating cash flow' };

function AnalystView({ desk, symbol }) {
    const e = desk.earnings?.[symbol];
    if (!e) return <Empty>No SEC financial data for {symbol} (ETFs and non-US filers have none).</Empty>;
    const m = e.metrics;
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Earnings Analyst · {e.company}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Latest quarter as reported to the SEC (XBRL company facts), compared with the same quarter a year earlier.</p>
            <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-borderdark">
                    <th className="py-2 pr-3">Metric</th><th className="py-2 pr-3">Quarter</th><th className="py-2 pr-3 text-right">Latest</th><th className="py-2 pr-3 text-right">Year earlier</th><th className="py-2 text-right">Change</th>
                </tr></thead>
                <tbody>
                    {Object.entries(METRIC_LABEL).filter(([k]) => m[k]).map(([k, label]) => {
                        const v = m[k], fmt = k === 'eps_diluted' ? (x) => (x == null ? '—' : `$${x.toFixed(2)}`) : big;
                        return (
                            <tr key={k} className="border-b border-slate-100 dark:border-borderdark/60">
                                <td className="py-2 pr-3 font-semibold">{label}</td>
                                <td className="py-2 pr-3 text-xs text-slate-500">{v.period} ({v.form}, filed {v.filed})</td>
                                <td className="py-2 pr-3 text-right font-mono">{fmt(v.value)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-slate-500">{fmt(v.prior_year)}</td>
                                <td className={`py-2 text-right font-mono ${v.yoy_pct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{pct(v.yoy_pct)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {m.net_margin_pct && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Net margin {m.net_margin_pct.value}% in {m.net_margin_pct.period}.</p>}
        </Card>
    );
}

function CongressView({ desk }) {
    const rows = desk.congress || [];
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Congress Tracker</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Newest Periodic Transaction Reports (stock trades) filed with the House Clerk. Each report is a PDF listing the trades; members have up to 45 days to file.</p>
            {rows.length === 0 ? <Empty>No reports in the snapshot.</Empty> : (
                <ul className="divide-y divide-slate-100 dark:divide-borderdark">
                    {rows.map((r, i) => (
                        <li key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                            <span><b className="text-slate-800 dark:text-slate-100">{r.name}</b> <span className="text-xs text-slate-500">{r.district}</span></span>
                            <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">filed {r.filed} <ExternalLink size={11} /></a>
                        </li>
                    ))}
                </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Senate reports aren't included: the Senate's disclosure site requires an interactive agreement and can't be read by the data job.</p>
        </Card>
    );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DayTrader() {
    const [theme, setTheme] = useState(savedTheme);
    const dark = theme === 'dark';
    const [desk, setDesk] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('scanner');
    const [symbol, setSymbol] = useState(null);
    const [trade, setTrade] = useState(null);
    const [intraday, setIntraday] = useState({});      // symbol → intraday file
    const [replay, setReplay] = useState(null);
    const [settings, setSettings] = useState(loadSettings);
    const [orders, setOrders] = useState(loadOrders);
    const [watches, setWatches] = useState([]);
    const [alertLog, setAlertLog] = useState([]);
    const [now, setNow] = useState(Date.now());
    const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
    const fired = useRef(new Set());
    const prevPlans = useRef({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setDesk(await snapshotJson('daytrader.json'));
            setError(null);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
            setNow(Date.now());
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, REFRESH_MS);
        return () => clearInterval(id);
    }, [load]);

    useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }, [settings]);
    useEffect(() => saveOrders(orders), [orders]);

    // First load: work the scanner's top stock
    useEffect(() => {
        if (desk && !symbol && desk.scanner?.length) pick(desk.scanner[0].symbol);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [desk]);

    // Replay library + today's bars for the chosen stock (refetched with each new snapshot)
    useEffect(() => {
        if (!symbol || !desk) return;
        snapshotJson(`intraday/${symbol}.json`).then(d => setIntraday(m => ({ ...m, [symbol]: d }))).catch(() => {});
    }, [symbol, desk?.generated_at]);

    const pick = (sym) => {
        setSymbol(sym);
        const p = desk?.plans?.[sym];
        setTrade(p ? { direction: p.direction, entry: p.entry, stop: p.stop, target: p.target } : null);
        setReplay(null);
    };

    const prices = useMemo(() => Object.fromEntries((desk?.scanner || []).map(r => [r.symbol, r.price])), [desk]);
    const closeUtc = desk?.session?.close_utc ? new Date(desk.session.close_utc).getTime() : null;
    const minutesToClose = closeUtc && !desk.session.complete ? Math.max(0, (closeUtc - now) / 60000) : 0;

    const sizing = trade ? positionSize({ account: settings.account, maxRisk: settings.maxRisk, entry: trade.entry, stop: trade.stop }) : null;
    const replayForTrade = replay && replay.symbol === symbol && JSON.stringify(replay.trade) === JSON.stringify(trade) ? replay.result : null;
    const todayOrders = orders.filter(o => sameDay(o.placedAt));
    const check = trade && sizing ? riskCheck({
        account: settings.account, shares: sizing.shares, trade, todayOrders, minutesToClose, replay: replayForTrade, rules: DEFAULT_RULES,
    }) : null;

    const addAlert = (key, text) => {
        if (fired.current.has(key)) return;
        fired.current.add(key);
        setAlertLog(l => [...l, { at: Date.now(), text }]);
        notify('FinEngine Day Trader', text);
    };

    // On every new snapshot: mark paper orders to market and fire alerts
    useEffect(() => {
        if (!desk) return;
        setOrders(prev => {
            const next = markToMarket(prev, prices);
            next.forEach((o, i) => {
                if (prev[i]?.status === 'open' && o.status === 'closed') {
                    addAlert(`order-${o.id}`, `${o.symbol} paper ${o.direction} hit its ${o.exitReason} at ${money(o.exit)} (P&L ${money(o.pnl)})`);
                }
            });
            return next;
        });
        for (const sym of watches) {
            const p = desk.plans?.[sym];
            if (p && p.trigger_state !== 'waiting' && prevPlans.current[sym] === 'waiting') {
                addAlert(`trigger-${sym}-${desk.session?.date}`, `${sym} ${p.direction} setup triggered at ${p.triggered_at} ET (entry ${money(p.entry)})`);
            }
        }
        prevPlans.current = Object.fromEntries(Object.entries(desk.plans || {}).map(([s, p]) => [s, p.trigger_state]));
        if (minutesToClose > 0 && minutesToClose <= 15 && orders.some(o => o.status === 'open')) {
            addAlert(`close-${desk.session?.date}`, `${Math.round(minutesToClose)} minutes to the close — decide on your open paper positions.`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [desk?.generated_at]);

    const placeOrder = () => {
        setOrders(o => markToMarket([...o, { id: `${Date.now()}`, symbol, ...trade, shares: sizing.shares, status: 'open', placedAt: new Date().toISOString() }], prices));
        setTab('alerts');
    };
    const closeOrder = (id) => setOrders(os => os.map(o => {
        if (o.id !== id || o.status !== 'open') return o;
        const exit = prices[o.symbol] ?? o.entry;
        return { ...o, status: 'closed', exit, exitReason: 'manual', pnl: (o.direction === 'short' ? o.entry - exit : exit - o.entry) * o.shares, closedAt: new Date().toISOString() };
    }));
    const enableNotifications = async () => {
        if (!('Notification' in window)) return;
        setPermission(await Notification.requestPermission());
    };
    const toggleWatch = (sym) => setWatches(w => (w.includes(sym) ? w.filter(s => s !== sym) : [...w, sym]));

    const stale = desk?.generated_at && minutesToClose > 0 && Date.now() - new Date(desk.generated_at).getTime() > 40 * 60000;
    const needsSymbol = !['scanner', 'congress', 'alerts', 'broker'].includes(tab);

    const view = () => {
        if (!desk) return null;
        if (needsSymbol && !symbol) return <Empty>Pick a stock in the Scanner first.</Empty>;
        const id = intraday[symbol];
        switch (tab) {
            case 'scanner': return <ScannerView desk={desk} symbol={symbol} onPick={pick} onGo={setTab} />;
            case 'news': return <NewsView desk={desk} symbol={symbol} onGo={setTab} />;
            case 'entry': return <EntryView desk={desk} symbol={symbol} intraday={id} watched={watches.includes(symbol)} onToggleWatch={toggleWatch} onGo={setTab} />;
            case 'exit': return <ExitView symbol={symbol} trade={trade} setTrade={setTrade} plan={desk.plans?.[symbol]} onGo={setTab} />;
            case 'timemachine': return <TimeMachineView desk={desk} symbol={symbol} trade={trade} intraday={id} replay={replay} setReplay={setReplay} onGo={setTab} />;
            case 'budget': return <SizerView trade={trade} settings={settings} setSettings={setSettings} sizing={sizing} onGo={setTab} />;
            case 'risk': return <RiskView check={check} onGo={setTab} />;
            case 'broker': return <OrderView symbol={symbol} trade={trade} sizing={sizing} check={check} orders={orders} onPlace={placeOrder} onClose={closeOrder} />;
            case 'alerts': return <AlertsView permission={permission} onEnable={enableNotifications} log={alertLog} orders={orders} watches={watches} minutesToClose={minutesToClose} />;
            case 'analyst': return <AnalystView desk={desk} symbol={symbol} />;
            case 'congress': return <CongressView desk={desk} />;
            default: return null;
        }
    };

    return (
        <div className={dark ? 'dark' : ''}>
            <div className="min-h-[100dvh] bg-slate-50 dark:bg-darkbg text-slate-800 dark:text-slate-200 font-sans antialiased">
                <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg">
                    <div className="max-w-7xl mx-auto px-3 md:px-6 h-12 flex items-center justify-between gap-3">
                        <a href="./#daytrader" className="flex items-center gap-2 font-brand text-lg font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
                            <img src="./logo-light.svg" alt="" width="24" height="24" className="dark:hidden" /><img src="./logo.svg" alt="" width="24" height="24" className="hidden dark:block" />
                            <span>Fin<span className="text-emerald-600 dark:text-emerald-400">Engine</span></span> <span className="hidden sm:inline text-sm font-normal text-slate-500 dark:text-slate-400">Day Trader</span>
                        </a>
                        <div className="flex items-center gap-2">
                            {desk?.generated_at && (
                                <span className="hidden md:inline text-[11px] text-slate-500 dark:text-slate-400" title={new Date(desk.generated_at).toLocaleString()}>
                                    Data {ageText(desk.generated_at)}{desk.session && ` · ${desk.session.date} ${desk.session.complete ? 'session closed' : `last bar ${desk.session.last_bar} ET`}`}
                                </span>
                            )}
                            <button onClick={load} aria-label="Reload data" className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-borderdark text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surfacebg">
                                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
                                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-borderdark text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surfacebg">
                                {dark ? <Sun size={15} /> : <Moon size={15} />}
                            </button>
                            <a href="./#" className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-borderdark text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-surfacebg">
                                <LineChart size={14} /> Screener
                            </a>
                        </div>
                    </div>
                </header>

                <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4">
                    <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Desk skills">
                        {SKILLS.map((s, i) => {
                            const Icon = s.icon;
                            return (
                                <button key={s.key} onClick={() => setTab(s.key)} title={s.desc} aria-current={tab === s.key ? 'page' : undefined}
                                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${tab === s.key ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 dark:border-borderdark text-slate-600 dark:text-slate-300 hover:border-emerald-500'}`}>
                                    <span className="opacity-60">{i + 1}</span><Icon size={14} />{s.title}
                                </button>
                            );
                        })}
                    </nav>

                    {desk && symbol && needsSymbol && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-slate-500 dark:text-slate-400">Stock:</span>
                            {(desk.scanner || []).map(r => (
                                <button key={r.symbol} onClick={() => pick(r.symbol)}
                                    className={`px-2 py-0.5 rounded-md font-semibold ${symbol === r.symbol ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 dark:bg-surfacebg text-slate-600 dark:text-slate-300'}`}>{r.symbol}</button>
                            ))}
                        </div>
                    )}

                    {error && (
                        <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-400 flex gap-2">
                            <AlertTriangle size={18} className="shrink-0" /> <span>Couldn't load the desk data. {error}</span>
                        </div>
                    )}
                    {stale && (
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-sm text-amber-800 dark:text-amber-300 flex gap-2">
                            <AlertTriangle size={17} className="shrink-0" /> The market is open but this snapshot is {ageText(desk.generated_at)} — GitHub's scheduler is running late. Prices may be behind.
                        </div>
                    )}
                    {desk?.errors?.length > 0 && (
                        <details className="text-xs text-slate-500 dark:text-slate-400">
                            <summary className="cursor-pointer">{desk.errors.length} data source{desk.errors.length > 1 ? 's' : ''} failed in the last update</summary>
                            <ul className="mt-1 list-disc list-inside">{desk.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                        </details>
                    )}
                    {loading && !desk && !error && <div className="p-6 text-center text-slate-500">Loading the desk…</div>}

                    {view()}

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2">
                        Workflow from the open-source day-trader-skill (Jake Schincariol, MIT). Data: Yahoo Finance (5-minute bars, delayed), SEC EDGAR and the House Clerk,
                        refreshed about every 15 minutes in market hours. Educational only, not financial advice; day trading is risky and most day traders lose money. Paper trade first.
                    </p>
                </main>
            </div>
        </div>
    );
}
