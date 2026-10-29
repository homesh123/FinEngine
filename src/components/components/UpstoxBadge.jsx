// Upstox account badge on the chart toolbar (owner only): green dot + name when connected, with a small menu
// (session expiry, trading dashboard, Upstox page, log out); "Connect Upstox" when not connected. Hidden for normal visitors.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, ExternalLink, LayoutDashboard, Layers } from 'lucide-react';
import { useBrokerSession } from '../hooks/useBrokerSession';
import { getTradeToken } from '../utils/tradingApi';
import { navigate } from '../utils/route';
import { confirmDialog } from '../utils/confirmDialog';
import { useProMode } from '../hooks/useProMode';

const fmt = (iso) => {
    try { return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) + ' IST'; }
    catch { return ''; }
};

export default function UpstoxBadge({ compact = false }) {
    const s = useBrokerSession();
    const { isProMode } = useProMode();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const btnRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, right: 0 });

    useEffect(() => {
        if (!open) return undefined;
        const r = btnRef.current?.getBoundingClientRect();
        if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
        const close = (e) => { if (!e.target.closest?.('[data-upstox-menu]')) setOpen(false); };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', esc);
        return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
    }, [open]);

    if (!s.owner || !isProMode) return null;

    const base = 'flex items-center gap-1.5 h-7 rounded-lg border text-xs font-semibold shrink-0 transition-[transform,background-color] duration-100 active:scale-[0.97]';
    if (!s.connected) {
        return (
            <button onClick={() => navigate('/upstox')} title="Log in to Upstox for Indian stocks"
                className={`${base} px-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}>
                <span className="w-2 h-2 rounded-full bg-slate-400" />{compact ? 'Upstox' : 'Connect Upstox'}
            </button>
        );
    }

    const logout = async () => {
        setOpen(false);
        if (!(await confirmDialog({ title: 'Log out of Upstox?', message: 'Indian stock data and trading stop until you log in again.', confirmLabel: 'Log out', danger: true }))) return;
        setBusy(true);
        try { await fetch('/api/upstox/logout', { method: 'POST', headers: { 'X-Trade-Token': getTradeToken() } }); }
        finally { setBusy(false); s.refresh(); }
    };
    const first = (s.user || 'Upstox').split(' ')[0];
    const initials = (s.user || 'U').split(' ').map(w => w[0]).slice(0, 2).join('');

    return (
        <>
            <button ref={btnRef} onClick={() => setOpen(o => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open}
                title={`Upstox connected${s.user ? ` as ${s.user}` : ''}`}
                className={`${base} pl-1 pr-2 border-emerald-300/70 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/20`}>
                <span className="relative flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[9px] font-bold">
                    {initials}
                    <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900" />
                </span>
                {!compact && <span className="max-w-[90px] truncate">{first}</span>}
            </button>
            {open && createPortal(
                <div data-upstox-menu role="menu" style={{ top: pos.top, right: pos.right }}
                    className="fixed z-[400] w-60 rounded-xl border border-white/40 dark:border-white/10 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl shadow-2xl p-1.5 ts-sheet-in">
                    <div className="px-2.5 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Upstox · Indian stocks</div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{s.user || 'Connected'}</div>
                        {s.expiresAt && <div className="text-[11px] text-slate-500 dark:text-slate-400">Session until {fmt(s.expiresAt)}</div>}
                    </div>
                    <div className="h-px bg-slate-200/70 dark:bg-white/10 my-1" />
                    <button role="menuitem" onClick={() => { setOpen(false); navigate('/india'); }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10">
                        <LayoutDashboard className="w-4 h-4" /> Trading dashboard
                    </button>
                    <button role="menuitem" onClick={() => { setOpen(false); navigate('/options'); }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10">
                        <Layers className="w-4 h-4" /> Option chain
                    </button>
                    <button role="menuitem" onClick={() => { setOpen(false); navigate('/upstox'); }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10">
                        <ExternalLink className="w-4 h-4" /> Upstox connection
                    </button>
                    <button role="menuitem" onClick={logout}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10">
                        <LogOut className="w-4 h-4" /> Log out
                    </button>
                </div>, document.body)}
        </>
    );
}
