import React from 'react';
import { footprintSettings } from '../utils/footprint';
import { TABLE_ROW_LABELS } from '../utils/footprintRenderer';

export const field = "bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 rounded px-1.5 py-1 focus:outline-none";
export const label = "flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400";
export const check = "rounded border-slate-300 dark:border-slate-600 text-indigo-600";

export function Section({ title, children }) {
    return (
        <div className="mb-3">
            <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{title}</h4>
            <div className="flex flex-col gap-2">{children}</div>
        </div>
    );
}

export function Num({ value, onChange, min = 1, max = 10000, step = 1, w = 'w-16' }) {
    return (
        <input type="number" min={min} max={max} step={step} value={value}
               onChange={e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v >= min) onChange(Math.min(max, v)); }}
               className={`${field} ${w} text-center font-mono`} />
    );
}

/**
 * Footprint chart settings — mirrors TradingView's "Volume footprint" settings
 * (Volume footprint / Labels / Imbalance sections).
 */
export default function FootprintSettingsPanel({ state, setState }) {
    const s = footprintSettings(state.footprintSettings);
    const set = (patch) => setState(prev => ({ ...prev, footprintSettings: { ...footprintSettings(prev.footprintSettings), ...patch } }));
    const setLayer = (key) => setState(prev => ({ ...prev, layers: { ...prev.layers, [key]: !prev.layers[key] } }));
    const toggleTableRow = (key) => set({
        tableRows: s.tableRows.includes(key) ? s.tableRows.filter(k => k !== key) : [...s.tableRows, key],
    });

    return (
        <>
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 pb-2 border-b border-slate-100 dark:border-slate-700">Footprint Settings</h3>

            <Section title="Volume footprint">
                <label className={label}>
                    <span title="Auto: 0.2 × ATR. Manual: a fixed number of price ticks per row.">Row size</span>
                    <select value={s.rowMode} onChange={e => set({ rowMode: e.target.value })} className={field}>
                        <option value="auto">Auto (ATR)</option>
                        <option value="manual">Manual</option>
                    </select>
                </label>
                {s.rowMode === 'auto' ? (
                    <label className={label}>ATR length <Num value={s.atrLength} onChange={v => set({ atrLength: Math.round(v) })} max={500} /></label>
                ) : (
                    <label className={label}>Ticks per row <Num value={s.ticksPerRow} onChange={v => set({ ticksPerRow: Math.round(v) })} /></label>
                )}
                <label className={label}>
                    <span title="Cluster: equal-width cells. Profile: cell width proportional to volume.">Display</span>
                    <select value={s.display} onChange={e => set({ display: e.target.value })} className={field}>
                        <option value="cluster">Cluster</option>
                        <option value="profile">Profile</option>
                    </select>
                </label>
                <label className={label}>
                    Type
                    <select value={s.type} onChange={e => set({ type: e.target.value })} className={field}>
                        <option value="buySell">Buy and Sell</option>
                        <option value="delta">Delta</option>
                        <option value="total">Total</option>
                        <option value="ladder">Ladder</option>
                    </select>
                </label>
                <label className={label}>Apply gradient to background <input type="checkbox" checked={s.gradient} onChange={e => set({ gradient: e.target.checked })} className={check} /></label>
                <label className={label}>Show volume numbers <input type="checkbox" checked={state.layers.footprintText !== false} onChange={() => setLayer('footprintText')} className={check} /></label>
                <div className={label}>
                    <span className="flex items-center gap-2"><input type="checkbox" checked={s.valueArea} onChange={e => set({ valueArea: e.target.checked })} className={check} /> Value area</span>
                    <span className="flex items-center gap-1"><Num value={s.vaPct} onChange={v => set({ vaPct: v })} min={10} max={99} w="w-14" />%</span>
                </div>
            </Section>

            <Section title="Labels">
                <label className={label}>POC <input type="checkbox" checked={s.poc} onChange={e => set({ poc: e.target.checked })} className={check} /></label>
                <label className={label}><span title="Small bar under each candle: green = buyers won (delta > 0), red = sellers; length vs the largest delta on screen">Delta bar</span> <input type="checkbox" checked={s.deltaBar !== false} onChange={e => set({ deltaBar: e.target.checked })} className={check} /></label>
                <label className={label}><span title="Buy + sell volume at each price over the candles on screen, at the right edge, with its POC (VPOC)">Visible range profile</span> <input type="checkbox" checked={s.visibleProfile !== false} onChange={e => set({ visibleProfile: e.target.checked })} className={check} /></label>
                <label className={label}><span title="Diamond beside the candle where both buyers and sellers still traded at its high or low - an auction that didn't finish, often revisited">Unfinished auctions</span> <input type="checkbox" checked={!!s.unfinishedAuction} onChange={e => set({ unfinishedAuction: e.target.checked })} className={check} /></label>
                <label className={label}>
                    Summary info
                    <select value={s.summary} onChange={e => set({ summary: e.target.value })} className={field}>
                        <option value="infobox">Info Box</option>
                        <option value="table">Table</option>
                        <option value="off">Off</option>
                    </select>
                </label>
                {s.summary === 'table' && (
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 pl-1">
                        {Object.entries(TABLE_ROW_LABELS).map(([key, text]) => (
                            <label key={key} className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                                <input type="checkbox" checked={s.tableRows.includes(key)} onChange={() => toggleTableRow(key)} className={check} /> {text}
                            </label>
                        ))}
                    </div>
                )}
                <label className={label}><span title="▲/▼ when delta and imbalances agree. Shown only if, on this chart's history, they called the next candle right clearly more often than a coin flip (hover the live candle for their record).">Order-flow arrows</span> <input type="checkbox" checked={!!state.layers.prediction} onChange={() => setLayer('prediction')} className={check} /></label>
            </Section>

            <Section title="Imbalance">
                <label className={label}>
                    <span title="Buy volume at a row vs sell volume one row below (and vice versa) must be at least this % of the other side.">Imbalance %</span>
                    <Num value={s.imbalancePct} onChange={v => set({ imbalancePct: v })} min={100} max={10000} step={50} />
                </label>
                <label className={label}>Highlight (side lines) <input type="checkbox" checked={s.highlightImbalance} onChange={e => set({ highlightImbalance: e.target.checked })} className={check} /></label>
                <div className={label}>
                    <span className="flex items-center gap-2"><input type="checkbox" checked={s.stacked} onChange={e => set({ stacked: e.target.checked })} className={check} /> Stacked levels</span>
                    <Num value={s.stackedLevels} onChange={v => set({ stackedLevels: Math.round(v) })} min={2} max={20} w="w-14" />
                </div>
            </Section>

            <Section title="Hover">
                <label className={label}>
                    <span title="Hover a footprint candle to see who was in control, imbalances, value area and short notes.">Show candle details on hover</span>
                    <input type="checkbox" checked={s.hoverInfo} onChange={e => set({ hoverInfo: e.target.checked })} className={check} />
                </label>
            </Section>

            <Section title="Alerts">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                    Footprint alerts (stacked or new imbalances, delta, buy/sell volume) are in the
                    Alerts panel (alarm-clock button) → Create alert → Footprint (Order Flow).
                </p>
            </Section>

            <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                Like TradingView, each candle uses the finest data available: 1-second bars from MT5 ticks,
                then 1-minute bars, then the chart's base bars for older history.
                Forex volume is tick volume (activity), not exchange-traded volume.
            </p>
        </>
    );
}
