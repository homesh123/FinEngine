// Minimal in-app routing (no router library): pages like /accounts open on top
// of the charts without a reload, so the charts keep running underneath (their
// indicator signals still reach the broker accounts). Works with the browser's
// back/forward buttons and direct links; servers already fall back to
// index.html for unknown paths (Vite, FastAPI).
import { useEffect, useState } from 'react';

const listeners = new Set();

export const currentPath = () => window.location.pathname.replace(/\/+$/, '') || '/';

export function navigate(path, { replace = false } = {}) {
    if (currentPath() === path) return;
    window.history[replace ? 'replaceState' : 'pushState']({ tsInApp: true }, '', path + window.location.search);
    listeners.forEach(fn => fn());
}

/** Back to the previous in-app screen; a page opened directly goes to `fallback`. */
export function goBack(fallback = '/') {
    if (window.history.state?.tsInApp && window.history.length > 1) window.history.back();
    else navigate(fallback, { replace: true });
}

export function usePath() {
    const [path, setPath] = useState(currentPath);
    useEffect(() => {
        const update = () => setPath(currentPath());
        listeners.add(update);
        window.addEventListener('popstate', update);
        return () => { listeners.delete(update); window.removeEventListener('popstate', update); };
    }, []);
    return path;
}
