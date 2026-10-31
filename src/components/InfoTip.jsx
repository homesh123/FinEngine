import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

const WIDTH = 280;

/**
 * Small "i" icon that explains a metric in plain language.
 * Opens on hover, keyboard focus, or tap (mobile); closes on Escape, outside
 * tap, scroll or resize. Uses fixed positioning so table scroll containers
 * don't clip it.
 */
export default function InfoTip({ title, children, label }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const btnRef = useRef(null);
    const tipId = useId();

    const place = useCallback(() => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
        setPos({ top: r.bottom + 6, left });
    }, []);

    const show = () => { place(); setOpen(true); };
    const hide = () => setOpen(false);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') hide(); };
        const onDown = (e) => { if (!btnRef.current?.contains(e.target)) hide(); };
        window.addEventListener('keydown', onKey);
        window.addEventListener('pointerdown', onDown);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('pointerdown', onDown);
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('resize', hide);
        };
    }, [open]);

    return (
        <span className="inline-flex align-middle normal-case tracking-normal">
            <button
                ref={btnRef}
                type="button"
                aria-label={label || `What is ${title}?`}
                aria-describedby={open ? tipId : undefined}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
                // Hover/focus already open it, so a click/tap only opens (never
                // toggles closed); it closes on leave, outside tap, scroll or Escape.
                onClick={(e) => { e.stopPropagation(); show(); }}
                className="relative z-10 ml-1 p-0.5 rounded-full text-slate-400 before:absolute before:-inset-3.5 before:content-[''] hover:text-indigo-500 dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
                <Info size={12} strokeWidth={2.25} />
            </button>
            {open && (
                <span
                    id={tipId}
                    role="tooltip"
                    style={{ position: 'fixed', top: pos.top, left: pos.left, width: WIDTH, zIndex: 60 }}
                    className="block text-left font-normal text-xs leading-relaxed p-3 rounded-lg shadow-xl border bg-white text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700"
                >
                    <span className="block font-semibold text-slate-800 dark:text-slate-100 mb-1">{title}</span>
                    {children}
                </span>
            )}
        </span>
    );
}
