import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { subscribeConfirm, currentConfirm, settleConfirm } from '../utils/confirmDialog';

// Renders confirmDialog() requests: themed modal, Enter = confirm, Escape or
// clicking outside = cancel, focus on the safe button for destructive actions.
export default function ConfirmHost({ dark }) {
    const [req, setReq] = useState(currentConfirm());
    const cancelRef = useRef(null), okRef = useRef(null);

    useEffect(() => subscribeConfirm(() => setReq(currentConfirm())), []);

    useEffect(() => {
        if (!req) return;
        (req.danger ? cancelRef : okRef).current?.focus();
        // Capture phase + stopImmediatePropagation: the dialog handles Escape/Enter
        // first, so panels underneath (e.g. Indicators) don't also close
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); settleConfirm(false); }
            if (e.key === 'Enter' && !req.danger) { e.preventDefault(); e.stopImmediatePropagation(); settleConfirm(true); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [req]);

    if (!req) return null;
    const Icon = req.danger ? AlertTriangle : HelpCircle;
    return createPortal(
        <div className={dark ? 'dark' : undefined}>
            <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] ts-scrim-in"
                onMouseDown={(e) => { if (e.target === e.currentTarget) settleConfirm(false); }}>
                <div role="alertdialog" aria-modal="true" aria-labelledby="ts-confirm-title"
                    className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl ts-pop-in">
                    <div className="flex gap-3 p-5">
                        <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${req.danger ? 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'}`}>
                            <Icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                            <h2 id="ts-confirm-title" className="text-sm font-bold text-slate-900 dark:text-white">{req.title}</h2>
                            {req.message && <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-line">{req.message}</p>}
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 px-5 pb-5">
                        <button ref={cancelRef} type="button" onClick={() => settleConfirm(false)}
                            className="h-9 px-4 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                            {req.cancelLabel || 'Cancel'}
                        </button>
                        <button ref={okRef} type="button" onClick={() => settleConfirm(true)}
                            className={`h-9 px-4 rounded-lg text-xs font-semibold text-white focus:outline-none focus:ring-2 ${req.danger ? 'bg-red-600 hover:bg-red-500 focus:ring-red-500/50' : 'bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-500/50'}`}>
                            {req.confirmLabel || 'OK'}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
