// Client for /api/india (owner only): order panel, positions, orders, risk settings, kill switch.
// Every order goes through the backend RiskEngine + journal (INDIA_ALGO_TRADING.md C3); paper is the default.
import { getTradeToken } from './tradingApi';

async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api/india${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Trade-Token': getTradeToken() },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw Object.assign(new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${res.status})`), { status: res.status });
    return data;
}

const q = encodeURIComponent;
export const indiaApi = {
    quote: (symbol) => call(`/quote?symbol=${q(symbol)}`),
    margin: (b) => call('/margin', { method: 'POST', body: b }),
    place: (b) => call('/orders', { method: 'POST', body: b }),
    orders: (limit = 100) => call(`/orders?limit=${limit}`),
    cancel: (id) => call(`/orders/${id}`, { method: 'DELETE' }),
    positions: (execution) => call(`/positions?execution=${execution}`),
    close: (b) => call('/positions/close', { method: 'POST', body: b }),
    holdings: () => call('/holdings'),
    funds: (execution) => call(`/funds?execution=${execution}`),
    equity: () => call('/equity'),
    events: (days = 14) => call(`/events?days=${days}`),
    decisions: () => call('/decisions'),
    settings: () => call('/settings'),
    saveSettings: (limits) => call('/settings', { method: 'PUT', body: limits }),
    kill: (on) => call('/kill', { method: 'POST', body: { on } }),
    strategies: () => call('/strategies'),
    saveStrategy: (s) => call('/strategies', { method: 'POST', body: s }),
    deleteStrategy: (id) => call(`/strategies/${id}`, { method: 'DELETE' }),
    testStrategy: (id, side) => call(`/strategies/${id}/test`, { method: 'POST', body: { side } }),
    signal: (b) => call('/signal', { method: 'POST', body: b }),
    approvals: (status = 'pending') => call(`/approvals?status=${status}`),
    decide: (id, approve) => call(`/approvals/${id}`, { method: 'POST', body: { approve } }),
    agentRuns: () => call('/agent/runs'),
    agentAccuracy: () => call('/agent/accuracy'),
    agentAsk: (symbol, timeframe) => call('/agent/ask', { method: 'POST', body: { symbol, timeframe } }),
    agentKill: (on) => call('/agent/kill', { method: 'POST', body: { on } }),
    notifications: (after = 0) => call(`/notifications?after=${after}`),
    notifySettings: () => call('/notify/settings'),
    saveNotifySettings: (b) => call('/notify/settings', { method: 'PUT', body: b }),
    notifyTest: () => call('/notify/test', { method: 'POST' }),
    pilotAsk: (underlying, min_days = 2) => call('/option-pilot/ask', { method: 'POST', body: { underlying, min_days } }),
    pilotStatus: () => call('/option-pilot/status'),
    pilotCatalog: () => call('/option-pilot/catalog'),
    pilotIdeas: () => call('/option-pilot/ideas'),
    optionUnderlyings: (query) => call(`/options/underlyings?q=${q(query || '')}`),
    optionExpiries: (u) => call(`/options/expiries?underlying=${q(u)}`),
    optionChain: (u, e) => call(`/options/chain?underlying=${q(u)}&expiry=${q(e)}`),
};

export const inr = (v, d = 2) => (v == null || Number.isNaN(+v) ? '—'
    : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));

// Paper / live choice shared by the order panel and the dashboard (per browser).
export const getExecution = () => { try { return localStorage.getItem('ts_india_exec') === 'live' ? 'live' : 'paper'; } catch { return 'paper'; } };
export const setExecution = (v) => { try { localStorage.setItem('ts_india_exec', v); } catch { /* storage unavailable */ } };

// Underlying / expiry last used on /options (also set by the chart's "Options" chip).
export const OPTIONS_LAST_KEY = 'ts_options_last';
export const openOptionsFor = (symbol) => { try { localStorage.setItem(OPTIONS_LAST_KEY, JSON.stringify({ underlying: symbol })); } catch { /* storage unavailable */ } };
