// Open a stock from the Investment tab in a chart tab (App listens for 'ts-open-chart').
// Indian stocks use Yahoo's ".NS" (NSE) suffix: the server charts symbols its MT5
// broker doesn't carry from yfinance. Daily candles suit investing.
export const chartSymbolFor = (symbol, market) => {
    const s = String(symbol || '').toUpperCase();
    return market === 'IN' && s && !s.includes('.') ? `${s}.NS` : s;
};

export function openStockChart(symbol, market) {
    const chartSymbol = chartSymbolFor(symbol, market);
    if (!chartSymbol) return;
    window.dispatchEvent(new CustomEvent('ts-open-chart', { detail: { symbol: chartSymbol, timeframe: 1440 } }));
}
