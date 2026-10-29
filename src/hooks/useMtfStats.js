import { useEffect, useMemo, useState } from 'react';
import { fetchTwelveData } from '../utils/api';

// MTF Interest Meter score, shared by the meter and the prediction signals.
// History requests are shared and cached by fetchTwelveData, so several users
// of this hook cost no extra network calls.
const getTwelveDataInterval = (tf) => {
    const m = {
        '1': '1min', '5': '5min', '15': '15min', '30': '30min', '45': '45min',
        '60': '1h', '120': '2h', '240': '4h', '1D': '1day', '1W': '1week', '1M': '1month',
        '1h': '1h', '2h': '2h', '4h': '4h',          // the defaults are stored as '1h' / '4h'
    };
    return m[tf] || '1h';
};

// Score of one timeframe, −100 … +100 = (RSI − 50) + momentum, where momentum
// is the close-to-close move over `lookback` bars in units of 2 × ATR, capped
// at ±50. RSI and ATR use Wilder smoothing (RMA) seeded with an SMA.
// `data` is chronological (oldest first) — as /api/history and the chart give it.
// (It used to read the array as newest-first, i.e. it scored the oldest candles.)
const tfText = (tf) => ({ '1': '1m', '5': '5m', '15': '15m', '30': '30m', '45': '45m', '60': '1h', '1h': '1h', '120': '2h', '240': '4h', '4h': '4h', '1440': '1D', '1D': '1D', '1W': '1W' })[String(tf)] || String(tf);

const calculateScore = (data, lookback) => {
    const n = data ? data.length : 0;
    if (n < lookback + 2) return 0;
    const start = Math.max(1, n - lookback * 10);          // enough bars to warm up the RMA
    const num = (v) => parseFloat(v);
    let atr = 0, avgGain = 0, avgLoss = 0, k = 0;
    const alpha = 1 / lookback;
    for (let i = start; i < n; i++) {
        const h = num(data[i].high), l = num(data[i].low), pc = num(data[i - 1].close);
        const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        const chg = num(data[i].close) - pc;
        const g = chg > 0 ? chg : 0, ls = chg < 0 ? -chg : 0;
        if (k < lookback) { atr += tr / lookback; avgGain += g / lookback; avgLoss += ls / lookback; }
        else { atr = alpha * tr + (1 - alpha) * atr; avgGain = alpha * g + (1 - alpha) * avgGain; avgLoss = alpha * ls + (1 - alpha) * avgLoss; }
        k++;
    }
    if (k < lookback) return 0;
    const momVal = num(data[n - 1].close) - num(data[n - 1 - lookback].close);
    const momScore = atr > 0 ? Math.max(-50, Math.min(50, (momVal / (atr * 2)) * 50)) : 0;
    const rsiVal = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    return (rsiVal - 50) + momScore;
};

export function useMtfStats(dataset, state, enabled = true) {
    const [mtfScores, setMtfScores] = useState({ score1: 0, score2: 0, ready: false });
    const { symbol, indicatorSettings = {} } = state;
    const { tiLookback = 14, tiTf1 = '1h', tiTf2 = '4h', tiEnable1 = true, tiEnable2 = true } = indicatorSettings;

    // Higher-timeframe scores: fetched when the settings change and refreshed
    // every minute (they used to be fetched once and then go stale)
    useEffect(() => {
        if (!symbol || !enabled) return;
        let isMounted = true;
        const fetchMtf = async () => {
            try {
                const reqs = [];
                const fetchLimit = Math.max(150, (tiLookback + 1) * 5);

                if (tiEnable1) reqs.push(fetchTwelveData(symbol, getTwelveDataInterval(tiTf1), fetchLimit));
                else reqs.push(Promise.resolve([]));

                if (tiEnable2) reqs.push(fetchTwelveData(symbol, getTwelveDataInterval(tiTf2), fetchLimit));
                else reqs.push(Promise.resolve([]));

                const results = await Promise.all(reqs);

                if (isMounted) {
                    setMtfScores({
                        score1: tiEnable1 ? calculateScore(results[0], tiLookback) : 0,
                        score2: tiEnable2 ? calculateScore(results[1], tiLookback) : 0,
                        ready: true,
                    });
                }
            } catch (err) {
                console.error('Failed to fetch MTF data for Traders Interest', err);
            }
        };
        fetchMtf();
        const timer = setInterval(fetchMtf, 60000);

        return () => { isMounted = false; clearInterval(timer); };
    }, [symbol, tiTf1, tiTf2, tiLookback, tiEnable1, tiEnable2, enabled]);

    const stats = useMemo(() => {
        if (!dataset || dataset.length < tiLookback + 1) {
            return { score: 0, buyPct: 50, sellPct: 50, trendLabel: 'Neutral', signalTxt: 'WAIT', parts: [], ready: false };
        }

        const score_curr = calculateScore(dataset, tiLookback);
        
        let totalScore = score_curr;
        let count = 1;
        if (tiEnable1) { totalScore += mtfScores.score1; count++; }
        if (tiEnable2) { totalScore += mtfScores.score2; count++; }
        
        const finalScore = totalScore / count;

        const buyPct = (finalScore + 100) / 2;
        const sellPct = 100 - buyPct;

        let trendLabel = "Neutral";
        if (finalScore > 40) trendLabel = "Strong Buy";
        else if (finalScore > 10) trendLabel = "Weak Buy";
        else if (finalScore < -40) trendLabel = "Strong Sell";
        else if (finalScore < -10) trendLabel = "Weak Sell";

        let signalTxt = "WAIT";
        if (finalScore > 40) signalTxt = "BUY";
        else if (finalScore < -40) signalTxt = "SELL";

        // Per-timeframe scores for the hover summary
        const parts = [{ tf: tfText(state.timeframe), s: score_curr, chart: true }];
        if (tiEnable1) parts.push({ tf: tfText(tiTf1), s: mtfScores.score1 });
        if (tiEnable2) parts.push({ tf: tfText(tiTf2), s: mtfScores.score2 });
        return { 
            score: finalScore, 
            buyPct: Math.max(0, Math.min(100, buyPct)), 
            sellPct: Math.max(0, Math.min(100, sellPct)), 
            trendLabel, 
            signalTxt,
            parts,
            ready: mtfScores.ready || (!tiEnable1 && !tiEnable2),   // higher timeframes loaded
        };
    }, [dataset, mtfScores, tiLookback, tiEnable1, tiEnable2, tiTf1, tiTf2, state.timeframe]);
    return stats;
}
