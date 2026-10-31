import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { fetchDailyCandles } from '../utils/dataSource';
import { chartSymbolFor, openStockChart } from '../utils/openChart';

// A stock's daily chart inside the Investment tab: candles, 50- and 200-day
// averages, volume, crosshair; with a trade plan (Top 5) its entry, target and
// stop lines. Kept separate from the main chart engine on purpose — no alerts,
// live feed or chart tabs get involved. "Open full chart" goes to the chart tab.

const RANGES = [['3M', 63], ['6M', 126], ['1Y', 252]];

function sma(c, n) {
    const out = new Array(c.length).fill(null);
    let s = 0;
    for (let i = 0; i < c.length; i++) {
        s += c[i].close;
        if (i >= n) s -= c[i - n].close;
        if (i >= n - 1) out[i] = s / n;
    }
    return out;
}

const fmtPx = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3));

export default function MiniStockChart({ symbol, market, plan, onClose, height = 300 }) {
    const wrapRef = useRef(null), canvasRef = useRef(null);
    const [candles, setCandles] = useState(null);
    const [error, setError] = useState(null);
    const [range, setRange] = useState(126);
    const [hover, setHover] = useState(null);

    useEffect(() => {
        let alive = true;
        setCandles(null); setError(null);
        fetchDailyCandles(chartSymbolFor(symbol, market))
            .then(rows => { if (alive) setCandles(rows.filter(r => r.close > 0)); })
            .catch(e => { if (alive) setError(e.message || 'Could not load the chart'); });
        return () => { alive = false; };
    }, [symbol, market]);

    useEffect(() => {
        const cv = canvasRef.current, wrap = wrapRef.current;
        if (!cv || !wrap || !candles?.length) return undefined;
        const ma50 = sma(candles, 50), ma200 = sma(candles, 200);
        const draw = () => {
            const dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = height;
            cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
            const ctx = cv.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            const dark = !!cv.closest('.dark');
            const grid = dark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)', text = dark ? '#94a3b8' : '#64748b';
            const from = Math.max(0, candles.length - range), view = candles.slice(from);
            const axisW = 56, plotW = W - axisW, priceH = H * 0.78, volTop = H * 0.82;
            let lo = Infinity, hi = -Infinity;
            view.forEach((k, j) => {
                lo = Math.min(lo, k.low); hi = Math.max(hi, k.high);
                for (const m of [ma50[from + j], ma200[from + j]]) if (m) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
            });
            if (plan) for (const p of [plan.entry, plan.target, plan.stop_loss]) if (p > 0) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
            const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
            const y = (p) => 6 + (1 - (p - lo) / (hi - lo)) * (priceH - 12);
            const step = plotW / view.length, bw = Math.max(1, step * 0.7);
            const x = (j) => j * step + step / 2;
            // grid + price axis
            ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            for (let g = 0; g <= 4; g++) {
                const p = lo + (hi - lo) * (g / 4), yy = y(p);
                ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
                ctx.fillStyle = text; ctx.fillText(fmtPx(p), plotW + 6, yy);
            }
            // volume
            const vMax = Math.max(...view.map(k => k.volume || 0)) || 1;
            view.forEach((k, j) => {
                const vh = ((k.volume || 0) / vMax) * (H - volTop - 2);
                ctx.fillStyle = k.close >= k.open ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)';
                ctx.fillRect(x(j) - bw / 2, H - vh - 1, bw, vh);
            });
            // candles
            view.forEach((k, j) => {
                const up = k.close >= k.open, col = up ? '#10b981' : '#ef4444';
                ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x(j), y(k.high)); ctx.lineTo(x(j), y(k.low)); ctx.stroke();
                const top = y(Math.max(k.open, k.close));
                ctx.fillRect(x(j) - bw / 2, top, bw, Math.max(1, y(Math.min(k.open, k.close)) - top));
            });
            // moving averages
            for (const [ma, col] of [[ma50, '#6366f1'], [ma200, '#f59e0b']]) {
                ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
                let started = false;
                view.forEach((_, j) => { const m = ma[from + j]; if (!m) return; if (started) ctx.lineTo(x(j), y(m)); else { ctx.moveTo(x(j), y(m)); started = true; } });
                ctx.stroke();
            }
            // trade plan
            if (plan) {
                for (const [p, col, label, dash] of [[plan.target, '#16a34a', 'Target', []], [plan.entry, dark ? '#e2e8f0' : '#334155', 'Entry', [4, 3]], [plan.stop_loss, '#dc2626', 'Stop', [6, 4]]]) {
                    if (!(p > 0)) continue;
                    const yy = y(p);
                    ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 1.2;
                    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]);
                    ctx.fillStyle = col; ctx.fillRect(plotW, yy - 8, axisW, 16);
                    ctx.fillStyle = '#fff'; ctx.fillText(fmtPx(p), plotW + 4, yy);
                    ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.fillText(label, plotW - 4, yy - 7); ctx.textAlign = 'left';
                }
            }
            // last price tag
            const last = view[view.length - 1], ly = y(last.close);
            ctx.fillStyle = '#4f46e5'; ctx.fillRect(plotW, ly - 8, axisW, 16);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillText(fmtPx(last.close), plotW + 4, ly);
            // crosshair
            if (hover != null && view[hover]) {
                ctx.strokeStyle = dark ? 'rgba(226,232,240,0.5)' : 'rgba(51,65,85,0.4)'; ctx.setLineDash([3, 3]);
                ctx.beginPath(); ctx.moveTo(x(hover), 0); ctx.lineTo(x(hover), H); ctx.stroke(); ctx.setLineDash([]);
            }
            cv._map = { step, from };
        };
        draw();
        const ro = new ResizeObserver(draw); ro.observe(wrap);
        return () => ro.disconnect();
    }, [candles, range, hover, plan, height]);

    const view = candles ? candles.slice(Math.max(0, candles.length - range)) : [];
    const hk = hover != null ? view[hover] : view[view.length - 1];
    const onMove = (e) => {
        const m = canvasRef.current?._map; if (!m) return;
        const r = canvasRef.current.getBoundingClientRect();
        const j = Math.floor((e.clientX - r.left) / m.step);
        setHover(j >= 0 && j < view.length ? j : null);
    };

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex-wrap">
                <b className="text-sm text-slate-800 dark:text-slate-100">{symbol}</b>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">daily</span>
                {hk && (
                    <span className="text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                        {new Date(hk.time).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' })} · O {fmtPx(hk.open)} H {fmtPx(hk.high)} L {fmtPx(hk.low)} C <b>{fmtPx(hk.close)}</b>
                    </span>
                )}
                <span className="text-[11px] text-slate-500 dark:text-slate-400"><span className="text-indigo-500">━</span> 50-day <span className="text-amber-500">━</span> 200-day avg</span>
                <div className="ml-auto flex items-center gap-1">
                    <div className="inline-flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
                        {RANGES.map(([l, n]) => (
                            <button key={l} type="button" onClick={() => setRange(n)} aria-pressed={range === n}
                                className={`min-w-[44px] h-11 sm:h-auto sm:min-w-0 px-2 sm:py-0.5 rounded text-[11px] font-semibold ${range === n ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>{l}</button>
                        ))}
                    </div>
                    <button type="button" onClick={() => openStockChart(symbol, market)} title="Open on TradingView"
                        className="inline-flex items-center gap-1 h-11 sm:h-auto px-2 sm:py-1 rounded-md text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10">
                        <ExternalLink size={12} /> TradingView
                    </button>
                    {onClose && <button type="button" onClick={onClose} aria-label="Close chart" className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"><X size={15} /></button>}
                </div>
            </div>
            <div ref={wrapRef} className="relative w-full" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
                {candles && candles.length > 0 && <canvas ref={canvasRef} className="block" aria-label={`${symbol} daily price chart`} />}
                {!candles && !error && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Loading {symbol}…</div>}
                {error && <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-red-600 dark:text-red-400">Couldn't load the chart: {error}</div>}
                {candles && candles.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">No price history for {symbol}.</div>}
            </div>
        </div>
    );
}
