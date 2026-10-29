import React, { useEffect, useRef } from 'react';
import { RotateCcw, Copy, BellPlus, Minus, Trash2, Eraser, Layers, Camera } from 'lucide-react';

// Right-click menu on the chart. `items` = [{ label, icon, onClick, danger?, disabled?, hint? } | 'sep'].
// Positioned inside the chart (flips left/up near the edges); closes on outside
// click, Escape, scroll or resize.
const ICONS = { RotateCcw, Copy, BellPlus, Minus, Trash2, Eraser, Layers, Camera };

export default function ChartContextMenu({ x, y, bounds, items, onClose }) {
    const ref = useRef(null);

    useEffect(() => {
        const close = (e) => { if (!ref.current || !ref.current.contains(e.target)) onClose(); };
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('pointerdown', close, true);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onClose);
        window.addEventListener('wheel', onClose, { passive: true });
        return () => {
            document.removeEventListener('pointerdown', close, true);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('wheel', onClose);
        };
    }, [onClose]);

    // Keep the menu inside the chart
    const W = 230, H = items.length * 30 + 12;
    const left = x + W > bounds.width ? Math.max(4, x - W) : x;
    const top = y + H > bounds.height ? Math.max(4, y - H) : y;

    return (
        <div ref={ref} role="menu" onContextMenu={(e) => e.preventDefault()}
            className="absolute z-[80] w-[230px] py-1.5 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 bg-white/98 dark:bg-slate-900/98 backdrop-blur text-xs ts-pop-in"
            style={{ left, top }}>
            {items.map((it, i) => {
                if (it === 'sep') return <div key={i} className="my-1 h-px bg-slate-200 dark:bg-slate-700" />;
                const Icon = ICONS[it.icon] || Minus;
                return (
                    <button key={i} type="button" role="menuitem" disabled={it.disabled}
                        onClick={() => { onClose(); it.onClick(); }}
                        className={`w-full flex items-center gap-2.5 px-3 h-[30px] text-left transition-colors disabled:opacity-40 disabled:pointer-events-none ${it.danger ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                        <Icon className="w-3.5 h-3.5 shrink-0 opacity-80" />
                        <span className="flex-1 truncate">{it.label}</span>
                        {it.hint && <span className="text-[10px] text-slate-400">{it.hint}</span>}
                    </button>
                );
            })}
        </div>
    );
}
