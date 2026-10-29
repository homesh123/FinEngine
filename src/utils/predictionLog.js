// Live track record (backend/prediction_log.py): each prediction and signal is
// posted once; the server checks it against real candles later. Failures are
// ignored — the chart works the same without the record.
const posted = new Set();

export function logPrediction(entry) {
    const key = [entry.symbol, entry.tf, entry.kind, entry.horizon, entry.analogs, entry.refTime].join('|');
    if (posted.has(key)) return;
    posted.add(key);
    if (posted.size > 2000) posted.clear();
    fetch('/api/predlog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
}

export async function fetchLiveRecord(symbol, tf) {
    try {
        const r = await fetch(`/api/predlog/stats?symbol=${encodeURIComponent(String(symbol).replace('/', ''))}&tf=${tf}`);
        return r.ok ? await r.json() : null;
    } catch { return null; }
}
