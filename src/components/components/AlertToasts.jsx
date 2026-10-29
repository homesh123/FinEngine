import React, { useEffect, useRef, useState } from 'react';
import { X, AlarmClock } from 'lucide-react';
import { ALERT_TOAST_EVENT } from '../utils/alerts/alertDelivery';

const MAX_TOASTS = 4;
const TOAST_MS = 10000;

/** In-app pop-ups for fired alerts (bottom-right; at most 4, each closes after 10s). */
export default function AlertToasts() {
    const [toasts, setToasts] = useState([]);
    const timersRef = useRef(new Map());   // toast id → timeout
    const dismissRef = useRef(() => {});

    useEffect(() => {
        const timers = timersRef.current;
        const dismiss = (id) => {
            clearTimeout(timers.get(id));
            timers.delete(id);
            setToasts(prev => prev.filter(t => t.id !== id));
        };
        const onAlert = (e) => {
            const t = e.detail;
            if (!t || timers.has(t.id)) return;
            setToasts(prev => {
                const next = [...prev, t];
                // Drop the oldest beyond the limit (and its timer)
                while (next.length > MAX_TOASTS) {
                    const old = next.shift();
                    clearTimeout(timers.get(old.id));
                    timers.delete(old.id);
                }
                return next;
            });
            timers.set(t.id, setTimeout(() => dismiss(t.id), TOAST_MS));
        };
        window.addEventListener(ALERT_TOAST_EVENT, onAlert);
        dismissRef.current = dismiss;
        return () => {
            window.removeEventListener(ALERT_TOAST_EVENT, onAlert);
            timers.forEach(clearTimeout);
            timers.clear();
        };
    }, []);

    if (!toasts.length) return null;
    return (
        <div className="fixed bottom-14 right-3 z-[350] flex flex-col gap-2 w-[300px] max-w-[calc(100vw-24px)] pointer-events-none">
            {toasts.map(t => (
                <div key={t.id} role="status"
                    className={`pointer-events-auto rounded-lg shadow-xl border bg-white dark:bg-slate-900 p-3 border-l-4 ts-toast-in ${t.side === 'buy' ? 'border-l-emerald-500' : t.side === 'sell' ? 'border-l-red-500' : 'border-l-indigo-500'} border-slate-200 dark:border-slate-700`}>
                    <div className="flex items-start gap-2">
                        <AlarmClock size={14} className="mt-0.5 text-indigo-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{t.title}</div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 break-words whitespace-pre-wrap">{t.message}</div>
                        </div>
                        <button type="button" aria-label="Dismiss" onClick={() => dismissRef.current(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white"><X size={13} /></button>
                    </div>
                </div>
            ))}
        </div>
    );
}
