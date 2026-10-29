// ─── SMC Pro ─────────────────────────────────────────────────────────────────
// Order blocks and supply/demand zones with CONFIRMED entries.
//
// Validated Oct 2026 (XAUUSD 15m 2023-25, BTCUSDT 15m 2026; first return to a
// fresh zone, SL just beyond the zone):
//   limit entry at the zone edge      gold -0.06R, BTC -0.12R per trade (2R target)
//   entry after a confirmation close  gold +0.04R, BTC +0.07R  (~51% reach 1R first)
// So signals fire only on confirmation: after price returns to the zone, a
// candle closes back out of it in the trade direction (within 5 candles).
//
// Order block = the last opposite-colour candle before a displacement candle
// (body ≥ 1 ATR) that leaves a fair-value gap. Supply/demand = small base
// candle + impulse (body > ATR × mult) with distance/base ≥ min score.
// Zones live until used for a signal, invalidated (close through the far
// side) or 300 candles old. All of it uses past data only.

const MAX_AGE = 300, CONFIRM_BARS = 5, KEEP = 6;

export function calcSmcPro(candles, s = {}) {
    if (!candles || candles.length < 30) return null;
    for (const c of candles) c.smcSignal = null;
    const n = candles.length;
    const atrMult = Number(s.smcAtrMult) || 1.5, minScore = Number(s.smcMinScore) || 1.0;
    const tp1R = Number(s.smcTp1) || 1, tp2R = Number(s.smcTp2) || 2, tp3R = Number(s.smcTp3) || 3;
    const showOb = s.smcShowOb !== false, showSd = s.smcShowSd !== false;

    // Wilder ATR and average body
    const atr = new Float64Array(n), body = new Float64Array(n);
    let a = candles[0].high - candles[0].low, b = Math.abs(candles[0].close - candles[0].open);
    const per = Number(s.smcAtrPeriod) || 14;
    for (let i = 0; i < n; i++) {
        const c = candles[i], p = i ? candles[i - 1] : c;
        const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        a += (tr - a) / per; b += (Math.abs(c.close - c.open) - b) / per;
        atr[i] = a; body[i] = b;
    }

    const zones = [];          // { startIdx, top, bottom, isSupply, type, score?, touchedAt, endIdx, state }
    const signals = [];        // past confirmed signals with outcome

    const close = (z, i, state) => { z.state = state; z.endIdx = i; };

    for (let i = 2; i < n; i++) {
        const c = candles[i], live = i === n - 1;

        // Existing zones: touch → wait for confirmation → signal; invalidation
        for (let k = zones.length - 1; k >= 0; k--) {
            const z = zones[k];
            if (i <= z.createdAt) continue;
            const bull = !z.isSupply;
            if (bull ? c.close < z.bottom : c.close > z.top) { zones.splice(k, 1); close(z, i, 'invalidated'); continue; }
            if (i - z.startIdx > MAX_AGE) { zones.splice(k, 1); close(z, i, 'expired'); continue; }
            if (z.touchedAt < 0 && (bull ? c.low <= z.top : c.high >= z.bottom)) z.touchedAt = i;
            if (z.touchedAt >= 0) {
                const confirmed = bull ? (c.close > z.top && c.close > c.open) : (c.close < z.bottom && c.close < c.open);
                if (confirmed) {
                    zones.splice(k, 1); close(z, i, 'signal');
                    const dir = bull ? 1 : -1, entry = c.close;
                    const sl = bull ? z.bottom - 0.1 * atr[z.startIdx] : z.top + 0.1 * atr[z.startIdx];
                    const risk = Math.abs(entry - sl);
                    if (!(risk > 0)) continue;
                    const sig = {
                        i, time: c.time, dir, entry, sl, zone: z.type,
                        tp1: entry + dir * risk * tp1R, tp2: entry + dir * risk * tp2R, tp3: entry + dir * risk * tp3R,
                        tp1Hit: false, tp2Hit: false, result: null,
                    };
                    c.smcSignal = sig;
                    signals.push(sig);                        // live-candle signal can still change (alerts: bar close)
                } else if (i - z.touchedAt >= CONFIRM_BARS) {
                    zones.splice(k, 1); close(z, i, 'no reaction');
                }
            }
        }

        // New zones, known when candle i closes
        const p = candles[i - 1], p2 = candles[i - 2];
        if (showOb && !live && Math.abs(p.close - p.open) >= atr[i - 1]) {
            if (c.low > p2.high && p.close > p.open) {
                for (let j = i - 2; j >= Math.max(0, i - 5); j--) {
                    const o = candles[j];
                    if (o.close < o.open) { zones.push({ startIdx: j, createdAt: i, top: o.high, bottom: o.low, isSupply: false, type: 'ob_bull', touchedAt: -1, state: 'fresh' }); break; }
                }
            }
            if (c.high < p2.low && p.close < p.open) {
                for (let j = i - 2; j >= Math.max(0, i - 5); j--) {
                    const o = candles[j];
                    if (o.close > o.open) { zones.push({ startIdx: j, createdAt: i, top: o.high, bottom: o.low, isSupply: true, type: 'ob_bear', touchedAt: -1, state: 'fresh' }); break; }
                }
            }
        }
        if (showSd && !live) {
            const b1 = Math.abs(p.close - p.open), b2 = Math.abs(p2.close - p2.open);
            if (b2 < body[i - 2] && b1 > atr[i - 1] * atrMult) {
                if (p.close > p.open) {
                    const top = Math.max(p2.open, p2.close), bottom = p2.low, score = (p.high - top) / Math.max(1e-9, top - bottom);
                    if (score >= minScore) zones.push({ startIdx: i - 2, createdAt: i, top, bottom, isSupply: false, type: 'sd_demand', score, touchedAt: -1, state: 'fresh' });
                } else {
                    const top = p2.high, bottom = Math.min(p2.open, p2.close), score = (bottom - p.low) / Math.max(1e-9, top - bottom);
                    if (score >= minScore) zones.push({ startIdx: i - 2, createdAt: i, top, bottom, isSupply: true, type: 'sd_supply', score, touchedAt: -1, state: 'fresh' });
                }
            }
        }
    }

    // Keep the chart readable: the most recent live zones per side
    const recent = (arr) => arr.slice(-KEEP);
    const shown = [...recent(zones.filter(z => !z.isSupply)), ...recent(zones.filter(z => z.isSupply))];
    for (const z of shown) z.state = z.touchedAt >= 0 ? 'tested' : 'fresh';

    // Nearest fresh zones above/below the price: what to watch for
    const last = candles[n - 1].close;
    let watchSell = null, watchBuy = null;
    for (const z of shown) {
        if (z.state !== 'fresh') continue;
        if (z.isSupply && z.bottom >= last && (!watchSell || z.bottom < watchSell.bottom)) watchSell = z;
        if (!z.isSupply && z.top <= last && (!watchBuy || z.top > watchBuy.top)) watchBuy = z;
    }
    const watch = [];
    if (watchSell) watch.push({ type: 'SELL', level: watchSell.bottom, sl: watchSell.top + 0.1 * atr[watchSell.startIdx], zone: watchSell.type });
    if (watchBuy) watch.push({ type: 'BUY', level: watchBuy.top, sl: watchBuy.bottom - 0.1 * atr[watchBuy.startIdx], zone: watchBuy.type });

    // Outcome of every past signal (SL first = loss; TP hits counted until then)
    for (const t of signals) {
        for (let j = t.i + 1; j < n - 1 && j - t.i <= 200; j++) {
            const c = candles[j];
            if (t.dir > 0 ? c.low <= t.sl : c.high >= t.sl) { t.result = t.tp1Hit ? 'TP1 then SL' : 'SL'; break; }
            if (t.dir > 0 ? c.high >= t.tp1 : c.low <= t.tp1) t.tp1Hit = true;
            if (t.dir > 0 ? c.high >= t.tp2 : c.low <= t.tp2) { t.tp2Hit = true; t.result = 'TP2'; break; }
        }
    }

    // Record of past signals on this chart (resolved ones only)
    const resolved = signals.filter(x => x.result && x.result !== 'expired');
    const record = {
        signals: resolved.length,
        tp1: resolved.length ? resolved.filter(x => x.tp1Hit).length / resolved.length : 0,
        tp2: resolved.length ? resolved.filter(x => x.tp2Hit).length / resolved.length : 0,
    };

    // Pressure (this timeframe): body direction × volume over the last 10 candles
    let press = 0;
    for (let i = Math.max(0, n - 10); i < n; i++) {
        const c = candles[i], hl = c.high - c.low;
        press += (hl > 0 ? (c.close - c.open) / hl : 0) * (c.volume || 1);
    }

    // Latest signal (if recent) for the entry/SL/TP lines
    const lastSig = signals.length && n - 1 - signals[signals.length - 1].i <= 50 ? signals[signals.length - 1] : null;

    return {
        obZones: shown.filter(z => z.type.startsWith('ob')),
        sdZones: shown.filter(z => z.type.startsWith('sd')),
        watch, lastSignal: lastSig, record,
        dashboard: { pressureBias: press > 0 ? 'BULLISH' : press < 0 ? 'BEARISH' : 'NEUTRAL' },
    };
}

/** Contract size for lot sizing: the setting if changed, else a guess from the symbol. */
export function smcContractSize(symbol, setting) {
    const v = Number(setting);
    if (v && v !== 100) return v;
    const s = String(symbol || '').toUpperCase().replace('/', '');
    if (/^XAU/.test(s)) return 100;
    if (/^XAG/.test(s)) return 5000;
    if (/^(BTC|ETH|XBT|SOL|XRP|LTC)/.test(s)) return 1;
    if (/^[A-Z]{6}$/.test(s)) return 100000;
    return v || 1;
}
