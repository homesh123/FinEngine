import React, { useCallback, useEffect, useRef, useState } from 'react';
import ChartLinkButton from './ChartLinkButton';
import MiniStockChart from './MiniStockChart';
import { ArrowLeft, RefreshCw, Trophy, Eye, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { formatMoney } from '../utils/money';
import { getData } from '../utils/dataSource';
import { savedCriteria, topPicks } from '../utils/screenerRules';

const pct = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`;

const MARKET_LABEL = { IN: 'Indian', US: 'US' };

function ScoreBadge({ score }) {
    const tone = score >= 75 ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
        : score >= 60 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    return (
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${tone}`} title="Overall score out of 100">
            {score}/100
        </span>
    );
}

function StockHeader({ rank, stock, market, chartOpen, onChart }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
                <span className="mt-0.5 w-7 h-7 shrink-0 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">{rank}</span>
                <div className="min-w-0">
                    <div className="font-bold text-base text-slate-800 dark:text-slate-100 flex items-center gap-2">{stock.symbol}<ChartLinkButton symbol={stock.symbol} market={market} active={chartOpen} onOpen={onChart} /></div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{stock.name}{stock.sector ? ` · ${stock.sector}` : ''}</div>
                </div>
            </div>
            <div className="text-right shrink-0">
                <div className="font-mono font-bold text-base text-slate-800 dark:text-slate-100">{formatMoney(stock.price, stock.currency, 2)}</div>
                <ScoreBadge score={stock.score} />
            </div>
        </div>
    );
}

function Reasons({ reasons }) {
    return (
        <ul className="mt-3 space-y-1.5">
            {reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-slate-600 dark:text-slate-300 leading-snug">
                    <span className="text-green-600 dark:text-green-400 shrink-0">✓</span>{r}
                </li>
            ))}
        </ul>
    );
}

// The short-term plan, highlighted
function TradePlan({ plan, currency }) {
    const cell = 'flex flex-col rounded-lg px-3 py-2';
    return (
        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className={`${cell} bg-slate-50 dark:bg-slate-800/60`}>
                <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Buy around</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{formatMoney(plan.entry, currency, 2)}</span>
            </div>
            <div className={`${cell} bg-green-50 dark:bg-green-500/10`}>
                <span className="text-[11px] uppercase tracking-wide text-green-700 dark:text-green-400">Target</span>
                <span className="font-mono font-bold text-green-700 dark:text-green-400">{formatMoney(plan.target, currency, 2)} <span className="text-xs">({pct(plan.target_pct)})</span></span>
            </div>
            <div className={`${cell} bg-red-50 dark:bg-red-500/10`}>
                <span className="text-[11px] uppercase tracking-wide text-red-700 dark:text-red-400">Stop-loss (exit if below)</span>
                <span className="font-mono font-bold text-red-700 dark:text-red-400">{formatMoney(plan.stop_loss, currency, 2)} <span className="text-xs">({pct(plan.stop_pct)})</span></span>
            </div>
            <div className={`${cell} bg-indigo-50 dark:bg-indigo-500/10`}>
                <span className="text-[11px] uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Hold for</span>
                <span className="font-bold text-indigo-800 dark:text-indigo-200">{plan.hold_weeks[0]}–{plan.hold_weeks[1]} weeks</span>
            </div>
        </div>
    );
}

/**
 * Full-page "Top 5 to Invest" view (replaces the screener table; Back returns).
 */
export default function TopPicksPage({ market = 'US', onBack }) {
    const [state, setState] = useState({ status: 'loading', data: null, error: null });
    const [showRules, setShowRules] = useState(false);
    const [chartOf, setChartOf] = useState(null);       // stock whose chart is open in its card
    const toggleChart = (sym) => setChartOf(c => (c === sym ? null : sym));
    const pollRef = useRef(null);

    const load = useCallback(async (refresh = false) => {
        clearTimeout(pollRef.current);
        try {
            // Ranked in the browser from the screener data (live prices when connected), with this browser's criteria
            const { body } = await getData(`/api/investment/screener?market=${market}`, `screener-${market}.json`);
            setState({ status: 'ready', data: topPicks(body, savedCriteria() || undefined), error: null });
        } catch (e) {
            setState(prev => ({ ...prev, status: 'error', error: e.message }));
        }
    }, [market]);

    useEffect(() => {
        setState({ status: 'loading', data: null, error: null });
        load(false);
        return () => clearTimeout(pollRef.current);
    }, [load]);

    const { status, data, error } = state;
    const busy = status === 'computing' || status === 'loading';
    const picks = data?.picks || [];
    const watchlist = data?.watchlist || [];
    const updated = data?.generated_at ? new Date(data.generated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', hour12: false }) : null;

    return (
        <div className="w-full">
            {/* Page header */}
            <button onClick={onBack}
                    className="inline-flex items-center gap-1.5 mb-4 px-2.5 py-1.5 -ml-1 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                <ArrowLeft size={16} /> Back to screener
            </button>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Trophy size={22} className="text-amber-500" /> Top 5 {MARKET_LABEL[market]} Stocks to Invest
                    </h1>
                    <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Good fundamentals + a favourable short-term trend · {data?.universe || (market === 'US' ? 'US large caps' : 'NIFTY 50')}
                        {updated && <> · updated {updated}</>}
                    </p>
                </div>
                <button onClick={() => load(true)} disabled={busy}
                        className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50">
                    <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {status === 'computing' ? 'Analysing…' : 'Re-analyse'}
                </button>
            </div>

            <div className="space-y-6">
                {status === 'loading' && (
                    <div className="flex items-center gap-2 p-3 text-sm text-slate-500 dark:text-slate-400">
                        <RefreshCw size={15} className="animate-spin" /> Loading…
                    </div>
                )}
                {status === 'computing' && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-800 dark:text-indigo-200 text-sm">
                        <RefreshCw size={16} className="animate-spin shrink-0" />
                        Analysing {data?.scanned || 50} stocks with the latest market data — this takes 1–2 minutes.
                        {data && ' Showing the previous result meanwhile.'}
                    </div>
                )}
                {status === 'error' && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">{error}</div>
                )}

                {data && (
                    <>
                        {/* Buy now */}
                        <section>
                            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-3">
                                <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Ready to buy now
                                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">— pass every check today</span>
                            </h2>
                            {picks.length === 0 ? (
                                <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300">
                                    No stock passes every check today — most good companies are currently in a short-term
                                    downtrend, so buying right now isn't recommended. The stocks below have strong fundamentals;
                                    consider them once the condition shown is met.
                                </div>
                            ) : (
                                <div className="grid gap-3 xl:grid-cols-2">
                                    {picks.map((s, i) => (
                                        <div key={s.symbol} className="p-4 rounded-xl border border-green-200 dark:border-green-500/30 bg-white dark:bg-slate-900">
                                            <StockHeader rank={i + 1} stock={s} market={market} chartOpen={chartOf === s.symbol} onChart={() => toggleChart(s.symbol)} />
                                            {chartOf === s.symbol && <div className="mt-3"><MiniStockChart symbol={s.symbol} market={market} plan={s.plan} onClose={() => setChartOf(null)} height={260} /></div>}
                                            <TradePlan plan={s.plan} currency={s.currency} />
                                            <Reasons reasons={s.reasons} />
                                            <div className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
                                                Longer term: analysts' 12-month target {formatMoney(s.analyst_target, s.currency)} ({pct(s.analyst_upside_pct)}) by {s.target_by}.
                                                Sell at the target or if the price closes below the stop-loss — whichever comes first.
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Watchlist */}
                        {watchlist.length > 0 && (
                            <section>
                                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-3">
                                    <Eye size={17} className="text-amber-500" /> Watchlist
                                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">— strong fundamentals, wait for a better entry</span>
                                </h2>
                                <div className="grid gap-3 xl:grid-cols-2">
                                    {watchlist.map((s, i) => (
                                        <div key={s.symbol} className="p-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-white dark:bg-slate-900">
                                            <StockHeader rank={picks.length + i + 1} stock={s} market={market} chartOpen={chartOf === s.symbol} onChart={() => toggleChart(s.symbol)} />
                                            {chartOf === s.symbol && <div className="mt-3"><MiniStockChart symbol={s.symbol} market={market} onClose={() => setChartOf(null)} height={260} /></div>}
                                            <div className="mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-[13px] text-amber-900 dark:text-amber-200">
                                                <b>Wait for:</b> {s.waiting_for.join('; ')}.
                                            </div>
                                            <Reasons reasons={s.reasons} />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* How it works */}
                        <section className="rounded-xl border border-slate-200 dark:border-slate-800">
                            <button onClick={() => setShowRules(v => !v)} aria-expanded={showRules}
                                    className="w-full flex items-center gap-1.5 px-4 py-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                {showRules ? <ChevronDown size={15} /> : <ChevronRight size={15} />} How are these stocks picked?
                            </button>
                            {showRules && data.rules && (
                                <div className="px-4 pb-4 text-[13px] text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
                                    <p>We scan {data.scanned} stocks ({data.universe}; {data.evaluated} had complete data). A stock must pass all of these:</p>
                                    <p><b>Fundamentals:</b> {data.rules.fundamentals}.</p>
                                    <p><b>Room to rise:</b> {data.rules.value}.</p>
                                    <p><b>Timing (for "buy now"):</b> {data.rules.timing}.</p>
                                    <p>The score (out of 100) ranks them: fundamentals 40, profit growth 15, upside to analysts' target 20, price trend 25.
                                       Target and stop-loss are sized from each stock's usual daily price movement; the holding
                                       period is how long a move of that size typically takes.</p>
                                    <p>Note: this list looks for short-term opportunities (at least 10% upside), so a stock can appear
                                       here while the screener table shows HOLD — the table's BUY needs a 20% discount to the analysts' target.</p>
                                </div>
                            )}
                        </section>
                    </>
                )}

                <p className="flex gap-2 text-xs text-slate-500 dark:text-slate-400 leading-snug pb-2">
                    <AlertTriangle size={15} className="shrink-0 text-amber-500" />
                    For education only, not investment advice. Based on public market data and analysts' estimates,
                    which can be wrong. Always use a stop-loss and invest only what you can afford to lose.
                </p>
            </div>
        </div>
    );
}
