// ─── Chart pattern detection ─────────────────────────────────────────────────
// Finds common chart patterns on the swing points of a zigzag (a new swing is
// confirmed when price reverses by `mult` × ATR):
//  • Harmonic XABCD: Gartley, Bat, Butterfly, Crab, Cypher (Fibonacci ratio ranges)
//  • Head & Shoulders / Inverse Head & Shoulders (with neckline)
//  • Double Top / Double Bottom
//  • Triangles (ascending, descending, symmetrical) and wedges (rising, falling)
//  • Bull / Bear Flag (pole + counter-trend channel) and Cup and Handle
//  • Potential patterns at the current candle: harmonic D zone, right shoulder
//    zone of a head & shoulders, second top/bottom of a double top/bottom
// The latest swing is "tentative" (not yet confirmed), so patterns that end on
// it are marked "forming". Shapes only — not trade signals.
// Rules follow the standard references: Carney "Harmonic Trading" (ratios),
// Edwards & Magee / Bulkowski "Encyclopedia of Chart Patterns" (reversal patterns
// need a prior trend; a close through the neckline confirms; price going beyond
// the head / tops first invalidates), O'Neil (cup and handle: prior advance,
// handle in the upper half and shorter than the cup).
// Runs in the data worker; O(candles + swings).

export const PATTERN_DEFAULTS = {
    ptEnabled: false,
    ptHarmonic: true,
    ptHeadShoulders: true,
    ptDouble: true,
    ptTriangles: true,
    ptFlags: true,
    ptCup: true,
    ptPotential: true,          // patterns still forming at the current candle (projected zones)
    ptSensitivity: 'medium',     // low | medium | high (fewer → more patterns)
};
const SENSITIVITY_MULT = { low: 3, medium: 2.2, high: 1.5 };

export const PATTERN_COLORS = {
    Gartley: '#22d3ee', Bat: '#a78bfa', Butterfly: '#f472b6', Crab: '#fb923c', Cypher: '#facc15',
    'Head & Shoulders': '#f87171', 'Inverse Head & Shoulders': '#34d399',
    'Double Top': '#ef4444', 'Double Bottom': '#10b981',
    'Ascending Triangle': '#60a5fa', 'Descending Triangle': '#60a5fa', 'Symmetrical Triangle': '#60a5fa',
    'Rising Wedge': '#c084fc', 'Falling Wedge': '#c084fc',
    'Bull Flag': '#4ade80', 'Bear Flag': '#f87171', 'Cup and Handle': '#fbbf24',
};

function atrSeries(c, len = 14) {
    const out = new Float64Array(c.length);
    let atr = c[0].high - c[0].low;
    for (let i = 0; i < c.length; i++) {
        const tr = i === 0 ? c[i].high - c[i].low
            : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
        atr = i === 0 ? tr : atr + (tr - atr) / len;
        out[i] = atr;
    }
    return out;
}

/** Alternating swing highs/lows: [{ i, type: 'H'|'L', price, tentative? }] */
function zigzag(c, atr, mult) {
    const piv = [];
    let dir = 0, ext = 0, hi = 0, lo = 0;
    for (let i = 1; i < c.length; i++) {
        const th = mult * atr[i];
        if (dir === 0) {
            if (c[i].high >= c[hi].high) hi = i;
            if (c[i].low <= c[lo].low) lo = i;
            if (hi < i && c[hi].high - c[i].low >= th) { piv.push({ i: hi, type: 'H', price: c[hi].high }); dir = -1; ext = i; }
            else if (lo < i && c[i].high - c[lo].low >= th) { piv.push({ i: lo, type: 'L', price: c[lo].low }); dir = 1; ext = i; }
        } else if (dir === 1) {
            if (c[i].high >= c[ext].high) ext = i;
            else if (c[ext].high - c[i].low >= th) { piv.push({ i: ext, type: 'H', price: c[ext].high }); dir = -1; ext = i; }
        } else {
            if (c[i].low <= c[ext].low) ext = i;
            else if (c[i].high - c[ext].low >= th) { piv.push({ i: ext, type: 'L', price: c[ext].low }); dir = 1; ext = i; }
        }
    }
    if (dir !== 0) piv.push({ i: ext, type: dir === 1 ? 'H' : 'L', price: dir === 1 ? c[ext].high : c[ext].low, tentative: true });
    return piv;
}

const within = (v, lo, hi) => v >= lo && v <= hi;

// Harmonic ratio rules (Scott Carney's ranges, ±tolerance on single values)
const HARMONICS = [
    { name: 'Gartley',   ab: [0.58, 0.66],  bc: [0.382, 0.886], cd: [1.272, 1.618], ad: [0.75, 0.82] },
    { name: 'Bat',       ab: [0.382, 0.5],  bc: [0.382, 0.886], cd: [1.618, 2.618], ad: [0.85, 0.92] },
    { name: 'Butterfly', ab: [0.75, 0.82],  bc: [0.382, 0.886], cd: [1.618, 2.618], ad: [1.27, 1.618] },
    { name: 'Crab',      ab: [0.382, 0.618], bc: [0.382, 0.886], cd: [2.24, 3.618], ad: [1.55, 1.70] },
];

function harmonic(p) {
    const [X, A, B, C, D] = p;
    const bull = X.type === 'L';                         // X low → A high → … → D low (buy zone)
    const XA = Math.abs(A.price - X.price), AB = Math.abs(B.price - A.price);
    const BC = Math.abs(C.price - B.price), CD = Math.abs(D.price - C.price);
    if (!XA || !AB || !BC) return null;
    const ab = AB / XA, bc = BC / AB, cd = CD / BC, ad = Math.abs(A.price - D.price) / XA;
    for (const h of HARMONICS) {
        if (within(ab, ...h.ab) && within(bc, ...h.bc) && within(cd, ...h.cd) && within(ad, ...h.ad)) {
            return { name: h.name, side: bull ? 'bull' : 'bear', ratios: { ab, bc, cd, ad } };
        }
    }
    // Cypher: B 0.382–0.618 XA, C beyond A at 1.13–1.414 XA, D = 0.786 of XC
    const cExt = Math.abs(C.price - X.price) / XA;
    const XC = Math.abs(C.price - X.price);
    const beyondA = bull ? C.price > A.price : C.price < A.price;
    if (beyondA && within(ab, 0.382, 0.618) && within(cExt, 1.13, 1.414) && XC && within(Math.abs(C.price - D.price) / XC, 0.75, 0.82)) {
        return { name: 'Cypher', side: bull ? 'bull' : 'bear', ratios: { ab, cExt } };
    }
    return null;
}

/**
 * Prior trend into a reversal pattern (Edwards & Magee): within `len` bars before
 * bar `i`, price must have been beyond `level` — below it for a top (it rose
 * into the pattern), above it for a bottom.
 */
function priorTrend(c, i, len, level, top) {
    const from = Math.max(0, i - len);               // whatever history exists before the pattern
    for (let j = from; j < i; j++) if (top ? c[j].low < level : c[j].high > level) return true;
    return false;
}

/** Price on the line through (i1,p1)–(i2,p2) at bar i. */
const lineAt = (i1, p1, i2, p2, i) => p1 + ((p2 - p1) * (i - i1)) / (i2 - i1);

export function detectPatterns(c, s = {}) {
    const o = { ...PATTERN_DEFAULTS, ...s };
    if (!o.ptEnabled || c.length < 60) return [];
    const atr = atrSeries(c);
    const piv = zigzag(c, atr, SENSITIVITY_MULT[o.ptSensitivity] || 2.2);
    const last = c.length - 1;
    const found = [];
    const pt = (p, label) => ({ time: c[p.i].time, price: p.price, label });

    for (let k = 0; k + 4 < piv.length; k++) {
        const w = piv.slice(k, k + 5);
        const tentative = !!w[4].tentative;

        if (o.ptHarmonic) {
            const h = harmonic(w);
            if (h) found.push({
                kind: 'harmonic', name: h.name, side: h.side, status: tentative ? 'forming' : 'complete',
                points: w.map((p, j) => pt(p, 'XABCD'[j])), endIdx: w[4].i,
            });
        }

        if (o.ptHeadShoulders) {
            // H&S: LS(H) T1(L) Head(H) T2(L) RS(H); inverse mirrored
            const top = w[0].type === 'H';
            const [LS, T1, H, T2, RS] = w;
            const ext = (a, b) => (top ? a > b : a < b);
            if (ext(H.price, LS.price) && ext(H.price, RS.price)) {
                const neckMid = (T1.price + T2.price) / 2;
                const height = Math.abs(H.price - neckMid);
                const shoulderGap = Math.abs(LS.price - RS.price);
                const headOver = Math.min(Math.abs(H.price - LS.price), Math.abs(H.price - RS.price));
                const neckTilt = Math.abs(T1.price - T2.price);
                // shoulders roughly symmetric in time (right side 1/3 … 3× the left)
                const tRatio = (RS.i - H.i) / Math.max(1, H.i - LS.i);
                // a reversal: price trended into the left shoulder from beyond the neckline
                const trendIn = priorTrend(c, LS.i, H.i - LS.i, top ? Math.min(T1.price, T2.price) : Math.max(T1.price, T2.price), top);
                if (height > 2 * atr[H.i] && shoulderGap <= 0.35 * height && headOver >= 0.15 * height && neckTilt <= 0.4 * height
                    && tRatio >= 1 / 3 && tRatio <= 3 && trendIn) {
                    // Confirmed once a later close breaks the neckline; invalid if price
                    // goes beyond the head first
                    let broke = -1, failed = false;
                    for (let i = RS.i + 1; i <= Math.min(last, RS.i + 60); i++) {
                        if (top ? c[i].high > H.price : c[i].low < H.price) { failed = true; break; }
                        const neck = lineAt(T1.i, T1.price, T2.i, T2.price, i);
                        if (top ? c[i].close < neck : c[i].close > neck) { broke = i; break; }
                    }
                    if (!failed) found.push({
                        kind: 'hs', name: top ? 'Head & Shoulders' : 'Inverse Head & Shoulders', side: top ? 'bear' : 'bull',
                        status: broke >= 0 ? 'confirmed' : 'forming',
                        points: [pt(LS, 'LS'), pt(T1, ''), pt(H, 'H'), pt(T2, ''), pt(RS, 'RS')],
                        neck: { t1: c[T1.i].time, p1: T1.price, t2: c[T2.i].time, p2: T2.price, endTime: c[broke >= 0 ? broke : last].time,
                            endPrice: lineAt(T1.i, T1.price, T2.i, T2.price, broke >= 0 ? broke : last) },
                        endIdx: RS.i,
                    });
                }
            }
        }
    }

    if (o.ptDouble) {
        for (let k = 0; k + 2 < piv.length; k++) {
            const [P1, T, P2] = piv.slice(k, k + 3);
            const top = P1.type === 'H';
            const tol = 0.6 * atr[P2.i];
            const depth = top ? Math.min(P1.price, P2.price) - T.price : T.price - Math.max(P1.price, P2.price);
            // tops well apart (Bulkowski: distinct peaks, not one choppy top) and a
            // prior trend into the first top from beyond the trough
            if (Math.abs(P1.price - P2.price) <= tol && depth >= 2.5 * atr[P2.i] && P2.i - P1.i >= 10
                && priorTrend(c, P1.i, P2.i - P1.i, T.price, top)) {
                // confirmed by a close through the trough; invalid if price closes
                // beyond both tops first
                const ext = top ? Math.max(P1.price, P2.price) : Math.min(P1.price, P2.price);
                let broke = -1, failed = false;
                for (let i = P2.i + 1; i <= Math.min(last, P2.i + 60); i++) {
                    if (top ? c[i].close > ext : c[i].close < ext) { failed = true; break; }
                    if (top ? c[i].close < T.price : c[i].close > T.price) { broke = i; break; }
                }
                if (!failed) found.push({
                    kind: 'double', name: top ? 'Double Top' : 'Double Bottom', side: top ? 'bear' : 'bull',
                    status: broke >= 0 ? 'confirmed' : P2.tentative ? 'forming' : 'complete',
                    points: [pt(P1, top ? 'Top 1' : 'Bottom 1'), pt(T, ''), pt(P2, top ? 'Top 2' : 'Bottom 2')],
                    neck: { t1: c[T.i].time, p1: T.price, t2: c[broke >= 0 ? broke : last].time, p2: T.price, endTime: c[broke >= 0 ? broke : last].time, endPrice: T.price },
                    endIdx: P2.i,
                });
            }
        }
    }

    if (o.ptTriangles && piv.length >= 4) {
        // Latest 2 swing highs + 2 swing lows (interleaved): two converging lines
        const w = piv.slice(-5);
        const highs = w.filter(p => p.type === 'H').slice(-2), lows = w.filter(p => p.type === 'L').slice(-2);
        if (highs.length === 2 && lows.length === 2) {
            const [h1, h2] = highs, [l1, l2] = lows;
            const a = atr[last] || 1;
            const su = (h2.price - h1.price) / (h2.i - h1.i) / a;       // slope in ATR per bar
            const sl = (l2.price - l1.price) / (l2.i - l1.i) / a;
            const flat = 0.02;
            const startI = Math.min(h1.i, l1.i);
            const gapStart = lineAt(h1.i, h1.price, h2.i, h2.price, startI) - lineAt(l1.i, l1.price, l2.i, l2.price, startI);
            const gapEnd = lineAt(h1.i, h1.price, h2.i, h2.price, last) - lineAt(l1.i, l1.price, l2.i, l2.price, last);
            const converging = gapEnd > 0 && gapEnd < gapStart && gapStart > 2 * a;
            let name = null, side = null;
            if (converging) {
                if (Math.abs(su) < flat && sl > flat) { name = 'Ascending Triangle'; side = 'bull'; }
                else if (su < -flat && Math.abs(sl) < flat) { name = 'Descending Triangle'; side = 'bear'; }
                else if (su < -flat && sl > flat) { name = 'Symmetrical Triangle'; side = null; }
                else if (su > flat && sl > flat && sl > su) { name = 'Rising Wedge'; side = 'bear'; }
                else if (su < -flat && sl < -flat && su < sl) { name = 'Falling Wedge'; side = 'bull'; }
            }
            // Breakout: a close outside the lines after the last touch
            let brk = 0;
            for (let i = Math.max(h2.i, l2.i) + 1; i <= last && !brk; i++) {
                if (c[i].close > lineAt(h1.i, h1.price, h2.i, h2.price, i)) brk = 1;
                else if (c[i].close < lineAt(l1.i, l1.price, l2.i, l2.price, i)) brk = -1;
            }
            if (name && last - Math.max(h2.i, l2.i) <= 40) {
                found.push({
                    kind: 'triangle', name, side, status: brk ? 'confirmed' : 'forming', breakout: brk ? (brk > 0 ? 'up' : 'down') : null,
                    points: [pt(h1, ''), pt(h2, ''), pt(l1, ''), pt(l2, '')],
                    upper: { t1: c[h1.i].time, p1: h1.price, t2: c[last].time, p2: lineAt(h1.i, h1.price, h2.i, h2.price, last) },
                    lower: { t1: c[l1.i].time, p1: l1.price, t2: c[last].time, p2: lineAt(l1.i, l1.price, l2.i, l2.price, last) },
                    endIdx: last,
                });
            }
        }
    }

    // ── Flag & pole: strong impulse, then a short channel against it ──
    if (o.ptFlags) {
        const tried = new Set();
        for (let end = last; end >= Math.max(40, last - 400); end -= (end === last ? 1 : 3)) {
            const f = findFlag(c, atr, end);
            if (!f || tried.has(f.poleStart)) continue;
            tried.add(f.poleStart);
            // Breakout after the flag (only for flags ending before the live candle)
            let broke = -1;
            if (end < last) {
                for (let i = end + 1; i <= Math.min(last, end + 20); i++) {
                    if (f.bull ? c[i].close > f.hiLine(i) : c[i].close < f.loLine(i)) { broke = i; break; }
                }
                if (broke < 0) continue;            // historical flags only when they broke out
            }
            const brk = broke >= 0 ? broke : last;
            const target = f.bull ? c[brk].close + f.pole : c[brk].close - f.pole;
            found.push({
                kind: 'flag', name: f.bull ? 'Bull Flag' : 'Bear Flag', side: f.bull ? 'bull' : 'bear',
                status: broke >= 0 ? 'confirmed' : 'forming',
                points: [{ time: c[f.poleStart].time, price: f.poleFrom, label: '' }, { time: c[f.poleEnd].time, price: f.poleTo, label: '' }],
                upper: { t1: c[f.flagStart].time, p1: f.hiLine(f.flagStart), t2: c[end].time, p2: f.hiLine(end) },
                lower: { t1: c[f.flagStart].time, p1: f.loLine(f.flagStart), t2: c[end].time, p2: f.loLine(end) },
                target: { time: c[brk].time, from: c[brk].close, price: target },
                endIdx: end,
            });
            if (found.filter(x => x.kind === 'flag').length >= 3) break;
            end -= 10;
        }
    }

    // ── Cup and handle: rounded bottom between two similar highs + small pullback ──
    if (o.ptCup) {
        for (let k = piv.length - 3; k >= 0; k--) {
            const [R1, B, R2] = piv.slice(k, k + 3);
            if (R1.type !== 'H' || B.type !== 'L') continue;
            const depth = Math.min(R1.price, R2.price) - B.price;
            const width = R2.i - R1.i;
            const a = atr[B.i];
            if (width < 20 || depth < 3 * a || Math.abs(R1.price - R2.price) > Math.max(1.5 * a, 0.15 * depth)) continue;
            // Rounded, not V-shaped: the bottom sits mid-cup and price spends time near it
            const pos = (B.i - R1.i) / width;
            let nearBottom = 0;
            for (let i = R1.i; i <= R2.i; i++) if (c[i].low <= B.price + depth / 3) nearBottom++;
            if (pos < 0.25 || pos > 0.75 || nearBottom / width < 0.25) continue;
            // O'Neil: the cup follows an advance — price rose into the left rim by at least the cup depth
            if (!priorTrend(c, R1.i, width, R1.price - depth, true)) continue;
            // Handle: the swing after the right rim pulls back less than half the depth
            const H = piv[k + 3];
            const rim = Math.max(R1.price, R2.price);
            let status = 'forming', handle = null;
            if (H && H.type === 'L') {
                const pull = R2.price - H.price;
                if (pull > 0.5 * depth || H.i - R2.i < 3 || H.i - R2.i > 0.5 * width) continue;   // handle: upper half, shorter than the cup
                handle = H;
                for (let i = H.i + 1; i <= Math.min(last, H.i + 40); i++) if (c[i].close > rim) { status = 'confirmed'; break; }
            }
            const pts = [pt(R1, 'Rim'), pt(B, 'Cup'), pt(R2, 'Rim')];
            if (handle) pts.push(pt(handle, 'Handle'));
            found.push({
                kind: 'cup', name: 'Cup and Handle', side: 'bull', status: handle ? status : 'forming',
                points: pts, rim: { t1: c[R1.i].time, t2: c[handle ? Math.min(last, handle.i + 10) : R2.i].time, price: rim },
                cupLows: sampleLows(c, R1.i, R2.i, 24),
                endIdx: handle ? handle.i : R2.i,
            });
            if (found.filter(x => x.kind === 'cup').length >= 2) break;
        }
    }

    // ── Potential patterns at the current candle (projected completion zones) ──
    if (o.ptPotential && piv.length >= 4) {
        const conf = piv.filter(p => !p.tentative);
        const lastPrice = c[last].close;
        const a = atr[last] || 1;
        // Harmonic: X A B C confirmed, current leg heading to D → D zone
        if (o.ptHarmonic && conf.length >= 4) {
            const [X, A, B, C] = conf.slice(-4);
            const XA = Math.abs(A.price - X.price), AB = Math.abs(B.price - A.price), BC = Math.abs(C.price - B.price);
            const bull = X.type === 'L';
            if (XA && AB && BC) {
                const ab = AB / XA, bc = BC / AB;
                for (const h of HARMONICS) {
                    if (!within(ab, ...h.ab) || !within(bc, ...h.bc)) continue;
                    // D price range from both rules (retracement of XA, extension of BC)
                    const dir = bull ? -1 : 1;
                    const fromA = h.ad.map(r => A.price + dir * r * XA);
                    const fromC = h.cd.map(r => C.price + dir * r * BC);
                    const lo = Math.max(Math.min(...fromA), Math.min(...fromC)), hi = Math.min(Math.max(...fromA), Math.max(...fromC));
                    if (lo >= hi) continue;
                    // Price still on its way to (or inside) the zone
                    const ahead = bull ? lastPrice >= lo - 0.5 * a : lastPrice <= hi + 0.5 * a;
                    if (!ahead || last - C.i > 3 * (C.i - B.i) + 10) continue;
                    found.push({
                        kind: 'potential', name: h.name, side: bull ? 'bull' : 'bear', status: 'potential',
                        points: [pt(X, 'X'), pt(A, 'A'), pt(B, 'B'), pt(C, 'C')],
                        zone: { lo, hi, label: 'D zone', bars: Math.max(5, Math.round((C.i - B.i) * 0.8)) },
                        endIdx: last,
                    });
                    break;
                }
            }
        }
        // Head & shoulders: LS T1 Head T2 confirmed, head is the extreme → right shoulder zone
        if (o.ptHeadShoulders && conf.length >= 4) {
            const [LS, T1, Hd, T2] = conf.slice(-4);
            const top = LS.type === 'H';
            const ext = (x, y2) => (top ? x > y2 : x < y2);
            const height = Math.abs(Hd.price - (T1.price + T2.price) / 2);
            if (ext(Hd.price, LS.price) && height > 2 * atr[Hd.i] && Math.abs(Hd.price - LS.price) >= 0.15 * height
                && priorTrend(c, LS.i, Hd.i - LS.i, top ? Math.min(T1.price, T2.price) : Math.max(T1.price, T2.price), top)) {
                const tol = 0.35 * height;
                const lo = LS.price - tol, hi = Math.min(LS.price + tol, top ? Hd.price : Infinity);
                const zlo = top ? lo : Math.max(LS.price - tol, Hd.price), zhi = top ? hi : LS.price + tol;
                const stillForming = top ? lastPrice < Hd.price : lastPrice > Hd.price;
                if (stillForming && last - T2.i <= 2 * (T2.i - Hd.i) + 10) {
                    found.push({
                        kind: 'potential', name: top ? 'Head & Shoulders' : 'Inverse Head & Shoulders', side: top ? 'bear' : 'bull', status: 'potential',
                        points: [pt(LS, 'LS'), pt(T1, ''), pt(Hd, 'H'), pt(T2, '')],
                        zone: { lo: Math.min(zlo, zhi), hi: Math.max(zlo, zhi), label: 'Right shoulder', bars: Math.max(5, Hd.i - LS.i) },
                        neck: { t1: c[T1.i].time, p1: T1.price, t2: c[T2.i].time, p2: T2.price, endTime: c[last].time, endPrice: lineAt(T1.i, T1.price, T2.i, T2.price, last) },
                        endIdx: last,
                    });
                }
            }
        }
        // Double top/bottom: first top + trough confirmed, price heading back to the first top
        if (o.ptDouble && conf.length >= 2) {
            const [P1, T] = conf.slice(-2);
            const top = P1.type === 'H';
            const depth = Math.abs(P1.price - T.price);
            const near = top ? lastPrice < P1.price + 0.6 * a && lastPrice > P1.price - 0.5 * depth
                             : lastPrice > P1.price - 0.6 * a && lastPrice < P1.price + 0.5 * depth;
            if (depth >= 2.5 * atr[T.i] && near && last - T.i >= 2) {
                found.push({
                    kind: 'potential', name: top ? 'Double Top' : 'Double Bottom', side: top ? 'bear' : 'bull', status: 'potential',
                    points: [pt(P1, top ? 'Top 1' : 'Bottom 1'), pt(T, '')],
                    zone: { lo: P1.price - 0.6 * a, hi: P1.price + 0.6 * a, label: top ? 'Second top' : 'Second bottom', bars: Math.max(5, T.i - P1.i) },
                    endIdx: last,
                });
            }
        }
    }

    // Most recent first, a few per kind (so frequent shapes don't crowd out rare
    // harmonics), dropping overlapping duplicates of the same kind
    const CAP = { harmonic: 4, hs: 3, double: 3, triangle: 1, flag: 3, cup: 2, potential: 3 };
    found.sort((x, y) => y.endIdx - x.endIdx);
    const kept = [], perKind = {};
    for (const f of found) {
        if ((perKind[f.kind] || 0) >= CAP[f.kind]) continue;
        if (kept.some(k => k.kind === f.kind && Math.abs(k.endIdx - f.endIdx) < 10)) continue;
        kept.push(f);
        perKind[f.kind] = (perKind[f.kind] || 0) + 1;
    }
    for (const f of kept) f.color = PATTERN_COLORS[f.name] || '#94a3b8';
    return kept;
}

/**
 * Flag ending at bar `end`: a pole (move ≥ 4 ATR within ≤ 15 bars) followed by
 * 5–20 bars of tight, counter-trend (or flat) drift retracing ≤ 50% of the pole.
 */
function findFlag(c, atr, end) {
    for (let len = 5; len <= 20; len++) {
        const fs = end - len + 1;                 // flag start
        if (fs < 16) break;
        const a = atr[fs];
        // Pole: largest move into the flag start within 15 bars
        let lowI = fs, highI = fs;
        for (let i = fs - 15; i <= fs; i++) {
            if (c[i].low < c[lowI].low) lowI = i;
            if (c[i].high > c[highI].high) highI = i;
        }
        const up = c[highI].high - c[lowI].low;
        const bull = lowI < highI && highI >= fs - 3;
        const bear = highI < lowI && lowI >= fs - 3;
        if (!(bull || bear) || up < 4 * a) continue;
        // Flag channel: regression of closes over the flag, band = max deviation
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let i = fs; i <= end; i++) { const xx = i - fs; sx += xx; sy += c[i].close; sxx += xx * xx; sxy += xx * c[i].close; }
        const n = end - fs + 1, den = n * sxx - sx * sx;
        const slope = den ? (n * sxy - sx * sy) / den : 0, icpt = (sy - slope * sx) / n;
        let hiDev = 0, loDev = 0, fHigh = -Infinity, fLow = Infinity;
        for (let i = fs; i <= end; i++) {
            const m = icpt + slope * (i - fs);
            hiDev = Math.max(hiDev, c[i].high - m); loDev = Math.max(loDev, m - c[i].low);
            fHigh = Math.max(fHigh, c[i].high); fLow = Math.min(fLow, c[i].low);
        }
        const range = fHigh - fLow;
        const retrace = bull ? (c[highI].high - fLow) / up : (fHigh - c[lowI].low) / up;
        const against = bull ? slope <= 0.05 * a : slope >= -0.05 * a;   // drifts against the pole (or flat)
        if (range > 0.5 * up || retrace > 0.5 || !against || hiDev + loDev > 0.6 * up) continue;
        return {
            bull, pole: up, poleStart: bull ? lowI : highI, poleEnd: bull ? highI : lowI,
            poleFrom: bull ? c[lowI].low : c[highI].high, poleTo: bull ? c[highI].high : c[lowI].low,
            flagStart: fs,
            hiLine: (i) => icpt + slope * (i - fs) + hiDev,
            loLine: (i) => icpt + slope * (i - fs) - loDev,
        };
    }
    return null;
}

/** Lowest low in each of `k` slices of [i0, i1] — draws the cup's curve. */
function sampleLows(c, i0, i1, k) {
    const out = [];
    const step = Math.max(1, Math.floor((i1 - i0) / k));
    for (let i = i0; i <= i1; i += step) {
        let lo = i;
        for (let j = i; j < Math.min(i1 + 1, i + step); j++) if (c[j].low < c[lo].low) lo = j;
        out.push({ time: c[lo].time, price: c[lo].low });
    }
    return out;
}
