import { useMemo } from 'react';
import { useMtfStats } from './useMtfStats';
import { calcPressure } from '../utils/pressureChart';
import { computeKeyLevels } from '../utils/keyLevels';
import { buildTradeSignal, signalOutcome } from '../utils/tradeSignal';
import { logPrediction } from '../utils/predictionLog';

// Latest signal per symbol|timeframe, shared by the sidebar card and every chart
// (alerts): a new one replaces it only after its stop or target is hit, after
// its hold time, or when the opposite signal appears.
const active = new Map();

export const predictionSignalsOn = (state) => state.chartType !== 'footprint' && !!state.indicators?.nextProjection
    && !state.hiddenIndicators?.nextProjection && !!state.indicatorSettings?.ppSignals
    && Number(state.timeframe) >= 15;   // 1m / 5m are too noisy for trade signals

/**
 * BUY / SELL from the price prediction, MTF meter, Pressure analysis and levels
 * (utils/tradeSignal). Stamps `ppSignal` on the candle a signal was given on,
 * which the alert engine reads. Returns null when the option is off.
 */
export function usePredictionSignal(dataset, state) {
    const on = predictionSignalsOn(state);
    const mtf = useMtfStats(dataset, state, on);
    const n = dataset?.length || 0;
    const closedTime = n > 1 ? dataset[n - 2].time : 0;
    const tf = Number(state.timeframe) || 15;
    const S = state.indicatorSettings || {};

    // Pressure analysis: the chart's own when the Pressure / Ocean view is on, else once per closed candle
    const pc = useMemo(() => {
        if (!on || n < 60) return null;
        return dataset.pressure || calcPressure(dataset, { tfMins: tf, symbol: state.symbol });
    }, [on, closedTime, tf, state.symbol]);

    const result = useMemo(() => {
        if (!on || n < 60) return null;
        const pp = dataset[n - 1].pathProjection;
        const levels = dataset.keyLevels || computeKeyLevels(dataset);
        return buildTradeSignal({
            c: dataset, pp, mtf, pc, levels, symbol: state.symbol,
            cfg: { balance: Number(S.sigBalance) || 1000, riskPct: Number(S.sigRiskPct) || 1, leverage: Number(S.sigLeverage) || 100, minRR: Number(S.sigMinRR) || 1.5 },
        });
    }, [on, closedTime, mtf.score, mtf.ready, pc, state.symbol, S.sigBalance, S.sigRiskPct, S.sigLeverage, S.sigMinRR]);

    if (!on || !result) return null;
    const key = `${state.symbol}|${tf}`;
    let cur = active.get(key);
    let outcome = cur ? signalOutcome(dataset, cur) : null;
    const age = cur ? dataset.filter(k => k.time > cur.time).length - 1 : 0;   // closed candles since the signal
    if (result.dir && (!cur || outcome !== 'open' || age >= cur.hold || cur.dir !== result.dir) && (!cur || result.time > cur.time)) {
        cur = { ...result, symbol: state.symbol, tf };
        active.set(key, cur);
        const pp = dataset[n - 1].pathProjection;
        logPrediction({ symbol: state.symbol, tf, kind: 'signal', horizon: pp?.horizon ?? 1, analogs: pp?.analogs ?? 30,
            refTime: cur.time, call: cur.dir, entry: cur.entry, sl: cur.sl, tp: cur.tp });
        outcome = 'open';
    }
    if (cur) { const k = dataset.find(x => x.time === cur.time); if (k) k.ppSignal = cur; }   // for alerts
    return { now: result, active: cur, outcome, expired: cur && outcome === 'open' && age >= cur.hold };
}
