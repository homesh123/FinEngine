/**
 * useGoldMoveNotifications
 *
 * Watches the tail of the chart `dataset` for Gold Move signals and fires:
 *   - A browser push notification (via Service Worker when available, or direct Notification API)
 *   - The bell chime via the Web Audio API
 *
 * Fixes the previous implementation which silently blocked signals because:
 *   1. `notifEnabled` from useNotifications was read before the user toggled it on.
 *   2. The `signalCutoff` date comparison was too strict and rejected any candle
 *      that didn't close exactly on today/yesterday UTC.
 *   3. The Service Worker controller was `null` on first load and the direct
 *      Notification fallback was never reached.
 */

import { useEffect, useRef } from 'react';
import { playNotificationSound } from '../utils/notificationSound';

/**
 * Request notification permission proactively.
 * Browsers require a user-gesture context for the first call — we try on mount
 * and also attach once-listeners so the first real click/key re-tries.
 */
let _permissionRequested = false;
function ensurePermission() {
    if (_permissionRequested) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    _permissionRequested = true;
    Notification.requestPermission().catch(() => {});
}

/**
 * Send a notification via the most reliable channel available:
 *   1. Service Worker (shows even when the tab is in the background)
 *   2. Direct Notification API (fallback when SW controller is not yet active)
 */
// The same alert can come from two chart tabs showing the same symbol and
// timeframe; show it once. Entries expire after a minute (bounded map).
const recentNotifs = new Map();
const NOTIF_DEDUPE_MS = 60000;

export function sendNotification(title, body, tag) {
    const now = Date.now();
    const key = `${title}|${body}`;
    for (const [k, t] of recentNotifs) if (now - t > NOTIF_DEDUPE_MS) recentNotifs.delete(k);
    if (recentNotifs.has(key)) return;
    recentNotifs.set(key, now);
    try {
        if (
            'serviceWorker' in navigator &&
            navigator.serviceWorker.controller
        ) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SHOW_NOTIFICATION',
                title,
                body,
                tag,
            });
        } else if (
            'Notification' in window &&
            Notification.permission === 'granted'
        ) {
            // Direct API fallback — works when SW controller hasn't attached yet
            new Notification(title, {
                body,
                tag: tag || 'goldmove',
                renotify: true,
                icon: '/favicon.svg',
            });
        }
    } catch (e) {
        console.warn('[GoldMove Notif] Failed to send notification:', e);
    }
}

/**
 * @param {object} params
 * @param {Array}   params.dataset       - The aggregated candle dataset from ChartWrapper
 * @param {object}  params.state         - App state (state.indicators.goldMove, state.symbol)
 * @param {boolean} params.notifEnabled  - Whether the user has notifications turned on
 */
export function useGoldMoveNotifications({ dataset, state, notifEnabled, tradingEnabled = true }) {
    // tradingEnabled: false for background chart tabs — they still notify, but
    // only the chart tab on screen sends BUY/SELL/CLOSE to the MT5 EA bridge
    // (otherwise every open tab would send its own trade signals).
    // Dedup refs — store the candle *time* of the last notification fired for
    // each signal type so we never fire twice for the same candle.
    const lastSignalTimeRef = useRef(null);   // Buy / Sell signals
    const watchKeyRef = useRef(null);
    const lastTpTimeRef = useRef(null);        // TP1 hit
    
    // Hook to send signals to our backend webhook

    // Register the service worker and request permission on mount.
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('/notification-sw.js')
                .catch(() => {});
        }
        ensurePermission();

        // Re-try permission on first real user gesture (required by some browsers)
        const retry = () => ensurePermission();
        document.addEventListener('click', retry, { once: true });
        document.addEventListener('keydown', retry, { once: true });
        document.addEventListener('touchstart', retry, { once: true });
        return () => {
            document.removeEventListener('click', retry);
            document.removeEventListener('keydown', retry);
            document.removeEventListener('touchstart', retry);
        };
    }, []);

    useEffect(() => {
        // Guard: Gold Move indicator must be active
        if (!state?.indicators?.goldMove) return;
        // Guard: need at least one candle
        if (!dataset || dataset.length === 0) return;

        const liveCandle = dataset[dataset.length - 1];
        if (!liveCandle) return;

        const symbol = state.symbol || '';

        // Signal: Buy / Sell — from the last CLOSED candle only. The live candle's
        // signal can still disappear before it closes, and this one goes to the
        // MT5 Receiver EA as a trade.
        const lastCandle = dataset.length >= 2 ? dataset[dataset.length - 2] : null;

        // First data for this symbol/timeframe: remember where we are, send nothing
        // (opening the app or switching chart must not replay an old signal)
        const watchKey = `${symbol}|${state.timeframe}`;
        if (watchKeyRef.current !== watchKey) {
            watchKeyRef.current = watchKey;
            lastSignalTimeRef.current = lastCandle?.time ?? null;
            lastTpTimeRef.current = liveCandle.time;
            return;
        }
        const hasSignal = !!lastCandle && (
            lastCandle.gmBull ||
            lastCandle.gmSBull ||
            lastCandle.gmBear ||
            lastCandle.gmSBear);

        if (hasSignal && lastSignalTimeRef.current !== lastCandle.time) {
            lastSignalTimeRef.current = lastCandle.time;

            const isBuy = !!(lastCandle.gmBull || lastCandle.gmSBull);
            const isSmart = !!(lastCandle.gmSBull || lastCandle.gmSBear);
            const entry = lastCandle.close ?? 0;
            const sl = lastCandle.gmSl ?? null;
            const tp = lastCandle.gmTp1 ?? null;

            const typeLabel = `${isSmart ? 'Smart ' : ''}${isBuy ? 'Buy' : 'Sell'}`;
            const slStr = sl != null ? sl.toFixed(2) : 'N/A';
            const tpStr = tp != null ? tp.toFixed(2) : 'N/A';
            const timeStr = new Date(lastCandle.time).toLocaleTimeString([], { hour12: false });

            const title = `${isBuy ? '\uD83D\uDCC8' : '\uD83D\uDCC9'} Gold Move ${isBuy ? 'BUY' : 'SELL'} \u2014 ${symbol}`;
            const body = `${typeLabel} @ ${entry.toFixed(2)}  |  TP: ${tpStr}  |  SL: ${slStr}  |  ${timeStr}`;
            const tag = `goldmove-${isBuy ? 'buy' : 'sell'}-${lastCandle.time}`;

            if (notifEnabled) {
                console.log('[GoldMove Notif] Signal fired:', title, body);
                playNotificationSound();
                sendNotification(title, body, tag);
            }

            // Trades for the MT5 Receiver EA are sent by useEaSignalBridge (Signal
            // Tester → "Auto-send to MT5 EA"), not here.
        }

        // TP1 Hit — on the live candle (price touching TP is real as it happens)
        if (liveCandle.gmTP1 && lastTpTimeRef.current !== liveCandle.time) {
            lastTpTimeRef.current = liveCandle.time;

            const tpType = liveCandle.gmTP1Type === 'buy' ? 'Buy' : 'Sell';
            const priceStr =
                liveCandle.gmTP1Type === 'buy'
                    ? (liveCandle.high ?? liveCandle.close)?.toFixed(2)
                    : (liveCandle.low ?? liveCandle.close)?.toFixed(2);
            const timeStr = new Date(liveCandle.time).toLocaleTimeString([], { hour12: false });

            const title = `\u2705 Gold Move TP Hit \u2014 ${symbol}`;
            const body = `${tpType} TP1 reached @ ${priceStr}  |  ${timeStr}`;
            const tag = `goldmove-tp-${liveCandle.time}`;

            if (notifEnabled) {
                console.log('[GoldMove Notif] TP hit fired:', title, body);
                playNotificationSound();
                sendNotification(title, body, tag);
            }
            // (No CLOSE to the EA: the order already carries this TP, and a CLOSE
            // would also close trades from other indicators on the symbol.)
        }
    }, [dataset, state?.indicators?.goldMove, state?.symbol, state?.timeframe, notifEnabled, tradingEnabled]);
}
