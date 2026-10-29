import { useEffect, useRef } from 'react';
import { getAlertState } from '../utils/alerts/alertStore';
import { deliverAlert } from '../utils/alerts/alertDelivery';
import { getMarketState, withSeasonalHours } from '../utils/clock/market-hours';
import { GOLDEN_HOURS, formatDuration } from '../utils/clock/clock';
import { ALL, readCfg } from '../components/MarketHours';

// Market clock alerts (Alerts → Settings): exchange opens / closes / opens in 15 min,
// London–New York overlap starts. Time-based, so one checker for the whole app,
// every 20 s; exchanges = the ones chosen on the market clock. Fired once per
// event across browser tabs (shared key in localStorage).
const PRE_MIN = 15;
const NOTIFY = { popup: true, sound: true, email: false, webhook: false };

function firstTime(key) {
    try {
        const seen = JSON.parse(localStorage.getItem('ts_mkt_alerts_fired') || '{}');
        if (seen[key]) return false;
        seen[key] = Date.now();
        for (const k of Object.keys(seen)) if (Date.now() - seen[k] > 2 * 86400000) delete seen[k];
        localStorage.setItem('ts_mkt_alerts_fired', JSON.stringify(seen));
    } catch { /* storage unavailable: fire anyway */ }
    return true;
}

export function useMarketAlerts({ notifEnabled }) {
    const prev = useRef(null);
    useEffect(() => {
        const check = () => {
            const { settings } = getAlertState();
            const on = settings.marketAlerts || {};
            const hidden = readCfg().hidden;
            const now = {};
            for (const m of ALL) if (!hidden.includes(m.id)) now[m.label] = getMarketState(withSeasonalHours(m));
            now['__overlap'] = getMarketState(GOLDEN_HOURS);
            const before = prev.current;
            prev.current = now;
            if (!before || !settings.enabled) return;                 // first look only sets the baseline
            const day = new Date().toISOString().slice(0, 10);
            const fire = (key, title, message, side) => {
                if (!firstTime(`${day}|${key}`)) return;
                deliverAlert({ id: `market-${key}`, notify: NOTIFY }, title, message, { ticker: 'Market clock', interval: '', side, barTime: Date.now() }, { soundAndPopup: notifEnabled });
            };
            for (const [label, s] of Object.entries(now)) {
                const b = before[label];
                if (!b) continue;
                const name = label === '__overlap' ? 'London–New York overlap' : label;
                if (label === '__overlap') {
                    if (on.overlap && s.open && !b.open) fire('overlap', 'London–New York overlap started', `The busiest forex hours have started — for ${formatDuration(s.minutesToChange)}.`, 'buy');
                    continue;
                }
                if (on.open && s.open && !b.open) fire(`${label}|open`, `${name} opened`, `${name} stock exchange is open now — closes in ${formatDuration(s.minutesToChange)}.`, 'buy');
                if (on.close && !s.open && b.open) fire(`${label}|close`, `${name} closed`, `${name} stock exchange has closed — opens again in ${formatDuration(s.minutesToChange)}.`, 'sell');
                if (on.preOpen && !s.open && s.minutesToChange <= PRE_MIN && (b.open || b.minutesToChange > PRE_MIN))
                    fire(`${label}|pre`, `${name} opens in ${s.minutesToChange} min`, `${name} stock exchange opens in ${s.minutesToChange} minutes.`, '');
            }
        };
        check();
        const t = setInterval(check, 20000);
        return () => clearInterval(t);
    }, [notifEnabled]);
}
