// INDIA_ALGO_TRADING.md task H1: the single switch for any Indian trading UI.
// `ready` = this browser has the owner's trading token AND Upstox is logged in. Polls every 60 s
// and reacts at once when the token is saved/forgotten (tradingApi.setTradeToken fires 'ts-trade-token').
import { useEffect, useState } from 'react';
import { getTradeToken } from '../utils/tradingApi';

const INDIA_RE = /^(NSE|BSE):\S|^(NSE|BSE)_[A-Z]+\|/i;
export const isIndiaSymbol = (s) => !!s && INDIA_RE.test(String(s).trim());

let shared = { owner: false, connected: false, user: null, expiresAt: null };
const listeners = new Set();
let timer = null;

async function poll() {
    const token = getTradeToken();
    let next = { owner: !!token, connected: false, user: null, expiresAt: null };
    if (token) {
        try {
            const res = await fetch('/api/upstox/status', { headers: { 'X-Trade-Token': token } });
            const d = res.ok ? await res.json() : {};
            next = { owner: true, connected: !!d.connected, user: d.user_name || null, expiresAt: d.expires_at || null };
        } catch { /* offline: keep "not connected" */ }
    }
    shared = next;
    listeners.forEach(fn => fn(shared));
}

export function useBrokerSession() {
    const [s, setS] = useState(shared);
    useEffect(() => {
        listeners.add(setS);
        if (listeners.size === 1) {
            poll();
            timer = setInterval(poll, 60_000);
            window.addEventListener('ts-trade-token', poll);
        }
        return () => {
            listeners.delete(setS);
            if (listeners.size === 0) { clearInterval(timer); window.removeEventListener('ts-trade-token', poll); }
        };
    }, []);
    return { ...s, ready: s.owner && s.connected, refresh: poll };
}
