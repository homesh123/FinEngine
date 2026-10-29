import React from 'react';
import { Plus, X } from 'lucide-react';

const TF_LABELS = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 45: '45m', 60: '1H', 240: '4H', 1440: '1D' };
const tfLabel = (tf) => TF_LABELS[tf] || `${tf}m`;

// Circular mandala logo: concentric rings with radial petals.
function MandalaIcon({ className }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6.6" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map(a => {
                const r = (a * Math.PI) / 180;
                return (
                    <line
                        key={a}
                        x1={12 + Math.cos(r) * 6.6}
                        y1={12 + Math.sin(r) * 6.6}
                        x2={12 + Math.cos(r) * 9.4}
                        y2={12 + Math.sin(r) * 9.4}
                    />
                );
            })}
        </svg>
    );
}

// Nazar boncuk — evil eye amulet protecting the charts 👁️
function NazarIcon({ className }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            {/* outer blue */}
            <circle cx="12" cy="12" r="10" fill="#1a4fff" />
            {/* white ring */}
            <circle cx="12" cy="12" r="7.2" fill="#ffffff" />
            {/* light-blue iris */}
            <circle cx="12" cy="12" r="5.2" fill="#5db8ff" />
            {/* dark pupil */}
            <circle cx="12" cy="12" r="2.8" fill="#050a14" />
            {/* highlight */}
            <circle cx="13.2" cy="10.6" r="1.1" fill="rgba(255,255,255,0.88)" />
            {/* 8 tiny gold dots orbiting */}
            {Array.from({length:8},(_,k)=>{
                const a = k * Math.PI / 4;
                return <circle key={k} cx={12+Math.cos(a)*11.5} cy={12+Math.sin(a)*11.5} r="0.7" fill="#ffd750" opacity="0.8" />;
            })}
        </svg>
    );
}

const openMeditation = () => {
    const w = Math.min(1280, window.screen.availWidth);
    const h = Math.min(900, window.screen.availHeight);
    const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
    const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
    window.open(
        '/mandala',
        'meditation-mandala',
        `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener,noreferrer`
    );
};

/**
 * Chart tabs (like browser tabs): each tab is an independent chart with its
 * own symbol, timeframe, layout, indicators, settings and drawings. Background
 * tabs keep running so their notifications still fire.
 */
export default function ChartTabsBar({ tabs, activeId, max, onSelect, onAdd, onClose }) {
    const canAdd = tabs.length < max;
    return (
        <div className="flex items-center gap-1 px-2 h-8 shrink-0 bg-slate-50 dark:bg-panelbg border-b border-slate-200/80 dark:border-borderdark">
            <div className="flex items-center gap-1 flex-1 min-w-0 h-full py-1 overflow-x-auto no-scrollbar">
                {tabs.map(({ id, symbol, timeframe }) => {
                    const active = id === activeId;
                    return (
                        <div
                            key={id}
                            role="tab"
                            aria-selected={active}
                            tabIndex={0}
                            onClick={() => onSelect(id)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(id); }}
                            onAuxClick={e => { if (e.button === 1 && tabs.length > 1) onClose(id); }}
                            title={`${symbol} · ${tfLabel(timeframe)}`}
                            className={`group flex items-center gap-1.5 h-6 pl-2.5 pr-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer select-none transition-colors border ${
                                active
                                    ? 'bg-white dark:bg-cardbg text-indigo-600 dark:text-indigo-300 border-slate-200 dark:border-slate-700 shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60'
                            }`}
                        >
                            <span>{symbol}</span>
                            <span className={`font-medium ${active ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400/80 dark:text-slate-500/80'}`}>{tfLabel(timeframe)}</span>
                            {tabs.length > 1 ? (
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); onClose(id); }}
                                    title="Close tab"
                                    aria-label={`Close ${symbol} tab`}
                                    className={`p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ${active ? '' : 'opacity-60 group-hover:opacity-100'}`}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            ) : <span className="w-1" />}
                        </div>
                    );
                })}
                <button
                    type="button"
                    onClick={onAdd}
                    disabled={!canAdd}
                    title={canAdd ? 'New chart tab' : `Up to ${max} chart tabs`}
                    aria-label="New chart tab"
                    className="flex items-center justify-center w-6 h-6 shrink-0 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
                <span className="ml-1 text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{tabs.length}/{max}</span>
            </div>
            <span className="w-px h-4 shrink-0 bg-slate-200 dark:bg-borderdark" aria-hidden="true" />
            <button
                type="button"
                onClick={openMeditation}
                title="Meditate — open the mandala in a new window"
                aria-label="Meditate — open the mandala in a new window"
                className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md text-slate-600 dark:text-slate-300 hover:text-fuchsia-600 dark:hover:text-fuchsia-400 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-500/10 transition-colors"
            >
                <MandalaIcon className="w-[18px] h-[18px]" />
            </button>
            {/* Nazar evil eye amulet — protecting TradeSagar from envy since 2024 */}
            <button
                type="button"
                title="👁️ Nazar boncuk — this chart is protected from evil eye • may your trades be blessed"
                aria-label="Evil eye protection amulet"
                className="flex items-center justify-center w-7 h-7 shrink-0 rounded-full hover:scale-110 transition-transform duration-200 cursor-default"
                style={{ filter: 'drop-shadow(0 0 3px #1a4fff44)' }}
            >
                <NazarIcon className="w-[18px] h-[18px]" />
            </button>
        </div>
    );
}

