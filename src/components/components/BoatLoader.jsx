import React, { useId } from 'react';

// Loading indicator: the TradeSagar boat riding two drifting waves.
// Pure SVG + CSS transforms (GPU-composited, no JS per frame); with
// "reduce motion" on it shows the still logo (index.css rule).
const wave = (y) => `M0 ${y}` + ' q4 -2.6 8 0 t8 0'.repeat(18);   // 16-unit wavelength, longer than the view so it can slide

export default function BoatLoader({ size = 56, label = null, className = '' }) {
    const id = useId().replace(/:/g, '');
    return (
        <div role="status" aria-label="Loading" className={`flex flex-col items-center gap-2 ${className}`}>
            <svg width={size} height={size * 1.1} viewBox="28 14 84 92" aria-hidden="true" className="overflow-visible">
                <defs>
                    <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#6366f1" /><stop offset="1" stopColor="#7c3aed" />
                    </linearGradient>
                    {/* fade the waves out at both ends */}
                    <linearGradient id={`${id}f`}>
                        <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".25" stopColor="#fff" />
                        <stop offset=".75" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
                    </linearGradient>
                    <mask id={`${id}m`}><rect x="28" y="80" width="84" height="26" fill={`url(#${id}f)`} /></mask>
                </defs>
                <g className="ts-boat">
                    <polygon points="68,20 68,66 40,66" fill={`url(#${id}s)`} />
                    <polygon points="76,32 76,66 100,66" fill="#10b981" />
                    <polygon points="38,72 102,72 94,84 46,84" className="fill-slate-900 dark:fill-white" />
                </g>
                <g mask={`url(#${id}m)`} fill="none" strokeLinecap="round">
                    <path d={wave(90)} className="ts-wave ts-wave-a" stroke="#6366f1" strokeWidth="2.2" />
                    <path d={wave(97)} className="ts-wave ts-wave-b" stroke="#10b981" strokeWidth="1.8" opacity=".55" />
                </g>
            </svg>
            {label && <span className="text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">{label}</span>}
        </div>
    );
}
