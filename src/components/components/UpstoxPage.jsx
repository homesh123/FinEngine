// /upstox: owner-only Upstox connection (see INDIA_ALGO_TRADING.md, tasks A1/B1).
// The login is started with the trading token (TRADING_API_TOKEN), so a visitor can never
// replace the owner's Upstox session. Upstox tokens expire at 03:30 IST: log in once each morning.
import React, { useCallback, useEffect, useState } from 'react';
import { X, LogIn, LogOut, KeyRound, CheckCircle2, AlertTriangle, LineChart } from 'lucide-react';
import { getTradeToken, setTradeToken } from '../utils/tradingApi';

const btn = 'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md text-sm font-semibold disabled:opacity-50';
const input = 'w-full h-9 px-3 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500';

async function call(path, method = 'GET') {
    const res = await fetch(`/api/upstox${path}`, { method, headers: { 'X-Trade-Token': getTradeToken() } });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw Object.assign(new Error(data?.detail || `Request failed (${res.status})`), { status: res.status });
    return data;
}

const fmtExpiry = (iso) => {
    try { return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST'; }
    catch { return iso; }
};

// Trading with a broker connected is a Pro-mode feature: switch Pro on and load the chart fresh
// (a full load keeps the non-Pro ad script out; useProMode reads the flag at start-up).
function openProCharts() {
    try { localStorage.setItem('promode', 'true'); } catch { /* storage unavailable */ }
    window.location.assign('/');
}

export default function UpstoxPage({ onClose, dark = false }) {
    const params = new URLSearchParams(window.location.search);
    const [token, setToken] = useState(getTradeToken());
    const [val, setVal] = useState('');
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(params.get('error') ? { err: true, text: params.get('error') }
        : params.get('connected') ? { err: false, text: 'Upstox connected.' } : null);

    const refresh = useCallback(async () => {
        try { setStatus(await call('/status')); } catch (e) { setMsg({ err: true, text: e.message }); }
    }, []);
    useEffect(() => { refresh(); }, [refresh, token]);
    useEffect(() => {   // fresh login: show "Connected" briefly, then back to the chart
        if (!params.get('connected')) return undefined;
        const t = setTimeout(openProCharts, 1500);
        return () => clearTimeout(t);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {   // drop ?connected / ?error from the address bar once shown
        if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname);
    }, []);

    const login = async () => {
        setBusy(true); setMsg(null);
        try { window.location.href = (await call('/login-url', 'POST')).url; }
        catch (e) {
            if (e.status === 401) { setTradeToken(''); setToken(''); }
            setMsg({ err: true, text: e.status === 401 ? 'Trading token is wrong.' : e.message });
            setBusy(false);
        }
    };
    const logout = async () => {
        setBusy(true); setMsg(null);
        try { await call('/logout', 'POST'); await refresh(); setMsg({ err: false, text: 'Disconnected from Upstox.' }); }
        catch (e) { setMsg({ err: true, text: e.message }); }
        setBusy(false);
    };

    const owner = !!token;
    const connected = status?.connected;
    return (
        <div className="fixed inset-0 z-[300] flex flex-col bg-white dark:bg-slate-900 ts-sheet-in" role="main" aria-label="Upstox connection">
            <div className="flex items-center justify-between px-4 h-12 border-b border-slate-200 dark:border-slate-800">
                <div className="font-bold text-slate-800 dark:text-white">Upstox (Indian stocks)</div>
                <button onClick={onClose} className="p-2 rounded hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="Close"><X className="w-5 h-5 text-slate-600 dark:text-slate-300" /></button>
            </div>
            <div className="flex-1 overflow-y-auto flex items-start md:items-center justify-center p-6">
                <div className="w-full max-w-md space-y-4">
                    {msg && (
                        <div className={`flex gap-2 items-start text-sm rounded-md p-3 ${msg.err ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                            {msg.err ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}<span>{msg.text}</span>
                        </div>
                    )}
                    {!owner ? (
                        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (val.trim()) { setTradeToken(val.trim()); setToken(val.trim()); } }}>
                            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-white"><KeyRound className="w-5 h-5 text-indigo-500" /> Owner only</div>
                            <p className="text-sm text-slate-600 dark:text-slate-300">Enter the trading token (<code>TRADING_API_TOKEN</code> from <code>backend/.env.local</code>). It is remembered in this browser only.</p>
                            <input type="password" autoComplete="off" className={input} value={val} onChange={e => setVal(e.target.value)} placeholder="Trading token" aria-label="Trading token" />
                            <button type="submit" disabled={!val.trim()} className={`${btn} w-full bg-indigo-600 text-white hover:bg-indigo-700`}>Continue</button>
                        </form>
                    ) : (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                            <div className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                <span className="font-semibold text-slate-800 dark:text-white">{status == null ? 'Checking…' : connected ? `Connected${status.user_name ? ` as ${status.user_name}` : ''}` : 'Not connected'}</span>
                            </div>
                            {connected && status.expires_at && <p className="text-sm text-slate-600 dark:text-slate-300">Session valid until {fmtExpiry(status.expires_at)}. Upstox requires a fresh login every day.</p>}
                            {!connected && <p className="text-sm text-slate-600 dark:text-slate-300">Log in once each trading day, before 09:15 IST. Orders are sent only from the server's registered static IP.</p>}
                            <div className="flex flex-wrap gap-2">
                                {connected && <button onClick={openProCharts} autoFocus className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.97] transition-transform`}><LineChart className="w-4 h-4" /> Open charts</button>}
                                {connected
                                    ? <button onClick={logout} disabled={busy} className={`${btn} bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700`}><LogOut className="w-4 h-4" /> Disconnect</button>
                                    : <button onClick={login} disabled={busy} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}><LogIn className="w-4 h-4" /> Login with Upstox</button>}
                                <button onClick={() => { setTradeToken(''); setToken(''); }} className={`${btn} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`} title="Forget the trading token in this browser">Forget token</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
