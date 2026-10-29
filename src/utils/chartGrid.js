// Grid lines — Chart Settings → Grid lines (off by default).

// Kept in app state as `grid` (not indicatorSettings, so changing it only
// redraws instead of recalculating every indicator).
export const GRID_DEFAULTS = { gridShow: false, gridColor: '#64748b', gridOpacity: 40 };

/** '#rrggbb' + opacity % → rgba(), or null for an invalid colour. */
export function hexToRgba(hexIn, opacityPct) {
    const hex = String(hexIn || '').replace('#', '');
    if (hex.length !== 6) return null;
    const a = Math.max(0.05, Math.min(1, (Number(opacityPct ?? 40) || 40) / 100));
    return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${a})`;
}

// Session separator lines (Chart Settings → Show Session Lines), per chart tab in `layers`
export const SESSION_LINE_DEFAULTS = { sessionLineColor: '#3b82f6', sessionLineOpacity: 25 };

/** Grid colour as rgba, or null when grid lines are off (the default). */
export function gridStyle(s, colors) {
    if (!s || !s.gridShow) return null;
    const hex = String(s.gridColor || '').replace('#', '');
    const a = Math.max(0.05, Math.min(1, (Number(s.gridOpacity ?? 40) || 40) / 100));
    if (hex.length !== 6) return colors.gridMajor;
    return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${a})`;
}
