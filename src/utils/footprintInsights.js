// ─── Footprint hover details ─────────────────────────────────────────────────
// Plain-language summary of what happened inside one footprint candle, shown
// when hovering it: the hovered row (sell × buy, imbalance), the candle's
// volume/delta, who was in control, and short trader notes based on the
// patterns in TradingView's footprint guide (delta divergence, stacked
// imbalances, value area acceptance, finished/unfinished auctions).
// These are interpretations of order flow, not trading advice.

const fmtInt = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
    return Math.round(v).toLocaleString();
};
const signed = (v) => (v > 0 ? '+' : '') + fmtInt(v);
const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;

/**
 * @param candle  candle with `fp` (see footprint.js)
 * @param rowIdx  hovered row index inside the footprint, or -1
 * @returns {{ title, sub, sections: [{ heading, rows: [[label, value, tone]] }], verdict: {text, tone}, notes: string[] }}
 *          tone: 'buy' | 'sell' | 'muted' | undefined
 */
export function describeFootprint(candle, rowIdx) {
    const fp = candle.fp;
    const st = fp.stats;
    const digits = Math.max(0, -Math.floor(Math.log10(fp.tick || 0.01)));
    const px = (v) => v.toFixed(digits);
    const rowLo = (k) => (fp.base + k) * fp.row;
    const n = fp.bid.length;
    const sections = [];

    // ── Hovered row ──
    if (rowIdx >= 0 && rowIdx < n) {
        const b = fp.bid[rowIdx], a = fp.ask[rowIdx];
        const rows = [
            ['Sell × Buy', `${fmtInt(b)} × ${fmtInt(a)}`],
            ['Row delta', signed(a - b), a > b ? 'buy' : a < b ? 'sell' : 'muted'],
        ];
        if (fp.buyImb[rowIdx]) {
            const below = rowIdx > 0 ? fp.bid[rowIdx - 1] : 0;
            rows.push(['Buy imbalance', below > 0 ? `${(a / below).toFixed(1)}× sell below` : 'no sellers below', 'buy']);
        }
        if (fp.sellImb[rowIdx]) {
            const above = rowIdx < n - 1 ? fp.ask[rowIdx + 1] : 0;
            rows.push(['Sell imbalance', above > 0 ? `${(b / above).toFixed(1)}× buy above` : 'no buyers above', 'sell']);
        }
        const tags = [];
        if (rowIdx === fp.poc) tags.push('POC (most traded)');
        tags.push(rowIdx >= fp.val && rowIdx <= fp.vah ? 'inside value area' : 'outside value area');
        rows.push(['Level', tags.join(', '), 'muted']);
        sections.push({ heading: `Price ${px(rowLo(rowIdx))} – ${px(rowLo(rowIdx + 1))}`, rows });
    }

    // ── Candle ──
    let buyImbN = 0, sellImbN = 0;
    for (let k = 0; k < n; k++) { buyImbN += fp.buyImb[k]; sellImbN += fp.sellImb[k]; }
    sections.push({
        heading: 'Candle',
        rows: [
            ['Volume', fmtInt(st.volume)],
            ['Buy / Sell', `${st.buyPct.toFixed(0)}% / ${st.sellPct.toFixed(0)}%`],
            ['Delta', `${signed(st.delta)} (${pct(st.deltaPct)})`, st.delta > 0 ? 'buy' : st.delta < 0 ? 'sell' : 'muted'],
            ['Min / Max delta', `${signed(st.minDelta)} / ${signed(st.maxDelta)}`],
            ['POC', px(st.poc)],
            ['Value area', `${px(rowLo(fp.val))} – ${px(rowLo(fp.vah + 1))}`],
            ['Imbalances', `${buyImbN} buy · ${sellImbN} sell`],
        ],
    });

    // ── Next-candle odds (live candle) ──
    const pr = fp.projection;
    if (pr) {
        sections.push({
            heading: 'Next candle odds',
            rows: [
                ['Closes up / down', `${Math.round(pr.pUp * 100)}% / ${Math.round((1 - pr.pUp) * 100)}%`, pr.dir > 0 ? 'buy' : pr.dir < 0 ? 'sell' : 'muted'],
                ['Typical high from open', `+${px(pr.upExc)}`, 'buy'],
                ['Typical low from open', `-${px(pr.downExc)}`, 'sell'],
                ['Based on', `${pr.n} similar candles`, 'muted'],
                ['Past calls right', pr.calls ? `${Math.round(pr.hitRate * 100)}% of ${pr.calls}` : 'not enough history', pr.proven ? 'buy' : 'muted'],
                ['Edge', pr.proven ? 'yes — above a coin flip here' : 'no proven edge on this chart', pr.proven ? 'buy' : 'muted'],
                ...(fp.arrowRecord && fp.arrowRecord.calls ? [['Order-flow arrows right', `${Math.round(fp.arrowRecord.hitRate * 100)}% of ${fp.arrowRecord.calls}${fp.arrowRecord.proven ? '' : ' (hidden, no edge)'}`, fp.arrowRecord.proven ? 'buy' : 'muted']] : []),
            ],
        });
    }

    // ── Who is in control ──
    const dp = st.deltaPct;
    let verdict;
    if (st.volume === 0) verdict = { text: 'No volume', tone: 'muted' };
    else if (dp >= 25) verdict = { text: 'Buyers in strong control', tone: 'buy' };
    else if (dp >= 10) verdict = { text: 'Buyers in control', tone: 'buy' };
    else if (dp <= -25) verdict = { text: 'Sellers in strong control', tone: 'sell' };
    else if (dp <= -10) verdict = { text: 'Sellers in control', tone: 'sell' };
    else verdict = { text: 'Balanced — neither side dominates', tone: 'muted' };

    // ── Trader notes (most useful first, max 4) ──
    const notes = [];
    const up = candle.close > candle.open, down = candle.close < candle.open;
    if (up && st.delta < 0) notes.push('Delta divergence: price closed up but sellers were more aggressive — the rise looks weak.');
    if (down && st.delta > 0) notes.push('Delta divergence: price closed down but buyers were more aggressive — selling may be fading.');
    for (const z of fp.stacks) {
        notes.push(z.side === 'buy'
            ? `Stacked buy imbalance ${px(z.lo)}–${px(z.hi)}: aggressive buying zone, often support later.`
            : `Stacked sell imbalance ${px(z.lo)}–${px(z.hi)}: aggressive selling zone, often resistance later.`);
        if (notes.length >= 3) break;
    }
    const vahPx = rowLo(fp.vah + 1), valPx = rowLo(fp.val);
    if (candle.close > vahPx) notes.push('Closed above the value area — buyers accepted higher prices.');
    else if (candle.close < valPx) notes.push('Closed below the value area — sellers pushed price lower and it held.');
    // Auction at the extremes: almost no buying at the high / selling at the low
    // = the move finished there; heavy two-sided trade = unfinished, may be revisited.
    let maxRow = 0;
    for (let k = 0; k < n; k++) maxRow = Math.max(maxRow, fp.bid[k] + fp.ask[k]);
    if (n >= 3 && maxRow > 0) {
        const hiB = fp.ask[n - 1], hiS = fp.bid[n - 1], loB = fp.ask[0], loS = fp.bid[0];
        if (hiB <= 0.05 * maxRow) notes.push('Almost no buying at the high — buyers ran out there (finished auction).');
        else if (hiB > 0.25 * maxRow && hiS > 0.25 * maxRow) notes.push('Heavy two-sided trade at the high — unfinished auction, price may come back to it.');
        if (loS <= 0.05 * maxRow) notes.push('Almost no selling at the low — sellers ran out there (finished auction).');
        else if (loS > 0.25 * maxRow && loB > 0.25 * maxRow) notes.push('Heavy two-sided trade at the low — unfinished auction, price may come back to it.');
    }
    if (fp.coarse) notes.unshift('Built from a single lower-timeframe bar — the split by price is approximate.');


    const time = new Date(candle.time);
    const title = `${time.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
    const sub = `O ${px(candle.open)}  H ${px(candle.high)}  L ${px(candle.low)}  C ${px(candle.close)} · ${fp.src} data`;
    const kept = notes.slice(0, pr ? 3 : 4);
    if (pr) kept.push(`Odds: what followed the last closed candle's pattern (${pr.basis}) on this chart's history — statistics, not a guarantee.`);
    return { title, sub, sections, verdict, notes: kept };
}

// ─── HTML version (shown above HTML overlays such as indicator panels) ───────
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The chart's single tooltip element (created once per chart wrapper, reused). */
function tooltipEl(wrapperNode) {
    let el = wrapperNode.querySelector(':scope > .fp-hover-tip');
    if (!el) {
        el = document.createElement('div');
        el.className = 'fp-hover-tip';
        el.style.cssText = 'position:absolute;z-index:70;pointer-events:none;width:260px;padding:10px;border-radius:8px;'
            + 'font:11px/15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);display:none';
        wrapperNode.appendChild(el);
    }
    return el;
}

export function hideFootprintTooltip(wrapperNode) {
    const el = wrapperNode && wrapperNode.querySelector(':scope > .fp-hover-tip');
    if (el) el.style.display = 'none';
}

/** Show trusted HTML (built by us, values escaped) near (mx, my) inside `bounds`. */
export function showHtmlTooltip(wrapperNode, html, mx, my, bounds, isDark) {
    const el = tooltipEl(wrapperNode);
    el.innerHTML = html;
    el.style.background = isDark ? 'rgba(11,17,32,.97)' : 'rgba(255,255,255,.98)';
    el.style.border = `1px solid ${isDark ? '#334155' : '#cbd5e1'}`;
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = mx + 16, y = my + 16;
    if (x + w > bounds.maxX) x = mx - 16 - w;
    if (x < bounds.minX) x = bounds.minX;
    if (y + h > bounds.maxY) y = Math.max(bounds.minY, bounds.maxY - h);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
}
export { esc as escapeHtml };

/** Show `info` near (mx, my) (wrapper coordinates), kept inside `bounds`. */
export function showFootprintTooltip(wrapperNode, info, mx, my, bounds, colors, isDark) {
    const el = tooltipEl(wrapperNode);
    const tone = (t) => (t === 'buy' ? colors.bull : t === 'sell' ? colors.bear : t === 'muted' ? colors.text : colors.textBright);
    const head = isDark ? '#818cf8' : '#4f46e5';
    let html = `<div style="font-weight:700;font-size:12px;color:${colors.textBright}">${esc(info.title)}</div>`
        + `<div style="font-size:10px;color:${colors.text};margin-bottom:4px">${esc(info.sub)}</div>`;
    for (const sct of info.sections) {
        html += `<div style="margin-top:6px;font-size:10px;font-weight:700;letter-spacing:.04em;color:${head}">${esc(sct.heading.toUpperCase())}</div>`;
        for (const [label, value, t] of sct.rows) {
            html += `<div style="display:flex;justify-content:space-between;gap:8px"><span style="color:${colors.text}">${esc(label)}</span>`
                + `<span style="color:${tone(t)};text-align:right">${esc(value)}</span></div>`;
        }
    }
    html += `<div style="margin-top:8px;font-weight:700;font-size:12px;color:${tone(info.verdict.tone)}">${esc(info.verdict.text)}</div>`;
    if (info.notes.length) {
        html += `<ul style="margin:6px 0 0;padding-left:14px;color:${colors.textBright}">`
            + info.notes.map(n => `<li style="margin-top:2px">${esc(n)}</li>`).join('') + '</ul>';
    }
    el.innerHTML = html;
    el.style.background = isDark ? 'rgba(11,17,32,.97)' : 'rgba(255,255,255,.98)';
    el.style.border = `1px solid ${isDark ? '#334155' : '#cbd5e1'}`;
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = mx + 16, y = my + 16;
    if (x + w > bounds.maxX) x = mx - 16 - w;
    if (x < bounds.minX) x = bounds.minX;
    if (y + h > bounds.maxY) y = Math.max(bounds.minY, bounds.maxY - h);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
}
