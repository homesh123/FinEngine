import React, { useEffect, useState } from 'react';

// Small "● 12 online" counter for the footer. Each browser pings /api/presence
// once a minute while the tab is visible, with a random anonymous id kept in
// localStorage (all tabs of one browser count once). Nothing personal is sent.
const KEY = 'ts_presence_id';

function browserId() {
    try {
        let id = localStorage.getItem(KEY);
        if (!id) {
            id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
            localStorage.setItem(KEY, id);
        }
        return id;
    } catch {
        return `t-${Math.random().toString(36).slice(2, 14)}`;   // storage blocked: per-tab id
    }
}

export default function OnlineCount() {
    const [online, setOnline] = useState(null);

    useEffect(() => {
        const id = browserId();
        let cancelled = false;
        // Visible tab: count this browser (POST). Hidden tab: only read the count (GET),
        // so background tabs show the number without counting as someone watching.
        const ping = async () => {
            try {
                const res = document.hidden
                    ? await fetch('/api/presence')
                    : await fetch('/api/presence', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
                    });
                if (!res.ok || cancelled) return;
                const d = await res.json();
                if (!cancelled && Number.isFinite(d.online)) setOnline(d.online);
            } catch { /* offline / backend down: keep the last value */ }
        };
        ping();
        const timer = setInterval(ping, 60000);
        const onVis = () => { if (!document.hidden) ping(); };
        document.addEventListener('visibilitychange', onVis);
        return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
    }, []);

    if (!online) return null;
    return (
        <span
            className="shrink-0 inline-flex items-center gap-1 text-[9px] leading-tight text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap cursor-default"
            title="People with TradeSagar open right now (active in the last 2 minutes)"
        >
            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
            {online.toLocaleString()} online
        </span>
    );
}
