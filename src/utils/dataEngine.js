import { calcPressure } from './pressureChart.js';
import { vbrLevelsAt, volumeSma } from './vbr.js';
import { computeKeyLevels } from './keyLevels.js';
import { calcWhalePulse } from './whalePulse.js';
import { calcIchimoku } from './ichimoku.js';
import { calcMovingAverages } from './movingAverages.js';
import { computeFootprints } from './footprint.js';
import { calcMacdHs } from './macdHs.js';
import { calcLondonBreakout } from './londonBreakout.js';
import { calcBtcTurtle } from './btcTurtle.js';
import { calcSmcPro } from './smcPro.js';
import { calcMarketProfile } from './marketProfile.js';
import { computePathProjection } from './pathProjection.js';
import { computeMarketSessions } from './marketSessions.js';
import { detectPatterns } from './patterns.js';
import { computeProjection, candleClass, describeCandle, CANDLE_CLASS_BASIS } from './projection.js';

// --- DATA AGGREGATION ---
// Footprint (order-flow) rows are computed in ./footprint.js, only when the
// footprint chart is shown.

/**
 * Group raw bars into candles of `timeframeMins`. When options.footprint is set,
 * each candle also gets `fp`, `delta` and `prediction` (see footprint.js);
 * options.footprintSettings, options.intrabar (1s bars), options.intrabar1m
 * (1m bars) and options.fixedRow (frozen Auto row size) refine it.
 */
export function aggregateData(rawData, timeframeMins, tickSize, settings, options = {}) {
    if (!rawData || rawData.length === 0) return [];

    const candles = [];
    const ranges = [];          // [firstRawIndex, lastRawIndex] per candle
    let currentPeriod = null;
    let c = null;
    // Timeframes that don't divide an hour (45m) start their day at the broker / FX day open
    // (17:00 New York = server midnight), like MT5 and TradingView. On the UTC-midnight grid the
    // 45m candles were 15 min off in winter, so Livermore signals landed on other candles than the EA's.
    const brokerGrid = timeframeMins < 60 && 60 % timeframeMins !== 0;

    for (let r = 0; r < rawData.length; r++) {
        const d = rawData[r];
        const date = new Date(d.time);
        const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
        let periodStart, periodId, startTime;
        if (brokerGrid) {
            const sm = (minutes + serverOffsetMin(d.time)) % 1440;           // minutes since server midnight
            periodStart = Math.floor(sm / timeframeMins) * timeframeMins;
            startTime = d.time - (sm - periodStart) * 60000 - (d.time % 60000);
            periodId = startTime;
        } else {
            periodStart = Math.floor(minutes / timeframeMins) * timeframeMins;
            periodId = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${periodStart}`;
        }

        if (periodId !== currentPeriod) {
            const pDate = new Date(date);
            pDate.setUTCHours(Math.floor(periodStart / 60), periodStart % 60, 0, 0);
            currentPeriod = periodId;
            c = { time: brokerGrid ? startTime : pDate.getTime(), open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume };
            candles.push(c);
            ranges.push([r, r]);
        } else {
            c.high = Math.max(c.high, d.high);
            c.low = Math.min(c.low, d.low);
            c.close = d.close;
            c.volume += d.volume;
            ranges[ranges.length - 1][1] = r;
        }
    }

    // Volume delta per candle from the lower-timeframe bars inside it
    // (TradingView's up/down volume rule: up bar = buying, down bar = selling,
    // unchanged → vs previous close, else same as previous bar). Used by CVD.
    {
        let prevClose = null, prevDir = 1;
        for (let k = 0; k < candles.length; k++) {
            const [r0, r1] = ranges[k];
            let d = 0;
            for (let r = r0; r <= r1; r++) {
                const b = rawData[r];
                const dir = b.close > b.open ? 1 : b.close < b.open ? -1
                    : prevClose !== null && b.close > prevClose ? 1 : prevClose !== null && b.close < prevClose ? -1 : prevDir;
                prevDir = dir;
                prevClose = b.close;
                d += dir * (b.volume || 0);
            }
            candles[k].ltfDelta = r1 > r0 ? d : null;     // single bar → no real split
        }
    }

    if (options.footprint) {
        computeFootprints(candles, rawData, ranges, timeframeMins, {
            settings: options.footprintSettings,
            intrabar: options.intrabar,
            intrabar1m: options.intrabar1m,
            fixedRow: options.fixedRow,
        });
    }

    // Footprint candles have a finer delta (1s/1m intrabar) — prefer it for CVD
    if (options.footprint) {
        for (const cd of candles) if (cd.fp && !cd.fp.coarse) cd.ltfDelta = cd.fp.stats.delta;
    }

    computeHeikinAshi(candles);
    const out = computeIndicators(candles, settings);
    // London Breakout (intraday): Asian range + London-open breakout signals
    out.londonBreakout = calcLondonBreakout(out, settings || {}, timeframeMins);
    // BTC Turtle Breakout (Pro): server-time H4 Donchian breakout, same rules as the EA
    out.btcTurtle = calcBtcTurtle(out, settings || {}, timeframeMins);
    calcVolumeVwapRsiMa(out, settings || {});
    // Pressure Chart (Pro): per-bar BuyShare / RelVol / strength on the candles,
    // zones, signals and the info-card data on the array
    if (options.pressure && !options.footprint) {
        const pc = calcPressure(out, { tfMins: timeframeMins, settings: settings || {}, news: options.news || [], symbol: options.symbol });
        pc.bars.forEach((b, i) => {
            const c = out[i];
            c.pcBs = b.bs; c.pcRv = b.rv; c.pcW = b.w; c.pcStr = b.str; c.pcEma = b.ema; c.pcAmber = b.amber; c.pcSrc = b.src;
        });
        for (const sg of pc.signals) out[sg.i].pcSignal = sg;
        delete pc.bars;
        out.pressure = pc;
    }
    calcBollinger(out, settings || {});
    calcMovingAverages(out, settings || {});                 // up to 3 moving averages (utils/movingAverages.js)
    calcIchimoku(out, settings || {});                        // Ichimoku lines, cloud and signals
    out.whalePulse = calcWhalePulse(out, settings || {});     // big-trade bubbles / absorption / deep pressure
    // Next-candle projection for standard charts (footprint charts have their
    // own order-flow version); drawn when the "Next-Candle Projection" overlay is on
    if (!options.footprint && out.length > 2) {
        out[out.length - 1].candleProjection = computeProjection(out, candleClass, CANDLE_CLASS_BASIS, describeCandle);
        if (options.projection) {
            const hz = [0, 1, 3, 5, 10].includes(Number(settings?.ppHorizon)) ? Number(settings.ppHorizon) : 5;   // 0 = current candle
            const na = [10, 30, 50].includes(Number(settings?.ppAnalogs)) ? Number(settings.ppAnalogs) : 30;
            out[out.length - 1].pathProjection = computePathProjection(out, hz, na);
            out.keyLevels = computeKeyLevels(out);      // trendline + support / resistance near price
        }
    }
    return out;
}

// --- HEIKIN ASHI COMPUTATION ---
function computeHeikinAshi(candles) {
    for (let i = 0; i < candles.length; i++) {
        let c = candles[i];
        let haClose = (c.open + c.high + c.low + c.close) / 4;
        let haOpen = i === 0 ? (c.open + c.close) / 2 : (candles[i - 1].haOpen + candles[i - 1].haClose) / 2;
        let haHigh = Math.max(c.high, haOpen, haClose);
        let haLow = Math.min(c.low, haOpen, haClose);

        c.haOpen = parseFloat(haOpen.toFixed(2));
        c.haHigh = parseFloat(haHigh.toFixed(2));
        c.haLow = parseFloat(haLow.toFixed(2));
        c.haClose = parseFloat(haClose.toFixed(2));
    }
}

// --- TECHNICAL INDICATORS ENGINE ---
export function computeIndicators(candles, settings) {
    if (candles.length === 0) return candles;

    const s = settings || {
        smaPeriod: 20, emaPeriod: 20, rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSig: 9, demPeriod: 14, sdMinB: 3, sdMaxB: 5
    };

    // 1. (Removed SMA/EMA)

    // 2. RSI (14)
    const rsiPeriod = Number(s.rsiPeriod) || 14;
    let avgGain = 0, avgLoss = 0;

    // 3. DeMarker (14)
    const demPeriod = Number(s.demPeriod) || 14;   // older saved settings have no demPeriod
    let demMax = [], demMin = [];

    // 4. MACD (12, 26, 9)
    // Seeded like TradingView's ta.ema: each EMA starts as the SMA of its first N values
    const macdFast = Number(s.macdFast) || 12, macdSlow = Number(s.macdSlow) || 26, macdSig = Number(s.macdSig) || 9;
    let eFast = null, eSlow = null, sigEma = null, sumFast = 0, sumSlow = 0, sumSig = 0, nSig = 0;

    // 5. ATR for Supply/Demand
    const atrP = s.sdAtrPeriod || 14;
    let atrArr = [];

    // Livermore Gold Trend v12 PRO Variables (inputs as in the Pine strategy)
    const LM = livermoreSettings(s);
    const ema100Period = LM.emaLen;
    const ema100Mult = 2 / (ema100Period + 1);
    let ema100Prev = candles[0].close;
    let qitE50 = candles[0].close, qitE200 = candles[0].close;   // QIT trend filter
    let lmAtr = null;                       // ta.atr(14) — independent of the S/D ATR setting
    const lmHour = sessionHourFn(LM.sessionTz);
    // daily trend filter: server-day closes and their EMA(50); "ok" = yesterday's close above it
    const lmDay = serverDayFn();
    let lmDayKey = null, lmDayClose = null, lmDayEma = null, lmDailyOk = false;

    const rsi21Period = 21;
    let rsi21AvgGain = 0, rsi21AvgLoss = 0;

    const adxPeriod = 14;
    let trSmooth = 0, pDmSmooth = 0, mDmSmooth = 0;
    let lastLivermoreState = {
        position_size: 0,   // open entries (pyramiding up to 2)
        sl: null, tp: null, initSl: null,
        entryPrice: null,   // average fill price
        pending: false,     // strategy.entry placed at this close → fills next open
        armed: false,       // strategy.exit active (placed at a close while in position)
        trailed: false,
    };

    for (let i = 0; i < candles.length; i++) {
        let c = candles[i];
        let prev = i > 0 ? candles[i - 1] : c;

        // (SMA and EMA moved to standalone calcMaRibbon function)

        // RSI
        let change = c.close - prev.close;
        let gain = Math.max(0, change), loss = Math.max(0, -change);
        if (i === rsiPeriod) {
            for (let j = 1; j <= rsiPeriod; j++) {
                let chg = candles[j].close - candles[j - 1].close;
                avgGain += Math.max(0, chg);
                avgLoss += Math.max(0, -chg);
            }
            avgGain /= rsiPeriod; avgLoss /= rsiPeriod;
        } else if (i > rsiPeriod) {
            avgGain = (avgGain * (rsiPeriod - 1) + gain) / rsiPeriod;
            avgLoss = (avgLoss * (rsiPeriod - 1) + loss) / rsiPeriod;
        }
        c.rsi = (i >= rsiPeriod) ? (avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)))) : null;

        // DeMarker
        demMax.push(Math.max(0, c.high - prev.high));
        demMin.push(Math.max(0, prev.low - c.low));
        if (i >= demPeriod) {
            let sMax = 0, sMin = 0;
            for (let j = 0; j < demPeriod; j++) {
                sMax += demMax[i - j]; sMin += demMin[i - j];
            }
            c.demarker = sMax + sMin === 0 ? 0.5 : sMax / (sMax + sMin);
        } else c.demarker = null;

        // MACD (TradingView: fast/slow EMA of close, signal = EMA of MACD, hist = MACD − signal)
        if (i < macdFast) { sumFast += c.close; if (i === macdFast - 1) eFast = sumFast / macdFast; }
        else eFast += (c.close - eFast) * (2 / (macdFast + 1));
        if (i < macdSlow) { sumSlow += c.close; if (i === macdSlow - 1) eSlow = sumSlow / macdSlow; }
        else eSlow += (c.close - eSlow) * (2 / (macdSlow + 1));
        c.macdLine = eFast !== null && eSlow !== null ? eFast - eSlow : null;
        if (c.macdLine !== null) {
            if (nSig < macdSig) { sumSig += c.macdLine; nSig++; if (nSig === macdSig) sigEma = sumSig / macdSig; }
            else sigEma += (c.macdLine - sigEma) * (2 / (macdSig + 1));
        }
        c.macdSignal = sigEma;
        c.macdHist = c.macdLine !== null && sigEma !== null ? c.macdLine - sigEma : null;

        // ATR
        let tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
        if (i === 0) atrArr.push(tr);
        else if (i < atrP) atrArr.push((atrArr[i - 1] * i + tr) / (i + 1));
        else atrArr.push((atrArr[i - 1] * (atrP - 1) + tr) / atrP);
        c.atr = atrArr[i];

        // --- Order Flow CVD Calculation ---
        // Candle delta: from the lower-timeframe bars inside the candle when it has
        // several (TradingView's up/down volume rule, see aggregateData) —
        // otherwise estimated from where the candle closed in its range.
        if (c.ltfDelta !== undefined && c.ltfDelta !== null) {
            c.cvdCandleDelta = c.ltfDelta;
        } else {
            let range_len = c.high - c.low === 0 ? 1 : c.high - c.low;
            let buy_vol = ((c.close - c.low) / range_len) * c.volume;
            let sell_vol = ((c.high - c.close) / range_len) * c.volume;
            c.cvdCandleDelta = buy_vol - sell_vol;
        }

        let cvdAggType = s.cvdAggType || 'Session (Daily)';
        let cvdRollLen = parseInt(s.cvdRollLen) || 20;
        let cvdSmoothLen = parseInt(s.cvdSmoothLen) || 5;

        if (i === 0) {
            c.cvdAccum = c.cvdCandleDelta;
        } else {
            if (cvdAggType === 'Session (Daily)') {
                let currDay = new Date(c.time).getUTCDate();
                let prevDay = new Date(prev.time).getUTCDate();
                if (currDay !== prevDay) {
                    c.cvdAccum = c.cvdCandleDelta;
                } else {
                    c.cvdAccum = prev.cvdAccum + c.cvdCandleDelta;
                }
            } else {
                // Rolling Window
                let sum = 0;
                let count = 0;
                for (let j = 0; j < cvdRollLen && (i - j) >= 0; j++) {
                    sum += candles[i - j].cvdCandleDelta;
                    count++;
                }
                c.cvdAccum = sum;
            }
        }

        if (i >= cvdSmoothLen - 1) {
            let sumSmooth = 0;
            for (let j = 0; j < cvdSmoothLen; j++) {
                sumSmooth += candles[i - j].cvdAccum;
            }
            c.cvdSmooth = sumSmooth / cvdSmoothLen;
        } else {
            c.cvdSmooth = null;
        }
        
        // --- QIT Intermediate Calculations ---
        // Validated Oct 2026 (gold 2016-25, BTC 2020-26, ~450k candles): the
        // original 55% body / 1.2× volume was break-even on gold and lost on BTC;
        // 70% / 2× with the EMA50/200 trend filter was the best on both.
        const qitImbLen = s.qitImbLen || 10;
        const qitImbThresh = Number(s.qitBodyMin) || 0.7;
        const qitVolMult = Number(s.qitVolMin) || 2.0;
        const qitTrendOn = s.qitTrend !== false;
        qitE50 += (2 / 51) * (c.close - qitE50); qitE200 += (2 / 201) * (c.close - qitE200);
        c.qitUp = qitE50 > qitE200;
        const qitAtrLen = s.qitAtrLen || 14; 
        
        let volSum = 0;
        let volCount = 0;
        for (let j = 0; j < qitImbLen && (i - j) >= 0; j++) {
            volSum += candles[i - j].volume;
            volCount++;
        }
        let volAvg = volSum / volCount;
        
        let body = Math.abs(c.close - c.open);
        let rng = c.high - c.low;
        let bodyRat = rng > 0 ? body / rng : 0;
        let volRat = volAvg > 0 ? c.volume / volAvg : 1.0;
        
        let momFastSum = 0;
        let momFastCount = 0;
        for (let j = 0; j < 5 && (i - j) >= 0; j++) { momFastSum += candles[i - j].close; momFastCount++; }
        let momFast = momFastSum / momFastCount;
        
        let momSlowSum = 0;
        let momSlowCount = 0;
        for (let j = 0; j < (qitImbLen * 2) && (i - j) >= 0; j++) { momSlowSum += candles[i - j].close; momSlowCount++; }
        let momSlow = momSlowSum / momSlowCount;
        
        let volSpike = volRat >= qitVolMult;
        let bullBody = c.close > c.open;
        let bearBody = c.close < c.open;
        let bullTrend = momFast > momSlow;
        let bearTrend = momFast < momSlow;
        
        c.qitImbBull = bullBody && bodyRat >= qitImbThresh && volSpike && bullTrend;
        c.qitImbBear = bearBody && bodyRat >= qitImbThresh && volSpike && bearTrend;
        
        // Signal Detection (Check previous candles)
        let activeQitState = i > 0 ? { ...(candles[i-1].qitState || {}) } : {};
        
        if (i >= 2) {
            let prev1 = candles[i - 1];
            let prev2 = candles[i - 2];
            
            let sigBull = prev1.qitImbBull && !prev2.qitImbBull && (!qitTrendOn || prev1.qitUp);
            let sigBear = prev1.qitImbBear && !prev2.qitImbBear && (!qitTrendOn || !prev1.qitUp);
            
            if (sigBull) {
                c.qitSignal = "LONG";
                c.qitEntry = c.open;
                c.qitSl = prev1.low - (prev1.atr || c.atr) * (s.qitSlAtr || 1.0);
                let risk = c.qitEntry - c.qitSl;
                c.qitTp1 = c.qitEntry + risk * (s.qitTp1 || 1.5);
                c.qitTp2 = c.qitEntry + risk * (s.qitTp2 || 2.5);
                c.qitTp3 = c.qitEntry + risk * (s.qitTp3 || 3.5);
                
                activeQitState = {
                    bull_active: true,
                    entry_bull: c.qitEntry,
                    signalTime: c.time,
                    sl_bull: c.qitSl,
                    tp1_bull: c.qitTp1,
                    tp2_bull: c.qitTp2,
                    tp3_bull: c.qitTp3,
                    zone_hi_b: prev1.high,
                    zone_lo_b: prev1.low,
                    bear_active: false,
                    last_bull_idx: i,
                    last_bear_idx: activeQitState.last_bear_idx
                };
            } else if (sigBear) {
                c.qitSignal = "SHORT";
                c.qitEntry = c.open;
                c.qitSl = prev1.high + (prev1.atr || c.atr) * (s.qitSlAtr || 1.0);
                let risk = c.qitSl - c.qitEntry;
                c.qitTp1 = c.qitEntry - risk * (s.qitTp1 || 1.5);
                c.qitTp2 = c.qitEntry - risk * (s.qitTp2 || 2.5);
                c.qitTp3 = c.qitEntry - risk * (s.qitTp3 || 3.5);
                
                activeQitState = {
                    bear_active: true,
                    entry_bear: c.qitEntry,
                    signalTime: c.time,
                    sl_bear: c.qitSl,
                    tp1_bear: c.qitTp1,
                    tp2_bear: c.qitTp2,
                    tp3_bear: c.qitTp3,
                    zone_hi_bear: prev1.high,
                    zone_lo_bear: prev1.low,
                    bull_active: false,
                    last_bear_idx: i,
                    last_bull_idx: activeQitState.last_bull_idx
                };
            }
        }
        
        // Track state invalidation
        if (activeQitState.bull_active) {
            if (c.low < activeQitState.sl_bull || c.high > activeQitState.tp2_bull) {
                activeQitState.bull_active = false;
            }
        }
        if (activeQitState.bear_active) {
            if (c.high > activeQitState.sl_bear || c.low < activeQitState.tp2_bear) {
                activeQitState.bear_active = false;
            }
        }
        c.qitState = activeQitState;

        // --- Livermore Gold Trend v12 PRO Calculation ---
        // 1. EMA 100
        c.ema100 = (c.close - ema100Prev) * ema100Mult + ema100Prev;
        ema100Prev = c.ema100;

        // 2. RSI 21
        let gain21 = Math.max(0, change), loss21 = Math.max(0, -change);
        if (i === rsi21Period) {
            for (let j = 1; j <= rsi21Period; j++) {
                let chg = candles[j].close - candles[j - 1].close;
                rsi21AvgGain += Math.max(0, chg);
                rsi21AvgLoss += Math.max(0, -chg);
            }
            rsi21AvgGain /= rsi21Period; rsi21AvgLoss /= rsi21Period;
        } else if (i > rsi21Period) {
            rsi21AvgGain = (rsi21AvgGain * (rsi21Period - 1) + gain21) / rsi21Period;
            rsi21AvgLoss = (rsi21AvgLoss * (rsi21Period - 1) + loss21) / rsi21Period;
        }
        c.rsi21 = (i >= rsi21Period) ? (rsi21AvgLoss === 0 ? 100 : 100 - (100 / (1 + (rsi21AvgGain / rsi21AvgLoss)))) : null;

        // 3. ADX 14 (RMA Smoothing)
        let tr_adx = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
        let upMove = c.high - prev.high;
        let downMove = prev.low - c.low;
        let pDM = (upMove > downMove && upMove > 0) ? upMove : 0;
        let mDM = (downMove > upMove && downMove > 0) ? downMove : 0;
        
        if (i === 0) {
            trSmooth = tr_adx; pDmSmooth = pDM; mDmSmooth = mDM;
        } else {
            trSmooth = trSmooth - (trSmooth / adxPeriod) + tr_adx;
            pDmSmooth = pDmSmooth - (pDmSmooth / adxPeriod) + pDM;
            mDmSmooth = mDmSmooth - (mDmSmooth / adxPeriod) + mDM;
        }
        let pDI = trSmooth > 0 ? 100 * (pDmSmooth / trSmooth) : 0;
        let mDI = trSmooth > 0 ? 100 * (mDmSmooth / trSmooth) : 0;
        let dx = (pDI + mDI) > 0 ? 100 * Math.abs(pDI - mDI) / (pDI + mDI) : 0;
        c.dx = dx; // Store for ADX smoothing

        if (i === adxPeriod * 2 - 1) { // Wait for initial period for ADX
            let sumDx = 0;
            for (let j = 0; j < adxPeriod; j++) sumDx += candles[i - j].dx;
            c.adx = sumDx / adxPeriod;
        } else if (i > adxPeriod * 2 - 1) {
            c.adx = (prev.adx * (adxPeriod - 1) + dx) / adxPeriod; // RMA of DX
        } else {
            c.adx = null;
        }

        // 4. Livermore Trade Simulation — port of TradingView's broker emulator
        //    for the Pine strategy (process_orders_on_close = false):
        //    • strategy.entry at bar t's close fills at bar t+1's OPEN
        //    • strategy.exit (stop = SL/trailing stop, limit = TP) is placed at a
        //      close while in a position and works from the NEXT bar
        //    • stop and limit in one bar: TV's intrabar path — open nearer the
        //      high → open→high→low→close, else open→low→high→close
        //    • a gap through the stop/limit fills at the open
        //    • pyramiding = 2: a second buy adds while long (SL/TP unchanged)
        {
            const trI = i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
            if (i < 14) lmAtr = ((lmAtr ?? 0) * i + trI) / (i + 1); else lmAtr = (lmAtr * 13 + trI) / 14;
            c.lmAtr = i >= 13 ? lmAtr : null;
        }
        let ls = { ...lastLivermoreState };
        c.livermoreBuy = false; c.livermoreAdd = false;
        c.livermoreFill = null; c.livermoreExit = null; c.livermoreExitPrice = null; c.livermorePnl = null;

        // (a) pending entry fills at this bar's open
        if (ls.pending) {
            if (ls.position_size < 2) {
                ls.entryPrice = ls.position_size === 0 ? c.open : (ls.entryPrice * ls.position_size + c.open) / (ls.position_size + 1);
                ls.position_size += 1;
                c.livermoreFill = c.open;
            }
            ls.pending = false;
        }

        // (b) exits during this bar (orders placed at an earlier close)
        if (ls.armed && ls.position_size > 0 && ls.sl != null) {
            const towardHighFirst = Math.abs(c.high - c.open) < Math.abs(c.open - c.low);
            let exitAt = null, reason = null;
            if (c.open <= ls.sl) { exitAt = c.open; reason = 'SL'; }
            else if (ls.tp != null && c.open >= ls.tp) { exitAt = c.open; reason = 'TP'; }
            else {
                const hitTp = ls.tp != null && c.high >= ls.tp, hitSl = c.low <= ls.sl;
                if (hitTp && hitSl) { if (towardHighFirst) { exitAt = ls.tp; reason = 'TP'; } else { exitAt = ls.sl; reason = 'SL'; } }
                else if (hitTp) { exitAt = ls.tp; reason = 'TP'; }
                else if (hitSl) { exitAt = ls.sl; reason = 'SL'; }
            }
            if (reason) {
                // TradingView labels this script's stop exits "SL" even after the
                // stop has trailed (it is a plain stop that the script moves up)
                c.livermoreTrailed = reason === 'SL' && ls.trailed;
                c.livermoreExit = reason;
                c.livermoreExitPrice = exitAt;
                c.livermorePnl = (exitAt - ls.entryPrice) * ls.position_size; // price points per unit
                c.livermoreExitEntry = ls.entryPrice;
                ls = { position_size: 0, sl: null, tp: null, initSl: null, entryPrice: null, pending: false, armed: false, trailed: false };
            }
        }

        // daily filter state: a new server day finalises yesterday's close
        if (LM.useDaily && c.time) {
            const dk = lmDay(c.time);
            if (dk !== lmDayKey) {
                if (lmDayClose != null) {
                    lmDayEma = lmDayEma == null ? lmDayClose : (lmDayClose - lmDayEma) * (2 / 51) + lmDayEma;
                    lmDailyOk = lmDayClose > lmDayEma;
                }
                lmDayKey = dk;
            }
            lmDayClose = c.close;
        }

        // (c) the script runs at this bar's close
        let in_session = true;
        if (LM.useSession && c.time) {
            const hr = lmHour(c.time);
            in_session = hr >= LM.sessionStart && hr <= LM.sessionEnd;
        }
        const uptrend = c.close > c.ema100 && c.adx !== null && c.adx > LM.adxThresh && in_session && (!LM.useDaily || lmDailyOk);
        const crossUp = prev !== c && prev.rsi21 != null && c.rsi21 != null && prev.rsi21 < LM.rsiEntry && c.rsi21 > LM.rsiEntry;
        const atrNow = c.lmAtr;
        if (crossUp && uptrend && atrNow) {
            if (ls.position_size === 0) {           // SL/TP only set when flat (as in the script)
                ls.sl = c.close - atrNow * LM.slMult;
                ls.initSl = ls.sl;
                ls.tp = c.close + atrNow * LM.tpMult;
                ls.trailed = false;
            }
            if (ls.position_size < 2) {             // pyramiding = 2
                ls.pending = true;
                c.livermoreBuy = true;
                c.livermoreAdd = ls.position_size > 0;
            }
        }
        if (LM.useTs && ls.position_size > 0 && atrNow) {
            const newSl = c.close - atrNow * LM.tsOffset;
            if (newSl > ls.sl) { ls.sl = newSl; ls.trailed = true; }
        }
        ls.armed = ls.position_size > 0;
        c.livermoreState = ls;
        lastLivermoreState = ls;

        // --- Trader's Interest Speedometer Calculation (Single TF Approximation) ---
        let interestLen = 14;
        if (i >= interestLen && c.rsi !== null && c.atr !== null && c.atr > 0) {
            let momVal = c.close - candles[i - interestLen].close;
            let momScore = Math.max(-50, Math.min(50, (momVal / (c.atr * 2)) * 50));
            let rsiScore = c.rsi - 50;
            let combined = rsiScore + momScore;
            
            c.tradersInterest = combined;
            let buy_pct = (combined + 100) / 2;
            c.tradersInterestBuyPct = Math.max(0, Math.min(100, buy_pct));
            c.tradersInterestSellPct = 100 - c.tradersInterestBuyPct;
        } else {
            c.tradersInterest = null;
        }
    }
    
    // Assign global flags
    candles.qit = true;
    candles.livermore = true;
    candles.tradersInterest = true;


    // Supply / Demand Pro (Matched with Pinescript)
    const sdZones = findSupplyDemandZones(candles, s);

    // We attach sdZones to the candles array object for easy retrieval without needing a separate state object
    candles.sdZones = sdZones;

    // --- FX24HR Market Profile: volume profile, POC, value area, naked POCs (marketProfile.js) ---
    candles.fxProfiles = calcMarketProfile(candles, s);
    candles.fxProfile = true;

    // --- Volume-Based Support & Resistance (VBR, utils/vbr.js) ---
    {
        const opts = { lookback: parseInt(s.vbrLookback) || 200, factor: parseFloat(s.vbrVolFactor) || 2.0, minVol: parseFloat(s.vbrMinVol) || 0, maxLevels: parseInt(s.vbrMaxLevels) || 12, mergePct: parseFloat(s.vbrMergePct) || 0.2 };
        const sma = volumeSma(candles, opts.lookback);
        for (let i = opts.lookback; i < candles.length; i++) candles[i].vbrLevels = vbrLevelsAt(candles, i, sma, opts);
    }

    // --- Multi-Timeframe Order Blocks ---
    candles.mtfOrderBlocks = computeMTFOrderBlocks(candles, s);

    // --- Market Sessions ---
    candles.marketSessions = computeMarketSessions(candles, s);

    // --- Chart patterns (harmonics, H&S, doubles, triangles) — only when switched on ---
    candles.chartPatterns = detectPatterns(candles, s);

    // --- MACD H&S Breakout scanner (patterns + breakout signals) ---
    candles.macdHsPatterns = calcMacdHs(candles, s);

    // --- Gold Move ---
    calcGoldMove(candles, s);

    // --- QIT track record: every past signal, TP1/TP2 reached before SL? ---
    {
        let n = 0, t1 = 0, t2 = 0;
        for (let i = 0; i < candles.length - 1; i++) {
            const c = candles[i];
            if (!c.qitSignal) continue;
            const long = c.qitSignal === 'LONG';
            let h1 = false, res = null;
            for (let j = i; j < candles.length - 1 && j - i <= 300; j++) {
                const k = candles[j];
                if (long ? k.low <= c.qitSl : k.high >= c.qitSl) { res = 'sl'; break; }
                if (long ? k.high >= c.qitTp1 : k.low <= c.qitTp1) h1 = true;
                if (long ? k.high >= c.qitTp2 : k.low <= c.qitTp2) { res = 'tp2'; break; }
            }
            if (!res) continue;                  // still open
            n++; if (h1 || res === 'tp2') t1++; if (res === 'tp2') t2++;
        }
        candles.qitRecord = { signals: n, tp1: n ? t1 / n : 0, tp2: n ? t2 / n : 0 };
    }

    // --- SMC Pro (zones + confirmed entries, see smcPro.js) ---
    let smc = calcSmcPro(candles, s);
    if (smc && candles.length > 0) {
        candles[candles.length - 1].smcProData = smc;
    }

    // --- MA Ribbon ---
    let ribbon = calcMaRibbon(candles, s);
    if (ribbon) {
        for (let i = 0; i < candles.length; i++) {
            candles[i].ma1 = ribbon.ma1[i];
            candles[i].ma2 = ribbon.ma2[i];
            candles[i].ma3 = ribbon.ma3[i];
            candles[i].ma4 = ribbon.ma4[i];
        }
    }

    // --- Liquidity Sweep Reversal (LSR) ---
    let lsrResult = calcLSR(candles, s);
    candles.lsrLevels = lsrResult.levels;
    for (let i = 0; i < candles.length; i++) {
        if (lsrResult.signals[i]) {
            candles[i].lsrSignal = lsrResult.signals[i];
        }
    }

    return candles;
}

// --- MTF Order Blocks Engine ---
function computeMTFOrderBlocks(baseCandles, s) {
    if (!baseCandles || baseCandles.length < 10) return [];
    
    let obs = [];
    const showMitigated = s.obShowMitigated === true;
    
    // Timeframes in minutes
    const tfs = [
        { key: 'M5', mins: 5, show: s.obShowM5, bull: '#20b2aa', bear: '#ffb6c1' },
        { key: 'M15', mins: 15, show: s.obShowM15, bull: '#006400', bear: '#dc143c' },
        { key: 'M30', mins: 30, show: s.obShowM30, bull: '#1e90ff', bear: '#ff4500' },
        { key: 'H1', mins: 60, show: s.obShowH1, bull: '#0000ff', bear: '#ff0000' },
        { key: 'H4', mins: 240, show: s.obShowH4, bull: '#000080', bear: '#800000' }
    ];
    
    // Helper to aggregate candles
    const aggregate = (tfMins) => {
        let htf = [];
        let curr = null;
        for (let i = 0; i < baseCandles.length; i++) {
            let c = baseCandles[i];
            let date = new Date(c.time);
            let totalMins = Math.floor(date.getTime() / 60000); // Unix timestamp in minutes
            let periodStart = Math.floor(totalMins / tfMins) * tfMins;
            
            if (!curr || curr.period !== periodStart) {
                if (curr) htf.push(curr);
                curr = {
                    period: periodStart,
                    time: c.time,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                    startIndex: i,
                    endIndex: i
                };
            } else {
                curr.high = Math.max(curr.high, c.high);
                curr.low = Math.min(curr.low, c.low);
                curr.close = c.close;
                curr.endIndex = i;
            }
        }
        if (curr) htf.push(curr);
        return htf;
    };

    tfs.forEach(tf => {
        if (!tf.show) return;
        
        let htfCandles = aggregate(tf.mins);
        let copied = htfCandles.length;
        if (copied < 10) return;
        
        // Loop from oldest to newest
        for (let i = 0; i < copied - 2; i++) {
            let c0 = htfCandles[i];
            let c1 = htfCandles[i+1];
            let c2 = htfCandles[i+2];
            
            // Bullish FVG (c2 is the newest in the 3-candle pattern)
            if (c2.low > c0.high) {
                let ob_idx = -1;
                // Find preceding bearish candle in the last 10
                for (let j = i; j >= Math.max(0, i - 10); j--) {
                    if (htfCandles[j].close < htfCandles[j].open) {
                        ob_idx = j;
                        break;
                    }
                }
                
                if (ob_idx !== -1) {
                    let ob = htfCandles[ob_idx];
                    let mitTime = null;
                    
                    // Check for mitigation
                    for (let k = i + 2; k < copied; k++) {
                        if (htfCandles[k].low <= ob.high) {
                            mitTime = htfCandles[k].time;
                            break;
                        }
                    }
                    
                    if (mitTime === null || showMitigated) {
                        obs.push({
                            tf: tf.key,
                            type: 'Bullish',
                            time: ob.time,
                            mitTime: mitTime,
                            high: ob.high,
                            low: ob.low,
                            color: tf.bull
                        });
                    }
                }
            }
            
            // Bearish FVG
            if (c2.high < c0.low) {
                let ob_idx = -1;
                // Find preceding bullish candle
                for (let j = i; j >= Math.max(0, i - 10); j--) {
                    if (htfCandles[j].close > htfCandles[j].open) {
                        ob_idx = j;
                        break;
                    }
                }
                
                if (ob_idx !== -1) {
                    let ob = htfCandles[ob_idx];
                    let mitTime = null;
                    
                    // Check for mitigation
                    for (let k = i + 2; k < copied; k++) {
                        if (htfCandles[k].high >= ob.low) {
                            mitTime = htfCandles[k].time;
                            break;
                        }
                    }
                    
                    if (mitTime === null || showMitigated) {
                        obs.push({
                            tf: tf.key,
                            type: 'Bearish',
                            time: ob.time,
                            mitTime: mitTime,
                            high: ob.high,
                            low: ob.low,
                            color: tf.bear
                        });
                    }
                }
            }
        }
    });

    return obs;
}

// --- Gold Move Engine ---
function calcGoldMove(candles, s) {
    if (!candles || candles.length < 2) return;

    // Default settings
    const gmFactor = s.gmFactor || 11;
    const gmSensitivity = s.gmSensitivity || 2.5;

    // Moving Averages
    const ema200Mult = 2 / (200 + 1);
    const ema150Mult = 2 / (150 + 1);
    const ema250Mult = 2 / (250 + 1);

    const ribbonPeriods = [20, 25, 30, 35, 40, 45, 50, 55];
    const ribbonMults = ribbonPeriods.map(p => 2 / (p + 1));

    let ema200Prev = candles[0].close;
    let ema150Prev = candles[0].close;
    let ema250Prev = candles[0].close;
    let ribbonPrevs = ribbonPeriods.map(() => candles[0].close);

    const sma13Period = 13;
    
    // Running sums for O(n) computation (replaces O(n*period) sliding window loops)
    let sma13Sum = 0;
    const atr100Queue = [];
    let atr100Sum = 0;
    const atr100Len = 100;
    
    const atrLen = gmFactor;
    let direction = 1;
    let prevLowerBand = 0;
    let prevUpperBand = 0;
    let prevSuperTrend = 0;
    let prevEma200 = 0;
    
    for (let i = 0; i < candles.length; i++) {
        let c = candles[i];
        let prevC = i > 0 ? candles[i - 1] : c;

        // EMAs
        c.gmEma200 = (c.close - ema200Prev) * ema200Mult + ema200Prev;
        ema200Prev = c.gmEma200;

        c.gmEma150 = (c.close - ema150Prev) * ema150Mult + ema150Prev;
        ema150Prev = c.gmEma150;

        c.gmEma250 = (c.close - ema250Prev) * ema250Mult + ema250Prev;
        ema250Prev = c.gmEma250;

        // Ribbon
        c.gmRibbon = [];
        for (let j = 0; j < ribbonPeriods.length; j++) {
            let val = (c.close - ribbonPrevs[j]) * ribbonMults[j] + ribbonPrevs[j];
            c.gmRibbon.push(val);
            ribbonPrevs[j] = val;
        }

        // SMA 13 (running sum — O(n) instead of O(n*13))
        if (i >= sma13Period) {
            sma13Sum += c.close - candles[i - sma13Period].close;
        } else {
            sma13Sum += c.close;
        }
        c.gmSma13 = i >= sma13Period - 1 ? (sma13Sum / sma13Period) : null;

        // ATR for SuperTrend (True Range then RMA)
        let tr = Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close));
        if (i === 0) {
            c.gmAtr = tr;
        } else {
            const alpha = 1 / atrLen;
            c.gmAtr = alpha * tr + (1 - alpha) * prevC.gmAtr;
        }

        // SuperTrend on OPEN price
        let _close = c.open;
        let atr = c.gmAtr;
        
        let upperBand = _close + gmSensitivity * atr;
        let lowerBand = _close - gmSensitivity * atr;

        if (i > 0) {
            lowerBand = (lowerBand > prevLowerBand || prevC.close < prevLowerBand) ? lowerBand : prevLowerBand;
            upperBand = (upperBand < prevUpperBand || prevC.close > prevUpperBand) ? upperBand : prevUpperBand;
        }

        if (i === 0 || isNaN(prevC.gmAtr)) {
            direction = 2; // Init
        } else if (prevSuperTrend === prevUpperBand) {
            direction = c.close > upperBand ? -1 : 1;
        } else {
            direction = c.close < lowerBand ? 1 : -1;
        }

        let superTrend = direction === -1 ? lowerBand : upperBand;
        c.gmSuperTrend = superTrend;
        c.gmSuperTrendDir = direction;

        // --- Chaos Trend Line (Trailing Step) ---
        const amplitude = 3;
        const channelDeviation = 2;
        
        // True Range for chaos trend
        let tr100 = Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close));
        
        // Running ATR(100) sum — O(n) instead of O(n*100)
        atr100Queue.push(tr100);
        atr100Sum += tr100;
        if (atr100Queue.length > atr100Len) {
            atr100Sum -= atr100Queue.shift();
        }
        
        if (i >= atr100Len) {
            c.gmAtr100 = atr100Sum / atr100Len;
        } else {
            c.gmAtr100 = c.gmAtr || 0; 
        }

        let dev = channelDeviation * (c.gmAtr100 / 2);
        
        let highPrice1 = -Infinity;
        let lowPrice1 = Infinity;
        let highSum = 0;
        let lowSum = 0;
        let validBars = Math.min(i+1, amplitude);
        for(let j=0; j<validBars; j++) {
            let jC = candles[i-j];
            if(jC.high > highPrice1) highPrice1 = jC.high;
            if(jC.low < lowPrice1) lowPrice1 = jC.low;
            highSum += jC.high;
            lowSum += jC.low;
        }
        let highma = highSum / validBars;
        let lowma = lowSum / validBars;

        if (c.gmNextTrend === undefined) c.gmNextTrend = prevC.gmNextTrend || 0;
        if (c.gmTrend === undefined) c.gmTrend = prevC.gmTrend || 0;
        if (c.gmMaxLowPrice === undefined) c.gmMaxLowPrice = prevC.gmMaxLowPrice !== undefined ? prevC.gmMaxLowPrice : (prevC.low || c.low);
        if (c.gmMinHighPrice === undefined) c.gmMinHighPrice = prevC.gmMinHighPrice !== undefined ? prevC.gmMinHighPrice : (prevC.high || c.high);
        if (c.gmUp1 === undefined) c.gmUp1 = prevC.gmUp1 || 0.0;
        if (c.gmDown1 === undefined) c.gmDown1 = prevC.gmDown1 || 0.0;

        let nextTrend = c.gmNextTrend;
        let trend = c.gmTrend;
        let maxLowPrice = c.gmMaxLowPrice;
        let minHighPrice = c.gmMinHighPrice;

        if (nextTrend === 1) {
            maxLowPrice = Math.max(lowPrice1, maxLowPrice);
            if (highma < maxLowPrice && c.close < (prevC.low || c.low)) {
                trend = 1;
                nextTrend = 0;
                minHighPrice = highPrice1;
            }
        } else {
            minHighPrice = Math.min(highPrice1, minHighPrice);
            if (lowma > minHighPrice && c.close > (prevC.high || c.high)) {
                trend = 0;
                nextTrend = 1;
                maxLowPrice = lowPrice1;
            }
        }
        
        let up1 = c.gmUp1;
        let down1 = c.gmDown1;

        if (trend === 0) {
            if (prevC.gmTrend !== undefined && prevC.gmTrend !== 0) {
                up1 = prevC.gmDown1 !== undefined ? prevC.gmDown1 : down1;
            } else {
                up1 = prevC.gmUp1 !== undefined ? Math.max(maxLowPrice, prevC.gmUp1) : maxLowPrice;
            }
        } else {
            if (prevC.gmTrend !== undefined && prevC.gmTrend !== 1) {
                down1 = prevC.gmUp1 !== undefined ? prevC.gmUp1 : up1;
            } else {
                down1 = prevC.gmDown1 !== undefined ? Math.min(minHighPrice, prevC.gmDown1) : minHighPrice;
            }
        }

        c.gmNextTrend = nextTrend;
        c.gmTrend = trend;
        c.gmMaxLowPrice = maxLowPrice;
        c.gmMinHighPrice = minHighPrice;
        c.gmUp1 = up1;
        c.gmDown1 = down1;
        
        c.gmChaosTrend = trend === 0 ? up1 : down1;
        c.gmChaosTrendDir = trend === 0 ? -1 : 1; 

        // --- Keltner Channels (Purple Clouds) ---
        // Pine Script ta.kc uses: basis = EMA(close, 10), range = ATR(10) = RMA(TR, 10)
        // We need running EMA(close,10) and RMA(TR,10)
        const kcEmaAlpha = 2 / (10 + 1);
        if (i === 0) {
            c.gmKcBasis = c.close;
            c.gmKcAtr = tr; // reuse tr already computed above for SuperTrend
        } else {
            c.gmKcBasis = kcEmaAlpha * c.close + (1 - kcEmaAlpha) * prevC.gmKcBasis;
            const rmaAlpha = 1 / 10;
            c.gmKcAtr = rmaAlpha * tr + (1 - rmaAlpha) * prevC.gmKcAtr;
        }

        let kcBasis = c.gmKcBasis;
        let kcRange = c.gmKcAtr;

        const k_length = 0.425;
        let upperKC1 = kcBasis + (10.5 * k_length) * kcRange;
        let upperKC2 = kcBasis + (9.5 * k_length) * kcRange;
        let upperKC3 = kcBasis + (8 * k_length) * kcRange;
        let upperKC4 = kcBasis + (3 * k_length) * kcRange;
        let lowerKC1 = kcBasis - (10.5 * k_length) * kcRange;
        let lowerKC2 = kcBasis - (9.5 * k_length) * kcRange;
        let lowerKC3 = kcBasis - (8 * k_length) * kcRange;
        let lowerKC4 = kcBasis - (3 * k_length) * kcRange;

        const ema50Mult = 2 / (50 + 1);
        c.gmK1 = i > 0 ? (upperKC1 - prevC.gmK1) * ema50Mult + prevC.gmK1 : upperKC1;
        c.gmK2 = i > 0 ? (upperKC2 - prevC.gmK2) * ema50Mult + prevC.gmK2 : upperKC2;
        c.gmK3 = i > 0 ? (upperKC3 - prevC.gmK3) * ema50Mult + prevC.gmK3 : upperKC3;
        c.gmK4 = i > 0 ? (upperKC4 - prevC.gmK4) * ema50Mult + prevC.gmK4 : upperKC4;
        c.gmK5 = i > 0 ? (lowerKC4 - prevC.gmK5) * ema50Mult + prevC.gmK5 : lowerKC4;
        c.gmK6 = i > 0 ? (lowerKC3 - prevC.gmK6) * ema50Mult + prevC.gmK6 : lowerKC3;
        c.gmK7 = i > 0 ? (lowerKC2 - prevC.gmK7) * ema50Mult + prevC.gmK7 : lowerKC2;
        c.gmK8 = i > 0 ? (lowerKC1 - prevC.gmK8) * ema50Mult + prevC.gmK8 : lowerKC1;

        // Signals
        c.gmBull = false;
        c.gmBear = false;
        c.gmSBull = false;
        c.gmSBear = false;

        if (i > 0) {
            let closeXUpSt = c.close > superTrend && prevC.close <= prevSuperTrend;
            let closeXDnSt = c.close < superTrend && prevC.close >= prevSuperTrend;
            
            let smaCondBull = c.close >= c.gmSma13;
            let smaCondBear = c.close <= c.gmSma13;

            let prevEmaCond = prevC.close > prevEma200 && c.close > c.gmEma200;

            if (closeXUpSt && smaCondBull) {
                if (!prevEmaCond) c.gmBull = true;
                if (prevEmaCond) c.gmSBull = true;
            }
            if (closeXDnSt && smaCondBear) {
                if (prevEmaCond) c.gmBear = true;
                if (!prevEmaCond) c.gmSBear = true;
            }
        }

        // Active Trade tracking for TP1
        if (i === 0) {
            c.gmActiveTrade = null;
        } else {
            let activeTrade = prevC.gmActiveTrade ? { ...prevC.gmActiveTrade } : null;

            if (c.gmBull || c.gmSBull || c.gmBear || c.gmSBear) {
                // Calculate SMA of TR over 14 periods
                let atrSum = 0;
                let count = 0;
                for (let j = i; j >= Math.max(0, i - 13); j--) {
                    let jC = candles[j];
                    let jPrev = j > 0 ? candles[j - 1] : jC;
                    let tr = Math.max(jC.high - jC.low, Math.abs(jC.high - jPrev.close), Math.abs(jC.low - jPrev.close));
                    atrSum += tr;
                    count++;
                }
                let smaTr = count > 0 ? atrSum / count : 0;
                let atrBand = smaTr * 2.2;

                if (c.gmBull || c.gmSBull) {
                    let sl = c.low - atrBand;
                    let diff = c.close - sl;
                    let tp1 = c.close + diff * 1.0;
                    c.gmSl = sl;
                    c.gmTp1 = tp1;
                    activeTrade = { type: 'buy', entry: c.close, sl, tp1 };
                } else if (c.gmBear || c.gmSBear) {
                    let sl = c.high + atrBand;
                    let diff = sl - c.close;
                    let tp1 = c.close - diff * 1.0;
                    c.gmSl = sl;
                    c.gmTp1 = tp1;
                    activeTrade = { type: 'sell', entry: c.close, sl, tp1 };
                }
            } else if (activeTrade) {
                // SL is checked first: when one candle touches both, the order
                // inside it is unknown, so it counts as a stop (not a TP1 win)
                if (activeTrade.type === 'buy') {
                    if (c.low <= activeTrade.sl) {
                        activeTrade = null;
                    } else if (c.high >= activeTrade.tp1) {
                        c.gmTP1 = true;
                        c.gmTP1Type = 'buy';
                        activeTrade = null;
                    }
                } else if (activeTrade.type === 'sell') {
                    if (c.high >= activeTrade.sl) {
                        activeTrade = null;
                    } else if (c.low <= activeTrade.tp1) {
                        c.gmTP1 = true;
                        c.gmTP1Type = 'sell';
                        activeTrade = null;
                    }
                }
            }
            c.gmActiveTrade = activeTrade;
        }

        prevLowerBand = lowerBand;
        prevUpperBand = upperBand;
        prevSuperTrend = superTrend;
        prevEma200 = c.gmEma200;
    }

    // Track record: every signal, TP1 (1R) before SL? Validated Oct 2026 on gold
    // 15m 2016-25 (7,396 signals): 50.0% - break-even; "Smart" 49.2%, others 50.7%.
    let n = 0, w = 0, ns = 0, ws = 0;
    for (let i = 1; i < candles.length - 1; i++) {
        const c = candles[i];
        if (!(c.gmBull || c.gmSBull || c.gmBear || c.gmSBear) || c.gmSl == null) continue;
        const buy = c.gmBull || c.gmSBull;
        let r = null;
        for (let j = i + 1; j < candles.length - 1 && j - i <= 500; j++) {
            const k = candles[j];
            if (buy ? k.low <= c.gmSl : k.high >= c.gmSl) { r = 0; break; }
            if (buy ? k.high >= c.gmTp1 : k.low <= c.gmTp1) { r = 1; break; }
        }
        if (r === null) continue;
        n++; w += r;
        if (c.gmSBull || c.gmSBear) { ns++; ws += r; }
    }
    candles.gmRecord = { signals: n, tp1: n ? w / n : 0, smart: ns, smartTp1: ns ? ws / ns : 0 };
}

// --- MA Ribbon Engine ---
function calcMaRibbon(candles, s) {
    if (!candles || candles.length < 2) return null;
    
    let maRibbon = {
        ma1: new Array(candles.length).fill(null),
        ma2: new Array(candles.length).fill(null),
        ma3: new Array(candles.length).fill(null),
        ma4: new Array(candles.length).fill(null)
    };
    
    for (let m = 1; m <= 4; m++) {
        let show = s[`ma${m}Show`];
        if (!show) continue;
        
        let type = s[`ma${m}Type`];
        let len = s[`ma${m}Len`] || 20;
        
        if (type === 'SMA') {
            for (let i = len - 1; i < candles.length; i++) {
                let sum = 0;
                for (let j = 0; j < len; j++) sum += candles[i - j].close;
                maRibbon[`ma${m}`][i] = sum / len;
            }
        } else if (type === 'EMA') {
            let mult = 2 / (len + 1);
            let prev = candles[0].close;
            maRibbon[`ma${m}`][0] = prev;
            for (let i = 1; i < candles.length; i++) {
                prev = (candles[i].close - prev) * mult + prev;
                maRibbon[`ma${m}`][i] = prev;
            }
        } else if (type === 'SMMA (RMA)') {
            let alpha = 1 / len;
            let sum = 0;
            let startLen = Math.min(len, candles.length);
            for (let j = 0; j < startLen; j++) sum += candles[j].close;
            let prev = sum / startLen;
            
            for (let i = 0; i < startLen; i++) maRibbon[`ma${m}`][i] = prev;
            
            for (let i = startLen; i < candles.length; i++) {
                prev = alpha * candles[i].close + (1 - alpha) * prev;
                maRibbon[`ma${m}`][i] = prev;
            }
        } else if (type === 'WMA') {
            let norm = (len * (len + 1)) / 2;
            for (let i = len - 1; i < candles.length; i++) {
                let sum = 0;
                for (let j = 0; j < len; j++) sum += candles[i - j].close * (len - j);
                maRibbon[`ma${m}`][i] = sum / norm;
            }
        } else if (type === 'VWMA') {
            for (let i = len - 1; i < candles.length; i++) {
                let sumPV = 0;
                let sumV = 0;
                for (let j = 0; j < len; j++) {
                    let c = candles[i - j];
                    let v = c.volume || 1;
                    sumPV += c.close * v;
                    sumV += v;
                }
                maRibbon[`ma${m}`][i] = sumV === 0 ? candles[i].close : sumPV / sumV;
            }
        }
    }
    return maRibbon;
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity Sweep Reversal (LSR) Engine
// Mirrors the Pine Script "Liquidity Sweep Reversal | H4/H1 Pools + LTF Entry"
// ─────────────────────────────────────────────────────────────────────────────
function calcLSR(candles, s) {
    if (!candles || candles.length < 10) return { levels: [], signals: {} };

    // ── Settings (mirror Pine Script defaults) ──────────────────────────────
    const useH4      = s.lsrUseH4     !== false;
    const useH1      = s.lsrUseH1     !== false;
    const fracL      = s.lsrFracL     || 2;
    const fracR      = s.lsrFracR     || 2;
    const tolMult    = s.lsrTolMult   !== undefined ? parseFloat(s.lsrTolMult)   : 0.10;
    const minTouches = s.lsrMinTouches !== undefined ? parseInt(s.lsrMinTouches)  : 1;
    const atrLen     = s.lsrAtrLen    || 14;
    const maxLevels  = s.lsrMaxLevels || 150;
    const showSwept  = s.lsrShowSwept || false;

    const rsiLen  = s.lsrRsiLen  || 14;
    const rsiWin  = s.lsrRsiWin  || 3;
    const autoProfile = s.lsrAutoProfile !== false;
    const rsiObIn = s.lsrRsiOb   !== undefined ? parseFloat(s.lsrRsiOb) : 70.0;
    const rsiOsIn = s.lsrRsiOs   !== undefined ? parseFloat(s.lsrRsiOs) : 30.0;
    const reqMacd = s.lsrReqMacd || false;
    const slBuf   = s.lsrSlBuf   !== undefined ? parseFloat(s.lsrSlBuf) : 0.20;

    const tp1R = s.lsrTp1R !== undefined ? parseFloat(s.lsrTp1R) : 1.0;
    const tp2R = s.lsrTp2R !== undefined ? parseFloat(s.lsrTp2R) : 2.0;
    const tp3R = s.lsrTp3R !== undefined ? parseFloat(s.lsrTp3R) : 3.0;

    // Detect gold
    // (We don't have syminfo here, so we expose a flag via settings)
    const isGold = s.lsrIsGold || false;
    const rsiOB = autoProfile ? (isGold ? 65.0 : 70.0) : rsiObIn;
    const rsiOS = autoProfile ? (isGold ? 35.0 : 30.0) : rsiOsIn;

    // ── Helper: aggregate candles into a higher timeframe ──────────────────
    const aggregate = (tfMins) => {
        let htf = [];
        let curr = null;
        for (let i = 0; i < candles.length; i++) {
            let c = candles[i];
            let totalMins = Math.floor(c.time / 60000);
            let periodStart = Math.floor(totalMins / tfMins) * tfMins;
            if (!curr || curr.period !== periodStart) {
                if (curr) htf.push(curr);
                curr = {
                    period: periodStart,
                    time: c.time,
                    open: c.open, high: c.high, low: c.low, close: c.close,
                    startIndex: i, endIndex: i, baseIdx: i
                };
            } else {
                curr.high = Math.max(curr.high, c.high);
                curr.low  = Math.min(curr.low,  c.low);
                curr.close = c.close;
                curr.endIndex = i;
            }
        }
        if (curr) htf.push(curr);
        return htf;
    };

    // ── Helper: ATR of an aggregated HTF candle array ──────────────────────
    const calcHtfAtr = (htfCandles, period) => {
        if (!htfCandles || htfCandles.length < 2) return 0;
        let atrs = [];
        for (let i = 0; i < htfCandles.length; i++) {
            let c = htfCandles[i];
            let p = i > 0 ? htfCandles[i-1] : c;
            let tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
            if (i === 0) atrs.push(tr);
            else if (i < period) atrs.push((atrs[i-1] * i + tr) / (i+1));
            else atrs.push((atrs[i-1] * (period-1) + tr) / period);
        }
        return atrs[atrs.length - 1] || 0;
    };

    // ── Helper: fractal pivot highs/lows on an HTF array ──────────────────
    const getPivots = (htfCandles, fL, fR) => {
        let pivotHighs = [], pivotLows = [];
        for (let i = fL; i < htfCandles.length - fR; i++) {
            let c = htfCandles[i];
            // Pivot High
            let isHigh = true;
            for (let j = i - fL; j <= i + fR; j++) {
                if (j === i) continue;
                if (htfCandles[j].high >= c.high) { isHigh = false; break; }
            }
            if (isHigh) pivotHighs.push({ price: c.high, time: c.time, confirmedIdx: i + fR });

            // Pivot Low
            let isLow = true;
            for (let j = i - fL; j <= i + fR; j++) {
                if (j === i) continue;
                if (htfCandles[j].low <= c.low) { isLow = false; break; }
            }
            if (isLow) pivotLows.push({ price: c.low, time: c.time, confirmedIdx: i + fR });
        }
        return { pivotHighs, pivotLows };
    };

    // Liquidity-concept options (previous-day high/low, confirmation, RR)
    const usePdhl   = s.lsrUsePdhl !== false;                 // PDH / PDL as liquidity
    const dayOffMs  = (parseFloat(s.lsrDayOffset) || 0) * 3600000;
    const confirmMode = s.lsrConfirm === 'next_candle' ? 'next_candle' : 'rejection';
    const useRsi    = s.lsrUseRsi !== false;
    const minRR     = parseFloat(s.lsrMinRR) || 0;            // vs. the opposite liquidity; 0 = off

    // ── Candidate levels, each with the bar from which it is KNOWN ─────────
    // A pivot is only confirmed fracR HTF bars later; PDH/PDL only once the day
    // has closed. Levels are added to the pool when they become known, so a
    // candle can never sweep a level that forms later (no look-ahead/repaint).
    const pending = [];   // { fromIdx, price, time, ty, tol, lbl, n }
    const addPivots = (tfMins, lbl) => {
        const htf = aggregate(tfMins);
        const tol = calcHtfAtr(htf, atrLen) * tolMult;
        const { pivotHighs, pivotLows } = getPivots(htf, fracL, fracR);
        const known = (p) => htf[p.confirmedIdx].endIndex + 1;  // after the confirming HTF bar closes
        for (const p of pivotHighs) pending.push({ fromIdx: known(p), price: p.price, time: p.time, ty: +1, tol, lbl, n: 1 });
        for (const p of pivotLows)  pending.push({ fromIdx: known(p), price: p.price, time: p.time, ty: -1, tol, lbl, n: 1 });
        return tol;
    };
    let baseTol = 0;
    if (useH4) baseTol = addPivots(240, 'H4');
    if (useH1) baseTol = addPivots(60, 'H1') || baseTol;
    if (usePdhl) {
        let dayKey = null, dHi = -Infinity, dLo = Infinity, dTime = 0;
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            const k = Math.floor((c.time + dayOffMs) / 86400000);
            if (dayKey !== null && k !== dayKey) {
                // the previous day just closed → its high/low are liquidity from now on
                pending.push({ fromIdx: i, price: dHi, time: dTime, ty: +1, tol: baseTol, lbl: 'PDH', n: 2 });
                pending.push({ fromIdx: i, price: dLo, time: dTime, ty: -1, tol: baseTol, lbl: 'PDL', n: 2 });
                dHi = -Infinity; dLo = Infinity;
            }
            if (dHi === -Infinity) dTime = c.time;
            dayKey = k; dHi = Math.max(dHi, c.high); dLo = Math.min(dLo, c.low);
        }
    }
    pending.sort((a, b) => a.fromIdx - b.fromIdx);

    // Each level: { price, time, ty(+1=high/-1=low), n(touches), lbl, swept, sweptTime }
    let levels = [];
    const addOrMerge = (lvIn) => {
        for (const lv of levels) {
            if (lv.ty === lvIn.ty && !lv.swept && Math.abs(lv.price - lvIn.price) <= lvIn.tol) {
                if (!lv.lbl.split('+').includes(lvIn.lbl)) lv.lbl = lv.lbl + '+' + lvIn.lbl;   // confluence
                lv.price = lvIn.ty === 1 ? Math.max(lv.price, lvIn.price) : Math.min(lv.price, lvIn.price);
                lv.time = Math.min(lv.time, lvIn.time);
                lv.n += lvIn.n;
                return;
            }
        }
        levels.push({ price: lvIn.price, time: lvIn.time, ty: lvIn.ty, n: lvIn.n, lbl: lvIn.lbl, swept: false, sweptTime: null });
        if (levels.length > maxLevels) levels.splice(0, levels.length - maxLevels);
    };

    // ── Sweep detection & signal generation ────────────────────────────────
    let signals = {};
    let pIdx = 0;
    let waiting = null;   // next-candle confirmation: { dir, lv, idx, bodyLo, bodyHi, extreme }

    // nearest unswept opposite liquidity (target)
    const oppositeLiquidity = (dir, price) => {
        let best = null;
        for (const lv of levels) {
            if (lv.swept) continue;
            if (dir === 1 && lv.ty === 1 && lv.price > price && (best === null || lv.price < best.price)) best = lv;
            if (dir === -1 && lv.ty === -1 && lv.price < price && (best === null || lv.price > best.price)) best = lv;
        }
        return best;
    };

    const emit = (i, dir, lv, ent, extreme) => {
        const c = candles[i];
        const buf = (c.atr || 0) * slBuf;
        const slP = dir === -1 ? extreme + buf : extreme - buf;    // beyond the sweep wick
        const r = Math.abs(ent - slP);
        if (!(r > 0)) return;
        const tgt = oppositeLiquidity(dir, ent);
        const rrToLiq = tgt ? Math.abs(tgt.price - ent) / r : null;
        if (minRR > 0 && rrToLiq !== null && rrToLiq < minRR) return;   // not worth the risk
        signals[i] = {
            dir, entry: ent, sl: slP,
            tp1: ent + dir * r * tp1R, tp2: ent + dir * r * tp2R, tp3: ent + dir * r * tp3R,
            liqTarget: tgt ? tgt.price : null, liqTargetLbl: tgt ? tgt.lbl : null, rrToLiq,
            sweepLvl: lv.price, sweepLbl: lv.lbl, confirm: confirmMode,
            time: c.time, candleHigh: c.high, candleLow: c.low,
        };
    };

    for (let i = 1; i < candles.length; i++) {
        while (pIdx < pending.length && pending[pIdx].fromIdx <= i) addOrMerge(pending[pIdx++]);
        let c    = candles[i];
        let rsiV = c.rsi;

        // RSI turn checks (optional momentum filter)
        let rsiShortOK = !useRsi, rsiLongOK = !useRsi;
        if (useRsi && rsiV !== null && rsiV !== undefined) {
            let maxRsi = rsiV, minRsi = rsiV;
            for (let w = 1; w < rsiWin && (i - w) >= 0; w++) {
                let r = candles[i - w].rsi;
                if (r !== null && r !== undefined) { maxRsi = Math.max(maxRsi, r); minRsi = Math.min(minRsi, r); }
            }
            let prevRsi = candles[i-1].rsi;
            rsiShortOK = maxRsi >= rsiOB && rsiV < (prevRsi || rsiV);
            rsiLongOK  = minRsi <= rsiOS && rsiV > (prevRsi || rsiV);
        }
        let macdH = c.macdHist, prevMacdH = candles[i-1].macdHist;
        let macdShortOK = (macdH != null && prevMacdH != null) ? macdH < prevMacdH : false;
        let macdLongOK  = (macdH != null && prevMacdH != null) ? macdH > prevMacdH : false;

        // Next-candle confirmation of the previous sweep: this candle must close
        // beyond the sweep candle's body (bearish for a high sweep, bullish for a low)
        if (waiting) {
            const w = waiting; waiting = null;
            const ok = w.dir === -1 ? c.close < w.bodyLo && c.close < c.open : c.close > w.bodyHi && c.close > c.open;
            const extreme = w.dir === -1 ? Math.max(w.extreme, c.high) : Math.min(w.extreme, c.low);
            if (ok) emit(i, w.dir, w.lv, c.close, extreme);
        }

        let sigShort = null, sigLong = null;
        for (let lv of levels) {
            if (lv.swept) continue;
            let lp = lv.price;
            if (lv.ty === 1 && c.high > lp) {                 // buy-side liquidity above highs taken
                lv.swept = true; lv.sweptTime = c.time;
                if (c.close < lp && lv.n >= minTouches && (!sigShort || lv.n > sigShort.n)) sigShort = lv;
            } else if (lv.ty === -1 && c.low < lp) {          // sell-side liquidity below lows taken
                lv.swept = true; lv.sweptTime = c.time;
                if (c.close > lp && lv.n >= minTouches && (!sigLong || lv.n > sigLong.n)) sigLong = lv;
            }
        }
        if (!showSwept) levels = levels.filter(lv => !lv.swept);

        let shortOK = sigShort && rsiShortOK && (!reqMacd || macdShortOK);
        let longOK  = sigLong  && rsiLongOK  && (!reqMacd || macdLongOK);
        if (shortOK || longOK) {
            const dir = shortOK ? -1 : 1;
            const lv = shortOK ? sigShort : sigLong;
            if (confirmMode === 'next_candle') {
                waiting = { dir, lv, bodyLo: Math.min(c.open, c.close), bodyHi: Math.max(c.open, c.close), extreme: dir === -1 ? c.high : c.low };
            } else {
                emit(i, dir, lv, c.close, dir === -1 ? c.high : c.low);
            }
        }
    }

    // Attach clean (unswept) levels for chart rendering
    const activeLevels = showSwept ? levels : levels.filter(lv => !lv.swept);

    return { levels: activeLevels, signals };
}

// ─── Moving Average (single EMA / SMA line) ──────────────────────────────────
// SMA = mean of the last mvLen source values; EMA seeded with that SMA, then
// ema += (2 / (len + 1)) × (v − ema) — as TradingView's ta.sma / ta.ema.

// ─── Bollinger Bands (TradingView defaults) ─────────────────────────────────
// Basis = SMA (or EMA) of the source over bbLength; bands = basis ± bbMult ×
// population standard deviation of the source over the same window (ta.stdev).
function calcBollinger(candles, s) {
    const len = Math.max(2, parseInt(s.bbLength) || 20);
    const mult = Number(s.bbMult ?? 2) || 2;
    const srcKey = s.bbSource || 'close';
    const useEma = s.bbMaType === 'EMA';
    const src = (c) => (srcKey === 'hlc3' ? (c.high + c.low + c.close) / 3 : srcKey === 'hl2' ? (c.high + c.low) / 2 : c[srcKey] ?? c.close);
    let sum = 0, sumSq = 0, ema = null;
    const k = 2 / (len + 1);
    for (let i = 0; i < candles.length; i++) {
        const v = src(candles[i]);
        sum += v; sumSq += v * v;
        if (i >= len) { const o = src(candles[i - len]); sum -= o; sumSq -= o * o; }
        const c = candles[i];
        if (i < len - 1) { c.bbBasis = c.bbUp = c.bbDn = null; continue; }
        const mean = sum / len;
        const sd = Math.sqrt(Math.max(0, sumSq / len - mean * mean));
        if (useEma) ema = ema === null ? mean : v * k + ema * (1 - k);
        const basis = useEma ? ema : mean;
        c.bbBasis = basis; c.bbUp = basis + mult * sd; c.bbDn = basis - mult * sd;
    }
}

// ─── Volume MA, RSI MA and VWAP ──────────────────────────────────────────────
// Volume: moving average of volume (volMaLen, SMA or EMA by volMaType) and
//         relative volume volRel = volume ÷ that average.
// RSI MA: simple moving average of RSI (rsiMaLen, 0 = off) — TradingView's
//         "RSI-based MA".
// VWAP:   anchored VWAP of hlc3, reset each session (UTC day), week or month,
//         with standard-deviation bands (vwapBand1 / vwapBand2 × σ).
function calcVolumeVwapRsiMa(candles, s) {
    const volLen = Math.max(1, parseInt(s.volMaLen) || 20);
    const rsiMaLen = Math.max(0, parseInt(s.rsiMaLen ?? 14) || 0);
    const anchor = s.vwapAnchor || 'Session';
    const b1 = Number(s.vwapBand1 ?? 1), b2 = Number(s.vwapBand2 ?? 2);
    let volSum = 0, rsiSum = 0, rsiN = 0;
    const rsiWin = [];
    let pv = 0, pvv = 0, vv = 0, period = null;
    const periodOf = (t) => {
        const d = new Date(t);
        if (anchor === 'Month') return d.getUTCFullYear() * 12 + d.getUTCMonth();
        if (anchor === 'Week') return Math.floor((t / 86400000 + 3) / 7);       // weeks start Monday (UTC)
        return Math.floor(t / 86400000);
    };
    const volEma = s.volMaType === 'EMA', kV = 2 / (volLen + 1);
    let volE = null;
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        // Volume MA (SMA, or EMA seeded with the SMA) and relative volume
        volSum += c.volume || 0;
        if (i >= volLen) volSum -= candles[i - volLen].volume || 0;
        if (volEma) { if (volE === null && i >= volLen - 1) volE = volSum / volLen; else if (volE !== null) volE += kV * ((c.volume || 0) - volE); c.volMa = volE; }
        else c.volMa = i >= volLen - 1 ? volSum / volLen : null;
        c.volRel = c.volMa > 0 ? (c.volume || 0) / c.volMa : null;
        // RSI MA
        if (rsiMaLen > 0) {
            if (c.rsi !== null && c.rsi !== undefined) {
                rsiWin.push(c.rsi); rsiSum += c.rsi; rsiN++;
                if (rsiWin.length > rsiMaLen) { rsiSum -= rsiWin.shift(); rsiN--; }
                c.rsiMa = rsiN === rsiMaLen ? rsiSum / rsiMaLen : null;
            } else c.rsiMa = null;
        } else c.rsiMa = null;
        // VWAP (zero-volume feeds count each candle equally)
        const p = periodOf(c.time);
        c.vwapStart = p !== period;                                   // anchor reset → line break
        if (p !== period) { period = p; pv = 0; pvv = 0; vv = 0; }
        const tp = (c.high + c.low + c.close) / 3;
        const v = c.volume > 0 ? c.volume : 1;
        pv += tp * v; pvv += tp * tp * v; vv += v;
        const vwap = pv / vv;
        const sd = Math.sqrt(Math.max(0, pvv / vv - vwap * vwap));
        c.vwap = vwap;
        c.vwapUp1 = vwap + b1 * sd; c.vwapDn1 = vwap - b1 * sd;
        c.vwapUp2 = vwap + b2 * sd; c.vwapDn2 = vwap - b2 * sd;
    }
}

// ─── Supply / Demand Pro zones (matched with Pinescript) ─────────────────────
// Base candle + impulse candle → demand (bullish impulse) or supply (bearish)
// zone; a zone is breached once price trades beyond its distal line or it gets
// older than sdMaxAge. Used by the Supply/Demand Pro overlay and by the broker
// accounts to place SL/TP when a signal has none (useAccountSignals).
export function findSupplyDemandZones(candles, s = {}) {
    let sdZones = [];
    const aMult = parseFloat(s.sdAtrMult) || 0.5;
    const minScore = parseFloat(s.sdMinScore) || 1.0;
    const atrPeriod = parseInt(s.sdAtrPeriod) || 14;
    const extendRight = s.sdExtendRight === true;
    const maxAge = parseInt(s.sdMaxAge) || 100;

    for (let i = atrPeriod + 2; i < candles.length - 1; i++) {
        let b = candles[i - 2]; // base candle
        let imp = candles[i - 1]; // impulse candle

        if (!b || !imp || b.atr === null || imp.atr === null) continue;

        // Calculate avg_body for i-2 (SMA of body size over atrPeriod)
        let sumBody = 0;
        let count = 0;
        for (let j = 0; j < atrPeriod; j++) {
            let c = candles[i - 2 - j];
            if (c) {
                sumBody += Math.abs(c.close - c.open);
                count++;
            }
        }
        let avgBody = count > 0 ? sumBody / count : 0;

        let body1 = Math.abs(imp.close - imp.open);
        let body2 = Math.abs(b.close - b.open);

        // Demand Zone
        if (body2 < avgBody && body1 > imp.atr * aMult && imp.close > imp.open) {
            let base_high = Math.max(b.open, b.close);
            let base_low = b.low;
            let dist = imp.high - base_high;
            let base_size = base_high - base_low === 0 ? 1 : base_high - base_low;
            let score = dist / base_size;
            
            if (score >= minScore) {
                sdZones.push({ type: 'demand', start: i - 2, end: i - 1, distal: base_low, proximal: base_high, breached: false, time: b.time, score });
            }
        }

        // Supply Zone
        if (body2 < avgBody && body1 > imp.atr * aMult && imp.close < imp.open) {
            let base_high = b.high;
            let base_low = Math.min(b.open, b.close);
            let dist = base_low - imp.low;
            let base_size = base_high - base_low === 0 ? 1 : base_high - base_low;
            let score = dist / base_size;
            
            if (score >= minScore) {
                sdZones.push({ type: 'supply', start: i - 2, end: i - 1, distal: base_high, proximal: base_low, breached: false, time: b.time, score });
            }
        }
    }

    for (let z of sdZones) {
        for (let i = z.end + 1; i < candles.length; i++) {
            let c = candles[i];
            
            if (!extendRight) {
                let age = i - z.start;
                if (age > maxAge) {
                    z.breached = true;
                    z.breachTime = c.time;
                    break;
                }
            }

            // Invalidate if price mitigates the zone (closes beyond distal line)
            if (z.type === 'supply') {
                if (c.high > z.distal) {
                    z.breached = true;
                    z.breachTime = c.time;
                    break;
                }
            } else if (z.type === 'demand') {
                if (c.low < z.distal) {
                    z.breached = true;
                    z.breachTime = c.time;
                    break;
                }
            }
        }
    }
    
    return sdZones;
}

// ─── Livermore Gold Trend v12 PRO inputs ─────────────────────────────────────
// Defaults = the setting picked on XAUUSD 45m 2021-23 and confirmed on 2024-26 and in the MT5
// tester (EA/Livermore_Gold_Trend_EA.mq5, $1,000: +$777 after swap, DD 11.7 %, RF 3.54, every year
// positive; web_app/research/livermore/README.md). Was: EMA 100, ADX 20, RSI 50, SL 2.5, TP 10, 08-20 UTC.
export const LIVERMORE_DEFAULTS = {
    lmEmaLen: 200, lmAdxThresh: 15, lmRsiEntry: 55,
    lmSlMult: 2, lmTpMult: 3, lmUseTs: true, lmTsOffset: 3,
    lmUseSession: true, lmSessionStart: 10, lmSessionEnd: 22,
    // 'server' = broker server time of a New-York-close broker (New York + 7h, e.g. RoboForex), as
    // tested. Pine's `hour` is the TradingView symbol's exchange timezone (OANDA:XAUUSD → America/New_York).
    lmSessionTz: 'server',
    lmUseDaily: true,   // only buy if yesterday's (server-day) close was above the daily EMA(50)
};
function livermoreSettings(s = {}) {
    const n = (k) => { const v = Number(s[k]); return Number.isFinite(v) ? v : LIVERMORE_DEFAULTS[k]; };
    return {
        emaLen: Math.max(2, Math.round(n('lmEmaLen'))), adxThresh: n('lmAdxThresh'), rsiEntry: n('lmRsiEntry'),
        slMult: n('lmSlMult'), tpMult: n('lmTpMult'), useTs: s.lmUseTs !== false, tsOffset: n('lmTsOffset'),
        useSession: s.lmUseSession !== false, sessionStart: n('lmSessionStart'), sessionEnd: n('lmSessionEnd'),
        sessionTz: s.lmSessionTz || LIVERMORE_DEFAULTS.lmSessionTz,
        useDaily: s.lmUseDaily !== undefined ? s.lmUseDaily !== false : LIVERMORE_DEFAULTS.lmUseDaily,
    };
}
// Broker server time offset from UTC in minutes (New York + 7h → +120 winter / +180 summer), cached per hour
const _srvOff = new Map();
export function serverOffsetMin(t) {
    const hk = Math.floor(t / 3600000);
    let off = _srvOff.get(hk);
    if (off === undefined) {
        const ny = sessionHourFn('America/New_York')(t);
        off = (((ny - new Date(t).getUTCHours() + 24) % 24) + 7) % 24 * 60;
        if (_srvOff.size > 50000) _srvOff.clear();
        _srvOff.set(hk, off);
    }
    return off;
}

// Server-day key (YYYY-MM-DD of New York + 7h) for the daily filter
let _dayFmt = null;
function serverDayFn() {
    if (!_dayFmt) { try { _dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { _dayFmt = null; } }
    return _dayFmt ? (t) => _dayFmt.format(new Date(t + SERVER_SHIFT)) : (t) => new Date(t + SERVER_SHIFT).toISOString().slice(0, 10);
}
const _hourFmt = new Map();
const SERVER_SHIFT = 7 * 3600 * 1000;   // New-York-close broker server time = New York + 7h, all year
function sessionHourFn(tz) {
    if (tz === 'server') { const ny = sessionHourFn('America/New_York'); return (t) => ny(t + SERVER_SHIFT); }
    if (!tz || tz === 'UTC') return (t) => new Date(t).getUTCHours();
    let f = _hourFmt.get(tz);
    if (!f) {
        try { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }); } catch { f = null; }
        _hourFmt.set(tz, f);
    }
    if (!f) return (t) => new Date(t).getUTCHours();
    return (t) => Number(f.format(new Date(t)));
}
