import { getTradeToken } from './tradingApi';
// ─── Trained model prediction (backend /api/predict) ─────────────────────────
// A gradient-boosting model per symbol + timeframe, trained on up to 20,000
// candles of history on the server (BTC from Binance with real buy/sell volume)
// and retrained daily. Each answer comes with the model's walk-forward record
// (calls it made on candles it had never seen); a direction is only shown when
// that record is an edge. Drawn as a small draggable box on the chart.
import { escapeHtml as esc } from './footprintInsights.js';
import { cotHtml, sentimentHtml } from './marketContext.js';

export const MODEL_INTERVALS = { 5: '5min', 15: '15min', 30: '30min', 60: '1h', 240: '4h' };

export async function fetchModelPrediction(symbol, timeframe) {
    const interval = MODEL_INTERVALS[timeframe];
    if (!interval) return null;
    // Indian symbols (NSE:/BSE:) are owner-only on the server: send the trading token
    const res = await fetch(`/api/predict?symbol=${encodeURIComponent(symbol.replace('/', ''))}&interval=${interval}`,
        /^(NSE|BSE):/i.test(symbol) ? { headers: { 'X-Trade-Token': getTradeToken() } } : undefined);
    if (!res.ok) return { status: 'error', detail: `Prediction service unavailable (${res.status})` };
    return res.json();
}

const pct = (p) => Math.round(p * 100);
const money = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3));

/** "≈ 9.11 · smaller than usual (0.6× normal)" — the expected size of the next candle (multi-factor model). */
export function moveText(mv) {
    if (!mv) return null;
    const word = mv.ratio >= 1.2 ? 'larger than usual' : mv.ratio <= 0.8 ? 'smaller than usual' : 'about usual';
    return { size: `≈ ${money(mv.price)}`, word, ratio: `${mv.ratio.toFixed(1)}× normal`, proven: !!mv.edge };
}
const side = (t, up = 'up', down = 'down') => (t.pUp >= 0.5 ? `${pct(t.pUp)}% ${up}` : `${100 - pct(t.pUp)}% ${down}`);

/** Draw the model box (draggable via placeBox). Returns its rect for hover. */
export function drawModelBox(ctx, mp, placeBox, chartWidth, chartHeight, colors, isDark, notice = null) {
    const lines = [];
    let tone = colors.textBright || colors.text;
    if (mp.status === 'ok') {
        const n = mp.targets.next, f = mp.targets.four, a = mp.targets.atr;
        const up = colors.bull, down = colors.bear;
        tone = n.dir > 0 ? up : n.dir < 0 ? down : tone;
        const mt = moveText(mp.move);
        if (mt) lines.push([`Next candle size ${mt.size} · ${mt.word} (${mt.ratio})${mt.proven ? '' : ' · not proven'}`, 'bold']);
        lines.push([`Trained model: ${side(n)} next candle`, mt ? '' : 'bold']);
        lines.push([`Next 4: ${side(f, 'higher', 'lower')} · +1 ATR first: ${pct(a.pUp)}%`, '']);
        lines.push([`Past accuracy ${pct(n.hitRate)}% of ${n.calls.toLocaleString()} calls · ${n.edge ? 'proven edge' : 'no proven edge'} · hover for details`, '']);
    } else if (mp.status === 'training') {
        lines.push(['Trained model: training…', 'bold']);
        lines.push(["Learning from this chart's history (1–5 min)", '']);
    } else {
        return null;
    }
    // Upcoming / just-released high-impact news (economic calendar): volatility warning
    if (notice) lines.push([`⚠ ${notice}`, 'warn']);
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    let w = 0;
    for (const [txt, b] of lines) { ctx.font = b ? 'bold 10px sans-serif' : '9px sans-serif'; w = Math.max(w, ctx.measureText(txt).width); }
    w += 12;
    const h = 6 + lines.length * 12;
    // Default spot: bottom-left of the chart (usually empty); draggable
    const { x, y } = placeBox('model', 8, Math.max(8, chartHeight - h - 30), w, h);   // above the calendar markers
    ctx.globalAlpha = 0.93; ctx.fillStyle = colors.bg; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.strokeStyle = mp.status === 'ok' && mp.targets.next.edge ? tone : (isDark ? '#475569' : '#cbd5e1');
    ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach(([txt, b], i) => {
        ctx.font = b ? 'bold 10px sans-serif' : '9px sans-serif';
        ctx.fillStyle = b === 'warn' ? '#f59e0b' : b ? tone : colors.text;
        ctx.fillText(txt, x + 6, y + 4 + i * 12);
    });
    ctx.restore();
    return { x, y, w, h };
}

/** Plain-words hover explanation. */
export function modelExplanationHtml(mp, colors, isDark, cot = null, sentiment = null) {
    const head = isDark ? '#818cf8' : '#4f46e5';
    if (mp.status !== 'ok') {
        return `<div style="font-weight:700;color:${head}">Trained model</div><div>${esc(mp.detail || 'Training…')}</div>`;
    }
    const days = Math.max(1, Math.round((mp.refTime - mp.historyFrom) / 86400000));
    const trained = new Date(mp.trainedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const row = (t) => {
        const tone = t.dir > 0 ? colors.bull : t.dir < 0 ? colors.bear : colors.textBright;
        return `<tr><td style="padding:2px 6px 2px 0">${esc(t.label)}</td>`
            + `<td style="padding:2px 6px;color:${tone};font-weight:700">${pct(t.pUp)}% up</td>`
            + `<td style="padding:2px 6px">${pct(t.hitRate)}% of ${t.calls.toLocaleString()}</td>`
            + `<td style="padding:2px 0;color:${t.edge ? colors.bull : colors.text}">${t.edge ? 'edge' : 'no edge'}</td></tr>`;
    };
    return `<div style="font-weight:700;color:${head};margin-bottom:4px">Trained model</div>`
        + `<div>A machine-learning model (gradient boosting, multi-factor inputs: volatility, time of day, recent returns, trend) trained on <b>${mp.nTrain.toLocaleString()}</b> candles of this symbol and timeframe (~${days} days, ${esc(mp.source)})`
        + `${mp.orderFlow ? ', including real buy/sell volume' : ''}. Retrained daily; last ${esc(trained)}.</div>`
        + `<table style="margin-top:6px;border-collapse:collapse;font-size:11px"><tr style="opacity:.7"><td>Question</td><td style="padding:0 6px">Now</td><td style="padding:0 6px">Past calls right</td><td></td></tr>`
        + row(mp.targets.next) + row(mp.targets.four) + row(mp.targets.atr) + '</table>'
        + (mp.move ? (() => {
            const mv = mp.move, mt = moveText(mv);
            return `<div style="margin-top:6px"><b>Size of the next candle: ${esc(mt.size)}</b> (${esc(mt.ratio)}, ${esc(mt.word)}). `
                + `Tested on ${mv.tested.toLocaleString()} unseen candles: predicted vs actual size correlation <b>${mv.corr.toFixed(2)}</b> `
                + `(“same as the last candle”: ${mv.corrLast.toFixed(2)}), average error ${Math.round(mv.skill)}% smaller than assuming every candle is average — `
                + `${mv.edge ? '<span style="color:' + colors.bull + '">a real edge</span>' : 'not proven on this chart'}. `
                + `Use it for stop / target distance and lot size; it does not tell the direction.</div>`;
        })() : '')
        + `<div style="margin-top:6px">"Past calls right" = its confident calls on candles it had never seen while training. `
        + `A direction is only coloured with an <b>edge</b>: clearly better than a coin flip and better probabilities than just using how often price rises.</div>`
        + cotHtml(cot)
        + sentimentHtml(sentiment)
        + `<div style="margin-top:4px;opacity:.75">Statistics, not a guarantee or trading advice.</div>`;
}
