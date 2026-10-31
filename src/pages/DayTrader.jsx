import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowRight, Bell, BellRing, Calculator, CheckCircle2, Clock, ExternalLink, Eye, EyeOff,
    FileText, History, Landmark, LineChart, Moon, Newspaper, RefreshCw, ScanSearch, Send, ShieldCheck, Sun, Target, XCircle,
} from 'lucide-react';
import LiveDataButton, { useLiveApiBase } from '../components/LiveDataButton';
import { ageText, getData, liveJson, snapshotJson } from '../utils/dataSource';
import {
    DEFAULT_CONFIG, barOfTime, buildPool, loadOrders, markToMarket, riskCheck, roundCent, sameDay, saveOrders,
    simulate, sizeTrade, verdict as tmVerdict,
} from '../utils/dayTrader';

// The day-trader-skill desk (github.com/Jakeschincariol/day-trader-skill, vendored
// in vendor/day-trader-skill). Every result comes from the skill's own tools,
// run by scripts/skill_desk.py: in the published snapshot, or live through
// server/live_api.py. Without a live API, re-planning, sizing and the risk
// check use browser ports of the same rules (src/utils/dayTrader.js).

const SKILLS = [
    { key: 'scanner', icon: ScanSearch, title: 'Scanner', tool: 'trader-scanner', desc: 'Opening-range breakouts so far today, plus pre-market daily setups.' },
    { key: 'news', icon: Newspaper, title: 'News', tool: 'trader-news', desc: 'Yahoo headlines, SEC 8-Ks and how far each stock moved today.' },
    { key: 'entry', icon: Clock, title: 'Entry Timer', tool: 'trader-entry', desc: 'Triggered, waiting or expired: the first 5-minute close above the range.' },
    { key: 'exit', icon: Target, title: 'Exit Planner', tool: 'trader-exit', desc: 'Stop and target before you enter; flat by 3:55 PM either way.' },
    { key: 'timemachine', icon: History, title: 'Time Machine', tool: 'trader-timemachine', desc: '10,000 replays of the rest of the day + the same rule on every past session.' },
    { key: 'budget', icon: Calculator, title: 'Budget', tool: 'trader-budget', desc: 'Shares from your budget and your max loss per trade.' },
    { key: 'risk', icon: ShieldCheck, title: 'Risk Manager', tool: 'trader-risk', desc: 'PASS or BLOCK against your limits, with the reason.' },
    { key: 'broker', icon: Send, title: 'Order Desk', tool: 'trader-broker', desc: 'Paper orders only, and never without your typed yes.' },
    { key: 'alerts', icon: Bell, title: 'Alerts', tool: 'trader-alerts', desc: 'Stop, target and flat-by-close, plus the NYSE clock.' },
    { key: 'analyst', icon: FileText, title: 'Earnings Analyst', tool: 'trader-analyst', desc: 'Quarters from SEC filings and what changed.' },
    { key: 'congress', icon: Landmark, title: 'Congress', tool: 'trader-pelosi', desc: "House members' stock-trade disclosures (PTRs)." },
];

const REFRESH_MS = 60000;
const SETTINGS_KEY = 'dtSkillSettings';
const TARGETS = ['1R', '1.5R', '2R', '3R'];
const STOPS = [['or-mid', 'Range midpoint'], ['or-low', 'Range low']];

const money = (v, d = 2) => (v == null || Number.isNaN(+v) ? '—' : `$${(+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`);
const big = (v) => {
    if (v == null) return '—';
    const a = Math.abs(v);
    return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;
};
const nyClock = (asOf) => (asOf || '').slice(11, 16);   // "2026-10-19 10:15" → "10:15"

function savedTheme() {
    try { return JSON.parse(localStorage.getItem('chartState') || '{}').theme === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

function loadSettings() {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_CONFIG }; }
}

function notify(title, body) {
    try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: './favicon.png' });
    } catch { /* not supported */ }
}

/** exit.py's or-mid / or-low stop and R target, for re-planning without a live API. */
function browserPlan(base, stopRule, targetRule) {
    const { high, low } = base.opening_range;
    const stop = stopRule === 'or-low' ? Math.floor(low * 100 + 1e-9) / 100 : Math.floor((high + low) / 2 * 100 + 1e-9) / 100;
    const r = parseFloat(targetRule);
    const target = roundCent(base.entry + r * (base.entry - stop));
    return {
        ...base, stop, target, target_r: r, risk_per_share: roundCent(base.entry - stop), reward_risk: r,
        stop_rule: stopRule.replace('-', '_'), stop_label: stopRule === 'or-low' ? 'opening-range low' : 'opening-range midpoint',
        target_label: `${targetRule} (${r} times the risk)`, stop_detail: null, warnings: [],
    };
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

const ToolTag = ({ tool, engine }) => (
    <span className="ml-2 align-middle text-[10px] font-mono font-normal text-slate-400" title={engine === 'browser' ? 'Browser port of the skill’s rule (no live API connected)' : 'Output of the skill’s own tool'}>
        {tool}{engine === 'browser' ? ' · browser' : ''}
    </span>
);

function NextButton({ to, onGo, children }) {
    return (
        <button onClick={() => onGo(to)} className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
            {children} <ArrowRight size={15} />
        </button>
    );
}

function NumberField({ label, value, onChange, step = '1', prefix }) {
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

function Select({ label, value, onChange, options }) {
    return (
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {label}
            <select value={value} onChange={e => onChange(e.target.value)} className="rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg px-2.5 py-2 text-sm">
                {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        </label>
    );
}

/** One session's 5-minute closes with the opening range and the plan's lines. */
function IntradayChart({ bars, date, plan, orHigh, orLow, height = 190 }) {
    const day = useMemo(() => {
        if (!bars?.length) return [];
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
        return bars.filter(b => fmt.format(new Date(b[0] * 1000)) === date);
    }, [bars, date]);
    if (!day.length) return null;
    const W = 1100, H = height, padR = 52;
    const levels = [plan?.entry, plan?.stop, plan?.target, orHigh, orLow].filter(v => v > 0);
    const lo = Math.min(...day.map(b => b[3]), ...levels), hi = Math.max(...day.map(b => b[2]), ...levels);
    const y = v => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
    const x = i => (i / 77) * (W - padR);
    const path = day.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b[4]).toFixed(1)}`).join('');
    const line = (v, col, label, dash) => v > 0 && (
        <g key={label}>
            <line x1="0" x2={W - padR} y1={y(v)} y2={y(v)} stroke={col} strokeDasharray={dash} strokeWidth="1" />
            <text x={W - padR + 4} y={y(v) + 3} fontSize="10" fill={col}>{label}</text>
        </g>
    );
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={`5-minute price on ${date}`}>
            {orHigh > 0 && orLow > 0 && <rect x="0" width={x(3)} y={y(orHigh)} height={Math.max(1, y(orLow) - y(orHigh))} fill="rgba(99,102,241,0.18)" />}
            {line(plan?.target, '#16a34a', 'Target', '')}
            {line(plan?.entry, '#94a3b8', 'Entry', '4 3')}
            {line(plan?.stop, '#dc2626', 'Stop', '6 4')}
            <path d={path} fill="none" stroke="#10b981" strokeWidth="1.6" />
        </svg>
    );
}

const STATUS_TONE = {
    triggered: 'text-green-600 dark:text-green-400', waiting: 'text-amber-600 dark:text-amber-400',
    expired: 'text-slate-500', 'no-data': 'text-slate-500',
};

// ── the eleven skills ────────────────────────────────────────────────────────

function ScannerView({ desk, symbol, onPick, onGo }) {
    const scan = desk.scan || {}, hits = scan.hits || [], daily = desk.daily?.hits || [];
    return (
        <div className="space-y-4">
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white">Opening-range breakouts<ToolTag tool="scan.py orb" /></h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    {scan.scanned ?? 0} charts scanned as of {desk.as_of} ET · range = first {scan.or_minutes || 15} minutes · a hit is the first completed 5-minute bar to close above the range high.
                    {hits.length > 0 && ' Click one to work it.'}
                </p>
                {hits.length === 0 ? <Empty>No breakouts {desk.clock?.open ? 'so far today' : 'in the last session'}. {scan.note}</Empty> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-borderdark">
                                    <th className="py-2 pr-3">Symbol</th><th className="py-2 pr-3 text-right">Close above</th><th className="py-2 pr-3">At</th>
                                    <th className="py-2 pr-3 text-right">Opening range</th><th className="py-2 pr-3 text-right">Over the high</th><th className="py-2">Time Machine</th>
                                </tr>
                            </thead>
                            <tbody>
                                {hits.map(h => {
                                    const p = desk.plans?.[h.symbol];
                                    return (
                                        <tr key={h.symbol} onClick={() => onPick(h.symbol)}
                                            className={`cursor-pointer border-b border-slate-100 dark:border-borderdark/60 hover:bg-slate-50 dark:hover:bg-surfacebg ${symbol === h.symbol ? 'bg-emerald-50 dark:bg-emerald-500/10' : ''}`}>
                                            <td className="py-2 pr-3 font-bold text-slate-800 dark:text-white">{h.symbol}</td>
                                            <td className="py-2 pr-3 text-right font-mono">{money(h.price)}</td>
                                            <td className="py-2 pr-3 text-xs">{h.at}</td>
                                            <td className="py-2 pr-3 text-right font-mono text-xs">{h.or_low} – {h.or_high}</td>
                                            <td className="py-2 pr-3 text-right font-mono text-green-600 dark:text-green-400">{pct(h.pct_over, 2)}</td>
                                            <td className="py-2 text-xs">
                                                {p?.timemachine ? <span className="text-slate-600 dark:text-slate-300">{p.timemachine.verdict.split(':')[0]}</span>
                                                    : p ? <span className={STATUS_TONE[p.entry?.status]}>{p.entry?.status}</span> : <span className="text-slate-400">—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {symbol && <NextButton to="news" onGo={onGo}>Check the news on {symbol}</NextButton>}
            </Card>
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white">Daily setups (pre-market)<ToolTag tool="scan.py daily" /></h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">From daily closes as of {desk.daily?.as_of || '—'}: 20-day breakout, bull flag, reclaimed 20-day average, oversold (RSI under 30), oversold bounce.</p>
                {daily.length === 0 ? <Empty>No daily setups in the watchlist.</Empty> : (
                    <div className="flex flex-wrap gap-2">
                        {daily.map(h => (
                            <span key={h.symbol} className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-surfacebg text-xs">
                                <b className="text-slate-800 dark:text-white">{h.symbol}</b> <span className="font-mono">{money(h.price)}</span>{' '}
                                <span className="text-emerald-700 dark:text-emerald-400">{(h.setups || []).join(', ').replace(/_/g, ' ')}</span>
                            </span>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}

function NewsView({ desk, symbol, onGo }) {
    const news = desk.news || {};
    const move = (news.moves || []).find(m => m.ticker === symbol);
    const items = (news.items || []).filter(i => i.ticker === symbol || (i.touches || []).includes(symbol));
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">News · {symbol}<ToolTag tool="news.py" /></h2>
            {move && <p className="text-sm mb-3">Today: <span className="font-mono">{money(move.price)}</span>, <span className={move.pct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{pct(move.pct, 2)}</span> vs yesterday's close {money(move.prev_close)}{move.moving && <b className="ml-1 text-amber-600 dark:text-amber-400">· moving</b>}</p>}
            {items.length === 0 ? <Empty>No headlines or 8-Ks for {symbol} in the last 24 hours{news.items ? '' : ' (news not in this snapshot)'}.</Empty> : (
                <ul className="space-y-3">
                    {items.map(n => (
                        <li key={n.id}>
                            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${n.kind === 'headline' ? 'bg-slate-100 text-slate-600 dark:bg-surfacebg dark:text-slate-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'}`}>{n.kind === 'headline' ? n.source : n.kind}</span>
                                {(n.tags || []).map(t => <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{t}</span>)}
                                <span className="text-[11px] text-slate-500">{new Date(n.time).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })} ET</span>
                            </div>
                            <a href={n.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-sm text-slate-800 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400">{n.title}</a>
                            {n.summary && <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">{n.summary}</p>}
                        </li>
                    ))}
                </ul>
            )}
            {(news.notes || []).length > 0 && <p className="mt-3 text-[11px] text-slate-500">{news.notes.join(' · ')}</p>}
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Headlines are leads, not facts: open the story before acting.</p>
            <NextButton to="entry" onGo={onGo}>Time the entry</NextButton>
        </Card>
    );
}

function EntryView({ desk, symbol, bars, watched, onToggleWatch, onGo }) {
    const e = desk.plans?.[symbol]?.entry;
    if (!e) return <Empty>{symbol} has no entry check in this desk (only the scanner's breakouts are carried through).</Empty>;
    const t = e.trigger;
    return (
        <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-bold text-slate-800 dark:text-white">Entry Timer · {symbol}<ToolTag tool="entry.py check" /></h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Opening-range breakout, long only. Entries allowed {e.no_entries_before}–{e.no_entries_after} ET.</p>
                </div>
                <button onClick={() => onToggleWatch(symbol)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border ${watched ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 dark:border-borderdark text-slate-600 dark:text-slate-300'}`}>
                    {watched ? <Eye size={15} /> : <EyeOff size={15} />} {watched ? 'Watching' : 'Watch & alert me'}
                </button>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Status" value={e.status} tone={STATUS_TONE[e.status]} />
                <Stat label="Opening range" value={`${e.opening_range?.low} – ${e.opening_range?.high}`} />
                <Stat label={t ? 'Triggered at' : 'Last close'} value={t ? `${t.time} · ${money(t.price)}` : money(e.last?.close)} />
                <Stat label={t ? 'Over the high' : 'vs range high'} value={pct(t ? t.pct_over : e.last?.vs_level_pct, 2)} />
            </div>
            <p className={`mt-2 text-sm ${STATUS_TONE[e.status]}`}>{e.reason}{t?.volume_x != null && ` · trigger bar volume ${t.volume_x}× the opening-range average`}</p>
            <div className="mt-3"><IntradayChart bars={bars} date={e.date} plan={desk.plans[symbol].plan} orHigh={e.opening_range?.high} orLow={e.opening_range?.low} /></div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Shaded box = opening range. A wick above the high is not a trigger; only a completed bar's close is.</p>
            <NextButton to="exit" onGo={onGo}>Plan the exit</NextButton>
        </Card>
    );
}

function ExitView({ symbol, plan, rules, setRules, replanning, engine, onGo }) {
    if (!plan) return <Empty>{symbol} hasn't triggered, so there is nothing to plan yet.</Empty>;
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Exit Planner · {symbol}<ToolTag tool="exit.py plan" engine={engine} /></h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Set before the entry. A long's stop rounds down to the cent; the target is entry + R × risk.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-xl">
                <Select label="Stop" value={rules.stop} onChange={v => setRules(r => ({ ...r, stop: v }))} options={STOPS} />
                <Select label="Target" value={rules.target} onChange={v => setRules(r => ({ ...r, target: v }))} options={TARGETS.map(t => [t, t])} />
            </div>
            <div className={`mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 ${replanning ? 'opacity-50' : ''}`}>
                <Stat label="Entry" value={`${money(plan.entry)} · ${plan.entry_time || ''}`} />
                <Stat label="Stop" value={money(plan.stop)} tone="text-red-600 dark:text-red-400" />
                <Stat label="Target" value={money(plan.target)} tone="text-green-600 dark:text-green-400" />
                <Stat label="Risk / share" value={money(plan.risk_per_share)} />
                <Stat label="Flat by" value={`${plan.flat_by || '15:55'} ET`} />
            </div>
            {plan.stop_detail && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{plan.stop_detail}</p>}
            {(plan.warnings || []).map(w => <p key={w} className="mt-1 text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{plan.note || 'A stop is a plan, not a guarantee: a gap or a fast market can fill past it.'}</p>
            <NextButton to="timemachine" onGo={onGo}>Run the Time Machine</NextButton>
        </Card>
    );
}

function TimeMachineView({ symbol, tm, replanning, onGo }) {
    if (!tm) return <Empty>{replanning ? 'Replaying…' : `No Time Machine run for ${symbol} (it runs once the entry has triggered).`}</Empty>;
    const mc = tm.mc, h = tm.history, engine = mc.engine;
    const tone = /toward the target/.test(tm.verdict) ? 'text-green-700 dark:text-green-400' : /toward the stop/.test(tm.verdict) ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400';
    return (
        <Card className={replanning ? 'opacity-60' : ''}>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Time Machine · {symbol}<ToolTag tool="timemachine.py run" engine={engine} /></h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                {mc.replays.toLocaleString()} replays of the last {mc.bars_left} bars from the entry, each 5-minute candle drawn from {symbol}'s own candles near that time of day
                {mc.pool_sessions ? ` over ${mc.pool_sessions} past sessions${mc.pool_from ? ` (${mc.pool_from} to ${mc.pool_to})` : ''}` : ''}, seed {mc.seed}. Stop checked before target in every bar.
            </p>
            <div className="flex h-6 rounded-md overflow-hidden text-[11px] font-bold text-white">
                <div className="bg-green-600 flex items-center justify-center" style={{ width: `${mc.p_target * 100}%` }}>{mc.p_target > 0.08 && `Target ${(mc.p_target * 100).toFixed(1)}%`}</div>
                <div className="bg-slate-400 dark:bg-slate-600 flex items-center justify-center" style={{ width: `${mc.p_neither * 100}%` }}>{mc.p_neither > 0.08 && `Neither ${(mc.p_neither * 100).toFixed(1)}%`}</div>
                <div className="bg-red-600 flex items-center justify-center" style={{ width: `${mc.p_stop * 100}%` }}>{mc.p_stop > 0.08 && `Stop ${(mc.p_stop * 100).toFixed(1)}%`}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Green at the end" value={`${(mc.p_green * 100).toFixed(1)}%`} />
                <Stat label="Average R" value={`${mc.avg_R >= 0 ? '+' : ''}${mc.avg_R.toFixed(3)}R`} tone={mc.avg_R >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
                <Stat label="Price at the close (median)" value={money(mc.median_close)} />
                <Stat label="5th – 95th percentile" value={`${money(mc.p5_close)} – ${money(mc.p95_close)}`} />
            </div>
            <p className={`mt-3 text-sm font-semibold ${tone}`}>{tm.verdict}</p>
            {(tm.verdict_notes || []).map(n => <p key={n} className="text-xs text-slate-500 dark:text-slate-400">{n}</p>)}
            {h ? (
                <div className="mt-4">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">The same rule on every past session</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                        Fired on {h.triggered} of {h.sessions} sessions: {h.target} hit the target, {h.stop} the stop, {h.close} neither · average {h.avg_R >= 0 ? '+' : ''}{h.avg_R}R.
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {(h.trades || []).map(t => (
                            <span key={t.date} title={`${t.date} ${t.time}: entry ${t.entry}, ${t.outcome}, ${t.R}R`}
                                className={`w-3 h-3 rounded-sm ${t.outcome === 'target' ? 'bg-green-500' : t.outcome === 'stop' ? 'bg-red-500' : 'bg-slate-400'}`} />
                        ))}
                    </div>
                </div>
            ) : engine === 'browser' && <p className="mt-3 text-[11px] text-slate-500">The history replay needs live data; this run uses the browser port of the replay algorithm (different random draws, so the odds can differ by a point or so from the skill's).</p>}
            <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Replays reuse the past: odds, not a forecast. A gap through the stop counts −1R here; a real fill can be worse.</p>
            <NextButton to="budget" onGo={onGo}>Size it</NextButton>
        </Card>
    );
}

function BudgetView({ sizing, settings, setSettings, engine, error, onGo }) {
    const set = (k) => (v) => setSettings(s => ({ ...s, [k]: v }));
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Budget<ToolTag tool="size.py" engine={engine} /></h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Whole shares: the smallest of max loss, position cap, max order and cash. Your limits are saved in this browser.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumberField label="Budget" prefix="$" step="100" value={settings.budget} onChange={set('budget')} />
                <NumberField label="Max loss per trade" prefix="$" step="5" value={settings.max_loss_per_trade_usd} onChange={set('max_loss_per_trade_usd')} />
                <NumberField label="Max daily loss" prefix="$" step="10" value={settings.max_daily_loss_usd} onChange={set('max_daily_loss_usd')} />
                <NumberField label="Trades per day" value={settings.max_trades_per_day} onChange={set('max_trades_per_day')} />
                <NumberField label="Cash buffer %" value={settings.cash_buffer_pct} onChange={set('cash_buffer_pct')} />
                <NumberField label="Max position %" value={settings.max_position_pct} onChange={set('max_position_pct')} />
                <NumberField label="Max order" prefix="$" step="100" value={settings.max_order_usd} onChange={set('max_order_usd')} />
                <NumberField label="Min reward:risk" step="0.1" value={settings.min_reward_risk} onChange={set('min_reward_risk')} />
            </div>
            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {sizing && (
                <>
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Stat label="Shares" value={sizing.qty} tone="text-emerald-600 dark:text-emerald-400" />
                        <Stat label="Cost" value={money(sizing.cost)} />
                        <Stat label="Loss if stopped" value={money(sizing.max_loss)} tone="text-red-600 dark:text-red-400" />
                        <Stat label="Bound by" value={sizing.bound_by} />
                    </div>
                    <ul className="mt-3 text-xs space-y-0.5">
                        {sizing.limits.map(l => <li key={l.name} className={l.binds ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}>{l.name}: {l.how} → {l.shares} shares{l.binds && ' ← binds'}</li>)}
                    </ul>
                    {sizing.refusal && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-400">No order: {sizing.refusal}</p>}
                </>
            )}
            {sizing && !sizing.refusal && <NextButton to="risk" onGo={onGo}>Risk check</NextButton>}
        </Card>
    );
}

function RiskView({ risk, engine, onGo }) {
    if (!risk) return <Empty>Size a trade first; no order, nothing to check.</Empty>;
    const pass = risk.verdict === 'PASS';
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-3">Risk Manager<ToolTag tool="check.py" engine={engine} /></h2>
            <p className={`text-lg font-bold flex items-center gap-2 ${pass ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {pass ? <CheckCircle2 size={20} /> : <XCircle size={20} />} {risk.verdict}
            </p>
            {(risk.reasons || []).map(r => <p key={r} className="mt-1 text-sm text-red-700 dark:text-red-400">{r}</p>)}
            {(risk.warnings || []).map(r => <p key={r} className="mt-1 text-sm text-amber-700 dark:text-amber-400">{r}</p>)}
            <ul className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-0.5">{(risk.info || []).map(i => <li key={i}>{i}</li>)}</ul>
            {pass && <NextButton to="broker" onGo={onGo}>Go to the Order Desk</NextButton>}
        </Card>
    );
}

function OrderView({ symbol, plan, sizing, risk, orders, onPlace, onClose }) {
    const [confirm, setConfirm] = useState('');
    const ready = risk?.verdict === 'PASS' && sizing?.qty > 0;
    const ok = ready && confirm.trim().toLowerCase() === 'yes';
    return (
        <div className="space-y-4">
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white mb-1">Order Desk · paper account<ToolTag tool="trader-broker" /></h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Paper only. Like the skill, this never sends anything to a broker; the order is recorded in this browser and filled at the plan's entry.
                </p>
                {ready ? (
                    <>
                        <div className="rounded-lg border border-slate-200 dark:border-borderdark p-3 text-sm text-slate-700 dark:text-slate-200">
                            <b>BUY {sizing.qty} {symbol}</b>, market, day · bracket: stop-loss {money(sizing.stop)}, take-profit {money(sizing.target)} ·
                            max loss at the stop {money(sizing.max_loss)} · flat by {plan?.flat_by || '15:55'} ET
                        </div>
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span>Type <b>yes</b> for this exact order</span>
                                <input value={confirm} onChange={e => setConfirm(e.target.value)} className="w-40 rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg px-2.5 py-2 text-sm" />
                            </label>
                            <button disabled={!ok} onClick={() => { onPlace(); setConfirm(''); }}
                                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">Record paper order</button>
                        </div>
                    </>
                ) : <Empty>Only an order the Risk Manager passed can go here.</Empty>}
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
                                        <td className="py-2 pr-3 font-semibold">Buy {o.qty} {o.symbol} @ {money(o.entry)}</td>
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

function AlertsView({ clock, permission, onEnable, log, orders, watches }) {
    const open = orders.filter(o => o.status === 'open');
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Alerts<ToolTag tool="alerts.py" /></h2>
            {clock && (
                <p className="text-sm mb-3">
                    NYSE {clock.open ? <b className="text-green-600 dark:text-green-400">open</b> : <b className="text-slate-500">closed</b>} ({clock.reason}) · {clock.date} {clock.opens}–{clock.closes} ET
                    {clock.early_close && <span className="text-amber-600"> · early close</span>} · next open {clock.next_open}
                </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                While this page is open it re-reads the desk every minute and rings once for each: a paper order's stop or target, a watched breakout that triggers, and the flat-by time.
            </p>
            {permission !== 'granted' ? (
                <button onClick={onEnable} disabled={permission === 'denied' || permission === 'unsupported'}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">
                    <BellRing size={15} /> {permission === 'denied' ? 'Notifications are blocked in this browser' : permission === 'unsupported' ? 'Notifications not supported here' : 'Enable notifications'}
                </button>
            ) : <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5"><BellRing size={15} /> Notifications on.</p>}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                <Stat label="Open paper orders" value={open.length ? open.map(o => `${o.symbol} stop ${o.stop} / target ${o.target}`).join(' · ') : 'none'} />
                <Stat label="Watched breakouts" value={watches.length ? watches.join(', ') : 'none'} />
            </div>
            <h3 className="mt-4 text-sm font-bold text-slate-800 dark:text-white">Rang</h3>
            {log.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Nothing yet.</p> : (
                <ul className="mt-1 space-y-1 text-sm">{[...log].reverse().map((a, i) => <li key={i}><span className="text-xs text-slate-500 mr-2">{new Date(a.at).toLocaleTimeString()}</span>{a.text}</li>)}</ul>
            )}
        </Card>
    );
}

function AnalystView({ desk, symbol }) {
    const doc = (desk.analyst || []).find(a => a.ticker === symbol);
    const res = doc?.result;
    if (!res?.rows?.length) return <Empty>No SEC numbers for {symbol}{doc?.note ? `: ${doc.note}` : ' in this desk'}.</Empty>;
    const pctCell = (v) => <span className={v == null ? 'text-slate-400' : v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{pct(v)}</span>;
    return (
        <Card>
            <h2 className="font-bold text-slate-800 dark:text-white mb-1">Earnings Analyst · {res.entity}<ToolTag tool="facts.py" /></h2>
            <ul className="text-sm text-slate-700 dark:text-slate-200 space-y-1 mb-3">{(doc.changes || []).map(c => <li key={c}>• {c}</li>)}</ul>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead><tr className="text-left uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-borderdark">
                        <th className="py-2 pr-3">Quarter</th><th className="py-2 pr-3 text-right">Revenue</th><th className="py-2 pr-3 text-right">YoY</th>
                        <th className="py-2 pr-3 text-right">Net income</th><th className="py-2 pr-3 text-right">EPS</th><th className="py-2 pr-3 text-right">EPS YoY</th>
                        <th className="py-2 pr-3 text-right">Gross</th><th className="py-2 pr-3 text-right">Operating</th><th className="py-2 text-right">Net margin</th>
                    </tr></thead>
                    <tbody>
                        {res.rows.map(r => (
                            <tr key={r.end} className="border-b border-slate-100 dark:border-borderdark/60 font-mono">
                                <td className="py-1.5 pr-3 font-sans">{r.fiscal}{r.derived && <span className="text-slate-400" title="Q4 = full year minus three quarters"> *</span>} <span className="text-slate-400">{r.end}</span></td>
                                <td className="py-1.5 pr-3 text-right">{big(r.revenue)}</td><td className="py-1.5 pr-3 text-right">{pctCell(r.revenue_yoy)}</td>
                                <td className="py-1.5 pr-3 text-right">{big(r.net_income)}</td><td className="py-1.5 pr-3 text-right">{r.eps_diluted != null ? `$${r.eps_diluted.toFixed(2)}` : '—'}</td>
                                <td className="py-1.5 pr-3 text-right">{pctCell(r.eps_yoy)}</td>
                                <td className="py-1.5 pr-3 text-right">{r.gross_margin ?? '—'}%</td><td className="py-1.5 pr-3 text-right">{r.operating_margin ?? '—'}%</td><td className="py-1.5 text-right">{r.net_margin ?? '—'}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {doc.filings?.earnings_8k?.exhibit && <a href={doc.filings.earnings_8k.exhibit} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">Earnings release ({doc.filings.earnings_8k.filed}) <ExternalLink size={11} /></a>}
                {doc.filings?.report?.url && <a href={doc.filings.report.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">Latest {doc.filings.report.form} ({doc.filings.report.filed}) <ExternalLink size={11} /></a>}
            </div>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">* Q4 is derived (full year minus three quarters); derived EPS is approximate. Numbers only: this never says whether a stock is a buy.</p>
        </Card>
    );
}

function CongressView({ desk }) {
    const { filings = [], reports = [] } = desk.congress || {};
    const trades = reports.flatMap(r => (r.rows || []).map(row => ({ ...row, member: r.name, district: r.district })));
    return (
        <div className="space-y-4">
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white mb-1">Trades in the newest reports<ToolTag tool="ptr.py fetch" /></h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Read from the PTR PDFs. Amounts are ranges; members have up to 45 days to disclose.</p>
                {trades.length === 0 ? <Empty>No trade rows in this desk (reading the PDFs needs pdftotext on the data server).</Empty> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead><tr className="text-left uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-borderdark">
                                <th className="py-2 pr-3">Member</th><th className="py-2 pr-3">Owner</th><th className="py-2 pr-3">Trade</th><th className="py-2 pr-3">Ticker</th>
                                <th className="py-2 pr-3">Asset</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Traded</th><th className="py-2">Disclosed after</th>
                            </tr></thead>
                            <tbody>
                                {trades.map((t, i) => (
                                    <tr key={i} className="border-b border-slate-100 dark:border-borderdark/60">
                                        <td className="py-1.5 pr-3 font-semibold">{t.member} <span className="font-normal text-slate-400">{t.district}</span></td>
                                        <td className="py-1.5 pr-3">{t.owner_name}</td>
                                        <td className={`py-1.5 pr-3 font-semibold ${t.type === 'P' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{t.type_name}{t.option ? ` ${t.option.kind}s` : ''}</td>
                                        <td className="py-1.5 pr-3 font-mono font-bold">{t.ticker || '—'}</td>
                                        <td className="py-1.5 pr-3 max-w-[16rem] truncate" title={t.asset}>{t.asset}</td>
                                        <td className="py-1.5 pr-3 font-mono">{t.amount}</td>
                                        <td className="py-1.5 pr-3">{t.date}</td>
                                        <td className={`py-1.5 ${t.late ? 'text-red-600 font-semibold' : ''}`}>{t.days_to_disclose != null ? `${t.days_to_disclose} days${t.late ? ' (late)' : ''}` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
            <Card>
                <h2 className="font-bold text-slate-800 dark:text-white mb-1">Newest Periodic Transaction Reports<ToolTag tool="ptr.py index" /></h2>
                {filings.length === 0 ? <Empty>No reports in this desk.</Empty> : (
                    <ul className="divide-y divide-slate-100 dark:divide-borderdark">
                        {filings.map(r => (
                            <li key={r.doc_id} className="py-2 flex items-center justify-between gap-3 text-sm">
                                <span><b className="text-slate-800 dark:text-slate-100">{r.name}</b> <span className="text-xs text-slate-500">{r.district}</span></span>
                                <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">filed {r.filed} <ExternalLink size={11} /></a>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">House only: Senate reports sit behind an agreement on efdsearch.senate.gov that you have to accept yourself.</p>
            </Card>
        </div>
    );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DayTrader() {
    const [theme, setTheme] = useState(savedTheme);
    const dark = theme === 'dark';
    const liveBase = useLiveApiBase();
    const [desk, setDesk] = useState(null);
    const [source, setSource] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('scanner');
    const [symbol, setSymbol] = useState(null);
    const [bars, setBars] = useState({});
    const [rules, setRules] = useState({ stop: 'or-mid', target: '2R' });
    const [replan, setReplan] = useState(null);       // {plan, timemachine, engine} for non-default rules
    const [replanning, setReplanning] = useState(false);
    const [settings, setSettings] = useState(loadSettings);
    const [sized, setSized] = useState(null);           // {sizing, risk, engine, error}
    const [orders, setOrders] = useState(loadOrders);
    const [watches, setWatches] = useState([]);
    const [alertLog, setAlertLog] = useState([]);
    const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
    const fired = useRef(new Set());
    const prevStatus = useRef({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { source: src, body } = await getData('/api/desk', 'daytrader.json');
            setDesk(body);
            setSource(src);
            setError(null);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, REFRESH_MS);
        return () => clearInterval(id);
    }, [load, liveBase]);

    useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }, [settings]);
    useEffect(() => saveOrders(orders), [orders]);

    const pick = (sym) => { setSymbol(sym); setReplan(null); setRules({ stop: 'or-mid', target: desk?.target_rule || '2R' }); };

    // First load: the scanner's first breakout, else the first watchlist symbol
    useEffect(() => {
        if (desk && !symbol) pick(desk.scan?.hits?.[0]?.symbol || desk.symbols?.[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [desk]);

    // 5-minute bars for the chosen stock (chart, browser Time Machine, latest price)
    useEffect(() => {
        if (!symbol || !desk) return;
        const req = source === 'live' ? liveJson(`/api/desk/bars?symbol=${symbol}`) : snapshotJson(`intraday/${symbol}.json`);
        req.then(d => setBars(m => ({ ...m, [symbol]: d.bars }))).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, desk?.generated_at, source]);

    const base = desk?.plans?.[symbol];
    const defaultRules = rules.stop === 'or-mid' && rules.target === (desk?.target_rule || '2R');
    const symBars = bars[symbol];

    // Re-plan with other stop/target rules: the skill via the live API, else the browser ports
    useEffect(() => {
        if (!base?.plan || defaultRules) { setReplan(null); return undefined; }
        let alive = true;
        setReplanning(true);
        (async () => {
            try {
                if (source === 'live') {
                    const r = await liveJson(`/api/desk/plan?symbol=${symbol}&target=${rules.target}&stop=${rules.stop}`);
                    if (alive) setReplan({ plan: r.plan, timemachine: r.timemachine, engine: 'skill' });
                } else {
                    const plan = browserPlan(base.plan, rules.stop, rules.target);
                    let timemachine = null;
                    const k = plan.entry_bar ?? barOfTime(plan.entry_time);   // the replay starts after the entry bar
                    if (symBars?.length && Number.isInteger(k)) {
                        const { pool, sessions } = buildPool(symBars, plan.date);
                        const mc = { ...simulate({ pool, entry: plan.entry, stop: plan.stop, target: plan.target, k }), pool_sessions: sessions };
                        const v = tmVerdict(mc);
                        timemachine = { mc, verdict: v.verdict, verdict_notes: v.notes };
                    }
                    if (alive) setReplan({ plan, timemachine, engine: 'browser' });
                }
            } catch (e) {
                if (alive) setReplan({ error: e.message });
            } finally {
                if (alive) setReplanning(false);
            }
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, rules.stop, rules.target, desk?.generated_at, source, symBars?.length]);

    const plan = replan?.plan || base?.plan || null;
    const tm = replan ? replan.timemachine : base?.timemachine;
    const planEngine = replan?.engine === 'browser' ? 'browser' : 'skill';

    const prices = useMemo(() => {
        const out = {};
        for (const [s, b] of Object.entries(bars)) if (b?.length) out[s] = b[b.length - 1][4];
        for (const h of desk?.scan?.hits || []) out[h.symbol] ??= h.price;
        return out;
    }, [bars, desk]);

    const todayEntries = orders.filter(o => sameDay(o.placedAt));

    // Budget + risk: the skill's size.py and check.py via the live API, else the browser ports
    useEffect(() => {
        if (!plan) { setSized(null); return undefined; }
        let alive = true;
        const timer = setTimeout(async () => {
            if (source === 'live') {
                try {
                    const r = await liveJson('/api/desk/size-risk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, settings }) });
                    const res = r.risk?.results?.[0];
                    let risk = res ? { verdict: res.verdict, reasons: res.reasons, warnings: res.warnings, info: res.info } : null;
                    // The server knows nothing of this browser's paper orders: add those two limits on top
                    if (risk && r.sizing) {
                        const extra = riskCheck({ sizing: r.sizing, cfg: settings, todayEntries }).reasons.filter(x => /^(daily loss|trades):/.test(x));
                        if (extra.length) risk = { ...risk, verdict: 'BLOCK', reasons: [...risk.reasons, ...extra] };
                    }
                    if (alive) setSized({ sizing: r.sizing, risk, engine: 'skill' });
                } catch (e) {
                    if (alive) setSized({ error: e.message, engine: 'skill' });
                }
                return;
            }
            try {
                const sizing = sizeTrade(plan, settings);
                const risk = sizing.refusal ? null : riskCheck({ sizing, cfg: settings, todayEntries, nowHHMM: nyClock(desk.as_of) });
                if (alive) setSized({ sizing, risk, engine: 'browser' });
            } catch (e) {
                if (alive) setSized({ error: e.message, engine: 'browser' });
            }
        }, 250);
        return () => { alive = false; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plan, settings, source, todayEntries.length]);

    const addAlert = (key, text) => {
        if (fired.current.has(key)) return;
        fired.current.add(key);
        setAlertLog(l => [...l, { at: Date.now(), text }]);
        notify('FinEngine Day Trader', text);
    };

    // On every desk refresh: mark paper orders, ring triggers and flat-by
    useEffect(() => {
        if (!desk) return;
        setOrders(prev => {
            const next = markToMarket(prev, prices);
            next.forEach((o, i) => {
                if (prev[i]?.status === 'open' && o.status === 'closed') addAlert(`order-${o.id}`, `${o.symbol}: paper order hit its ${o.exitReason} at ${money(o.exit)} (P&L ${money(o.pnl)})`);
            });
            return next;
        });
        for (const sym of watches) {
            const st = desk.plans?.[sym]?.entry?.status;
            if (st === 'triggered' && prevStatus.current[sym] && prevStatus.current[sym] !== 'triggered') {
                addAlert(`trigger-${sym}-${desk.as_of.slice(0, 10)}`, `${sym} triggered: ${desk.plans[sym].entry.reason}`);
            }
        }
        prevStatus.current = Object.fromEntries(Object.entries(desk.plans || {}).map(([s, p]) => [s, p.entry?.status]));
        const now = nyClock(desk.as_of);
        if (desk.clock?.open && orders.some(o => o.status === 'open' && now >= (o.flat_by || '15:55'))) {
            addAlert(`flat-${desk.as_of.slice(0, 10)}`, 'Flat-by time: close your open paper positions before the bell.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [desk?.generated_at, prices]);

    const placeOrder = () => {
        const s = sized.sizing;
        setOrders(o => markToMarket([...o, { id: `${Date.now()}`, symbol, qty: s.qty, entry: s.entry, stop: s.stop, target: s.target,
            max_loss: s.max_loss, flat_by: plan.flat_by, status: 'open', placedAt: new Date().toISOString() }], prices));
        setTab('alerts');
    };
    const closeOrder = (id) => setOrders(os => os.map(o => {
        if (o.id !== id || o.status !== 'open') return o;
        const exit = prices[o.symbol] ?? o.entry;
        return { ...o, status: 'closed', exit, exitReason: 'manual', pnl: Math.round((exit - o.entry) * o.qty * 100) / 100, closedAt: new Date().toISOString() };
    }));
    const enableNotifications = async () => {
        if ('Notification' in window) setPermission(await Notification.requestPermission());
    };
    const toggleWatch = (sym) => setWatches(w => (w.includes(sym) ? w.filter(s => s !== sym) : [...w, sym]));

    const stale = source === 'snapshot' && desk?.clock?.open && desk?.generated_at && Date.now() - new Date(desk.generated_at).getTime() > 40 * 60000;
    const needsSymbol = !['scanner', 'congress', 'alerts', 'broker'].includes(tab);
    const symbolChoices = [...new Set([...(desk?.scan?.hits || []).map(h => h.symbol), ...Object.keys(desk?.plans || {})])];

    const view = () => {
        if (!desk) return null;
        if (needsSymbol && !symbol) return <Empty>Pick a stock in the Scanner first.</Empty>;
        switch (tab) {
            case 'scanner': return <ScannerView desk={desk} symbol={symbol} onPick={pick} onGo={setTab} />;
            case 'news': return <NewsView desk={desk} symbol={symbol} onGo={setTab} />;
            case 'entry': return <EntryView desk={desk} symbol={symbol} bars={symBars} watched={watches.includes(symbol)} onToggleWatch={toggleWatch} onGo={setTab} />;
            case 'exit': return replan?.error ? <Empty>{replan.error}</Empty> : <ExitView symbol={symbol} plan={plan} rules={rules} setRules={setRules} replanning={replanning} engine={planEngine} onGo={setTab} />;
            case 'timemachine': return <TimeMachineView symbol={symbol} tm={tm} replanning={replanning} onGo={setTab} />;
            case 'budget': return plan ? <BudgetView sizing={sized?.sizing} settings={settings} setSettings={setSettings} engine={sized?.engine} error={sized?.error} onGo={setTab} /> : <Empty>Plan a trade first.</Empty>;
            case 'risk': return <RiskView risk={sized?.risk} engine={sized?.engine} onGo={setTab} />;
            case 'broker': return <OrderView symbol={symbol} plan={plan} sizing={sized?.sizing} risk={sized?.risk} orders={orders} onPlace={placeOrder} onClose={closeOrder} />;
            case 'alerts': return <AlertsView clock={desk.clock} permission={permission} onEnable={enableNotifications} log={alertLog} orders={orders} watches={watches} />;
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
                            {desk?.as_of && (
                                <span className="hidden md:inline text-[11px] text-slate-500 dark:text-slate-400" title={desk.generated_at && new Date(desk.generated_at).toLocaleString()}>
                                    As of {desk.as_of} ET{desk.generated_at && ` · built ${ageText(desk.generated_at)}`}
                                </span>
                            )}
                            <LiveDataButton source={source} />
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
                                <button key={s.key} onClick={() => setTab(s.key)} title={`${s.tool}: ${s.desc}`} aria-current={tab === s.key ? 'page' : undefined}
                                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${tab === s.key ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 dark:border-borderdark text-slate-600 dark:text-slate-300 hover:border-emerald-500'}`}>
                                    <span className="opacity-60">{i + 1}</span><Icon size={14} />{s.title}
                                </button>
                            );
                        })}
                    </nav>

                    {desk && symbol && needsSymbol && symbolChoices.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-slate-500 dark:text-slate-400">Stock:</span>
                            {symbolChoices.map(s => (
                                <button key={s} onClick={() => pick(s)}
                                    className={`px-2 py-0.5 rounded-md font-semibold ${symbol === s ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 dark:bg-surfacebg text-slate-600 dark:text-slate-300'}`}>{s}</button>
                            ))}
                        </div>
                    )}

                    {error && (
                        <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-400 flex gap-2">
                            <AlertTriangle size={18} className="shrink-0" /> <span>Couldn't load the desk. {error}</span>
                        </div>
                    )}
                    {stale && (
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-sm text-amber-800 dark:text-amber-300 flex gap-2">
                            <AlertTriangle size={17} className="shrink-0" /> The market is open but this snapshot was built {ageText(desk.generated_at)}. Connect live data (top right) for fresh bars.
                        </div>
                    )}
                    {desk?.errors?.length > 0 && (
                        <details className="text-xs text-slate-500 dark:text-slate-400">
                            <summary className="cursor-pointer">{desk.errors.length} part{desk.errors.length > 1 ? 's' : ''} of the last update failed</summary>
                            <ul className="mt-1 list-disc list-inside">{desk.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                        </details>
                    )}
                    {loading && !desk && !error && <div className="p-6 text-center text-slate-500">Loading the desk…</div>}

                    {view()}

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2">
                        Results from the open-source <a className="underline" href="https://github.com/Jakeschincariol/day-trader-skill" target="_blank" rel="noopener noreferrer">day-trader-skill</a> (Jake Schincariol, MIT).
                        Data: Yahoo Finance (unofficial, can lag), Nasdaq Trader, SEC EDGAR and the House Clerk. {source === 'live' ? 'Live: rebuilt every minute.' : 'Snapshot: rebuilt about every 15 minutes in market hours.'}
                        {' '}Educational only, not financial advice. Most day traders lose money; paper trade first.
                    </p>
                </main>
            </div>
        </div>
    );
}
