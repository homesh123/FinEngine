import React from 'react';
import { Section, Num, field, label, check } from './FootprintSettingsPanel';
import { PRESSURE_DEFAULTS } from '../utils/pressureChart';

/** Pressure Chart settings — the inputs of the v2.1 MT5 package (Data / Zones / Signals / Execution). */
export default function PressureSettingsPanel({ state, setState }) {
    const s = { ...PRESSURE_DEFAULTS, ...(state.indicatorSettings || {}) };
    const set = (patch) => setState(prev => ({ ...prev, indicatorSettings: { ...prev.indicatorSettings, ...patch } }));
    const reset = () => set(Object.fromEntries(Object.keys(PRESSURE_DEFAULTS).map(k => [k, PRESSURE_DEFAULTS[k]])));
    const box = (key, text, title) => (
        <label className={label}><span title={title}>{text}</span> <input type="checkbox" checked={s[key] !== false} onChange={e => set({ [key]: e.target.checked })} className={check} /></label>
    );

    return (
        <>
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 pb-2 border-b border-slate-100 dark:border-slate-700">Pressure Chart Settings · v2.1</h3>

            <Section title="Show">
                {box('pcMeter', 'Strength meter', 'Sub-window: (BuyShare − 0.5) × RelVol per bar, EMA 5 line, amber while a divergence is active')}
                {box('pcZones', 'Buy / sell zones')}
                {box('pcLevels', 'Trade levels', 'Entry, SL, TP1 and TP2 of the open signal, or of the setup being watched')}
                {box('pcCard', 'Info card')}
                <label className={label}><span title="Grade C = tested zone or against the higher-timeframe bias. Not traded.">Show grade C signals</span> <input type="checkbox" checked={!!s.pcShowC} onChange={e => set({ pcShowC: e.target.checked })} className={check} /></label>
            </Section>

            <Section title="Data">
                <label className={label}>
                    <span title="Auto: buy/sell split from the lower-timeframe bars (or exchange taker volume). Off: volume only — no BuyShare checks, divergence on volume. Off is chosen automatically when the split repeats the candle (ρ > 0.8).">Delta source</span>
                    <select value={s.pcDeltaSource} onChange={e => set({ pcDeltaSource: e.target.value })} className={field}>
                        <option value="auto">Auto (buy/sell split)</option>
                        <option value="off">Off (volume only)</option>
                    </select>
                </label>
                <label className={label}><span title="RelVol compares each bar with the same time of day over this many past days (median)">Volume baseline (days)</span> <Num value={s.pcVolDays} onChange={v => set({ pcVolDays: Math.round(v) })} min={3} max={60} /></label>
            </Section>

            <Section title="Zones">
                <label className={label}><span title="Net displacement (last close − first open) of a 1–3 bar impulse, in ATR">Impulse (× ATR)</span> <Num value={s.pcImpulseAtr} onChange={v => set({ pcImpulseAtr: v })} min={0.5} max={5} step={0.1} /></label>
                <label className={label}><span title="Average relative volume of the impulse">Impulse RelVol ≥</span> <Num value={s.pcImpulseRelVol} onChange={v => set({ pcImpulseRelVol: v })} min={0.5} max={5} step={0.1} /></label>
                <label className={label}><span title="Visits before a zone counts as used (faded, ignored by signals)">Max zone visits</span> <Num value={s.pcMaxTouches} onChange={v => set({ pcMaxTouches: Math.round(v) })} min={1} max={5} /></label>
                <label className={label}><span title="Bars after which a zone counts as used">Zone max age (bars)</span> <Num value={s.pcZoneMaxAge} onChange={v => set({ pcZoneMaxAge: Math.round(v) })} min={20} max={2000} step={10} /></label>
                <label className={label}><span title="Fractal size: a swing needs this many bars on each side, so it is known this many bars later">Pivot bars</span> <Num value={s.pcPivotBars} onChange={v => set({ pcPivotBars: Math.round(v) })} min={2} max={6} /></label>
                <label className={label}><span title="Bars a divergence stays active after its confirmation">Divergence bars</span> <Num value={s.pcDivBars} onChange={v => set({ pcDivBars: Math.round(v) })} min={2} max={20} /></label>
            </Section>

            <Section title="Signals">
                <label className={label}>Min reward : risk <Num value={s.pcMinRR} onChange={v => set({ pcMinRR: v })} min={1} max={10} step={0.5} /></label>
                <label className={label}><span title="Half the position closes here and the stop moves to entry">TP1 (R)</span> <Num value={s.pcTp1R} onChange={v => set({ pcTp1R: v })} min={0.5} max={5} step={0.1} /></label>
                <label className={label}><span title="TP2 when no active opposite zone is ahead">Fallback TP2 (R)</span> <Num value={s.pcFallbackR} onChange={v => set({ pcFallbackR: v })} min={1} max={10} step={0.5} /></label>
                <label className={label}><span title="Stop buffer beyond the zone or bar extreme">Stop buffer (× ATR)</span> <Num value={s.pcStopAtr} onChange={v => set({ pcStopAtr: v })} min={0} max={2} step={0.05} /></label>
                <label className={label}><span title="Bars without a new signal after one fires">Cooldown bars</span> <Num value={s.pcCooldown} onChange={v => set({ pcCooldown: Math.round(v) })} min={0} max={20} /></label>
                {box('pcUseNews', 'High-impact USD news filter (±15 min)')}
                {box('pcSession', 'Asian session (00–08 UTC) needs A+ below H1')}
            </Section>

            <Section title="Execution">
                <label className={label}><span title="A signal can be entered for this many bars after its bar closes">Valid for (bars)</span> <Num value={s.pcValidBars} onChange={v => set({ pcValidBars: Math.round(v) })} min={1} max={10} /></label>
                <label className={label}><span title="Void once price is this many R beyond the entry">Max chase (R)</span> <Num value={s.pcMaxChaseR} onChange={v => set({ pcMaxChaseR: v })} min={0} max={2} step={0.05} /></label>
                <label className={label}><span title="Time exit in the built-in simulator">Max hold (bars)</span> <Num value={s.pcMaxHoldBars} onChange={v => set({ pcMaxHoldBars: Math.round(v) })} min={5} max={1000} step={5} /></label>
                <label className={label}><span title="Your broker's typical spread in price units (gold: e.g. 0.30). Buys fill at ask; sell stops trigger on ask.">Spread (price)</span> <Num value={s.pcSpread} onChange={v => set({ pcSpread: v })} min={0} max={1000} step={0.01} w="w-20" /></label>
                <label className={label}><span title="Round-trip commission per 1.00 lot in USD">Commission (USD / lot)</span> <Num value={s.pcCommission} onChange={v => set({ pcCommission: v })} min={0} max={100} step={0.5} w="w-20" /></label>
                <label className={label}>Account balance (USD) <Num value={s.pcBalance} onChange={v => set({ pcBalance: v })} min={100} max={100000000} step={100} w="w-24" /></label>
                <label className={label}>Risk per A-grade trade (%) <Num value={s.pcRisk} onChange={v => set({ pcRisk: v })} min={0.05} max={5} step={0.05} /></label>
                <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">Lots = balance × risk × k ÷ (stop distance × value per $1 per lot + commission); k = 1 for A+/A, 0.5 for B, 0 for C. Rounded down; below 0.01 lot is reported, not rounded up.</p>
            </Section>

            <button type="button" onClick={reset} className={`${field} w-full mb-3 hover:bg-slate-100 dark:hover:bg-slate-800`}>Reset to v2.1 defaults</button>

            <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                Bar colour = who won the bar; width = volume vs the same hour on past days. Signals fire on closed bars only and never repaint.
                Confidence % comes from this chart's earlier signals of the same grade (in-sample) — treat signals as unproven until a forward test.
            </p>
        </>
    );
}
