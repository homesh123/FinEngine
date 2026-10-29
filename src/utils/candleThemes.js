// ─── Candle colour themes ────────────────────────────────────────────────────
// Body / outline / wick colours for up and down candles. 'bg' as a body colour
// means hollow (the chart background shows through). The outline-style
// schemes have a light- and a dark-background version so they stay readable
// in both app themes. (Keys are internal and kept stable for saved choices.) TradeSagar (the current look) is the default.

export const CANDLE_THEMES = {
    default:       { label: 'TradeSagar (default)', up: '#22c55e', down: '#ef4444' },
    tradingview:   { label: 'Teal & coral',         up: '#26a69a', down: '#ef5350' },
    hollow:        { label: 'Hollow candles',       up: '#26a69a', down: '#ef5350', upBody: 'bg' },
    mtGreenBlack:  { label: 'Neon outline', up: { light: '#00a344', dark: '#00e676' }, down: { light: '#00a344', dark: '#00e676' }, upBody: 'bg', downBody: { light: '#0f172a', dark: '#ffffff' } },   // deeper green on white for contrast
    mtBlackWhite:  { label: 'Ink & paper',
                     light: { up: '#000000', down: '#000000', upBody: '#ffffff', downBody: '#000000' },
                     dark:  { up: '#e2e8f0', down: '#e2e8f0', upBody: 'bg', downBody: '#e2e8f0' } },
    classic:       { label: 'Classic green / red', up: '#00b050', down: '#ff0000' },
    blueRed:       { label: 'Blue / red',          up: '#2962ff', down: '#f23645' },
    mono:          { label: 'Monochrome',          up: { light: '#64748b', dark: '#94a3b8' }, down: { light: '#0f172a', dark: '#e2e8f0' }, upBody: 'bg' },
    custom:        { label: 'Custom…' },
};

const pick = (v, dark) => (v && typeof v === 'object' ? (dark ? v.dark : v.light) : v);

/**
 * Colours for the current theme: { upBody, downBody, upBorder, downBorder, upWick, downWick }.
 * state.candleTheme picks the preset; 'custom' reads state.candleColors.
 */
export function candleColors(state, isDark, bg) {
    const key = CANDLE_THEMES[state?.candleTheme] ? state.candleTheme : 'default';
    let t = CANDLE_THEMES[key];
    if (key === 'custom') {
        const c = state.candleColors || {};
        t = { up: c.upBorder || '#22c55e', down: c.downBorder || '#ef4444', upBody: c.upBody || c.upBorder || '#22c55e', downBody: c.downBody || c.downBorder || '#ef4444', upWick: c.upWick, downWick: c.downWick };
    } else if (t.light) t = isDark ? t.dark : t.light;
    const up = pick(t.up, isDark), down = pick(t.down, isDark);
    const body = (v, fallback) => { const b = pick(v, isDark) ?? fallback; return b === 'bg' ? bg : b; };
    return {
        upBody: body(t.upBody, up), downBody: body(t.downBody, down),
        upBorder: up, downBorder: down,
        upWick: pick(t.upWick, isDark) || up, downWick: pick(t.downWick, isDark) || down,
    };
}
