// INDIA_ALGO_TRADING.md E8: while the app is open (owner, Upstox connected), shows each new trade alert from the
// server (/api/india/notifications) as a browser notification + in-app toast + sound. Emails are sent by the server
// itself, so they arrive even when no browser is open. The first poll only primes (no replay of old alerts).
import { useEffect } from 'react';
import { indiaApi } from '../utils/indiaApi';
import { useBrokerSession } from './useBrokerSession';
import { sendNotification } from './useGoldMoveNotifications';
import { playNotificationSound } from '../utils/notificationSound';
import { ALERT_TOAST_EVENT } from '../utils/alerts/alertDelivery';

const LAST = 'ts_india_alert_last';

export function useIndiaTradeAlerts() {
    const broker = useBrokerSession();
    useEffect(() => {
        if (!broker.ready) return undefined;
        let alive = true;
        const read = () => { try { return Number(localStorage.getItem(LAST)) || 0; } catch { return 0; } };
        const write = (v) => { try { localStorage.setItem(LAST, String(v)); } catch { /* storage unavailable */ } };
        const poll = async () => {
            try {
                const last = read();
                const list = await indiaApi.notifications(last);
                if (!alive || !list.length) return;
                write(list[0].id);                                  // newest first
                if (!last) return;                                  // first run: prime only
                list.slice(0, 5).reverse().forEach(n => {
                    sendNotification(n.title, n.body.split('\n')[0], `india-${n.id}`);
                    window.dispatchEvent(new CustomEvent(ALERT_TOAST_EVENT, { detail: { id: `india-${n.id}`, title: n.title, message: n.body.split('\n')[0],
                        side: /\bBUY\b/.test(n.title) ? 'buy' : /\bSELL\b/.test(n.title) ? 'sell' : undefined } }));
                });
                playNotificationSound(1500);
            } catch { /* offline / logged out: try again next poll */ }
        };
        poll();
        const t = setInterval(poll, 20000);
        return () => { alive = false; clearInterval(t); };
    }, [broker.ready]);
}
