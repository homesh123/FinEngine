import React, { useEffect, useState } from 'react';
import { X, Share } from 'lucide-react';

// First visit: offer to install TradeSagar as an app (phone and desktop).
// Chrome / Edge / Android: our card, then the browser's own install confirmation.
// iPhone / iPad Safari (no install API): how to add it to the Home Screen.
// Shown once per browser — never again after Install, Not now or ✕ — and never
// inside the installed app.
const KEY = 'ts_install_prompt_v1';
const SHOW_AFTER_MS = 6000;

const seen = () => { try { return !!localStorage.getItem(KEY); } catch { return true; } };
const mark = (v) => { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } };
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function InstallPrompt() {
    const [deferred, setDeferred] = useState(null);   // beforeinstallprompt event
    const [mode, setMode] = useState(null);           // 'prompt' | 'ios' | null

    useEffect(() => {
        if (standalone() || seen()) return undefined;
        let timer = null;
        const onBip = (e) => {
            window.__tsInstallEvent = null;
            e.preventDefault();                       // we show our own card first
            setDeferred(e);
            clearTimeout(timer);
            timer = setTimeout(() => setMode('prompt'), SHOW_AFTER_MS);
        };
        const onInstalled = () => { mark('installed'); setMode(null); };
        window.addEventListener('beforeinstallprompt', onBip);
        window.addEventListener('appinstalled', onInstalled);
        if (window.__tsInstallEvent) onBip(window.__tsInstallEvent);   // fired before we mounted
        else if (isIos()) timer = setTimeout(() => setMode('ios'), SHOW_AFTER_MS);
        return () => { clearTimeout(timer); window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('appinstalled', onInstalled); };
    }, []);

    if (!mode) return null;
    const close = (v) => { mark(v); setMode(null); };
    const install = async () => {
        if (!deferred) return close('dismissed');
        deferred.prompt();                            // browser's confirmation dialog
        const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
        setDeferred(null);
        close(outcome === 'accepted' ? 'installed' : 'dismissed');
    };

    return (
        <div role="dialog" aria-label="Install TradeSagar"
            className="fixed z-[300] bottom-3 inset-x-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[360px] rounded-2xl border border-white/60 dark:border-slate-700/80 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl shadow-2xl p-3.5 ts-pop-in">
            <div className="flex items-start gap-3">
                <img src="/favicon-512.png" alt="" width="44" height="44" className="rounded-xl shadow-sm shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900 dark:text-white">Install TradeSagar</div>
                    {mode === 'prompt' ? (
                        <p className="mt-0.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">Open live charts in one tap, full screen, like an app. Free, no store needed.</p>
                    ) : (
                        <p className="mt-0.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
                            Tap <Share size={14} className="inline -mt-0.5 text-[#007aff]" aria-label="Share" /> in Safari, then <b className="font-semibold text-slate-800 dark:text-slate-100">Add to Home Screen</b>.
                        </p>
                    )}
                </div>
                <button type="button" onClick={() => close('dismissed')} aria-label="Close"
                    className="-mr-1 -mt-1 w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"><X size={16} /></button>
            </div>
            <div className="mt-3 flex justify-end gap-2">
                {mode === 'prompt' ? (<>
                    <button type="button" onClick={() => close('dismissed')}
                        className="px-3.5 py-2 rounded-xl text-[13px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.97] transition-transform">Not now</button>
                    <button type="button" onClick={install}
                        className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-[#007aff] hover:bg-[#0062cc] active:scale-[0.97] transition-transform shadow-sm">Install</button>
                </>) : (
                    <button type="button" onClick={() => close('dismissed')}
                        className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-[#007aff] hover:bg-[#0062cc] active:scale-[0.97] transition-transform shadow-sm">Got it</button>
                )}
            </div>
        </div>
    );
}
