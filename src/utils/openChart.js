// Open a stock's full chart. This standalone site has no chart app, so it opens Yahoo Finance's.
// Indian stocks use Yahoo's ".NS" (NSE) suffix: the server charts symbols its MT5
// broker doesn't carry from yfinance. Daily candles suit investing.
export const chartSymbolFor = (symbol, market) => {
    const s = String(symbol || '').toUpperCase();
    return market === 'IN' && s && !s.includes('.') ? `${s}.NS` : s;
};

export function openStockChart(symbol, market) {
    const chartSymbol = chartSymbolFor(symbol, market);
    if (!chartSymbol) return;
    window.open(`https://finance.yahoo.com/chart/${encodeURIComponent(chartSymbol)}`, '_blank', 'noopener');
}
