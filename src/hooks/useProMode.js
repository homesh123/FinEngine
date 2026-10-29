/**
 * useProMode
 * ----------
 * Reads the `promode` flag from localStorage.
 * Returns { isProMode, toggleProMode }.
 *
 * Secret activation: double-click the disclaimer bar to toggle pro mode.
 *
 * To enable pro-mode from the browser console:
 *   localStorage.setItem('promode', 'true');
 * To disable:
 *   localStorage.removeItem('promode');
 */
import { useState, useEffect, useCallback } from 'react';
import { LIVE_MODE } from '../utils/liveMode';

const SITE_AD_SRC = 'https://abscloud.org/1/271f3cc42a719c71663f9a65b18ba9c3';

/**
 * The site-wide Adsterra script (added in index.html when Pro Mode is off) can't
 * be unloaded once it runs, so turning Pro Mode on reloads the page without it;
 * turning Pro Mode off loads it right away.
 */
function syncSiteAd(isPro) {
    const loaded = document.querySelector('script[data-site-ad]');
    if (isPro && loaded) {
        window.location.reload();
    } else if (!isPro && !loaded) {
        const el = document.createElement('script');
        el.setAttribute('data-cfasync', 'false');
        el.setAttribute('data-site-ad', '');
        el.src = SITE_AD_SRC;
        document.head.appendChild(el);
    }
}

export function useProMode() {
    const [isProMode, setIsProMode] = useState(() => {
        return LIVE_MODE || localStorage.getItem('promode') === 'true';
    });

    // Listen for storage changes (e.g. another tab toggling the flag)
    useEffect(() => {
        const handleStorage = (e) => {
            if (e.key === 'promode') {
                setIsProMode(LIVE_MODE || e.newValue === 'true');
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const toggleProMode = useCallback(() => {
        const next = localStorage.getItem('promode') !== 'true';
        if (next) {
            localStorage.setItem('promode', 'true');
        } else {
            localStorage.removeItem('promode');
        }
        setIsProMode(LIVE_MODE || next);   // live mode stays Pro
        syncSiteAd(LIVE_MODE || next);
    }, []);

    return { isProMode, toggleProMode };
}
