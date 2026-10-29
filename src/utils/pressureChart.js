// ─── Pressure Chart (Pro) — calculation core, v2.1 ───────────────────────────
// Port of the MT5 package "Pressure Chart v2.1 — Developer Reference" (Oct 2026;
// PressureCore.mqh + PressureChart.mq5) and the updated Build Specification.
//   Layer 1  pressure bars: colour = BuyShare (who won), width = RelVol (same
//            time-of-day median over N days, current bar excluded)
//   Layer 2  zones from impulses of ≥ 2 × ATR NET displacement (last close −
//            first open) with RelVol ≥ 1.3; base = last opposite-won bar; zone
//            0.3–1.5 ATR thick; order block if the impulse broke structure; FVG
//            +25 %; life cycle fresh → tested → used (visits / age) → broken
//   Layer 3  strength = (BuyShare − 0.5) × RelVol, EMA 5; CVD divergence between
//            confirmed pivots (within 60 bars)
//   Signals  per closed bar: UpdateZones → EvaluateSignals → DetectZones (a zone
//            never fires on the bar that made it); entry at ask for buys, stop =
//            zone or bar extreme ± 0.25 ATR, TP1 1.5R, TP2 nearest active
//            opposite zone else 3R, R:R after spread ≥ 2; best grade wins.
//   Replay   every signal simulated (ask/bid, spread, commission, stop first,
//            half at TP1 + break-even, time exit) → per-grade confidence
//            (Laplace + Wilson 95 %, no lookahead), typical hold, execution
//            window (valid N bars, void past 0.3R chase), grade-scaled lot size.
// Every pivot is used only from its confirmation bar, so nothing repaints and
// backtests see no future. Pure functions — also used by
// research/prediction/pressure_test.mjs.

export const PRESSURE_DEFAULTS = {
    pcDeltaSource: 'auto',   // 'auto' (lower-timeframe / exchange split) | 'off' (volume only)
    pcVolDays: 20, pcImpulseAtr: 2.0, pcImpulseRelVol: 1.3, pcMaxTouches: 2, pcZoneMaxAge: 300,
    pcPivotBars: 3, pcDivBars: 5,
    pcMinRR: 2.0, pcTp1R: 1.5, pcFallbackR: 3.0, pcStopAtr: 0.25, pcCooldown: 3,
    pcShowC: false, pcUseNews: true, pcSession: true,
    pcValidBars: 2, pcMaxChaseR: 0.3, pcMaxHoldBars: 100,
    pcSpread: 0, pcCommission: 0,   // spread in price units, commission USD per lot (round trip)
    pcRisk: 0.5, pcBalance: 10000,
    pcMeter: true, pcZones: true, pcLevels: true, pcCard: true,
};

const DAY = 86400000;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
// typed-array sort is numeric and native (much faster than sort with a comparator)
const median = (a) => { const s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const GRADES = ['C', 'B', 'A', 'A+'];
export const GRADE_RISK = { 'A+': 1, A: 1, B: 0.5, C: 0 };

/** Per-timeframe profile: bias timeframe (4–6 × the chart), session filter. */
export function pressureTfProfile(tfMins) {
    if (tfMins < 5) return { biasMins: 30, signals: false, note: 'M1 is not recommended (spread and tick noise) — signals off' };
    if (tfMins < 15) return { biasMins: 30, signals: true, asiaOnlyAPlus: true };
    if (tfMins < 60) return { biasMins: tfMins < 30 ? 60 : 240, signals: true, asiaOnlyAPlus: true };
    if (tfMins < 240) return { biasMins: 240, signals: true };
    if (tfMins < 1440) return { biasMins: 1440, signals: true };
    return { biasMins: 10080, signals: true };
}

/** USD per $1 move per 1.00 lot; null when the contract size is unknown. */
export function valuePerPointPerLot(symbol) {
    const s = String(symbol || '').toUpperCase().replace('/', '');
    return /^XAU|GOLD/.test(s) ? 100 : /^XAG|SILVER/.test(s) ? 5000 : /^(BTC|ETH)/.test(s) ? 1 : null;
}

/**
 * Lots = Balance × Risk% × k_grade / (stop distance × value per point + commission per lot),
 * rounded DOWN to 0.01. { lots, belowMin } — below the 0.01 minimum is reported, never rounded up.
 * Returns null when the contract size is unknown.
 */
export function pressureLots(symbol, balance, riskPct, stopDist, k = 1, commission = 0) {
    const v = valuePerPointPerLot(symbol);
    if (!v || !(stopDist > 0) || !(k > 0)) return v && k === 0 ? { lots: 0, belowMin: false, notTraded: true } : null;
    const raw = (balance * riskPct / 100 * k) / (stopDist * v + Math.max(0, commission));
    const lots = Math.floor(raw * 100 + 1e-9) / 100;
    return { lots, belowMin: lots < 0.01, raw };
}

/** Wilson 95 % interval for w wins out of n. */
function wilson(w, n) {
    if (!n) return [0, 1];
    const z = 1.96, p = w / n, d = 1 + z * z / n;
    const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

function wilderAtr(c, n = 14) {
    const out = new Float64Array(c.length);
    let a = 0;
    for (let i = 0; i < c.length; i++) {
        const tr = i ? Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)) : c[i].high - c[i].low;
        a = i < n ? (a * i + tr) / (i + 1) : a + (tr - a) / n;
        out[i] = a;
    }
    return out;
}

/** Asian session 00:00–08:00 UTC (v2.1 default). */
const isAsia = (ms) => Math.floor(ms / 3600000) % 24 < 8;

/**
 * candles: chronological { time, open, high, low, close, volume, buyVol?, ltfDelta? }
 *   buyVol   = real aggressive buy volume (exchange data)          → source 'real'
 *   ltfDelta = signed volume from lower-timeframe bars (tick rule)  → source 'ltf'
 *   neither  → close location (C − L)/(H − L), display only
 * opts: { tfMins, settings, formingLast = true, news = [ms…], symbol }
 */
export function calcPressure(candles, opts = {}) {
    const n = candles ? candles.length : 0;
    const s = { ...PRESSURE_DEFAULTS, ...(opts.settings || {}) };
    const tfMins = opts.tfMins || 15, tfMs = tfMins * 60000;
    const prof = pressureTfProfile(tfMins);
    const out = { bars: [], zones: [], signals: [], divs: [], trades: [], profile: prof, n, zonesMade: 0, funnel: {} };
    if (n < 30) return out;
    const funnel = out.funnel;
    const drop = (k) => { funnel[k] = (funnel[k] || 0) + 1; };

    const volDays = Math.max(3, Math.min(60, num(s.pcVolDays, 20)));
    const P = Math.max(2, Math.min(6, num(s.pcPivotBars, 3)));
    const divBars = Math.max(2, Math.min(20, num(s.pcDivBars, 5)));
    const impAtr = num(s.pcImpulseAtr, 2), impRv = num(s.pcImpulseRelVol, 1.3);
    const maxTouch = num(s.pcMaxTouches, 2), maxAge = num(s.pcZoneMaxAge, 300);
    const minRR = num(s.pcMinRR, 2), tp1R = num(s.pcTp1R, 1.5), fbR = num(s.pcFallbackR, 3), stopAtr = num(s.pcStopAtr, 0.25);
    const cooldown = num(s.pcCooldown, 3), spread = Math.max(0, num(s.pcSpread, 0));
    const lastClosed = opts.formingLast === false ? n - 1 : n - 2;
    const atr = wilderAtr(candles);
    const C = candles;

    // ── Layer 1: BuyShare, RelVol ──
    const bs = new Float64Array(n), rv = new Float64Array(n), src = new Array(n);
    const anyVol = C.some(c => c.volume > 0);
    const slots = new Map();                 // minute-of-day → previous days' volumes (ring of volDays)
    const recent = [];                       // previous 20 bars (fallback / D1)
    const srcCount = { real: 0, ltf: 0, clv: 0 };
    for (let i = 0; i < n; i++) {
        const c = C[i], v = c.volume || 0;
        if (c.buyVol != null && v > 0) { bs[i] = Math.max(0, Math.min(1, c.buyVol / v)); src[i] = 'real'; }
        else if (c.ltfDelta != null && v > 0) { bs[i] = Math.max(0, Math.min(1, 0.5 + c.ltfDelta / (2 * v))); src[i] = 'ltf'; }
        else { bs[i] = c.high > c.low ? (c.close - c.low) / (c.high - c.low) : 0.5; src[i] = 'clv'; }
        srcCount[src[i]]++;
        if (!anyVol) { rv[i] = 1; continue; }
        let base = null;
        if (tfMins < 1440) {
            const key = ((c.time % DAY) + DAY) % DAY;
            const hist = slots.get(key);
            if (hist && hist.length >= 5) base = median(hist);
            // pushed after use: the bar is never in its own baseline
            if (!hist) slots.set(key, [v]); else { hist.push(v); if (hist.length > volDays) hist.shift(); }
        }
        if (base === null && recent.length >= 5) base = median(recent);
        recent.push(v); if (recent.length > 20) recent.shift();
        rv[i] = base > 0 ? v / base : 1;
    }
    const mode = srcCount.real > n / 2 ? 'real' : srcCount.ltf > n / 2 ? 'ltf' : 'clv';

    // Redundancy test: ρ = corr(BuyShare, body ratio) on bars with a real split
    let rho = null;
    {
        let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0;
        for (let i = 0; i < n; i++) {
            const c = C[i]; if (!(c.high > c.low) || src[i] === 'clv') continue;
            const x = bs[i], y = (c.close - c.open) / (c.high - c.low);
            sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; m++;
        }
        if (m > 50) { const cv = sxy / m - (sx / m) * (sy / m), vx = sxx / m - (sx / m) ** 2, vy = syy / m - (sy / m) ** 2; rho = vx > 0 && vy > 0 ? cv / Math.sqrt(vx * vy) : null; }
        out.rhoSample = m;
    }
    // Delta "off": volume only (no BuyShare checks, divergence on RelVol)
    const deltaOff = s.pcDeltaSource === 'off' || mode === 'clv' || (rho !== null && rho > 0.8);
    const deltaOk = !deltaOff;
    // opposite-won without delta = candle direction
    const won = (i, dir) => (deltaOff ? (dir === 1 ? C[i].close > C[i].open : C[i].close < C[i].open) : (dir === 1 ? bs[i] > 0.5 : bs[i] < 0.5));

    // Strength, EMA 5, CVD
    const str = new Float64Array(n), ema = new Float64Array(n), cvd = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        str[i] = (bs[i] - 0.5) * rv[i];
        ema[i] = i ? ema[i - 1] + (str[i] - ema[i - 1]) * (2 / 6) : str[i];
        cvd[i] = (i ? cvd[i - 1] : 0) + (2 * bs[i] - 1) * (C[i].volume || 0);
    }

    // Pivot at j (confirmed at j + P): strictly above the P bars to the left, ≥ the P to the right
    const isPH = (arr, j, key) => { for (let m = 1; m <= P; m++) if (!(arr[j][key] > arr[j - m][key] && arr[j][key] >= arr[j + m][key])) return false; return true; };
    const isPL = (arr, j, key) => { for (let m = 1; m <= P; m++) if (!(arr[j][key] < arr[j - m][key] && arr[j][key] <= arr[j + m][key])) return false; return true; };

    // ── HTF bias: same confirmed-pivot rule on the chart's candles resampled to the bias timeframe ──
    const biasMs = prof.biasMins * 60000;
    const weekShift = prof.biasMins >= 10080 ? 3 * DAY : 0;                // weeks start Monday
    const grpOf = (t) => Math.floor((t + weekShift) / biasMs);
    const biasAt = new Int8Array(n);
    {
        const htf = [];
        for (let i = 0; i < n; i++) {
            const g = grpOf(C[i].time), c = C[i], h = htf[htf.length - 1];
            if (!h || h.g !== g) htf.push({ g, high: c.high, low: c.low, close: c.close, last: i });
            else { h.high = Math.max(h.high, c.high); h.low = Math.min(h.low, c.low); h.close = c.close; h.last = i; }
        }
        const after = new Int8Array(htf.length);
        let bias = 0, sh = null, sl = null;
        for (let k = 0; k < htf.length; k++) {
            const p = k - P;
            if (p >= P) {
                if (isPH(htf, p, 'high')) sh = htf[p].high;
                if (isPL(htf, p, 'low')) sl = htf[p].low;
            }
            if (sh !== null && htf[k].close > sh) { bias = 1; sh = null; }
            else if (sl !== null && htf[k].close < sl) { bias = -1; sl = null; }
            after[k] = bias;
        }
        // each chart bar uses only HTF bars closed by the chart bar's close
        let k = 0;
        for (let i = 0; i < n; i++) {
            while (k < htf.length - 1 && htf[k].last < i) k++;
            const closesNow = htf[k].last === i && C[i].time + tfMs >= (htf[k].g + 1) * biasMs - weekShift;
            biasAt[i] = closesNow ? after[k] : (k > 0 ? after[k - 1] : 0);
        }
    }

    // ── Walk forward bar by bar ──
    const zones = [];                 // live zones (state < 3)
    const pivH = [], pivL = [];       // confirmed pivots { idx, conf, price, metric }
    let lastSH = null, lastSL = null, shBroken = true, slBroken = true;
    const bosUp = new Uint8Array(n), bosDn = new Uint8Array(n);
    let divBullUntil = -1, divBearUntil = -1;
    let lastSig = -1e9, zid = 0;
    const news = (opts.news || []).slice().sort((a, b) => a - b);
    const nearNews = (t0, t1) => news.some(t => t >= t0 - 15 * 60000 && t <= t1 + 15 * 60000);
    const asia = s.pcSession !== false && prof.asiaOnlyAPlus;
    // divergence metric at a pivot: CVD, or (delta off) RelVol summed over the push into it
    const metric = (j, prevOpp) => {
        if (!deltaOff) return cvd[j];
        let t = 0; for (let m = Math.max(0, prevOpp ?? j - divBars); m <= j; m++) t += rv[m]; return t;
    };

    for (let i = 1; i < n; i++) {
        const c = C[i];
        // pivots confirmed at bar i (pivot bar i − P)
        const j = i - P;
        if (j >= P) {
            if (isPH(C, j, 'high')) {
                const piv = { idx: j, conf: i, price: C[j].high, metric: metric(j, pivL[pivL.length - 1]?.idx) };
                const prev = pivH[pivH.length - 1];
                if (prev && j - prev.idx <= 60 && piv.price > prev.price && piv.metric < prev.metric) {
                    divBearUntil = i + divBars; divBullUntil = -1;
                    out.divs.push({ i, dir: -1, price: piv.price, from: prev.idx, to: j });
                }
                pivH.push(piv); lastSH = piv; shBroken = false;
            }
            if (isPL(C, j, 'low')) {
                const piv = { idx: j, conf: i, price: C[j].low, metric: metric(j, pivH[pivH.length - 1]?.idx) };
                const prev = pivL[pivL.length - 1];
                if (prev && j - prev.idx <= 60 && piv.price < prev.price && piv.metric > prev.metric) {
                    divBullUntil = i + divBars; divBearUntil = -1;
                    out.divs.push({ i, dir: 1, price: piv.price, from: prev.idx, to: j });
                }
                pivL.push(piv); lastSL = piv; slBroken = false;
            }
        }
        // break of structure: the first close beyond the last confirmed swing
        if (lastSH && !shBroken && c.close > lastSH.price) { bosUp[i] = 1; shBroken = true; }
        if (lastSL && !slBroken && c.close < lastSL.price) { bosDn[i] = 1; slBroken = true; }
        const eq = lastSH && lastSL && lastSH.price > lastSL.price ? (lastSH.price + lastSL.price) / 2 : null;

        updateZones(i);
        if (i <= lastClosed && prof.signals) {
            const sig = evaluateSignals(i);
            if (sig) { out.signals.push(sig); lastSig = i; const z = zones.find(q => q.id === sig.zoneId); if (z) z.visitSignaled = true; }
        }
        if (i <= lastClosed + 1 && atr[i] > 0) detectZones(i);
        for (let k = zones.length - 1; k >= 0; k--) if (zones[k].state === 3 || i - zones[k].created > maxAge * 2) zones.splice(k, 1);
        out.eq = eq; out.lastSH = lastSH; out.lastSL = lastSL;

        function updateZones(t) {
            const k = C[t];
            for (const z of zones) {
                if (z.state === 3) continue;
                const inside = k.low <= z.top && k.high >= z.bottom;
                if (inside && !z.inVisit) { z.touchesBefore = z.touches; z.touches++; z.inVisit = true; z.visitSignaled = false; z.swept = false; }
                if (!inside) z.inVisit = false;
                if (z.dir === 1) {
                    if (k.low < z.bottom && k.close >= z.bottom) z.swept = true;
                    if (z.fvg && !z.fvg.filled && k.low <= z.fvg.lo) z.fvg.filled = true;
                    if (k.close < z.bottom) { z.state = 3; z.end = t; continue; }
                } else {
                    if (k.high > z.top && k.close <= z.top) z.swept = true;
                    if (z.fvg && !z.fvg.filled && k.high >= z.fvg.hi) z.fvg.filled = true;
                    if (k.close > z.top) { z.state = 3; z.end = t; continue; }
                }
                z.state = (t - z.created > maxAge || z.touches > maxTouch) ? 2 : z.touches === 0 ? 0 : 1;
            }
        }

        function evaluateSignals(t) {
            if (t - lastSig <= cooldown) { if (zones.some(z => z.inVisit && z.state < 2)) drop('cooldown'); return null; }
            const k = C[t], a = atr[t];
            const cands = [];
            for (const z of zones) {
                if (z.state >= 2 || !z.inVisit || z.visitSignaled || z.created >= t) continue;
                const dir = z.dir, mid = (z.top + z.bottom) / 2;
                drop('0 in zone');
                if (dir === 1 ? k.close <= mid : k.close >= mid) { drop('1 close past mid'); continue; }
                if (!deltaOff && (dir === 1 ? !(bs[t] >= 0.55) : !(bs[t] <= 0.45))) { drop('2 buyshare'); continue; }
                if (deltaOff && !won(t, dir)) { drop('2 bar colour'); continue; }
                if (rv[t] < 1.0) { drop('3 relvol'); continue; }
                const divWith = dir === 1 ? t <= divBullUntil : t <= divBearUntil;
                const divAgainst = dir === 1 ? t <= divBearUntil : t <= divBullUntil;
                if (!(dir === 1 ? ema[t] > ema[t - 1] : ema[t] < ema[t - 1]) && !divWith) { drop('4 strength'); continue; }
                if (divAgainst) { drop('5 divergence'); continue; }
                if (eq !== null && (dir === 1 ? k.close >= eq : k.close <= eq)) { drop('6 premium/discount'); continue; }
                // levels: buys fill at ask (close + spread), sells at bid (close)
                const entry = dir === 1 ? k.close + spread : k.close;
                const sl = dir === 1 ? Math.min(z.bottom, k.low) - stopAtr * a : Math.max(z.top, k.high) + stopAtr * a;
                const risk = Math.abs(entry - sl);
                if (!(risk > 0)) continue;
                // TP2: nearest ACTIVE opposite zone (fresh / tested), else fallback R
                const opp = zones.filter(q => q.dir === -dir && q.state < 2 && (dir === 1 ? q.bottom > entry : q.top < entry))
                    .sort((p, q) => (dir === 1 ? p.bottom - q.bottom : q.top - p.top))[0];
                const tp2 = opp ? (dir === 1 ? opp.bottom : opp.top) : entry + dir * fbR * risk;
                const rr = Math.abs(tp2 - entry) / risk;            // entry already includes the spread
                if (rr < minRR) { drop('7 R:R'); continue; }
                if (s.pcUseNews !== false && news.length && nearNews(k.time, k.time + tfMs)) { drop('8 news'); continue; }
                // grade
                const fresh = z.touchesBefore === 0, bias = biasAt[t];
                const withBias = bias === dir, neutral = bias === 0, counter = bias === -dir;
                let g;
                if (counter) g = 0;                                                         // counter-bias → C
                else if (z.swept && fresh && z.ob && withBias && divWith) g = 3;
                else if (fresh && z.ob && withBias) g = 2;
                else if ((fresh || (z.fvg && !z.fvg.filled)) && (withBias || neutral)) g = 1;  // neutral caps at B
                else g = 0;
                if (asia && isAsia(k.time) && g < 3) { drop('9 asia'); continue; }
                cands.push({
                    i: t, time: k.time, dir, grade: GRADES[g], g, entry, sl, tp1: entry + dir * tp1R * risk, tp2,
                    tp2From: opp ? 'zone' : `${fbR}R`, rr, risk, zoneId: z.id, zoneTop: z.top, zoneBottom: z.bottom,
                    fresh, ob: z.ob, swept: z.swept, withBias, divWith, fvg: !!(z.fvg && !z.fvg.filled), bias,
                    halfRisk: g === 1, riskK: GRADE_RISK[GRADES[g]],
                });
            }
            if (!cands.length) return null;
            // several zones on one bar: highest grade wins, ties → better reward:risk
            cands.sort((p, q) => q.g - p.g || q.rr - p.rr);
            const best = cands[0];
            if (best.g === 0 && !s.pcShowC) { drop('10 grade C hidden'); return null; }
            return best;
        }

        function detectZones(e) {
            for (let L = 1; L <= 3; L++) {
                const st = e - L + 1; if (st < 2) break;
                const a = atr[st - 1] || atr[e];
                const disp = C[e].close - C[st].open;
                const dir = disp > 0 ? 1 : -1;
                if (Math.abs(disp) < impAtr * a) continue;                         // net displacement
                let rvSum = 0, vol = 0, buy = 0;
                for (let m = st; m <= e; m++) { rvSum += rv[m]; vol += C[m].volume || 0; buy += bs[m] * (C[m].volume || 0); }
                if (rvSum / L < impRv) continue;
                const share = vol > 0 ? buy / vol : bs[e];
                if (!deltaOff && (dir === 1 ? share < 0.6 : share > 0.4)) continue;
                // base: last opposite-won bar within 5 bars before the impulse, else the bar before it
                let base = st - 1;
                for (let m = st - 1; m >= Math.max(1, st - 5); m--) if (won(m, -dir)) { base = m; break; }
                // the impulse must close beyond the base's far extreme
                if (dir === 1 ? C[e].close <= C[base].high : C[e].close >= C[base].low) continue;
                let top = C[base].high, bottom = C[base].low;
                const th = top - bottom;
                if (th < 0.3 * a) { if (dir === 1) bottom = top - 0.3 * a; else top = bottom + 0.3 * a; }
                if (th > 1.5 * a) { if (dir === 1) bottom = top - 1.5 * a; else top = bottom + 1.5 * a; }
                let ob = false;
                for (let m = st; m <= e; m++) if (dir === 1 ? bosUp[m] : bosDn[m]) { ob = true; break; }
                let fvg = null;
                for (let m = Math.max(st, base + 2); m <= e; m++) {
                    const gp = dir === 1 ? { lo: C[m - 2].high, hi: C[m].low } : { lo: C[m].high, hi: C[m - 2].low };
                    if (gp.hi > gp.lo) { fvg = { ...gp, i0: m - 2, filled: false }; break; }
                }
                const strength = (Math.abs(disp) / a) * (rvSum / L) * (fvg ? 1.25 : 1);
                const z = { id: ++zid, dir, top, bottom, created: e, baseIdx: base, ob, strength, fvg, touches: 0, touchesBefore: 0, state: 0, inVisit: false, swept: false };
                // > 50 % overlap with an active same-side zone → merge into it instead of stacking
                const ov = zones.find(q => q.dir === dir && q.state < 2 && (Math.min(q.top, top) - Math.max(q.bottom, bottom)) > 0.5 * Math.min(q.top - q.bottom, top - bottom));
                if (ov) { ov.strength = Math.max(ov.strength, strength); ov.ob = ov.ob || ob; if (!ov.fvg && fvg) ov.fvg = fvg; return; }
                zones.push(z); out.zonesMade++;
                return;
            }
        }
    }

    function zoneScore(z) { return z.strength * (z.ob ? 1.2 : 1); }

    // amber = a divergence was active on that bar
    const amber = new Uint8Array(n);
    for (const d of out.divs) for (let i = d.i; i <= Math.min(n - 1, d.i + divBars); i++) amber[i] = 1;
    for (let i = 0; i < n; i++) {
        const w = rv[i] < 0.7 ? 1 : rv[i] < 1.3 ? 2 : rv[i] <= 2 ? 3 : 4;
        out.bars.push({ bs: bs[i], rv: rv[i], w, str: str[i], ema: ema[i], src: src[i], amber: amber[i] === 1 });
    }

    // Live zones for drawing: nearest 3 above and 3 below price (+ the one price is in)
    const px = C[n - 1].close;
    const live = zones.filter(z => z.state < 3);
    const above = live.filter(z => z.bottom > px).sort((a, b) => a.bottom - b.bottom).slice(0, 3);
    const below = live.filter(z => z.top < px).sort((a, b) => b.top - a.top).slice(0, 3);
    const at = live.filter(z => z.bottom <= px && z.top >= px);
    out.zones = [...at, ...above, ...below].map(z => ({ ...z, score: zoneScore(z) }));
    out.bias = biasAt[n - 1];
    out.biasMins = prof.biasMins;
    out.mode = mode; out.rho = rho; out.deltaOk = deltaOk;
    out.atr = atr[n - 1];
    out.spread = spread;

    // ── Replay, confidence, typical hold, execution window ──
    const vpp = valuePerPointPerLot(opts.symbol);
    const commPrice = vpp ? Math.max(0, num(s.pcCommission, 0)) / vpp : 0;     // commission in price units per lot
    out.trades = simulateTrades(C, out.signals, { lastIdx: lastClosed, costPrice: commPrice, spread, maxHold: num(s.pcMaxHoldBars, 100) });
    const byGrade = {};
    for (const t of out.trades) if (t.r !== undefined) (byGrade[t.grade] = byGrade[t.grade] || []).push(t);
    for (const sg of out.signals) sg.conf = confidenceAt(byGrade[sg.grade] || [], sg.i);
    out.stats = {};
    for (const g of GRADES) {
        const ts = byGrade[g] || [];
        out.stats[g] = { ...confidenceAt(ts, Infinity), hold: ts.length ? median(ts.map(t => t.exit - t.i)) : null };
    }
    const validBars = Math.max(1, num(s.pcValidBars, 2)), chaseR = num(s.pcMaxChaseR, 0.3);
    for (const sg of out.signals) {
        sg.deadline = sg.time + tfMs * (1 + validBars);              // valid for N bars after the signal bar closes
        sg.chaseLimit = sg.entry + sg.dir * chaseR * sg.risk;        // void once price runs this far past entry
        sg.typicalHold = out.stats[sg.grade]?.hold ?? null;
    }
    out.plan = watchPlan(out, px, minRR, spread, stopAtr, fbR, tp1R);
    return out;
}

/** Confidence from earlier same-grade trades that exited before bar t (no lookahead). */
function confidenceAt(trades, t) {
    let n = 0, w = 0;
    for (const x of trades) if (x.exit < t) { n++; if (x.r > 0) w++; }
    const [lo, hi] = wilson(w, n);
    return { n, w, p: (w + 1) / (n + 2), lo, hi, enough: n >= 10 };
}

/** Nearest setup worth watching (not a signal — a signal needs the confirmation bar). */
function watchPlan(out, px, minRR, spread, stopAtr, fbR, tp1R) {
    const want = out.bias || 0;
    const best = [];
    for (const z of out.zones) {
        if (z.state >= 2 || (want && z.dir !== want)) continue;
        if (out.eq != null && (z.dir === 1 ? (z.top + z.bottom) / 2 >= out.eq : (z.top + z.bottom) / 2 <= out.eq)) continue;
        if (z.dir === 1 ? z.top > px : z.bottom < px) continue;
        const entry = z.dir === 1 ? z.top + spread : z.bottom;
        const sl = z.dir === 1 ? z.bottom - stopAtr * out.atr : z.top + stopAtr * out.atr;
        const risk = Math.abs(entry - sl);
        if (!(risk > 0)) continue;
        const opp = out.zones.filter(q => q.dir === -z.dir && q.state < 2 && (z.dir === 1 ? q.bottom > entry : q.top < entry))
            .sort((a, b) => (z.dir === 1 ? a.bottom - b.bottom : b.top - a.top))[0];
        const tp2 = opp ? (z.dir === 1 ? opp.bottom : opp.top) : entry + z.dir * fbR * risk;
        const rr = Math.abs(tp2 - entry) / risk;
        if (rr < minRR) continue;
        best.push({ dir: z.dir, entry, sl, tp1: entry + z.dir * tp1R * risk, tp2, rr, risk, zone: z, dist: Math.abs(px - entry) });
    }
    return best.sort((a, b) => a.dist - b.dist)[0] || null;
}

/**
 * Replay each signal (v2.1 rules): buys fill at ask (= signal entry) and exit on
 * bid; sells fill at bid and their stop / targets trigger on ask (price +
 * spread). Stop checked before targets in every bar (pessimistic). At TP1 half
 * closes and the stop moves to entry; the rest exits at TP2, the stop, or after
 * maxHold bars at the close. costPrice (number or fn(signal)) = commission in
 * price units, subtracted as a fraction of R. Trades still open at lastIdx are
 * marked open and excluded from statistics. Results in R.
 */
export function simulateTrades(candles, signals, { lastIdx, costPrice = 0, spread = 0, maxHold = 100, maxOpen = Infinity, dailyLossR = Infinity } = {}) {
    const res = [];
    const open = [];
    const dayLoss = new Map();
    for (const sg of signals) {
        const day = Math.floor(sg.time / DAY);
        for (let k = open.length - 1; k >= 0; k--) if (open[k].exit <= sg.i) open.splice(k, 1);
        if (open.length >= maxOpen || (dayLoss.get(day) || 0) >= dailyLossR) { res.push({ ...pick(sg), skipped: true }); continue; }
        const buy = sg.dir === 1, sp = buy ? 0 : spread;          // sells trigger on ask
        let r = null, exit = null, half = false, stop = sg.sl;
        const end = Math.min(lastIdx, sg.i + maxHold);
        for (let j = sg.i + 1; j <= end; j++) {
            const c = candles[j], hi = c.high + sp, lo = c.low + sp;
            const hitSL = buy ? lo <= stop : hi >= stop;
            if (hitSL) { r = half ? 0.5 * Math.abs(sg.tp1 - sg.entry) / sg.risk : -1; exit = j; break; }
            if (!half && (buy ? hi >= sg.tp1 : lo <= sg.tp1)) { half = true; stop = sg.entry; }
            if (buy ? hi >= sg.tp2 : lo <= sg.tp2) {
                r = 0.5 * Math.abs(sg.tp1 - sg.entry) / sg.risk + 0.5 * Math.abs(sg.tp2 - sg.entry) / sg.risk;
                if (!half) r = Math.abs(sg.tp2 - sg.entry) / sg.risk;   // gapped straight through TP1
                exit = j; break;
            }
            if (j === sg.i + maxHold) {                                 // time exit at the close
                const pnl = buy ? c.close - sg.entry : sg.entry - (c.close + spread);
                r = half ? 0.5 * Math.abs(sg.tp1 - sg.entry) / sg.risk + 0.5 * pnl / sg.risk : pnl / sg.risk;
                exit = j; break;
            }
        }
        if (r === null) { res.push({ ...pick(sg), open: true }); open.push({ exit: Infinity }); continue; }
        r -= (typeof costPrice === 'function' ? costPrice(sg) : costPrice) / sg.risk;
        res.push({ ...pick(sg), r, exit });
        open.push({ exit });
        if (r < 0) dayLoss.set(day, (dayLoss.get(day) || 0) - r);
    }
    return res;
    function pick(sg) { return { i: sg.i, time: sg.time, dir: sg.dir, grade: sg.grade, risk: sg.risk, rr: sg.rr }; }
}
