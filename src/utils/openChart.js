// Charts outside the app open on TradingView. Indian stocks use the NSE: prefix
// (TradingView writes M&M as M_M); US class shares use a dot (BRK-B → BRK.B).
export const chartSymbolFor = (symbol, market) => {
    const s = String(symbol || '').toUpperCase();
    return market === 'IN' && s && !s.includes('.') ? `${s}.NS` : s;
};

export function tradingViewUrl(symbol, market) {
    const s = String(symbol || '').toUpperCase().replace(/\.NS$/, '');
    const tv = market === 'IN' ? `NSE:${s.replace(/&/g, '_').replace(/-/g, '_')}` : s.replace(/-/g, '.');
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`;
}

export function openStockChart(symbol, market) {
    if (!symbol) return;
    window.open(tradingViewUrl(symbol, market), '_blank', 'noopener');
}
