// Chart screenshot: composites the visible chart canvases (all panels of the
// active tab — split layouts included) into one PNG with a small header, then
// downloads it and copies it to the clipboard where the browser allows.
// Only our own canvases are drawn (no cross-origin images), so export works.

const pad2 = (n) => String(n).padStart(2, '0');

export async function takeChartSnapshot({ symbol = '', timeframe = '', dark = true } = {}) {
    const areas = [...document.querySelectorAll('[data-chart-area]')].filter(el => el.offsetParent && el.clientWidth > 50);
    if (!areas.length) throw new Error('No chart on screen');

    const rects = areas.map(el => el.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
    const width = Math.max(...rects.map(r => r.right)) - left, height = Math.max(...rects.map(r => r.bottom)) - top;
    const HEADER = 30;
    const scale = Math.min(2, window.devicePixelRatio || 1);

    const out = document.createElement('canvas');
    out.width = Math.round(width * scale);
    out.height = Math.round((height + HEADER) * scale);
    const ctx = out.getContext('2d');
    ctx.scale(scale, scale);
    const bg = dark ? '#05080f' : '#ffffff', fg = dark ? '#e2e8f0' : '#0f172a', sub = dark ? '#94a3b8' : '#64748b';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height + HEADER);

    // Header: brand · symbol · timeframe · local time
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    ctx.textBaseline = 'middle';
    ctx.font = '600 14px Outfit, system-ui, sans-serif';
    ctx.fillStyle = fg; ctx.fillText('Trade', 10, HEADER / 2);
    const w1 = ctx.measureText('Trade').width;
    ctx.fillStyle = dark ? '#34d399' : '#059669'; ctx.fillText('Sagar', 10 + w1, HEADER / 2);
    const w2 = ctx.measureText('Sagar').width;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = fg; ctx.fillText(`${symbol}  ·  ${timeframe}`, 24 + w1 + w2, HEADER / 2);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = sub; ctx.textAlign = 'right'; ctx.fillText(stamp, width - 10, HEADER / 2);
    ctx.textAlign = 'left';

    // Chart canvases (main layer of each visible chart)
    for (const area of areas) {
        for (const c of area.querySelectorAll('canvas')) {
            if (!c.width || !c.height || c.dataset.snapshotSkip !== undefined) continue;
            const r = c.getBoundingClientRect();
            ctx.drawImage(c, 0, 0, c.width, c.height, r.left - left, r.top - top + HEADER, r.width, r.height);
        }
    }

    const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Could not create the image');

    // Download
    const file = `TradeSagar_${String(symbol).replace(/[^A-Za-z0-9]/g, '')}_${String(timeframe).replace(/[^A-Za-z0-9]/g, '')}_${stamp.replace(/[-: ]/g, '')}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // Clipboard (best effort — needs a secure context and permission)
    let copied = false;
    try {
        if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
            copied = true;
        }
    } catch { /* not allowed — the download is enough */ }
    return { file, copied };
}
