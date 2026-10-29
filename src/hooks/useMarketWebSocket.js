/**
 * useMarketWebSocket
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the 1-second HTTP polling loop (App.jsx setInterval → refreshCounter)
 * with a persistent WebSocket connection to the FastAPI backend.
 *
 * Architecture:
 *  1. Connects via relative path /ws/candles/{symbol}/{interval}
 *     → dev:  routes through Vite proxy (5173 → 8000)
 *     → prod: same-origin (FastAPI serves React build on 8000)
 *  2. Backend sends two message types every ~1s:
 *     - TICK_UPDATE  : lightweight {symbol, price, time} — always sent
 *     - CANDLES_UPDATE: full 5-candle array — only when close price changes
 *  3. onUpdate(candles) is called only for CANDLES_UPDATE (triggers worker re-aggregation).
 *  4. onTick({price, time}) is called for every TICK_UPDATE (fast canvas redraw, no worker).
 *  5. onUpdate/onTick stored in refs — never stale, never causes reconnect.
 *  6. Auto-reconnect with exponential back-off (1s → 2s → 4s → max 30s).
 *  7. Falls back to HTTP polling after FALLBACK_AFTER_ATTEMPTS failures.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getTradeToken } from '../utils/tradingApi';
import { isIndiaSymbol } from './useBrokerSession';

// Use same host as the page so Vite proxy forwards /ws → backend in dev,
// and same-origin works directly in production.
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_BASE = `${WS_PROTOCOL}//${window.location.host}`;
const MAX_BACKOFF_MS = 30_000;
const FALLBACK_AFTER_ATTEMPTS = 5;
const PING_INTERVAL_MS = 25_000;

export function useMarketWebSocket({ symbol, interval, onUpdate, onTick, onHistory, onFallback, enabled = true }) {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef(null);
    const backoffRef = useRef(1000);
    const attemptsRef = useRef(0);
    const reconnectTimerRef = useRef(null);
    const pingTimerRef = useRef(null);
    const mountedRef = useRef(true);
    // Always-fresh refs — prevents stale closures without requiring reconnect
    const onUpdateRef = useRef(onUpdate);
    const onTickRef   = useRef(onTick);
    const onHistoryRef = useRef(onHistory);
    useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
    useEffect(() => { onTickRef.current   = onTick;   }, [onTick]);
    useEffect(() => { onHistoryRef.current = onHistory; }, [onHistory]);

    const clearTimers = useCallback(() => {
        clearTimeout(reconnectTimerRef.current);
        clearInterval(pingTimerRef.current);
    }, []);

    const sendHistoryRequest = useCallback((limit = 5000) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "HISTORY_REQUEST", limit }));
        }
    }, []);

    const connect = useCallback(() => {
        if (!mountedRef.current || !enabled) return;

        const sanitized = symbol.replace('/', '');
        // Indian symbols stream the owner's Upstox data: the backend requires the trading token
        const auth = isIndiaSymbol(symbol) ? `?t=${encodeURIComponent(getTradeToken())}` : '';
        const path = isIndiaSymbol(symbol) ? encodeURIComponent(sanitized) : sanitized;   // MT5 URLs unchanged
        const url = `${WS_BASE}/ws/candles/${path}/${interval}${auth}`;
        let ws;

        try {
            ws = new WebSocket(url);
        } catch (e) {
            if (onFallback) onFallback();
            return;
        }

        wsRef.current = ws;

        ws.onopen = () => {
            if (!mountedRef.current) { ws.close(); return; }
            setIsConnected(true);
            backoffRef.current = 1000;
            attemptsRef.current = 0;

            // Request full history on connect
            sendHistoryRequest(5000);

            // Keep-alive ping to prevent idle timeout
            pingTimerRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send('ping');
            }, PING_INTERVAL_MS);
        };

        ws.onmessage = (event) => {
            if (!mountedRef.current) return;
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'CANDLES_UPDATE' && Array.isArray(msg.candles)) {
                    // Full candle merge + Web Worker re-aggregation
                    onUpdateRef.current?.(msg.candles);
                } else if (msg.type === 'TICK_UPDATE') {
                    // Lightweight tick — just update the live price label on the canvas
                    onTickRef.current?.({ price: msg.price, time: msg.time });
                } else if (msg.type === 'HISTORY_RESPONSE' && Array.isArray(msg.candles)) {
                    // Initial history load
                    onHistoryRef.current?.(msg.candles);
                }
            } catch (e) { /* ignore malformed messages */ }
        };

        ws.onerror = () => { /* handled in onclose */ };

        ws.onclose = () => {
            clearInterval(pingTimerRef.current);
            if (!mountedRef.current) return;
            setIsConnected(false);
            attemptsRef.current += 1;

            if (attemptsRef.current >= FALLBACK_AFTER_ATTEMPTS) {
                console.warn(`[WS] ${sanitized}/${interval}: falling back to HTTP polling after ${FALLBACK_AFTER_ATTEMPTS} failures`);
                if (onFallback) onFallback();
                return;
            }

            const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
            backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
            reconnectTimerRef.current = setTimeout(connect, delay);
        };
    // onUpdate/onTick intentionally excluded — we use refs instead.
    // Only reconnect when symbol, interval, or enabled changes.
    }, [symbol, interval, onFallback, enabled, sendHistoryRequest]);

    useEffect(() => {
        mountedRef.current = true;
        backoffRef.current = 1000;
        attemptsRef.current = 0;
        connect();

        return () => {
            mountedRef.current = false;
            clearTimers();
            if (wsRef.current) {
                wsRef.current.onclose = null; // prevent reconnect on unmount
                wsRef.current.close();
            }
            setIsConnected(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, interval, enabled]);

    return { isConnected, sendHistoryRequest };
}
