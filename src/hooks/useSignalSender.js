/**
 * useSignalSender.js
 * ------------------
 * Custom hook for publishing trading signals from TradeSagar chart indicators
 * to the local FastAPI signal server (http://127.0.0.1:8000/api/v1/signal).
 *
 * Usage:
 *   const { sendSignal, lastSignal, status } = useSignalSender();
 *   await sendSignal({ symbol: 'XAUUSD', action: 'BUY', price: 2650, stop_loss: 2640, take_profit: 2670 });
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ----- Config ----------------------------------------------------------------
const API_BASE  = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';
const API_KEY   = import.meta.env.VITE_SIGNAL_API_KEY || 'TS_9f8e2a1b4c7d6e5f3a2b1c8d7e6f5a4b';
const ENDPOINT  = `${API_BASE}/api/v1/signal`;

// -----------------------------------------------------------------------------

export function useSignalSender() {
    const [lastSignal, setLastSignal] = useState(null);
    const [status, setStatus]         = useState('idle'); // idle | sending | ok | error
    const [errorMsg, setErrorMsg]     = useState('');

    // Track the latest in-flight AbortController so we can cancel on unmount.
    const abortRef = useRef(null);

    // Cancel any pending fetch when the consumer unmounts to prevent state
    // updates on an unmounted component and avoid retaining closed-over state.
    useEffect(() => {
        return () => {
            if (abortRef.current) {
                abortRef.current.abort();
                abortRef.current = null;
            }
        };
    }, []);

    /**
     * sendSignal({ symbol, action, price, stop_loss, take_profit, comment })
     * action: 'BUY' | 'SELL' | 'CLOSE'; comment: MT5 order comment (indicator + timeframe)
     */
    const sendSignal = useCallback(async ({ symbol, action, price, stop_loss = 0, take_profit = 0, comment = '' }) => {
        // Abort any previous in-flight request before starting a new one
        if (abortRef.current) {
            abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;

        setStatus('sending');
        setErrorMsg('');

        const payload = {
            symbol:      symbol.toUpperCase(),
            action:      action.toUpperCase(),
            price:       parseFloat(price)       || 0,
            stop_loss:   parseFloat(stop_loss)   || 0,
            take_profit: parseFloat(take_profit) || 0,
            comment:     String(comment || '').slice(0, 31),
        };

        try {
            const res = await fetch(ENDPOINT, {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key':    API_KEY,
                },
                body:   JSON.stringify(payload),
                signal: controller.signal,   // link fetch to abort controller
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }

            const data = await res.json();
            setLastSignal({ ...payload, signal_id: data.signal_id, timestamp: new Date().toISOString() });
            setStatus('ok');
            abortRef.current = null;
            return data;
        } catch (e) {
            // Ignore abort errors — they are intentional cancellations, not real errors
            if (e.name === 'AbortError') return;
            setErrorMsg(e.message);
            setStatus('error');
            throw e;
        }
    }, []);

    /** clearSignal — DELETE active signal for a symbol */
    const clearSignal = useCallback(async (symbol) => {
        try {
            await fetch(`${API_BASE}/api/v1/signal/${symbol.toUpperCase()}`, {
                method:  'DELETE',
                headers: { 'x-api-key': API_KEY },
            });
        } catch (e) {
            console.warn('clearSignal failed:', e);
        }
    }, []);

    /** fetchHistory — GET last 50 signals (dev/debug) */
    const fetchHistory = useCallback(async () => {
        const res = await fetch(`${API_BASE}/api/v1/signals/history`, {
            headers: { 'x-api-key': API_KEY },
        });
        if (!res.ok) throw new Error('Failed to fetch history');
        return res.json();
    }, []);

    return { sendSignal, clearSignal, fetchHistory, lastSignal, status, errorMsg };
}
