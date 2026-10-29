// ─── BTC Turtle Breakout (Pro) ───────────────────────────────────────────────
// Same rules as EA/BTC_Turtle_Breakout_EA.mq5 v1.10 (research: web_app/research/btc/README.md):
// on each completed H4 bar (broker server time, New York + 7h, as MT5):
//   BUY when the close > highest high of the previous 55 H4 bars and > EMA(200), unless ATR(14) is
//   in a spike (> 2 x its 20-bar mean; resumes after 3 bars < 1.5 x). Fill at the next bar's open.
//   Stop = fill - 2 x ATR (checked on every chart candle). Exit when an H4 close is below the lowest
//   low of the previous 27 bars - 40 bars for strong breakouts (close >= 55-bar high + 0.72 ATR),
//   20 for weak ones (< 0.27 ATR). Long only, no take profit.
// Works on any chart timeframe that divides 4 hours (1m … 4h): H4 bars are built from the candles.
// Marks: c.btBuy (signal candle), c.btFill (fill price), c.btExit { type, price, r }, and per candle
// c.btHi (breakout level), c.btLo / c.btSl while a trade is open, c.btEma.
import { serverOffsetMin } from './dataEngine.js';

export const BTC_TURTLE_DEFAULTS = {
    btEntryBars: 55, btExitBars: 27, btEmaLen: 200, btSlAtr: 2,
    btStrongBreak: 0.72, btStrongExit: 40, btWeakBreak: 0.27, btWeakExit: 20,
    btSpikeAtr: 2, btResumeAtr: 1.5,
};

const H4 = 4 * 3600000;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function calcBtcTurtle(candles, settings = {}, tfMins = 60) {
    for (const c of candles) { c.btBuy = false; c.btFill = null; c.btExit = null; c.btHi = null; c.btLo = null; c.btSl = null; c.btEma = null; }
    if (!(tfMins > 0 && tfMins <= 240 && 240 % tfMins === 0) || candles.length < 50) return null;
    const s = { ...BTC_TURTLE_DEFAULTS, ...settings };
    const N = Math.max(2, num(s.btEntryBars, 55)), X = Math.max(2, num(s.btExitBars, 27)), E = num(s.btEmaLen, 200);
    const slM = num(s.btSlAtr, 2), sB = num(s.btStrongBreak, 0.72), sX = Math.max(2, num(s.btStrongExit, 40));
    const wB = num(s.btWeakBreak, 0.27), wX = Math.max(2, num(s.btWeakExit, 20));
    const spike = num(s.btSpikeAtr, 2), resume = num(s.btResumeAtr, 1.5);
    const exitFor = (b) => (sB > 0 && b >= sB ? sX : wB > 0 && b < wB ? wX : X);

    // server-time H4 bars: [first, last] chart candle index each
    const bars = [];
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const key = Math.floor((c.time + serverOffsetMin(c.time) * 60000) / H4);
        const b = bars[bars.length - 1];
        if (!b || b.key !== key) bars.push({ key, o: c.open, h: c.high, l: c.low, c: c.close, i0: i, i1: i });
        else { b.h = Math.max(b.h, c.high); b.l = Math.min(b.l, c.low); b.c = c.close; b.i1 = i; }
    }
    const n = bars.length;
    // EMA seeded on the first close, Wilder ATR seeded on the first true range (as the EA)
    const ema = new Array(n), atr = new Array(n), atrMa = new Array(n).fill(null);
    let e = bars[0].c, a = 0, sum = 0;
    for (let k = 0; k < n; k++) {
        const b = bars[k], p = bars[k > 0 ? k - 1 : 0];
        if (E > 0) e += (b.c - e) * 2 / (E + 1);
        const tr = k === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
        a = k === 0 ? tr : a + (tr - a) / 14;
        ema[k] = e; atr[k] = a;
        sum += a; if (k >= 20) sum -= atr[k - 20];
        if (k >= 19) atrMa[k] = sum / 20;
    }
    const hiOf = (k) => { let m = -Infinity; for (let j = k - N; j < k; j++) m = Math.max(m, bars[j].h); return m; };
    const loOf = (k, len) => { let m = Infinity; for (let j = k - len; j < k; j++) m = Math.min(m, bars[j].l); return m; };

    const trades = [];
    let pos = null, pause = false, calm = 0;
    const need = Math.max(N, X, sX, wX, 20) + 1;
    for (let k = need; k < n; k++) {
        const b = bars[k];
        const hi = hiOf(k);
        // stop checked on each chart candle of this bar (a fill at its open happened before)
        for (let i = b.i0; i <= b.i1; i++) {
            const c = candles[i];
            c.btHi = hi; c.btEma = E > 0 ? ema[k] : null;
            if (!pos) continue;
            c.btSl = pos.sl; c.btLo = loOf(k, pos.exitBars);
            if (c.low <= pos.sl) {
                const px = Math.min(c.open, pos.sl);
                close(i, px, 'SL');
            }
        }
        if (k === n - 1) break;                       // forming bar: no close yet
        // bar close: volatility guard, channel exit, new signal → fill at the next bar's open
        if (spike > 0 && atrMa[k]) {
            if (atr[k] > spike * atrMa[k]) { pause = true; calm = 0; }
            else if (pause) { calm = atr[k] < resume * atrMa[k] ? calm + 1 : 0; if (calm >= 3) pause = false; }
        }
        const nx = bars[k + 1];
        if (pos) {
            if (b.c < loOf(k, pos.exitBars)) close(nx.i0, candles[nx.i0].open, 'Channel');
            continue;
        }
        if (b.c > hi && (E <= 0 || b.c > ema[k]) && !pause) {
            const brk = (b.c - hi) / atr[k];
            const fill = candles[nx.i0].open;
            candles[b.i1].btBuy = true;
            candles[nx.i0].btFill = fill;
            pos = { signalIdx: b.i1, entryIdx: nx.i0, fill, sl: fill - slM * atr[k], risk: slM * atr[k], exitBars: exitFor(brk), tier: sB > 0 && brk >= sB ? ' strong' : wB > 0 && brk < wB ? ' weak' : '' };
        }
    }

    function close(i, px, type) {
        const r = (px - pos.fill) / pos.risk;
        candles[i].btExit = { type, price: px, r };
        trades.push({ ...pos, exitIdx: i, exitPrice: px, type, r });
        pos = null;
    }

    const wins = trades.filter(t => t.r > 0), gross = wins.reduce((x, t) => x + t.r, 0);
    const loss = -trades.filter(t => t.r <= 0).reduce((x, t) => x + t.r, 0);
    return { trades, open: pos, stats: { n: trades.length, wins: wins.length, netR: gross - loss, pf: loss > 0 ? gross / loss : null } };
}

export function drawBtcTurtle(ctx, dataset, res, x, y, bw, halfBw, startIdx, endIdx, isDark, chartHeight) {
    if (!res) return;
    const i0 = Math.max(0, startIdx - 1), i1 = Math.min(dataset.length - 1, endIdx + 1);
    const step = (key, color, width, dash) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
        ctx.beginPath();
        let prev = null;
        for (let i = i0; i <= i1; i++) {
            const d = dataset[i], v = d[key], hx = x(d.time);
            if (v == null || hx === undefined) { prev = null; continue; }
            if (prev === null || prev !== v) { if (prev !== null) ctx.lineTo(hx, y(v)); else ctx.moveTo(hx, y(v)); }
            ctx.lineTo(hx + bw, y(v)); prev = v;
        }
        ctx.stroke(); ctx.setLineDash([]);
    };
    ctx.save();
    step('btEma', isDark ? 'rgba(148,163,184,0.6)' : 'rgba(100,116,139,0.6)', 1.5, []);
    step('btHi', isDark ? 'rgba(56,189,248,0.7)' : 'rgba(2,132,199,0.6)', 1, [4, 3]);   // 55-bar high to break
    step('btLo', '#f59e0b', 1.5, [4, 3]);                                              // channel exit level
    step('btSl', '#ef4444', 2, []);                                                    // stop

    const badge = (cx, cy, text, bg) => {
        ctx.font = 'bold 9px sans-serif';
        const w = ctx.measureText(text).width + 8;
        ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - 7, w, 14, 3); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, cy);
    };
    const dot = (cx, cy, col) => {
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = isDark ? '#0b1220' : '#ffffff'; ctx.stroke();
    };
    const byFill = new Map(res.trades.map(t => [t.entryIdx, t]));
    if (res.open) byFill.set(res.open.entryIdx, res.open);
    for (let i = i0; i <= i1; i++) {
        const d = dataset[i], hx = x(d.time);
        if (hx === undefined) continue;
        const px = hx + halfBw;
        if (d.btBuy) {
            const tip = y(d.low) + 5;
            ctx.fillStyle = '#0ea5e9';
            ctx.beginPath(); ctx.moveTo(px, tip); ctx.lineTo(px - 6, tip + 8); ctx.lineTo(px + 6, tip + 8); ctx.fill();
            const t = dataset[i + 1] && byFill.get(i + 1);
            badge(px, tip + 18, `TURTLE BUY${t ? t.tier : ''}`, '#0ea5e9');
        }
        if (d.btFill != null) dot(px, y(d.btFill), '#0ea5e9');
        if (d.btExit) {
            const { r, type, price } = d.btExit;
            const col = r >= 0 ? '#16a34a' : '#dc2626';
            const tip = y(d.high) - 5;
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.moveTo(px, tip); ctx.lineTo(px - 6, tip - 8); ctx.lineTo(px + 6, tip - 8); ctx.fill();
            dot(px, y(price), col);
            badge(px, tip - 18, `${type === 'SL' ? 'SL' : 'Exit'} ${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R`, col);
        }
    }
    // record box (bottom left, clear of the legend): closed trades on the loaded history
    const st = res.stats;
    const text = `BTC Turtle H4 · ${st.n} trades · ${st.wins} won · ${st.netR >= 0 ? '+' : ''}${st.netR.toFixed(1)}R${st.pf ? ` · PF ${st.pf.toFixed(2)}` : ''}${res.open ? ' · in trade' : ''}`;
    ctx.font = 'bold 10px sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.9)';
    const by = (chartHeight || 300) - 26;
    ctx.beginPath(); ctx.roundRect(8, by, w, 18, 4); ctx.fill();
    ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 14, by + 9);
    ctx.restore();
}
