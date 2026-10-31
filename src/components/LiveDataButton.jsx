import React, { useEffect, useState } from 'react';
import { Radio, X } from 'lucide-react';
import { getApiBase, setApiBase, testApiBase } from '../utils/dataSource';

/** Current live API URL, kept in sync when the setting changes. */
export function useLiveApiBase() {
    const [base, setBase] = useState(getApiBase);
    useEffect(() => {
        const on = () => setBase(getApiBase());
        window.addEventListener('live-api-changed', on);
        return () => window.removeEventListener('live-api-changed', on);
    }, []);
    return base;
}

/** Header button: shows Live / Snapshot and opens the live API setting. */
export default function LiveDataButton({ source }) {
    const base = useLiveApiBase();
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState(base);
    const [test, setTest] = useState(null);   // {ok, text}
    const live = source === 'live';

    useEffect(() => { if (open) { setUrl(base); setTest(null); } }, [open, base]);

    const save = async () => {
        if (!url.trim()) { setApiBase(''); setOpen(false); return; }
        setTest({ ok: null, text: 'Testing…' });
        try {
            await testApiBase(url);
            setApiBase(url);
            setTest({ ok: true, text: 'Connected.' });
            setOpen(false);
        } catch (e) {
            setTest({ ok: false, text: `Can't reach ${url.trim()}/api/health (${e.message}). Is the server running, on HTTPS, and sending CORS headers?` });
        }
    };

    return (
        <div className="relative">
            <button onClick={() => setOpen(o => !o)} title={live ? `Live data from ${base}` : 'Using the published snapshot — click to connect live data'}
                className={`flex items-center justify-center gap-1.5 min-w-[44px] h-11 sm:h-8 px-2.5 rounded-lg border text-xs font-semibold ${live
                    ? 'border-green-300 text-green-700 bg-green-50 dark:border-green-500/40 dark:text-green-400 dark:bg-green-500/10'
                    : 'border-slate-200 dark:border-borderdark text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surfacebg'}`}>
                <Radio size={13} className={live ? 'animate-pulse' : ''} /><span className="hidden sm:inline">{live ? 'Live' : 'Snapshot'}</span>
            </button>
            {open && (
                <div className="absolute right-0 top-10 z-50 w-[min(92vw,380px)] rounded-xl border border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg shadow-xl p-4 text-sm">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-bold text-slate-800 dark:text-white">Live data</h3>
                        <button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X size={16} /></button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                        Browsers can't read Yahoo Finance directly (no CORS), so live prices come through the FinEngine live API
                        (<code>server/live_api.py</code>) running on a server you control. Without it the site uses the snapshot
                        GitHub Actions publishes.
                    </p>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Live API URL</label>
                    <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-finengine-api.example.com"
                        className="w-full rounded-lg border border-slate-200 dark:border-borderdark bg-white dark:bg-surfacebg px-2.5 py-2 text-sm font-mono" />
                    {test && <p className={`mt-2 text-xs ${test.ok === false ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>{test.text}</p>}
                    <div className="mt-3 flex gap-2 justify-end">
                        {base && <button onClick={() => { setApiBase(''); setOpen(false); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-surfacebg">Use snapshot</button>}
                        <button onClick={save} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">Connect</button>
                    </div>
                </div>
            )}
        </div>
    );
}
