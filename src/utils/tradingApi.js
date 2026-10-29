// Client for /api/accounts (Algo Trading Account Manager — see ALGO_TRADING.md).
// Broker passwords never live in the browser: they are sent once when an
// account is added and kept encrypted on the server. Only the trading token
// (TRADING_API_TOKEN from backend/.env.local) is remembered here.

const TOKEN_KEY = 'ts_trade_token';
const LEGACY_KEY = 'mt5_accounts';

export const getTradeToken = () => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
};
export const setTradeToken = (t) => {
    try {
        if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
    } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event('ts-trade-token'));
};

export class TradingApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
}

async function call(path, { method = 'GET', body, signal } = {}) {
    const res = await fetch(`/api/accounts${path}`, {
        method,
        signal,
        headers: { 'Content-Type': 'application/json', 'X-Trade-Token': getTradeToken() },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
        const detail = data?.detail;
        throw new TradingApiError(typeof detail === 'string' ? detail : `Request failed (${res.status})`, res.status);
    }
    return data;
}

export const tradingApi = {
    list: (opts) => call('', opts),
    add: (acc) => call('', { method: 'POST', body: acc }),
    update: (id, patch) => call(`/${id}`, { method: 'PATCH', body: patch }),
    remove: (id) => call(`/${id}`, { method: 'DELETE' }),
    connect: (id) => call(`/${id}/connect`, { method: 'POST' }),
    disconnect: (id) => call(`/${id}/disconnect`, { method: 'POST' }),
    summary: (id, opts) => call(`/${id}/summary`, opts),
    positions: (id, opts) => call(`/${id}/positions`, opts).then(r => r.positions),
    history: (id, days = 30, opts) => call(`/${id}/history?days=${days}`, opts),
    logs: (id, limit = 200, opts) => call(`/${id}/logs?limit=${limit}`, opts).then(r => r.logs),
    order: (id, o) => call(`/${id}/order`, { method: 'POST', body: o }),
    close: (id, ticket) => call(`/${id}/close`, { method: 'POST', body: { ticket } }),
    signal: (id, s) => call(`/${id}/signal`, { method: 'POST', body: s }),
};

// Accounts saved by the old manager (with passwords in localStorage)
export const readLegacyAccounts = () => {
    try {
        const list = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
        return Array.isArray(list) ? list.filter(a => a && a.login && a.password && a.server && !a.isUpstox) : [];
    } catch { return []; }
};
export const clearLegacyAccounts = (logins) => {
    try {
        const list = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
        const keep = list.filter(a => !logins.includes(String(a.login)));
        if (keep.length) localStorage.setItem(LEGACY_KEY, JSON.stringify(keep));
        else localStorage.removeItem(LEGACY_KEY);
    } catch { /* storage unavailable */ }
};
