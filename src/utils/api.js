import { navigate } from './route';
import { getTradeToken } from './tradingApi';
import { isIndiaSymbol } from '../hooks/useBrokerSession';
// Many widgets ask for the same history at once (each chart tab, the Gold Move
// heatmap's 10 timeframes, the MTF meter…). Identical requests share one network
// call while in flight, and live (no end_date) results are reused for 20 s.
// Each caller gets its own copy — candle objects are mutated by indicator code.
const HISTORY_TTL_MS = 20000;
const historyInflight = new Map();   // url → Promise<array>
const historyCache = new Map();      // url → { at, data }
const copyRows = (rows) => rows.map(r => ({ ...r }));

export const fetchTwelveData = async (symbol, interval, outputSize = 1000, brokerContext = 'mt5', endDate = null) => {
    const key = `${brokerContext}|${symbol}|${interval}|${outputSize}|${endDate || ''}`;
    const hit = !endDate && historyCache.get(key);
    if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return copyRows(hit.data);
    let p = historyInflight.get(key);
    if (!p) {
        p = fetchHistoryUncached(symbol, interval, outputSize, brokerContext, endDate)
            .then(data => {
                if (!endDate) {
                    // drop expired entries (up to 5000 candles each) instead of holding them until 60 pile up
                    for (const [k, v] of historyCache) if (Date.now() - v.at > HISTORY_TTL_MS) historyCache.delete(k);
                    historyCache.set(key, { at: Date.now(), data });
                    if (historyCache.size > 60) historyCache.delete(historyCache.keys().next().value);  // oldest
                }
                return data;
            })
            .finally(() => historyInflight.delete(key));
        historyInflight.set(key, p);
    }
    return copyRows(await p);
};

const fetchHistoryUncached = async (symbol, interval, outputSize = 1000, brokerContext = 'mt5', endDate = null) => {
    // Strip slash from symbol for MT5 compatibility (e.g. EUR/USD -> EURUSD)
    const sanitizedSymbol = symbol.replace('/', '');
    
    // Route traffic through our Python bridge
    const isUpstox = brokerContext === 'upstox' || isIndiaSymbol(symbol);
    const baseUrl = isUpstox ? '/api/upstox/history' : '/api/history';
    let url = `${baseUrl}?symbol=${encodeURIComponent(sanitizedSymbol)}&interval=${interval}&limit=${outputSize}`;
    if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;
    
    try {
        const response = await fetch(url, isUpstox ? { headers: { 'X-Trade-Token': getTradeToken() } } : undefined);
        
        if (!response.ok) {
            let errData = {};
            try { errData = await response.json(); } catch(e) {}
            if (response.status === 401 || errData.detail === "Upstox not authenticated") {
                navigate("/upstox");   // owner logs in there (token-protected)
                return []; // prevent further execution
            }
            throw new Error(errData.detail || "Failed to fetch data from server 1 and 2");
        }
        
        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            throw new Error("No data returned from server 1 and 2.");
        }

        // The python backend returns it oldest to newest already, and parses the types!
        return data;
    } catch (e) {
        console.error("Failed to fetch MT5 Data:", e);
        throw e;
    }
};

export const searchSymbols = async (query, brokerContext = 'mt5') => {
    if (!query) return [];
    const baseUrl = brokerContext === 'upstox' ? '/api/upstox/symbols' : '/api/symbols';
    const url = `${baseUrl}?query=${encodeURIComponent(query)}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        if (!Array.isArray(data)) {
            return [];
        }
        
        return data.map(item => ({
            symbol: item.symbol,
            name: item.instrument_name,
            exchange: item.exchange,
            type: item.type || "Forex",
            fo: !!item.fo,
            currency: "" // omit
        }));
    } catch (e) {
        console.error("Failed to search symbols:", e);
        return [];
    }
};

export const fetchQuotes = async (symbols) => {
    if (!symbols || symbols.length === 0) return {};
    const API_KEY = "383556bb8d3f4c13857766c780a3c5fc";
    const symbolString = symbols.join(",");
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolString)}&apikey=${API_KEY}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.status === "error") {
            console.error("TwelveData Quote Error:", data.message);
            return {};
        }
        
        // If a single symbol was requested, TwelveData returns a single object instead of an object map
        if (symbols.length === 1) {
            return { [symbols[0]]: data };
        }
        
        return data; // Returns an object where keys are symbols and values are quote data
    } catch (e) {
        console.error("Failed to fetch quotes:", e);
        return {};
    }
};

export const fetchDOM = async (symbol) => {
    if (!symbol) return { bids: [], asks: [] };
    
    // Strip slash from symbol for MT5 compatibility (e.g. EUR/USD -> EURUSD)
    const sanitizedSymbol = symbol.replace('/', '');
    const url = `/api/dom?symbol=${encodeURIComponent(sanitizedSymbol)}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (e) {
        console.error("Failed to fetch DOM data:", e);
        return { bids: [], asks: [] };
    }
};

export const loginMT5 = async (login, password, server) => {
    const url = `/api/login`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                login: parseInt(login),
                password: password,
                server: server
            })
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Failed to login to MT5");
        }
        return data;
    } catch (e) {
        console.error("Failed to login:", e);
        throw e;
    }
};

export const executeTrade = async (symbol, volume, type, sl = 0, tp = 0, account = null) => {
    const sanitizedSymbol = symbol.replace('/', '');
    const url = `/api/trade`;                 // MT5 only; Indian orders go through /api/india/orders (RiskEngine)
    const body = {
        symbol: sanitizedSymbol,
        volume: parseFloat(volume),
        type: type,
        sl: parseFloat(sl),
        tp: parseFloat(tp)
    };
    
    if (account) {
        body.login = parseInt(account.login);
        body.password = account.password;
        body.server = account.server;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Trade execution failed");
        }
        return data;
    } catch (e) {
        console.error("Failed to execute trade:", e);
        throw e;
    }
};

export const closeTradeMT5 = async (ticket, symbol, account = null) => {
    const sanitizedSymbol = symbol.replace('/', '');
    const url = `/api/close_trade`;
    
    const body = {
        ticket: parseInt(ticket),
        symbol: sanitizedSymbol
    };
    
    if (account) {
        body.login = parseInt(account.login);
        body.password = account.password;
        body.server = account.server;
    }
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Trade close failed");
        }
        return data;
    } catch (e) {
        console.error("Failed to close trade:", e);
        throw e;
    }
};

export const fetchPositions = async (account) => {
    if (account && account.isUpstox) return []; // Upstox positions fetch not yet implemented in frontend
    try {
        const response = await fetch('/api/positions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                login: parseInt(account.login),
                password: account.password,
                server: account.server
            })
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Failed to fetch positions");
        }
        return data.positions || [];
    } catch (e) {
        console.error("Failed to fetch positions:", e);
        throw e;
    }
};

export const fetchAccountMetrics = async (account) => {
    if (!account) throw new Error("No account provided");
    const url = `/api/account_metrics`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                login: parseInt(account.login),
                password: account.password,
                server: account.server
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Failed to fetch account metrics");
        }
        return data;
    } catch (e) {
        console.error("Failed to fetch metrics:", e);
        throw e;
    }
};
