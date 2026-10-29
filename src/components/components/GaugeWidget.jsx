import React from 'react';

// Zones use the same thresholds as the Traders Interest "Trend" row
// (±10 / ±40) so the gauge and the table never disagree.
const ZONES = [
    { from: -100, to: -40, label: 'Strong Sell', color: '#f23645' },
    { from: -40,  to: -10, label: 'Weak Sell',   color: '#f7525f' },
    { from: -10,  to: 10,  label: 'Neutral',     color: '#787b86' },
    { from: 10,   to: 40,  label: 'Weak Buy',    color: '#26a69a' },
    { from: 40,   to: 100, label: 'Strong Buy',  color: '#089981' },
];

const CX = 100;
const CY = 100;
const R = 78;
const STROKE = 10;
const GAP_DEG = 1.6; // gap between segments

// score (-100..100) → angle in degrees from vertical (-90 = left, 90 = right)
const toAngle = (score) => (Math.max(-100, Math.min(100, score)) / 100) * 90;

const polar = (deg, r = R) => {
    const rad = (deg * Math.PI) / 180;
    return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
};

const arcPath = (fromDeg, toDeg) => {
    const [x1, y1] = polar(fromDeg);
    const [x2, y2] = polar(toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
};

// Same comparisons as TradersInterestWidget's trendLabel
export const zoneFor = (score) => {
    if (score > 40) return ZONES[4];
    if (score > 10) return ZONES[3];
    if (score < -40) return ZONES[0];
    if (score < -10) return ZONES[1];
    return ZONES[2];
};

export default function GaugeWidget({ score = 0, symbol, compact = false, svgOnly = false }) {
    const value = Number.isFinite(score) ? score : 0;
    const zone = zoneFor(value);
    const angle = toAngle(value);
    const signed = `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
    const gauge = (className) => (
    <svg viewBox="0 0 200 118" className={className} role="img"
         aria-label={`Traders interest ${zone.label}, score ${signed}`}>
        {ZONES.map(z => {
            const active = z === zone;
            return (
                <path
                    key={z.label}
                    d={arcPath(toAngle(z.from) + GAP_DEG / 2, toAngle(z.to) - GAP_DEG / 2)}
                    fill="none"
                    stroke={z.color}
                    strokeWidth={STROKE}
                    strokeLinecap="butt"
                    opacity={active ? 1 : 0.22}
                    style={{ transition: 'opacity 0.3s ease' }}
                />
            );
        })}

        {/* Minor ticks every 10 points, just inside the arc */}
        {Array.from({ length: 21 }, (_, i) => {
            const deg = -90 + i * 9;
            const major = i % 5 === 0;
            const [x1, y1] = polar(deg, R - STROKE / 2 - 3);
            const [x2, y2] = polar(deg, R - STROKE / 2 - (major ? 8 : 5));
            return (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={major ? 1.2 : 0.8}
                      className="stroke-slate-300 dark:stroke-slate-600" />
            );
        })}

        {/* End labels */}
        <text x={CX - R} y={CY + 14} textAnchor="middle" fontSize="8.5" className="fill-slate-400 dark:fill-slate-500">Sell</text>
        <text x={CX + R} y={CY + 14} textAnchor="middle" fontSize="8.5" className="fill-slate-400 dark:fill-slate-500">Buy</text>

        {/* Needle */}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: 'transform 0.6s cubic-bezier(.22,1,.36,1)' }}>
            <polygon points={`${CX - 2.4},${CY} ${CX},${CY - (R - STROKE - 6)} ${CX + 2.4},${CY}`}
                     className="fill-slate-700 dark:fill-slate-200" />
        </g>
        <circle cx={CX} cy={CY} r="6" className="fill-white dark:fill-cardbg" stroke={zone.color} strokeWidth="2.5" />
    </svg>
    );

    // Just the dial (the sidebar's Traders Interest card lays out its own text)
    if (svgOnly) return gauge('w-[104px] shrink-0 block');

    // Sidebar: one row — small gauge left, rating right (~80px tall instead of ~200px)
    if (compact) {
        return (
            <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg">
                {gauge('w-[112px] shrink-0 block')}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-500 dark:text-slate-400">Traders Interest</span>
                        {symbol && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 dark:border-borderdark text-slate-500 dark:text-slate-400 truncate">{symbol}</span>}
                    </div>
                    <div className="text-sm font-semibold tracking-tight brightness-[.62] dark:brightness-100 leading-tight mt-0.5" style={{ color: zone.color }}>{zone.label}</div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">Score {signed}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 pt-3 pb-4 border-b border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg">
            {/* Header */}
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-500 dark:text-slate-400">
                    Traders Interest
                </span>
                {symbol && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 dark:border-borderdark text-slate-500 dark:text-slate-400">
                        {symbol}
                    </span>
                )}
            </div>

            {/* Gauge */}
            {gauge('w-full max-w-[220px] mx-auto block')}

            {/* Readout */}
            <div className="flex flex-col items-center -mt-1">
                <span className="text-base font-semibold tracking-tight brightness-[.62] dark:brightness-100" style={{ color: zone.color }}>
                    {zone.label}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    Score {signed}
                </span>
            </div>
        </div>
    );
}
