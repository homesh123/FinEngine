import { useEffect } from 'react';

// Silent update: when a newer build is deployed, refresh the cached page and reload so the browser
// picks it up (the deploy keeps the previous build's chunks, so the old page keeps working until then). Checks /version.json (never cached) every 5 minutes, when the tab
// comes back into view and when the connection returns. Waits while the user is
// typing in a field, and reloads at most once per new build (no loop if a cache
// still serves the old page). Production builds only.
const CHECK_MS = 5 * 60 * 1000;

export function useAutoUpdate() {
    useEffect(() => {
        if (!import.meta.env.PROD) return undefined;
        let pending = false;
        const typing = () => {
            const el = document.activeElement;
            return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        };
        const reloadWhenIdle = (buildId) => {
            if (pending) return;
            pending = true;
            const go = async () => {
                if (typing()) { setTimeout(go, 3000); return; }
                try { sessionStorage.setItem('ts_reloaded_for', buildId); } catch { /* storage unavailable */ }
                // The server sends index.html without a cache header, so a plain reload can reuse the old copy:
                // refetch this page's HTML (and the root) past the cache first, which replaces the cached copy.
                await Promise.all([...new Set([window.location.pathname, '/'])].map(u =>
                    fetch(u, { cache: 'reload', credentials: 'same-origin' }).catch(() => null)));
                window.location.reload();
            };
            go();
        };
        const check = async () => {
            try {
                const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
                if (!r.ok) return;
                const { buildId } = await r.json();
                if (!buildId || buildId === __APP_BUILD_ID__) return;
                let done = null;
                try { done = sessionStorage.getItem('ts_reloaded_for'); } catch { /* storage unavailable */ }
                if (done === buildId) return;          // already reloaded once for this build
                reloadWhenIdle(buildId);
            } catch { /* offline: try again later */ }
        };
        const onVisible = () => { if (document.visibilityState === 'visible') check(); };
        const t = setInterval(check, CHECK_MS);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', check);
        check();
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', check); };
    }, []);
}
