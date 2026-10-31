// Screener decisions made in the browser from the snapshot's raw metrics, so the
// Criteria Config dialog works on the static site (criteria are saved per browser).

const CRITERIA_KEY = 'screenerCriteria';

export const DEFAULT_CRITERIA = {
    roe_min: 15, roic_min: 15, eps_growth_min: 12, revenue_growth_min: 10, gross_margin_min: 40,
    debt_to_equity_max: 0.5, peg_max: 1.5, margin_of_safety_min: 20, f_score_min: 7,
};

export function savedCriteria() {
    try { return JSON.parse(localStorage.getItem(CRITERIA_KEY) || 'null'); } catch { return null; }
}

export function saveCriteria(c) {
    try { localStorage.setItem(CRITERIA_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

const f1 = (v) => Number(v).toFixed(1);

/** Short-term timing from the daily trend: { ok, text, waitingFor[] }. */
export function timing(stock) {
    const t = stock.trend || {};
    const p = stock.current_price;
    const waiting = [];
    if (t.sma50 && p < t.sma50) waiting.push(`price back above its 50-day average (${f1(t.sma50)})`);
    if (t.sma50 && t.sma200 && t.sma50 < t.sma200) waiting.push('the 50-day average to cross above the 200-day');
    if (t.rsi14 >= 70) waiting.push(`RSI to cool from ${f1(t.rsi14)} (overbought)`);
    if (!t.sma50) return { ok: false, text: 'Not enough price history', waitingFor: ['more price history'] };
    if (waiting.length === 0) return { ok: true, text: `Buy now — uptrend (above 50-day avg, RSI ${f1(t.rsi14)})`, waitingFor: [] };
    return { ok: false, text: `Wait — ${waiting[0]}`, waitingFor: waiting };
}

function checks(stock, c) {
    const fPassMin = stock.f_score_tests ? (c.f_score_min / 9) * stock.f_score_tests : c.f_score_min;
    return [
        { name: 'ROE', pass: stock.roe != null && stock.roe >= c.roe_min, text: stock.roe != null ? `ROE ${f1(stock.roe)}% (min ${c.roe_min}%)` : 'ROE unknown' },
        { name: 'F-Score', pass: stock.f_score_points >= fPassMin, text: `F-Score ${stock.f_score_points}/${stock.f_score_tests} (min ${c.f_score_min}/9)` },
        { name: 'Margin of safety', pass: stock.margin_of_safety != null && stock.margin_of_safety >= c.margin_of_safety_min,
          text: stock.margin_of_safety != null ? `${f1(stock.margin_of_safety)}% below analysts' target (min ${c.margin_of_safety_min}%)` : 'no analyst target' },
    ];
}

/** Adds investment_status / execution_timing / action_reason (unless a live backend already did). */
export function applyCriteria(stock, criteria = DEFAULT_CRITERIA) {
    const c = { ...DEFAULT_CRITERIA, ...criteria };
    const res = checks(stock, c);
    const passed = res.filter(r => r.pass).length;
    const tm = timing(stock);
    let status;
    if (passed === 3) status = tm.ok ? 'BUY' : 'BUY ON DIP';
    else if (passed === 2) status = 'WATCH';
    else status = 'AVOID';
    const good = res.filter(r => r.pass).map(r => r.text);
    const bad = res.filter(r => !r.pass).map(r => r.text);
    const extras = [];
    if (stock.revenue_growth != null) extras.push(`revenue ${stock.revenue_growth >= 0 ? '+' : ''}${f1(stock.revenue_growth)}% a year`);
    if (stock.debt_to_equity != null && stock.debt_to_equity > c.debt_to_equity_max) extras.push(`debt/equity ${stock.debt_to_equity} is above ${c.debt_to_equity_max}`);
    const reason = [
        good.length ? `Passes: ${good.join('; ')}.` : '',
        bad.length ? `Fails: ${bad.join('; ')}.` : '',
        extras.length ? `Also: ${extras.join('; ')}.` : '',
    ].filter(Boolean).join(' ');
    return { ...stock, investment_status: status, execution_timing: tm.text, action_reason: reason, roe: stock.roe ?? 0 };
}

/** Top 5 page data computed from the screener snapshot. */
export function topPicks(snapshot, criteria = DEFAULT_CRITERIA) {
    const c = { ...DEFAULT_CRITERIA, ...criteria };
    const rows = (snapshot.data || []).filter(s => s.trend?.atr14 && s.current_price);
    const scored = rows.map(s => {
        const res = checks(s, c);
        const tm = timing(s);
        const fRatio = s.f_score_tests ? s.f_score_points / s.f_score_tests : 0;
        const score = Math.round(
            Math.min(s.roe || 0, 40) / 40 * 30 + fRatio * 30
            + Math.max(0, Math.min(s.margin_of_safety || 0, 40)) / 40 * 25 + (tm.ok ? 15 : 0));
        const price = s.current_price, atr = s.trend.atr14;
        const stop = price - 2 * atr;
        const target = price + 2 * (price - stop);
        const reasons = res.filter(r => r.pass).map(r => r.text);
        if (tm.ok) reasons.push(tm.text.replace(/^Buy now — /, 'Short-term trend: '));
        return {
            s, res, tm, score,
            card: {
                symbol: s.symbol, name: s.name, sector: s.sector, currency: s.currency, price, score, reasons,
                analyst_target: s.target_price, analyst_upside_pct: s.upside_pct ?? 0, target_by: s.target_by,
                plan: { entry: price, stop_loss: +stop.toFixed(2), target: +target.toFixed(2),
                        stop_pct: (stop / price - 1) * 100, target_pct: (target / price - 1) * 100, hold_weeks: [3, 8] },
                waiting_for: [...res.filter(r => !r.pass && r.name === 'Margin of safety').map(() => 'a lower price (more room below the analysts\' target)'), ...tm.waitingFor],
            },
        };
    }).sort((a, b) => b.score - a.score);
    const strong = scored.filter(x => x.res[0].pass && x.res[1].pass);
    const picks = strong.filter(x => x.res[2].pass && x.tm.ok).slice(0, 5).map(x => x.card);
    const watchlist = strong.filter(x => !(x.res[2].pass && x.tm.ok)).slice(0, 5).map(x => x.card);
    return {
        picks, watchlist, generated_at: snapshot.generated_at, universe: snapshot.universe,
        scanned: (snapshot.data || []).length, evaluated: rows.length,
        rules: {
            fundamentals: `ROE ≥ ${c.roe_min}% and Piotroski F-Score ≥ ${c.f_score_min}/9`,
            value: `price at least ${c.margin_of_safety_min}% below the analysts' average 12-month target`,
            timing: 'price above its 50-day average, 50-day above 200-day, daily RSI under 70; stop-loss 2 × ATR below, target 2 × the risk above',
        },
    };
}
