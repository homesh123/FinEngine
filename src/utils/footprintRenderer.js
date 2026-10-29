// ─── Volume footprint renderer (TradingView-style) ───────────────────────────
// Column per candle: thin candle on the left, then the footprint cells.
//  Type  Buy & Sell : sell volume on the left half, buy on the right
//        Delta      : one column with buy − sell per row
//        Total      : one column with buy + sell per row
//        Ladder     : buy & sell, with the larger side of each row highlighted
//  Display Cluster : equal-width cells;  Profile : cell width ∝ volume
//  Gradient: 4 colour steps by volume, buy and sell sides scaled separately
//  Imbalance: vertical line right of the row (buy) / left of the row (sell)
//  Stacked imbalances: zones projected right until price trades back into them
//  Value area: VAH line above / VAL line below the VA rows;  POC: outlined row
//  Summary: Info Box under each candle, or a Table band at the bottom
import { footprintSettings } from './footprint.js';
import { drawProjection } from './projection.js';

const GRADIENT_ALPHA = [0.12, 0.26, 0.42, 0.6];   // the 4 gradient steps

export const TABLE_ROW_LABELS = {
    volume: 'Volume', volChangePct: 'Vol chg %', buy: 'Buy vol', buyPct: 'Buy %',
    sell: 'Sell vol', sellPct: 'Sell %', delta: 'Delta', deltaPct: 'Delta %',
    minDelta: 'Min Δ', maxDelta: 'Max Δ', cvd: 'Session CVD', poc: 'POC', hlRange: 'HL range',
};

const ROW_H = 14;

/** Pixels to keep free at the bottom of the main chart for the summary. */
export function footprintReservePx(state) {
    const s = footprintSettings(state.footprintSettings);
    if (s.summary === 'table') return s.tableRows.length * ROW_H + 8;
    if (s.summary === 'infobox') return 58;
    return 0;
}

function fmtNum(v, digits = 0) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const n = Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(digits);
    return n;
}

function stepAlpha(v, min, max) {
    if (!(v > 0)) return 0;
    const r = max > min ? (v - min) / (max - min) : 1;
    return GRADIENT_ALPHA[r < 0.25 ? 0 : r < 0.5 ? 1 : r < 0.75 ? 2 : 3];
}

/**
 * [min, max] volume over a footprint's rows, as in TradingView's gradient:
 * every level counts (an empty level makes the minimum 0). `filter` picks the
 * rows of one side (e.g. positive deltas) when sides are scaled separately.
 */
function sideRange(arr, filter) {
    let min = Infinity, max = 0;
    for (let k = 0; k < arr.length; k++) {
        if (filter && !filter(arr[k])) continue;
        const v = Math.abs(arr[k]);
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return [min === Infinity ? 0 : min, max];
}

export function drawFootprint(ctx, data, x, y, bw, halfBw, chartWidth, chartHeight, colors, state) {
    const s = footprintSettings(state.footprintSettings);
    const showText = state.layers?.footprintText !== false;
    const reserve = footprintReservePx(state);
    const tableTop = s.summary === 'table' ? chartHeight - reserve : chartHeight;
    let projHit = null;    // projection box area (for its hover explanation)

    // ── Stacked imbalance zones (behind the cells) ──
    if (s.stacked) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, chartWidth, tableTop);
        ctx.clip();
        for (const d of data) {
            if (!d.fp || !d.fp.stacks.length) continue;
            const xPos = x(d.time);
            if (xPos === undefined) continue;
            for (const z of d.fp.stacks) {
                const xEnd = z.endTime != null ? (x(z.endTime) ?? chartWidth) + halfBw : chartWidth;
                if (xEnd < 0) continue;
                const yT = y(z.hi), yB = y(z.lo);
                ctx.fillStyle = z.side === 'buy' ? colors.bull : colors.bear;
                ctx.globalAlpha = 0.12;
                ctx.fillRect(xPos + bw, yT, Math.max(0, xEnd - xPos - bw), yB - yT);
                ctx.globalAlpha = 0.7;
                ctx.fillRect(xPos + bw, yT, Math.max(0, xEnd - xPos - bw), 1);
                ctx.fillRect(xPos + bw, yB - 1, Math.max(0, xEnd - xPos - bw), 1);
                ctx.globalAlpha = 1;
            }
        }
        ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, chartWidth, tableTop);
    ctx.clip();

    // Cells are collected into a few paths keyed by colour + shade and filled
    // once per frame (thousands of cells → a handful of fills); text, POC,
    // value area and info boxes are drawn afterwards on top.
    const cellPaths = new Map();                  // `${colour}|${alpha}` → Path2D
    const addCell = (col, alpha, x0, y0, w, h) => {
        if (!(alpha > 0) || !(w > 0)) return;
        const k = `${col}|${alpha}`;
        let p = cellPaths.get(k);
        if (!p) { p = new Path2D(); cellPaths.set(k, p); }
        p.rect(x0, y0, w, h);
    };
    const overlays = [];                          // functions drawn after the cells
    // Delta bars: scale to the largest |delta| among visible candles
    let maxAbsDelta = 0;
    if (s.deltaBar !== false) {
        for (const d of data) {
            const xp = x(d.time);
            if (d.fp && xp !== undefined && xp + bw >= 0 && xp <= chartWidth) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(d.fp.stats.delta));
        }
    }
    const compact = bw < 8;                       // too narrow to read cells: plain candles tinted by delta

    for (const d of data) {
        const xPos = x(d.time);
        if (xPos === undefined || xPos + bw < 0 || xPos > chartWidth) continue;
        const cColor = d.close >= d.open ? colors.bull : colors.bear;
        const fp = d.fp;

        if (compact) {
            // Normal candle; body opacity = how one-sided the order flow was
            const cx = Math.round(xPos + halfBw) + 0.5;
            ctx.strokeStyle = cColor; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(cx, y(d.high)); ctx.lineTo(cx, y(d.low)); ctx.stroke();
            const bTop = y(Math.max(d.open, d.close));
            const strength = fp && fp.stats.volume ? Math.min(1, Math.abs(fp.stats.deltaPct) / 60) : 0.5;
            ctx.fillStyle = cColor; ctx.globalAlpha = 0.35 + 0.65 * strength;
            ctx.fillRect(xPos + bw * 0.1, bTop, Math.max(1, bw * 0.8), Math.max(1, y(Math.min(d.open, d.close)) - bTop));
            ctx.globalAlpha = 1;
            continue;
        }

        // Thin candle on the left of the column
        const candleW = Math.max(2, Math.min(6, bw * 0.07));
        const candleX = xPos + Math.max(1, bw * 0.03);
        const cx = Math.round(candleX + candleW / 2) + 0.5;
        ctx.strokeStyle = cColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, y(d.high));
        ctx.lineTo(cx, y(d.low));
        ctx.stroke();
        ctx.fillStyle = cColor;
        const bTop = y(Math.max(d.open, d.close));
        ctx.fillRect(candleX, bTop, candleW, Math.max(1, y(Math.min(d.open, d.close)) - bTop));

        if (!fp) continue;
        const n = fp.bid.length;
        const cellsX = candleX + candleW + Math.max(2, bw * 0.04);
        const cellsW = Math.max(1, xPos + bw - cellsX - 1);
        const rowPx = Math.abs(y(0) - y(fp.row));
        const twoSided = s.type === 'buySell' || s.type === 'ladder';
        const fontPx = Math.max(7, Math.min(12, Math.floor(rowPx * 0.72), Math.floor(cellsW / (twoSided ? 5.2 : 3.6))));
        const textOk = showText && rowPx >= 9 && cellsW >= (twoSided ? 26 : 18) && fontPx >= 7;   // same rule as before
        // Too narrow for "sell × buy" (< 26 px) but wide enough for one number:
        // show each row's delta (buy − sell) instead of hiding the numbers
        const deltaOnly = !textOk && twoSided && showText && rowPx >= 9 && cellsW >= 18;
        const fontD = Math.max(7, Math.min(11, Math.floor(rowPx * 0.72), Math.floor(cellsW / 3.6)));

        // Per-row values for the chosen type
        const isDelta = s.type === 'delta', isTotal = s.type === 'total';
        const singleVals = (isDelta || isTotal) ? Array.from(fp.bid, (b, k) => isDelta ? fp.ask[k] - b : fp.ask[k] + b) : null;
        const [bidMin, bidMax] = sideRange(fp.bid), [askMin, askMax] = sideRange(fp.ask);
        const [sMin, sMax] = singleVals ? sideRange(singleVals) : [0, 0];
        const [posMin, posMax] = isDelta ? sideRange(singleVals, v => v > 0) : [0, 0];
        const [negMin, negMax] = isDelta ? sideRange(singleVals, v => v < 0) : [0, 0];
        let maxRowVol = 0;
        for (let k = 0; k < n; k++) maxRowVol = Math.max(maxRowVol, fp.bid[k], fp.ask[k]);
        const mid = cellsX + cellsW / 2;
        const texts = textOk || deltaOnly ? [] : null;
        const shortNum = (v) => { const a = Math.abs(v); return a >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v); };

        for (let k = 0; k < n; k++) {
            const yTop = y((fp.base + k + 1) * fp.row), yBot = y((fp.base + k) * fp.row);
            if (yBot < 0 || yTop > tableTop) continue;
            const h = Math.max(1, yBot - yTop - 1), yc = yTop + (yBot - yTop) / 2;
            const b = fp.bid[k], a = fp.ask[k];

            if (singleVals) {
                const v = singleVals[k];
                const w = s.display === 'profile' ? cellsW * Math.min(1, Math.abs(v) / Math.max(1, sMax)) : cellsW;
                const [gMin, gMax] = isDelta ? (v >= 0 ? [posMin, posMax] : [negMin, negMax]) : [sMin, sMax];
                if (Math.abs(v) > 0) addCell(isTotal ? colors.text : (v >= 0 ? colors.bull : colors.bear), s.gradient ? stepAlpha(Math.abs(v), gMin, gMax) : 0.25, cellsX, yTop + 0.5, w, h);
                if (texts) texts.push([isDelta && v > 0 ? `+${v}` : String(v), mid, yc, 'center', colors.textBright, false]);
            } else {
                // Sell on the left half, buy on the right half
                const half = cellsW / 2 - 0.5;
                const wB = s.display === 'profile' ? half * Math.min(1, b / Math.max(1, maxRowVol)) : half;
                const wA = s.display === 'profile' ? half * Math.min(1, a / Math.max(1, maxRowVol)) : half;
                const ladderBid = s.type === 'ladder' && b > a, ladderAsk = s.type === 'ladder' && a > b;
                if (b > 0) addCell(colors.bear, s.type === 'ladder' ? (ladderBid ? 0.55 : 0.1) : (s.gradient ? stepAlpha(b, bidMin, bidMax) : 0.22), mid - 0.5 - wB, yTop + 0.5, wB, h);
                if (a > 0) addCell(colors.bull, s.type === 'ladder' ? (ladderAsk ? 0.55 : 0.1) : (s.gradient ? stepAlpha(a, askMin, askMax) : 0.22), mid + 0.5, yTop + 0.5, wA, h);
                // Imbalance: bar at the row edge + the winning number in bold colour
                // booleans (fp.*Imb are 0/1 numbers; the text passes compare against true/false)
                const sImb = !!(s.highlightImbalance && fp.sellImb[k]), bImb = !!(s.highlightImbalance && fp.buyImb[k]);
                if (bImb) addCell(colors.bull, 1, cellsX + cellsW - 2, yTop + 0.5, 2.5, h);
                if (sImb) addCell(colors.bear, 1, cellsX - 0.5, yTop + 0.5, 2.5, h);
                if (texts && textOk) {
                    texts.push([String(b), mid - 4, yc, 'right', sImb ? colors.bear : colors.textBright, sImb]);
                    texts.push([String(a), mid + 4, yc, 'left', bImb ? colors.bull : colors.textBright, bImb]);
                } else if (texts && (a || b)) {
                    const dv = a - b;
                    texts.push([`${dv > 0 ? '+' : ''}${shortNum(dv)}`, mid, yc, 'center', dv > 0 ? colors.bull : dv < 0 ? colors.bear : colors.text, true]);
                }
            }
        }

        // Unfinished auction: both sides still trading at the candle's extreme
        // (often revisited) — small hollow diamond beside the thin candle
        const unfinished = [];
        if (s.unfinishedAuction && n >= 3) {
            if (fp.bid[n - 1] > 0 && fp.ask[n - 1] > 0) unfinished.push(y(d.high));
            if (fp.bid[0] > 0 && fp.ask[0] > 0) unfinished.push(y(d.low));
        }

        overlays.push(() => {
            if (texts && texts.length) {
                // regular numbers first, then the bold imbalance ones: the font is set
                // twice per candle (changing ctx.font is expensive)
                ctx.textBaseline = 'middle';
                for (const pass of [false, true]) {
                    let set = false;
                    for (const [t, tx, ty, align, col, isBold] of texts) {
                        if (!!isBold !== pass) continue;
                        if (!set) { ctx.font = `${pass ? 'bold ' : ''}${textOk ? fontPx : fontD}px sans-serif`; set = true; }
                        ctx.textAlign = align; ctx.fillStyle = col; ctx.fillText(t, tx, ty);
                    }
                }
            }
            if (s.poc) {
                const yTop = y((fp.base + fp.poc + 1) * fp.row), yBot = y((fp.base + fp.poc) * fp.row);
                ctx.strokeStyle = colors.textBright; ctx.lineWidth = 1;
                ctx.strokeRect(cellsX + 0.5, yTop + 1, cellsW - 1, Math.max(1, yBot - yTop - 2));
            }
            // Value area: VAH line above, VAL line below the VA rows
            if (s.valueArea) {
                ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
                const vahY = y((fp.base + fp.vah + 1) * fp.row), valY = y((fp.base + fp.val) * fp.row);
                ctx.beginPath();
                ctx.moveTo(cellsX, vahY); ctx.lineTo(cellsX + cellsW, vahY);
                ctx.moveTo(cellsX, valY); ctx.lineTo(cellsX + cellsW, valY);
                ctx.stroke(); ctx.setLineDash([]);
            }
            for (const uy of unfinished) {
                ctx.strokeStyle = colors.textBright; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(cx - 6, uy - 3); ctx.lineTo(cx - 3, uy); ctx.lineTo(cx - 6, uy + 3); ctx.lineTo(cx - 9, uy); ctx.closePath(); ctx.stroke();
            }
            // Delta bar under the footprint: who won the candle (length vs the visible max)
            let below = y(fp.base * fp.row) + 3;
            if (s.deltaBar !== false && maxAbsDelta > 0) {
                const st = fp.stats, len = (Math.abs(st.delta) / maxAbsDelta) * cellsW;
                ctx.fillStyle = st.delta >= 0 ? colors.bull : colors.bear;
                ctx.globalAlpha = 0.85;
                if (st.delta >= 0) ctx.fillRect(mid, below, Math.max(1, len / 2), 3);
                else ctx.fillRect(mid - Math.max(1, len / 2), below, Math.max(1, len / 2), 3);
                ctx.globalAlpha = 0.35; ctx.fillRect(cellsX, below + 1, cellsW, 1); ctx.globalAlpha = 1;
                below += 5;
            }
            // Info Box under the footprint: volume, buy, sell, delta
            if (s.summary === 'infobox' && bw >= 34) {
                const st = fp.stats;
                const boxY = below + 1;
                const lines = [['Vol', fmtNum(st.volume), colors.textBright], ['Buy', fmtNum(st.buy), colors.bull],
                               ['Sell', fmtNum(st.sell), colors.bear], ['Δ', (st.delta > 0 ? '+' : '') + fmtNum(st.delta), st.delta >= 0 ? colors.bull : colors.bear]];
                const bh = lines.length * 11 + 6;
                if (boxY < tableTop - 4) {
                    ctx.fillStyle = colors.bg; ctx.globalAlpha = 0.9; ctx.fillRect(cellsX, boxY, cellsW, bh); ctx.globalAlpha = 1;
                    ctx.strokeStyle = colors.gridMajor; ctx.strokeRect(cellsX + 0.5, boxY + 0.5, cellsW - 1, bh - 1);
                    ctx.font = '9px sans-serif'; ctx.textBaseline = 'middle';
                    lines.forEach(([label, val, col], i) => {
                        const ly = boxY + 3 + i * 11 + 5.5;
                        ctx.textAlign = 'left'; ctx.fillStyle = colors.text; ctx.fillText(label, cellsX + 3, ly);
                        ctx.textAlign = 'right'; ctx.fillStyle = col; ctx.fillText(val, cellsX + cellsW - 3, ly);
                    });
                }
            }
            // Next-candle odds (live candle only)
            if (s.projection && fp.projection && d === data[data.length - 1]) {
                projHit = { rect: drawProjection(ctx, d, fp.projection, xPos + bw + 6, y, colors, state.timeframe, chartWidth), pr: fp.projection };
            }
            // Optional order-flow arrow above the column (only with a proven record)
            if (state.layers?.prediction && d.prediction && fp.arrowRecord?.proven) {
                ctx.fillStyle = d.prediction === 'UP' ? colors.bull : colors.bear;
                ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                ctx.fillText(d.prediction === 'UP' ? '▲' : '▼', xPos + halfBw, y((fp.base + n) * fp.row) - 2);
            }
        });
    }

    // Fill all cells, then everything that sits on top of them
    for (const [k, path] of cellPaths) {
        const i = k.lastIndexOf('|');
        ctx.fillStyle = k.slice(0, i); ctx.globalAlpha = Number(k.slice(i + 1));
        ctx.fill(path);
    }
    ctx.globalAlpha = 1;
    for (const f of overlays) f();

    // ── Visible-range volume profile on the right edge ──
    if (s.visibleProfile !== false && !compact) drawVisibleProfile(ctx, data, x, y, bw, chartWidth, tableTop, colors);
    ctx.restore();

    // ── Table summary band (aligned rows across candles) ──
    if (s.summary === 'table' && reserve > 0) {
        ctx.save();
        ctx.fillStyle = colors.bg;
        ctx.globalAlpha = 0.94;
        ctx.fillRect(0, tableTop, chartWidth, reserve);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.gridMajor;
        ctx.beginPath();
        ctx.moveTo(0, tableTop + 0.5);
        ctx.lineTo(chartWidth, tableTop + 0.5);
        ctx.stroke();
        const labelW = 72;
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'middle';
        s.tableRows.forEach((key, i) => {
            const cy = tableTop + 4 + i * ROW_H + ROW_H / 2;
            for (const d of data) {
                const xPos = x(d.time);
                if (!d.fp || xPos === undefined || xPos + bw < labelW || xPos > chartWidth || bw < 22) continue;
                const v = d.fp.stats[key];
                let txt, col = colors.textBright;
                if (key.endsWith('Pct')) { txt = v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`; }
                else if (key === 'poc') txt = v.toFixed(Math.max(0, -Math.floor(Math.log10(d.fp.tick))));
                else if (key === 'hlRange') txt = v.toFixed(Math.max(0, -Math.floor(Math.log10(d.fp.tick))));
                else txt = (['delta', 'minDelta', 'maxDelta', 'cvd'].includes(key) && v > 0 ? '+' : '') + fmtNum(v);
                if (['delta', 'deltaPct', 'minDelta', 'maxDelta', 'cvd', 'volChangePct'].includes(key) && v != null) col = v >= 0 ? colors.bull : colors.bear;
                ctx.fillStyle = col;
                ctx.textAlign = 'center';
                ctx.fillText(txt, xPos + halfBw, cy);
            }
            ctx.fillStyle = colors.bg;
            ctx.fillRect(0, cy - 7, labelW, 14);
            ctx.fillStyle = colors.textBright;
            ctx.textAlign = 'left';
            ctx.fillText(TABLE_ROW_LABELS[key] || key, 4, cy);
        });
        ctx.restore();
    }
    return projHit;
}

/** "Footprint · 1s data (recent) / 1m (older) · row 0.34" — shown in the chart legend. */
export function footprintSourceSummary(data) {
    if (!data || !data.length || !data[data.length - 1].fp) return null;
    const last = data[data.length - 1].fp;
    const srcs = new Set();
    let coarse = 0, total = 0;
    for (let i = Math.max(0, data.length - 200); i < data.length; i++) {
        if (!data[i].fp) continue;
        srcs.add(data[i].fp.src);
        total++;
        if (data[i].fp.coarse) coarse++;
    }
    // Most candles are a single lower-timeframe bar → the footprint can't show
    // how volume was distributed inside them
    return { sources: [...srcs], row: last.row, ticksPerRow: last.ticksPerRow, coarse: total > 0 && coarse / total > 0.5 };
}


/**
 * Visible-range volume profile: buy + sell volume at each price over the
 * candles on screen, drawn at the right edge (sell part, then buy part), with
 * the busiest price (POC) highlighted and labelled.
 */
function drawVisibleProfile(ctx, data, x, y, bw, chartWidth, tableTop, colors) {
    const rows = new Map();                       // row index → [sell, buy]
    let row = 0, maxTot = 0;
    for (const d of data) {
        const fp = d.fp, xp = x(d.time);
        if (!fp || xp === undefined || xp + bw < 0 || xp > chartWidth) continue;
        if (!row) row = fp.row;
        if (fp.row !== row) continue;             // row size changed (rare): keep one grid
        for (let k = 0; k < fp.bid.length; k++) {
            const key = fp.base + k;
            let r = rows.get(key);
            if (!r) { r = [0, 0]; rows.set(key, r); }
            r[0] += fp.bid[k]; r[1] += fp.ask[k];
        }
    }
    if (!rows.size || !row) return;
    let pocKey = null;
    for (const [k, [b, a]] of rows) if (b + a > maxTot) { maxTot = b + a; pocKey = k; }
    const W = Math.min(140, chartWidth * 0.16), right = chartWidth - 2;
    const sell = new Path2D(), buy = new Path2D();
    for (const [k, [b, a]] of rows) {
        const yt = y((k + 1) * row), yb = y(k * row);
        if (yb < 0 || yt > tableTop) continue;
        const h = Math.max(1, yb - yt - 1), wTot = ((b + a) / maxTot) * W, wB = (b / maxTot) * W;
        sell.rect(right - wTot, yt + 0.5, wB, h);
        buy.rect(right - wTot + wB, yt + 0.5, wTot - wB, h);
    }
    ctx.globalAlpha = 0.28; ctx.fillStyle = colors.bear; ctx.fill(sell);
    ctx.fillStyle = colors.bull; ctx.fill(buy); ctx.globalAlpha = 1;
    // POC of the visible range
    const py = y((pocKey + 0.5) * row);
    if (py >= 0 && py <= tableTop) {
        ctx.strokeStyle = colors.textBright; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(right - W, py); ctx.lineTo(right, py); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        const price = (pocKey + 0.5) * row;
        ctx.font = '9px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = colors.textBright;
        ctx.fillText(`VPOC ${Math.abs(price) >= 100 ? price.toFixed(2) : price.toFixed(5)}`, right, py - 2);
    }
}
