import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pathExplanationHtml, horizonLabel } from '../utils/pathProjection';
import { usePredictionSignal } from '../hooks/usePredictionSignal';
import { useDraggable } from '../hooks/useDraggable';
import { fetchLiveRecord } from '../utils/predictionLog';
import { fetchModelPrediction, moveText } from '../utils/modelPrediction';

/**
 * Future-candle projection in plain words (sidebar, above the ads):
 * what is likely, where it comes from, and how far to trust it — at most 3 lines.
 * Hover for the full explanation.
 */
const fmt = (v) => (v == null ? '—' : Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
const money = (v) => `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;

/** Server-checked results of this chart's real predictions and signals, refreshed every 5 minutes. */
function useLiveRecord(symbol, tf) {
    const [rec, setRec] = useState(null);
    useEffect(() => {
        if (!symbol || !tf) return undefined;
        let alive = true;
        const load = () => fetchLiveRecord(symbol, tf).then(r => { if (alive) setRec(r); });
        load();
        const t = setInterval(load, 5 * 60000);
        return () => { alive = false; clearInterval(t); };
    }, [symbol, tf]);
    return rec;
}

/** Expected size of the next candle (backend multi-factor model), refreshed every minute. */
function useExpectedMove(symbol, tf) {
    const [mv, setMv] = useState(null);
    useEffect(() => {
        if (!symbol || !tf) return undefined;
        let alive = true;
        const load = () => fetchModelPrediction(symbol, tf).then(r => { if (alive) setMv(r?.status === 'ok' ? r.move || null : null); }).catch(() => {});
        load();
        const t = setInterval(load, 60000);
        return () => { alive = false; clearInterval(t); };
    }, [symbol, tf]);
    return mv;
}

const since = (s) => new Date(s * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** The trade signal under the prediction: levels, lot size, and why (or what it waits for). */
function SignalBlock({ signal, record }) {
    const { now, active, outcome, expired } = signal;
    const show = active && outcome === 'open' && !expired ? active : null;
    if (!show) {
        const missing = now.checks.filter(c => !c.ok);
        const done = active && (outcome === 'tp' ? `Last ${active.dir === 1 ? 'BUY' : 'SELL'} hit its target ✅` : outcome === 'sl' ? `Last ${active.dir === 1 ? 'BUY' : 'SELL'} hit its stop loss ❌` : null);
        return (
            <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-700/60 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                <div className="font-semibold text-slate-700 dark:text-slate-200">No trade signal — wait<span className="ml-1 align-middle rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Experimental</span></div>
                {done && <div>{done}</div>}
                {missing.slice(0, 2).map((c, k) => <div key={k}>✗ {c.text}</div>)}
            </div>
        );
    }
    const buy = show.dir === 1, z = show.size;
    const pct = (p) => `${(Math.abs(p - show.entry) / show.entry * 100).toFixed(2)}%`;
    return (
        <div className={`mt-1.5 rounded-lg px-2 py-1.5 text-[11px] leading-snug border ${buy ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'}`}>
            <div className={`text-[13px] font-bold ${buy ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {buy ? '▲ BUY' : '▼ SELL'} signal<span className="ml-1 align-middle rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Experimental</span> <span className="font-normal text-slate-500 dark:text-slate-400 text-[11px]">· {new Date(show.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-slate-700 dark:text-slate-300">
                <span>Entry</span><span className="font-semibold tabular-nums">{fmt(show.entry)}</span>
                <span>Stop loss</span><span className="tabular-nums"><b>{fmt(show.sl)}</b> <span className="text-slate-500 dark:text-slate-400">({pct(show.sl)}, {show.slWhy})</span></span>
                <span>Take profit</span><span className="tabular-nums"><b>{fmt(show.tp)}</b> <span className="text-slate-500 dark:text-slate-400">({pct(show.tp)}, {show.tpWhy})</span></span>
                <span>Reward</span><span>{show.rr.toFixed(1)}× the risk · hold up to ~{show.hold} candles</span>
            </div>
            <div className="mt-1 pt-1 border-t border-black/5 dark:border-white/10 text-slate-700 dark:text-slate-300">
                {!z ? <span>Lot size: set it yourself (contract size of this symbol varies by broker). Risk at most 1% of your balance.</span>
                    : z.belowMin ? <span>⚠️ Balance too small: even 0.01 lot risks {money(z.minLotRisk)} on this stop. Skip this trade or add funds.</span>
                    : <span><b>Lot size {z.lots.toFixed(2)}</b> — risks {money(z.risk)} ({z.riskPct.toFixed(1)}% of balance) if stopped. <b>Don't go above {z.maxLots.toFixed(2)}</b> (2% risk){z.cappedByMargin ? '; reduced to keep margin low' : ''}. Move the stop to entry once halfway to target.</span>}
            </div>
            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{show.checks.map(c => `✓ ${c.text}`).join(' · ')}</div>
            {record?.tp + record?.sl > 0 && <div className="mt-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">Live signal record here: {record.tp} hit target, {record.sl} hit stop (since {since(record.since)})</div>}
        </div>
    );
}

export default function ProjectionCard({ pp, dark, signal, bare = false, symbol, tf }) {
    const record = useLiveRecord(symbol, tf);
    const move = moveText(useExpectedMove(symbol, tf));
    const ref = useRef(null);
    const [pos, setPos] = useState(null);
    if (!pp?.path?.length) return null;

    const up = Math.round(pp.pUp * 100);
    const even = up >= 45 && up <= 55;
    const head = even
        ? `${horizonLabel(pp)}: no clear direction (${up}% up)`
        : up > 50 ? `${horizonLabel(pp)}: more likely to ${pp.current ? 'close up' : 'rise'} (${up}%)` : `${horizonLabel(pp)}: more likely to ${pp.current ? 'close down' : 'fall'} (${100 - up}%)`;
    const tone = even ? 'text-slate-700 dark:text-slate-200' : up > 50 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
    const hit = Math.round(pp.hitRate * 100);
    const trust = pp.calls < 30
        ? 'Not enough history yet to check how reliable this is.'
        : pp.proven
            ? `Right ${hit}% of the time before — better than chance, still not a guarantee.`
            : `Right ${hit}% of the time before — no better than a coin flip, so treat it as a hint.`;

    const show = () => {
        const r = ref.current?.getBoundingClientRect();
        if (!r || window.innerWidth < 768) return;
        setPos({ top: Math.max(8, Math.min(r.top, window.innerHeight - 260)), right: Math.max(8, window.innerWidth - r.left + 8) });
    };

    return (
        <div ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)}
            className={bare ? 'px-2.5 pb-2' : 'mx-3 mt-2 mb-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/40 cursor-help'}>
            {!bare && <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-500 dark:text-slate-400 mb-0.5">Price prediction</div>}
            <div className={`text-[12px] font-semibold leading-snug ${tone}`}>{head}</div>
            <div className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">Based on {pp.n} moments on this chart that looked like now.</div>
            <div className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">{trust}</div>
            {move && (
                <div className="mt-1 mb-0.5 rounded-md px-2 py-1 bg-indigo-50 dark:bg-indigo-500/10 text-[11px] leading-snug text-slate-700 dark:text-slate-200"
                    title="Multi-factor model (volatility, time of day, recent returns, trend). Tested on unseen candles; it predicts size, not direction.">
                    <b>Next candle size {move.size}</b> · {move.word} ({move.ratio}){move.proven ? '' : ' · not proven on this chart'}
                </div>
            )}
            {(() => {   // what really happened to this setting's past calls on this chart, live
                const r = record?.[`path|${pp.horizon}|${pp.analogs}`], n = r ? r.hit + r.miss : 0;
                return <div className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">{n >= 20
                    ? <>Live record: right <b>{Math.round(r.hit / n * 100)}%</b> of {n} real calls since {since(r.since)}.</>
                    : 'Live record: being collected — results show after 20 real calls.'}</div>;
            })()}
            {signal && <SignalBlock signal={signal} record={record?.signal} />}
            {pos && createPortal(
                <div className={dark ? 'dark' : undefined}>
                    <div role="tooltip" style={{ top: pos.top, right: pos.right }}
                        className="fixed z-[330] w-80 pointer-events-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 backdrop-blur shadow-2xl p-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 ts-pop-in"
                        dangerouslySetInnerHTML={{ __html: pathExplanationHtml(pp, null, dark) }} />
                </div>,
                document.body,
            )}
        </div>
    );
}

/** The projection of a chart's own data, when it is switched on (standard chart types). */
export const projectionOf = (dataset, state) => (state.chartType !== 'footprint' && state.indicators?.nextProjection && !state.hiddenIndicators?.nextProjection
    ? dataset?.[dataset.length - 1]?.pathProjection : null);

const OPEN_KEY = 'ts_proj_box_open';

/**
 * Phones: the prediction (and its trade signal) in a box at the top right of the
 * chart — drag it by its header, tap − / + to collapse it to one line.
 */
export function FloatingProjection({ dataset, state }) {
    const pp = projectionOf(dataset, state);
    const signal = usePredictionSignal(dataset, state);
    const drag = useDraggable('projection');
    const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } });
    if (!pp?.path?.length) return null;
    const toggle = () => setOpen(o => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* storage unavailable */ } return !o; });
    const sig = signal?.active && signal.outcome === 'open' && !signal.expired ? signal.active : null;
    const up = Math.round(pp.pUp * 100);
    const summary = sig ? (sig.dir === 1 ? '▲ BUY signal' : '▼ SELL signal') : up >= 45 && up <= 55 ? 'No clear direction' : up > 50 ? `${up}% likely up` : `${100 - up}% likely down`;
    const tone = sig ? (sig.dir === 1 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300') : 'text-slate-700 dark:text-slate-200';
    return (
        <div ref={drag.boxRef} style={drag.boxStyle}
            className="md:hidden absolute top-2 right-16 z-30 w-[min(270px,calc(100%-80px))] max-h-[70%] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-lg">
            <div {...drag.handleProps} className="flex items-center gap-2 px-2.5 py-1.5 select-none">
                <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-slate-500 dark:text-slate-400">Prediction</span>
                {!open && <span className={`text-[11px] font-semibold truncate ${tone}`}>{summary}</span>}
                <button type="button" onPointerDown={e => e.stopPropagation()} onClick={toggle}
                    aria-label={open ? 'Collapse prediction' : 'Expand prediction'} aria-expanded={open}
                    className="ml-auto -mr-1 w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-base font-bold text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                    {open ? '−' : '+'}
                </button>
            </div>
            {open && <ProjectionCard pp={pp} dark={state.theme === 'dark'} signal={signal} bare symbol={state.symbol} tf={Number(state.timeframe)} />}
        </div>
    );
}
