import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Plus, Trash2, Power, Plug, Unplug, KeyRound, RefreshCw, AlertTriangle, ShieldCheck, Wallet,
    ListOrdered, ScrollText, SlidersHorizontal, Briefcase, Loader2, ArrowLeft,
} from 'lucide-react';
import { tradingApi, getTradeToken, setTradeToken, readLegacyAccounts, clearLegacyAccounts } from '../utils/tradingApi';
import { ALERT_SOURCES, TIMEFRAMES } from '../utils/alerts/alertSources';
import { notifyAccountsChanged } from '../hooks/useAccountSignals';
import { confirmDialog } from '../utils/confirmDialog';

// Algo Trading Account Manager — see ALGO_TRADING.md.
// Broker passwords go to the backend once (encrypted there) and are never
// stored in this browser. Each account runs on its own MT5 terminal, separate
// from the one that feeds chart data.

const SERVERS = ['RoboForex-Pro', 'RoboForex-ECN', 'RoboForex-Prime', 'RoboForex-Demo', 'RoboForex-ProCent'];
const TRADABLE_SOURCES = Object.entries(ALERT_SOURCES).filter(([k]) => k !== 'price');

const inputCls = 'w-full text-sm h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500';
const labelCls = 'block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1';
const btn = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-500 text-white`;
const btnGhost = `${btn} border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`;

const money = (v, cur) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`);
const signed = (v, cur) => (v == null ? '—' : `${v > 0 ? '+' : ''}${money(v, cur)}`);
const pnlCls = (v) => (v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200');
const tsLocal = (sec) => (sec ? new Date(sec * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const STATUS = {
    connected:    { label: 'Connected',    dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
    connecting:   { label: 'Connecting…',  dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700 dark:text-amber-400' },
    starting:     { label: 'Starting…',    dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700 dark:text-amber-400' },
    reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700 dark:text-amber-400' },
    error:        { label: 'Error',        dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
    stopped:      { label: 'Stopped',      dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400' },
    disconnected: { label: 'Disconnected', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400' },
};
const StatusPill = ({ state }) => {
    const s = STATUS[state] || STATUS.disconnected;
    return <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${s.text}`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}</span>;
};

/** setInterval that pauses while the tab is hidden and is always cleaned up. */
function usePoll(fn, ms, enabled) {
    const ref = useRef(fn);
    ref.current = fn;
    useEffect(() => {
        if (!enabled) return undefined;
        const tick = () => { if (!document.hidden) ref.current(); };
        tick();
        const id = setInterval(tick, ms);
        return () => clearInterval(id);
    }, [ms, enabled]);
}

export default function AccountManager({ onClose, dark = false }) {
    const [token, setToken] = useState(getTradeToken());
    const [gate, setGate] = useState(null);            // null | 'token' | 'setup'
    const [gateMsg, setGateMsg] = useState('');
    const [accounts, setAccounts] = useState([]);
    const [defaults, setDefaults] = useState(null);
    const [selected, setSelected] = useState(null);   // account id | 'add'
    const [loaded, setLoaded] = useState(false);
    const [legacy, setLegacy] = useState(() => readLegacyAccounts());
    const [mobileList, setMobileList] = useState(true); // phones: list or detail

    const load = useCallback(async () => {
        if (!getTradeToken()) { setGate('token'); setLoaded(true); return; }
        try {
            const r = await tradingApi.list();
            setAccounts(r.accounts || []);
            setDefaults(r.defaults || null);
            setGate(null);
        } catch (e) {
            if (e.status === 401) { setGate('token'); setGateMsg('That token was not accepted.'); }
            else if (e.status === 503) { setGate('setup'); setGateMsg(e.message); }
            else setGateMsg(e.message);
        } finally { setLoaded(true); }
    }, []);

    usePoll(load, 5000, gate === null && !!token);
    useEffect(() => { load(); }, [load, token]);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Keep a valid selection
    useEffect(() => {
        if (selected === 'add') return;
        if (!accounts.find(a => a.id === selected)) setSelected(accounts[0]?.id || (loaded && gate === null ? 'add' : null));
    }, [accounts, selected, loaded, gate]);

    const changed = () => { load(); notifyAccountsChanged(); };
    const current = accounts.find(a => a.id === selected);

    // Portal: the toolbar creates a stacking context that would put the
    // mobile sub-bar above this dialog
    return createPortal(
        <div className={dark ? 'dark' : undefined}>
        <div className="fixed inset-0 z-[300] bg-white dark:bg-slate-900 flex flex-col ts-sheet-in" role="main" aria-label="Algo Trading Account Manager">
            <div className="w-full h-full flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 h-14 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        {/* Back: to the account list on phones (when in a detail view), otherwise to the chart */}
                        <button className={`${btnGhost} h-8 -ml-1 border-transparent`} onClick={() => (!mobileList && window.innerWidth < 768 ? setMobileList(true) : onClose())} aria-label="Back">
                            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
                        </button>
                        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
                        <Briefcase className="w-5 h-5 text-indigo-500 shrink-0" />
                        <h2 className="text-base font-bold text-slate-800 dark:text-white truncate">Algo Trading Accounts</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {gate === null && token && (
                            <button className={btnGhost} onClick={() => { setTradeToken(''); setToken(''); setGate('token'); }} title="Forget the trading token in this browser">
                                <KeyRound className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Token</span>
                            </button>
                        )}
                    </div>
                </div>

                {!loaded ? (
                    <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
                ) : gate ? (
                    <TokenGate mode={gate} message={gateMsg} onSave={(t) => { setTradeToken(t); setToken(t); setGateMsg(''); setGate(null); }} />
                ) : (
                    <div className="flex-1 min-h-0 flex">
                        {/* Account list */}
                        <aside className={`${mobileList ? 'flex' : 'hidden md:flex'} w-full md:w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900`}>
                            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                                {legacy.length > 0 && (
                                    <LegacyBanner legacy={legacy} onDone={() => { setLegacy(readLegacyAccounts()); changed(); }} />
                                )}
                                {accounts.map(a => (
                                    <button key={a.id} onClick={() => { setSelected(a.id); setMobileList(false); }}
                                        className={`w-full text-left p-3 rounded-xl border transition-colors ${selected === a.id ? 'bg-white dark:bg-slate-800 border-indigo-300 dark:border-indigo-500/50 shadow-sm' : 'border-transparent hover:bg-white dark:hover:bg-slate-800/60'}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-bold text-sm text-slate-800 dark:text-white tabular-nums">{a.login}</span>
                                            {a.settings.algo_enabled && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Algo on</span>}
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{a.label ? `${a.label} · ` : ''}{a.server}</div>
                                        <div className="mt-1"><StatusPill state={a.status?.state} /></div>
                                    </button>
                                ))}
                                {accounts.length === 0 && legacy.length === 0 && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400 p-3">No broker accounts yet.</p>
                                )}
                            </div>
                            <div className="p-2 border-t border-slate-200 dark:border-slate-700">
                                <button className={`${btnPrimary} w-full h-9`} onClick={() => { setSelected('add'); setMobileList(false); }}><Plus className="w-4 h-4" /> Add MT5 account</button>
                            </div>
                        </aside>

                        {/* Detail */}
                        <main className={`${mobileList ? 'hidden md:flex' : 'flex'} flex-1 min-w-0 flex-col`}>
                            {selected === 'add' ? (
                                <AddAccount defaults={defaults} onCancel={() => { setSelected(accounts[0]?.id || null); setMobileList(true); }} onAdded={(a) => { changed(); setSelected(a.id); }} />
                            ) : current ? (
                                <AccountDetail key={current.id} acc={current} onChanged={changed} onDeleted={() => { setSelected(null); setMobileList(true); changed(); }} />
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-sm text-slate-500">Select an account</div>
                            )}
                        </main>
                    </div>
                )}
            </div>
        </div>
        </div>
    , document.body);
}

function TokenGate({ mode, message, onSave }) {
    const [val, setVal] = useState('');
    return (
        <div className="flex-1 overflow-y-auto flex items-start md:items-center justify-center p-6">
            <form className="w-full max-w-md space-y-4" onSubmit={(e) => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }}>
                <div className="flex items-center gap-2 text-slate-800 dark:text-white font-bold"><KeyRound className="w-5 h-5 text-indigo-500" /> Trading token</div>
                {mode === 'setup' ? (
                    <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
                        <p>Trading is not set up on the backend yet.</p>
                        <ol className="list-decimal ml-5 space-y-1 text-[13px]">
                            <li>On the server, add <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">TRADING_API_TOKEN=&lt;a long random string&gt;</code> to <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">backend/.env.local</code>.</li>
                            <li>Also set <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">MT5_WEB_TERMINAL_PATH</code> to your MT5 <code>terminal64.exe</code> (each account gets its own copy of it).</li>
                            <li>Restart the backend, then enter the same token below.</li>
                        </ol>
                    </div>
                ) : (
                    <p className="text-sm text-slate-600 dark:text-slate-300">Enter the <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">TRADING_API_TOKEN</code> from <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">backend/.env.local</code>. It protects the endpoints that can place trades, and is remembered in this browser only.</p>
                )}
                {message && mode !== 'setup' && <p className="text-xs text-red-600 dark:text-red-400">{message}</p>}
                <input type="password" autoComplete="off" value={val} onChange={e => setVal(e.target.value)} placeholder="Trading token" className={inputCls} aria-label="Trading token" />
                <button type="submit" className={`${btnPrimary} h-9 w-full`} disabled={!val.trim()}>Continue</button>
            </form>
        </div>
    );
}

function LegacyBanner({ legacy, onDone }) {
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const migrate = async () => {
        setBusy(true); setMsg('');
        const moved = [];
        for (const a of legacy) {
            const src = ALERT_SOURCES[a.indicator] ? a.indicator : 'goldMove';
            const sig = src === 'livermore' ? 'buy' : (ALERT_SOURCES[src].signals.any ? 'any' : Object.keys(ALERT_SOURCES[src].signals)[0]);
            try {
                await tradingApi.add({
                    login: parseInt(a.login, 10), password: a.password, server: a.server, label: 'Imported',
                    settings: {
                        algo_enabled: false, // re-enable after checking the account connects
                        signals: [{ source: src, signal: sig }],
                        timeframe: parseInt(a.timeframe, 10) || null,
                        trade_symbol: a.tradeSymbol || '',
                        risk_percent: parseFloat(a.riskPercent) || 1, max_daily_loss_pct: parseFloat(a.maxDailyDrawdown) || 3,
                    },
                });
                moved.push(String(a.login));
            } catch (e) {
                if (/already added/i.test(e.message)) moved.push(String(a.login));
                else setMsg(`${a.login}: ${e.message}`);
            }
        }
        clearLegacyAccounts(moved);
        setBusy(false);
        onDone();
    };
    return (
        <div className="p-3 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-[12px] text-amber-900 dark:text-amber-200 space-y-2">
            <div className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{legacy.length} account{legacy.length > 1 ? 's' : ''} from the old manager {legacy.length > 1 ? 'are' : 'is'} stored in this browser with {legacy.length > 1 ? 'their passwords' : 'its password'}.</span></div>
            <div className="flex gap-2">
                <button className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`} disabled={busy} onClick={migrate}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Move to server</button>
                <button className={`${btn} text-amber-800 dark:text-amber-200 hover:underline`} disabled={busy} onClick={async () => { if (await confirmDialog({ title: 'Delete old accounts from this browser?', message: 'The old account list and its saved passwords are removed from this browser. Accounts already moved to the server are not affected.', confirmLabel: 'Delete', danger: true })) { clearLegacyAccounts(legacy.map(a => String(a.login))); onDone(); } }}>Delete</button>
            </div>
            {msg && <p className="text-red-700 dark:text-red-300">{msg}</p>}
        </div>
    );
}

function AddAccount({ onCancel, onAdded }) {
    const [f, setF] = useState({ label: '', login: '', password: '', server: 'RoboForex-Pro' });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
    const submit = async (e) => {
        e.preventDefault();
        setBusy(true); setErr('');
        try {
            const acc = await tradingApi.add({ login: parseInt(f.login, 10), password: f.password, server: f.server.trim(), label: f.label.trim() });
            setF(p => ({ ...p, password: '' }));
            onAdded(acc);
        } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
    };
    return (
        <form onSubmit={submit} className="flex-1 overflow-y-auto p-5 md:p-8">
            <div className="max-w-lg space-y-4">
                <h3 className="text-base font-bold text-slate-800 dark:text-white">Add MT5 account</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">The account runs on its own copy of the MT5 terminal on the server, so the chart data connection is never switched. The password is sent once, stored <b>encrypted on the server</b>, and never kept in this browser. Algo trading stays <b>off</b> until you turn it on.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className={labelCls}>Login (account number)</label><input required inputMode="numeric" pattern="[0-9]+" value={f.login} onChange={set('login')} className={inputCls} autoComplete="off" /></div>
                    <div><label className={labelCls}>Server</label><input required list="ts-mt5-servers" value={f.server} onChange={set('server')} className={inputCls} />
                        <datalist id="ts-mt5-servers">{SERVERS.map(s => <option key={s} value={s} />)}</datalist></div>
                    <div><label className={labelCls}>Password</label><input required type="password" value={f.password} onChange={set('password')} className={inputCls} autoComplete="new-password" /></div>
                    <div><label className={labelCls}>Label (optional)</label><input value={f.label} onChange={set('label')} placeholder="e.g. ProCent live" className={inputCls} /></div>
                </div>
                {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
                <div className="flex gap-2 pt-1">
                    <button type="submit" className={`${btnPrimary} h-9`} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />} Add &amp; connect</button>
                    <button type="button" className={`${btnGhost} h-9`} onClick={onCancel}>Cancel</button>
                </div>
            </div>
        </form>
    );
}

const TABS = [
    { id: 'positions', label: 'Positions', icon: Wallet },
    { id: 'history', label: 'History', icon: ListOrdered },
    { id: 'logs', label: 'Logs', icon: ScrollText },
    { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

function AccountDetail({ acc, onChanged, onDeleted }) {
    const [tab, setTab] = useState('positions');
    const [summary, setSummary] = useState(null);
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const connected = acc.status?.state === 'connected';
    const cur = summary?.currency || '';

    usePoll(async () => {
        try { setSummary(await tradingApi.summary(acc.id)); } catch { /* status shows the reason */ }
    }, 5000, connected);

    const act = async (name, fn) => {
        setBusy(name); setErr('');
        try { await fn(); onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
    };
    const toggleAlgo = async () => {
        const on = !acc.settings.algo_enabled;
        if (on && !(await confirmDialog({ title: `Turn ON algo trading for ${acc.login}?`, message: 'Orders will be placed automatically from the selected indicator signals while a chart for the symbol is open.', confirmLabel: 'Turn on algo trading', danger: true }))) return;
        act('algo', () => tradingApi.update(acc.id, { settings: { algo_enabled: on } }));
    };

    const tiles = [
        ['Balance', money(summary?.balance)],
        ['Equity', money(summary?.equity)],
        ['Floating P/L', signed(summary?.floating_pnl), pnlCls(summary?.floating_pnl)],
        ['Today closed', signed(summary?.today_closed_pnl), pnlCls(summary?.today_closed_pnl)],
        ['Free margin', money(summary?.margin_free)],
        ['Margin level', summary?.margin_level ? `${Number(summary.margin_level).toFixed(0)}%` : '—'],
        ['Leverage', summary?.leverage ? `1:${summary.leverage}` : '—'],
        ['Open positions', summary?.open_positions ?? '—'],
    ];

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 md:px-6 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700 space-y-3 shrink-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-lg font-bold text-slate-800 dark:text-white tabular-nums">{acc.login}</span>
                            <StatusPill state={acc.status?.state} />
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{[acc.label, acc.server, summary?.name, cur && `Currency ${cur}`].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <label className={`flex items-center gap-2 h-8 px-3 rounded-lg border text-xs font-semibold cursor-pointer select-none ${acc.settings.algo_enabled ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                            <Power className="w-3.5 h-3.5" /> Algo {acc.settings.algo_enabled ? 'on' : 'off'}
                            <input type="checkbox" className="sr-only" checked={!!acc.settings.algo_enabled} onChange={toggleAlgo} disabled={busy === 'algo'} />
                            <span className={`relative w-7 h-4 rounded-full transition-colors ${acc.settings.algo_enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${acc.settings.algo_enabled ? 'left-3.5' : 'left-0.5'}`} />
                            </span>
                        </label>
                        {connected || ['connecting', 'starting', 'reconnecting'].includes(acc.status?.state) ? (
                            <button className={btnGhost} disabled={!!busy} onClick={() => act('conn', () => tradingApi.disconnect(acc.id))}><Unplug className="w-3.5 h-3.5" /> Disconnect</button>
                        ) : (
                            <button className={btnGhost} disabled={!!busy} onClick={() => act('conn', () => tradingApi.connect(acc.id))}><Plug className="w-3.5 h-3.5" /> Connect</button>
                        )}
                        <button className={`${btnGhost} hover:text-red-600`} disabled={!!busy} title="Remove account"
                            onClick={async () => { if (await confirmDialog({ title: `Remove account ${acc.login}?`, message: 'Its stored password is deleted from the server. Open positions stay open in MT5.', confirmLabel: 'Remove account', danger: true })) act('del', async () => { await tradingApi.remove(acc.id); onDeleted(); }); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
                {acc.status?.state === 'error' && acc.status.error && (
                    <div className="flex gap-2 text-xs p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300"><AlertTriangle className="w-4 h-4 shrink-0" />{acc.status.error}</div>
                )}
                {summary && summary.algo_trading_allowed === false && (
                    <div className="flex gap-2 text-xs p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200"><AlertTriangle className="w-4 h-4 shrink-0" />"Algo Trading" is disabled in this account's MT5 terminal — orders will be rejected until it is enabled there.</div>
                )}
                {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {tiles.map(([k, v, cls]) => (
                        <div key={k} className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700/60">
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{k}</div>
                            <div className={`text-sm font-bold tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${cls || 'text-slate-800 dark:text-slate-100'}`}>{connected ? v : '—'}</div>
                        </div>
                    ))}
                </div>
                <div className="flex gap-1 overflow-x-auto -mb-3">
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex items-center gap-1.5 px-3 h-9 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                            <t.icon className="w-3.5 h-3.5" /> {t.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
                {tab === 'positions' && <PositionsTab acc={acc} connected={connected} cur={cur} />}
                {tab === 'history' && <HistoryTab acc={acc} connected={connected} cur={cur} />}
                {tab === 'logs' && <LogsTab acc={acc} />}
                {tab === 'settings' && <SettingsTab acc={acc} onChanged={onChanged} />}
            </div>
        </div>
    );
}

const Th = ({ children, right }) => <th className={`px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
const Td = ({ children, right, cls = '' }) => <td className={`px-3 py-2 tabular-nums ${right ? 'text-right' : ''} ${cls}`}>{children}</td>;
const Empty = ({ children }) => <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">{children}</div>;

function PositionsTab({ acc, connected, cur }) {
    const [rows, setRows] = useState(null);
    const [msg, setMsg] = useState('');
    const load = async () => { try { setRows(await tradingApi.positions(acc.id)); setMsg(''); } catch (e) { setMsg(e.message); } };
    usePoll(load, 4000, connected);
    if (!connected) return <Empty>Connect the account to see open positions.</Empty>;
    if (msg && !rows) return <Empty>{msg}</Empty>;
    if (!rows) return <Empty><Loader2 className="w-4 h-4 animate-spin inline" /></Empty>;
    if (!rows.length) return <Empty>No open positions.</Empty>;
    const close = async (p) => {
        if (!(await confirmDialog({ title: 'Close position at market?', message: `${p.type.toUpperCase()} ${p.volume} ${p.symbol} (#${p.ticket}) will be closed at the current market price.`, confirmLabel: 'Close position', danger: true }))) return;
        try { await tradingApi.close(acc.id, p.ticket); load(); } catch (e) { setMsg(e.message); }
    };
    const total = rows.reduce((s, p) => s + p.profit + (p.swap || 0), 0);
    return (
        <div className="overflow-x-auto">
            {msg && <p className="text-xs text-red-600 dark:text-red-400 px-4 pt-3">{msg}</p>}
            <table className="w-full text-xs min-w-[760px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60 sticky top-0"><tr><Th>Ticket</Th><Th>Opened</Th><Th>Symbol</Th><Th>Type</Th><Th right>Volume</Th><Th right>Open</Th><Th right>Current</Th><Th right>SL</Th><Th right>TP</Th><Th right>P/L</Th><Th>Source</Th><Th /></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-200">
                    {rows.map(p => (
                        <tr key={p.ticket}>
                            <Td>{p.ticket}</Td><Td>{tsLocal(p.time)}</Td><Td cls="font-semibold">{p.symbol}</Td>
                            <Td cls={p.type === 'buy' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-red-600 dark:text-red-400 font-bold'}>{p.type.toUpperCase()}</Td>
                            <Td right>{p.volume}</Td><Td right>{p.price_open}</Td><Td right>{p.price_current || '—'}</Td><Td right>{p.sl || '—'}</Td><Td right>{p.tp || '—'}</Td>
                            <Td right cls={`font-bold ${pnlCls(p.profit)}`}>{signed(p.profit)}</Td>
                            <Td cls="text-slate-500 dark:text-slate-400">{p.magic === acc.settings.magic ? (p.comment || 'TradeSagar') : 'Other'}</Td>
                            <Td right><button className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline" onClick={() => close(p)}>Close</button></Td>
                        </tr>
                    ))}
                </tbody>
                <tfoot><tr><td colSpan={9} className="px-3 py-2 text-right text-[11px] text-slate-500">Total</td><td className={`px-3 py-2 text-right text-xs font-bold tabular-nums ${pnlCls(total)}`}>{signed(total, cur)}</td><td colSpan={2} /></tr></tfoot>
            </table>
        </div>
    );
}

function HistoryTab({ acc, connected, cur }) {
    const [days, setDays] = useState(30);
    const [data, setData] = useState(null);
    const [msg, setMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try { setData(await tradingApi.history(acc.id, days)); setMsg(''); } catch (e) { setMsg(e.message); } finally { setLoading(false); }
    }, [acc.id, days]);
    useEffect(() => { if (connected) load(); }, [connected, load]);
    if (!connected) return <Empty>Connect the account to see its trade history.</Empty>;
    const t = data?.totals;
    return (
        <div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <select value={days} onChange={e => setDays(Number(e.target.value))} className="h-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 px-2" aria-label="Period">
                    {[1, 7, 30, 90, 365].map(d => <option key={d} value={d}>{d === 1 ? 'Today' : `Last ${d} days`}</option>)}
                </select>
                <button className={btnGhost} onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
                {t && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 ml-auto">
                        <span>Trades <b className="tabular-nums">{t.closed_trades}</b></span>
                        <span>Net <b className={`tabular-nums ${pnlCls(t.net_profit)}`}>{signed(t.net_profit, cur)}</b></span>
                        <span>Win rate <b className="tabular-nums">{t.win_rate != null ? `${t.win_rate}%` : '—'}</b></span>
                        <span>Profit factor <b className="tabular-nums">{t.profit_factor ?? '—'}</b></span>
                    </div>
                )}
            </div>
            {msg && <p className="text-xs text-red-600 dark:text-red-400 px-4">{msg}</p>}
            {!data ? <Empty><Loader2 className="w-4 h-4 animate-spin inline" /></Empty> : !data.deals.length ? <Empty>No trades in this period.</Empty> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[760px]">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 sticky top-0"><tr><Th>Time</Th><Th>Deal</Th><Th>Position</Th><Th>Symbol</Th><Th>Type</Th><Th>In/Out</Th><Th right>Volume</Th><Th right>Price</Th><Th right>Commission</Th><Th right>Swap</Th><Th right>Profit</Th><Th>Comment</Th></tr></thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-200">
                            {data.deals.map(d => (
                                <tr key={d.ticket}>
                                    <Td>{tsLocal(d.time)}</Td><Td>{d.ticket}</Td><Td>{d.position_id}</Td><Td cls="font-semibold">{d.symbol}</Td>
                                    <Td cls={d.type === 'buy' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{d.type.toUpperCase()}</Td>
                                    <Td>{d.entry}</Td><Td right>{d.volume}</Td><Td right>{d.price}</Td><Td right>{d.commission ? d.commission.toFixed(2) : '—'}</Td><Td right>{d.swap ? d.swap.toFixed(2) : '—'}</Td>
                                    <Td right cls={`font-bold ${d.entry === 'in' ? 'text-slate-400' : pnlCls(d.profit)}`}>{d.entry === 'in' ? '—' : signed(d.profit)}</Td>
                                    <Td cls="text-slate-500 dark:text-slate-400 max-w-[180px] truncate">{d.comment}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

const LOG_FILTERS = { all: () => true, signal: (l) => l.kind === 'signal', trades: (l) => ['order', 'close'].includes(l.kind) || l.data?.status === 'executed', issues: (l) => l.level !== 'info' };
const LEVEL_CLS = { error: 'text-red-600 dark:text-red-400', warn: 'text-amber-600 dark:text-amber-400', info: 'text-slate-500 dark:text-slate-400' };

function LogsTab({ acc }) {
    const [logs, setLogs] = useState(null);
    const [filter, setFilter] = useState('all');
    usePoll(async () => { try { setLogs(await tradingApi.logs(acc.id, 300)); } catch { /* keep last */ } }, 5000, true);
    const rows = useMemo(() => (logs || []).filter(LOG_FILTERS[filter]), [logs, filter]);
    return (
        <div>
            <div className="flex gap-1 px-4 py-3">
                {Object.entries({ all: 'All', signal: 'Signals', trades: 'Trades', issues: 'Warnings & errors' }).map(([k, v]) => (
                    <button key={k} onClick={() => setFilter(k)} className={`h-7 px-2.5 rounded-full text-[11px] font-semibold ${filter === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>{v}</button>
                ))}
            </div>
            {!logs ? <Empty><Loader2 className="w-4 h-4 animate-spin inline" /></Empty> : !rows.length ? <Empty>Nothing logged yet.</Empty> : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {rows.map((l, i) => {
                        const st = l.data?.status;
                        return (
                            <li key={`${l.time}-${i}`} className="px-4 py-2 flex gap-3">
                                <span className="text-slate-400 tabular-nums shrink-0 w-[118px]">{new Date(l.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                <span className={`shrink-0 w-14 font-semibold uppercase text-[10px] pt-px ${st === 'executed' ? 'text-emerald-600 dark:text-emerald-400' : LEVEL_CLS[l.level]}`}>{st || l.kind}</span>
                                <span className="text-slate-700 dark:text-slate-200 break-words min-w-0">{l.message}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function SettingsTab({ acc, onChanged }) {
    const [s, setS] = useState(acc.settings);
    const [password, setPassword] = useState('');
    const [label, setLabel] = useState(acc.label || '');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const set = (k, v) => setS(p => ({ ...p, [k]: v }));
    const has = (src, sig) => s.signals.some(x => x.source === src && x.signal === sig);
    const valueOf = (src, sig, def) => s.signals.find(x => x.source === src && x.signal === sig)?.value ?? def;
    const toggleSig = (src, sig, def) => set('signals', has(src, sig) ? s.signals.filter(x => !(x.source === src && x.signal === sig)) : [...s.signals, { source: src, signal: sig, ...(def != null ? { value: def } : {}) }]);
    const setSigValue = (src, sig, v) => set('signals', s.signals.map(x => (x.source === src && x.signal === sig ? { ...x, value: v === '' ? '' : Number(v) } : x)));
    const save = async () => {
        setBusy(true); setMsg('');
        try {
            const clean = { ...s, symbols: (Array.isArray(s.symbols) ? s.symbols : String(s.symbols).split(',')).map(x => x.trim().toUpperCase()).filter(Boolean),
                timeframe: s.timeframe ? Number(s.timeframe) : null };
            for (const k of ['risk_percent', 'fixed_lot', 'max_lot', 'max_daily_loss_pct', 'max_open_positions', 'sl_atr_mult', 'tp_rr', 'magic']) clean[k] = Number(clean[k]);
            await tradingApi.update(acc.id, { settings: clean, label, ...(password ? { password } : {}) });
            setPassword('');
            setMsg('Saved');
            onChanged();
        } catch (e) { setMsg(e.message); } finally { setBusy(false); }
    };
    const num = (k, step = '0.1', min = '0') => <input type="number" step={step} min={min} value={s[k]} onChange={e => set(k, e.target.value)} className={inputCls} />;

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-3xl">
            <section className="space-y-2">
                <h4 className="text-sm font-bold text-slate-800 dark:text-white">Signals that open trades</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Checked at each candle close on any open chart for this account's symbols and timeframe. The indicator's own stop loss / target is used when it gives one.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                    {TRADABLE_SOURCES.map(([key, src]) => (
                        <div key={key} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">{src.label}{src.requiresFootprint && <span className="ml-1 font-normal text-slate-400">(footprint chart only)</span>}</div>
                            <div className="space-y-1">
                                {Object.entries(src.signals).map(([sk, sd]) => (
                                    <label key={sk} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                        <input type="checkbox" checked={has(key, sk)} onChange={() => toggleSig(key, sk, sd.needsValue ? sd.defaultValue : null)} className="rounded border-slate-300" />
                                        <span className="flex-1">{sd.label}</span>
                                        {sd.needsValue && has(key, sk) && (
                                            <input type="number" value={valueOf(key, sk, sd.defaultValue)} onChange={e => setSigValue(key, sk, e.target.value)} className="w-20 h-7 px-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" aria-label={`${sd.label} value`} />
                                        )}
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className={labelCls}>Chart symbols (comma separated, empty = any)</label>
                    <input value={Array.isArray(s.symbols) ? s.symbols.join(', ') : s.symbols} onChange={e => set('symbols', e.target.value)} placeholder="XAUUSD" className={inputCls} /></div>
                <div><label className={labelCls}>Broker symbol override</label>
                    <input value={s.trade_symbol} onChange={e => set('trade_symbol', e.target.value)} placeholder="auto (e.g. XAUUSDc)" className={inputCls} /></div>
                <div><label className={labelCls}>Chart timeframe</label>
                    <select value={s.timeframe || ''} onChange={e => set('timeframe', e.target.value)} className={inputCls}>
                        <option value="">Any timeframe</option>
                        {TIMEFRAMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select></div>
            </section>

            <section className="space-y-2">
                <h4 className="text-sm font-bold text-slate-800 dark:text-white">Position size &amp; risk</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div><label className={labelCls}>Sizing</label>
                        <select value={s.risk_mode} onChange={e => set('risk_mode', e.target.value)} className={inputCls}><option value="percent">% of equity at risk</option><option value="fixed">Fixed lot</option></select></div>
                    {s.risk_mode === 'percent'
                        ? <div><label className={labelCls}>Risk per trade (%)</label>{num('risk_percent')}</div>
                        : <div><label className={labelCls}>Fixed lot</label>{num('fixed_lot', '0.01')}</div>}
                    <div><label className={labelCls}>Max lot per order</label>{num('max_lot', '0.01')}</div>
                    <div><label className={labelCls}>Max daily loss (%)</label>{num('max_daily_loss_pct')}</div>
                    <div><label className={labelCls}>Max open positions</label>{num('max_open_positions', '1', '1')}</div>
                    <div><label className={labelCls}>Stop loss if none (× ATR14)</label>{num('sl_atr_mult')}</div>
                    <div><label className={labelCls}>Target if none (× stop)</label>{num('tp_rr')}</div>
                    <div><label className={labelCls}>Magic number</label>{num('magic', '1', '1')}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 pt-1">
                    <input type="checkbox" checked={!!s.close_on_opposite} onChange={e => set('close_on_opposite', e.target.checked)} className="rounded border-slate-300" />
                    Close the open position when an opposite signal arrives
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Lot size = equity × risk % ÷ (stop distance × the broker's value per tick), rounded down to the lot step and capped by "Max lot". On cent accounts balances are in cents (USC).</p>
            </section>

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Label</label><input value={label} onChange={e => setLabel(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>New password (only to change it)</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className={inputCls} /></div>
            </section>

            <div className="flex items-center gap-3 sticky bottom-0 py-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
                <button className={`${btnPrimary} h-9`} onClick={save} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Save settings</button>
                {msg && <span className={`text-xs ${msg === 'Saved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{msg}</span>}
            </div>
        </div>
    );
}
