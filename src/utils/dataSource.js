// Where the pages get their data.
//
// GitHub Pages is static, and Yahoo Finance / SEC / Nasdaq don't send CORS
// headers, so the browser can't call them directly. A GitHub Actions job
// (scripts/build_data.py) fetches the data server-side and publishes JSON
// snapshots under ./data/ next to the site — same origin, no CORS.
//
// Live data: server/live_api.py (or any backend serving the same /api/*
// endpoints with Access-Control-Allow-Origin) fetches fresh prices for the
// browser. Its URL comes from the "Live data" setting (saved in this browser)
// or VITE_API_BASE at build time. Live calls are tried first and the snapshot
// is the fallback.

const LIVE_KEY = 'liveApiBase';
const DATA_BASE = `${import.meta.env.BASE_URL}data`;
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

export function getApiBase() {
    try {
        const saved = localStorage.getItem(LIVE_KEY);
        if (saved !== null) return clean(saved);   // '' = user switched live data off
    } catch { /* storage unavailable */ }
    return clean(import.meta.env.VITE_API_BASE);
}

export function setApiBase(url) {
    try { localStorage.setItem(LIVE_KEY, clean(url)); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event('live-api-changed'));
}

export const hasLiveApi = () => !!getApiBase();

/** GET /api/health on a candidate URL: resolves true, or throws with the reason. */
export async function testApiBase(url) {
    const res = await fetch(`${clean(url)}/api/health`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.ok) throw new Error('Unexpected answer');
    return true;
}

export async function liveJson(path, init) {
    const res = await fetch(`${getApiBase()}${path}`, { cache: 'no-store', ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `${path}: HTTP ${res.status}`);
    return body;
}

export async function snapshotJson(file) {
    const res = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-store' });
    if (res.status === 404) throw new Error('No data snapshot yet — the "Deploy to GitHub Pages" workflow publishes it on its next run.');
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return res.json();
}

/** Live API when configured (falling back to the snapshot on any error), else the snapshot. */
export async function getData(apiPath, file) {
    if (hasLiveApi() && apiPath) {
        try { return { source: 'live', body: await liveJson(apiPath) }; }
        catch (e) { console.warn(`Live API failed, using snapshot: ${e.message}`); }
    }
    return { source: 'snapshot', body: await snapshotJson(file) };
}

/** Daily candles for the mini chart ([{time, open, high, low, close, volume}]). */
export async function fetchDailyCandles(chartSymbol) {
    const { body } = await getData(
        `/api/history?symbol=${encodeURIComponent(chartSymbol)}&interval=1day&limit=500`,
        `history/${encodeURIComponent(chartSymbol)}.json`,
    );
    if (!Array.isArray(body) || body.length === 0) throw new Error(`No daily candles for ${chartSymbol}`);
    return body;
}

export const ageText = (iso) => {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
    return `${Math.round(mins / 1440)} days ago`;
};
