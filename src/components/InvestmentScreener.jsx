import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, RefreshCw, Search, Settings2, Trophy, X } from 'lucide-react';
import MiniStockChart from './MiniStockChart';
import CriteriaConfigModal from './CriteriaConfigModal';
import InfoTip from './InfoTip';
import TopPicksPage from './TopPicksPage';
import { formatMoney } from '../utils/money';
import { tradingViewUrl } from '../utils/openChart';
import { ageText, getData, hasLiveApi, liveJson } from '../utils/dataSource';
import { useLiveApiBase } from './LiveDataButton';
import { applyCriteria, DEFAULT_CRITERIA, savedCriteria } from '../utils/screenerRules';

// Long-term screener: a sortable table of the market's stocks with the
// criteria's verdict; click one for its chart and the reasoning.

const LIVE_REFRESH_MS = 60000;

// Plain-language explanations shown behind the (i) icons. They describe exactly
// how each number is calculated in this screener.
const ROE_TIP = (
    <>
        <b>Return on Equity</b> — how much yearly profit the company makes for every 100 (rupees or
        dollars) of its shareholders' money. ROE 20% means about 20 profit per 100. Higher is better;
        the criteria look for <b>15% or more</b> (shown in green).
        <span className="block mt-1.5 text-slate-500 dark:text-slate-400">
            Caution: companies that borrow a lot (banks, lenders) can show a high ROE partly because
            of borrowed money.
        </span>
    </>
);

const FSCORE_TIP = (
    <>
        <b>Piotroski F-Score</b> — a quick financial-health check made of yes/no tests that compare
        the latest yearly results with the year before: Is it profitable? Is cash actually coming in?
        Is profit per asset improving? Is debt not rising? Did it avoid issuing new shares? Is it
        getting more efficient? Each "yes" earns 1 point.
        <span className="block mt-1.5"><b>7–9</b> strong · <b>4–6</b> average · <b>0–3</b> weak. The criteria look for 7+.</span>
        <span className="block mt-1.5 text-slate-500 dark:text-slate-400">
            Banks and lenders are scored out of 7 (two tests don't apply), and the score is less
            reliable for them because giving out loans counts as negative cash flow.
        </span>
    </>
);

const MOS_TIP = (
    <>
        <b>Margin of Safety</b> — how far the current price is <b>below</b> the price analysts expect,
        using their average 12-month target. +25% means the share trades 25% under that target,
        a cushion in case things go wrong. A negative value means the price is already above the target.
        The criteria look for <b>20% or more</b>.
        <span className="block mt-1.5 text-slate-500 dark:text-slate-400">
            Based on analysts' targets, not a guarantee. "N/A" means no analysts cover the stock.
        </span>
    </>
);

// "6/9" from the tests passed / tests that apply (older results: scaled score /9)
const fScoreText = (stock) =>
    stock.f_score_tests ? `${stock.f_score_points}/${stock.f_score_tests}` : `${stock.f_score}/9`;

const HOLDING_TIP_BASE = (
    <span className="block mt-1.5 text-slate-500 dark:text-slate-400">
        A suggested range based on the company's last 3 years of results (growth, profitability,
        financial health) and its sector — not a prediction of an exact sell date. Review it as new
        results come out.
    </span>
);

// "Hold for 5–10 years" badge + why this category was chosen
function HoldingPeriod({ stock, compact = false }) {
    if (!stock.horizon_period) {
        // Results saved before this change: show the old label
        return stock.holding_horizon ? (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Horizon: {stock.holding_horizon}</span>
        ) : null;
    }
    return (
        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium
                          bg-slate-50 border-slate-200 text-slate-700
                          dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 ${compact ? 'text-[11px]' : 'text-[11px]'}`}>
            <span className="text-slate-500 dark:text-slate-400">Hold for</span>
            <b>{stock.horizon_period}</b>
            <span className="text-slate-500 dark:text-slate-400">· {stock.horizon_category?.replace(/^.*?:\s*/, '')}</span>
            <InfoTip title={stock.horizon_category}>
                {stock.horizon_reason}
                {HOLDING_TIP_BASE}
            </InfoTip>
        </span>
    );
}

// Highlighted analysts' 12-month target (the real, data-based "when")
function AnalystTarget({ stock }) {
    if (!stock.target_price || typeof stock.upside_pct !== 'number') {
        return (
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                No analyst target available for this stock.
            </div>
        );
    }
    const up = stock.upside_pct;
    return (
        <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1 text-[11px]
                        bg-indigo-50 border-indigo-200 text-indigo-900
                        dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-200">
            <span className="font-semibold">Analysts' target</span>
            <span className="font-mono font-bold">{formatMoney(stock.target_price, stock.currency || 'INR')}</span>
            <span className={`font-bold ${up >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                ({up >= 0 ? '+' : ''}{up.toFixed(1)}%)
            </span>
            <span className="text-indigo-700/80 dark:text-indigo-300/80">within 12 months · by {stock.target_by}</span>
            <InfoTip title="Analysts' 12-month target">
                The average price that{stock.analyst_count ? ` ${stock.analyst_count}` : ''} market analysts expect
                this share to reach within the next 12 months. The % shows how much higher (or lower) that is than
                today's price.
                <span className="block mt-1.5 text-slate-500 dark:text-slate-400">
                    It is an opinion, not a promise — analysts are often wrong, and targets change after results.
                </span>
            </InfoTip>
        </div>
    );
}


const hasMos = (stock) => typeof stock.margin_of_safety === 'number';
const mosText = (stock) =>
    hasMos(stock) ? `${stock.margin_of_safety > 0 ? '+' : ''}${stock.margin_of_safety.toFixed(1)}%` : 'N/A';
const mosClass = (stock) =>
    !hasMos(stock) ? 'text-slate-400' :
    stock.margin_of_safety > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';

// "Agent suggested" (INDIA_ALGO_TRADING.md E9): our own model on daily candles says BUY with an edge in its
// walk-forward record. Shown next to the criteria-based status; the tooltip gives its confidence and reason.
function AgentTag({ stock, compact }) {
    const a = stock.agent;
    if (!a || !a.suggested) return null;
    return (
        <span title={`Agent: BUY, ${Math.round((a.confidence || 0) * 100)}% confident (${a.date}). ${a.reason || ''}`}
            className={`inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 font-semibold ${compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-[11px]'}`}>
            🤖 Agent suggested{!compact && <span className="opacity-70">{Math.round((a.confidence || 0) * 100)}%</span>}
        </span>
    );
}


const STATUS_STYLE = {
    'BUY': 'bg-green-600 text-white',
    'BUY ON DIP': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    'WATCH': 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    'AVOID': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};
const statusStyle = (st = '') => STATUS_STYLE[st] || (st.includes('BUY') ? STATUS_STYLE.BUY : st.includes('SELL') ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : STATUS_STYLE.WATCH);
const StatusBadge = ({ status }) => <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold whitespace-nowrap ${statusStyle(status)}`}>{status}</span>;

// Quick filters: what an investor scans for first
const FILTERS = [
    ['passing', 'Pass my criteria', s => s.investment_status?.startsWith('BUY')],
    ['buy', 'Buy now', s => s.investment_status === 'BUY'],
    ['dip', 'Buy on dip', s => s.investment_status === 'BUY ON DIP'],
    ['watch', 'Watch', s => s.investment_status === 'WATCH'],
    ['all', 'All', () => true],
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const COLUMNS = [   // key, label, sort value, align, tip
    ['symbol', 'Stock', s => s.symbol, 'left'],
    ['price', 'Price', s => num(s.current_price), 'right'],
    ['status', 'Signal', s => ['BUY', 'BUY ON DIP', 'WATCH', 'AVOID'].indexOf(s.investment_status), 'left'],
    ['upside', 'Upside', s => num(s.upside_pct), 'right', 'To the analysts’ average 12-month target'],
    ['mos', 'Margin of safety', s => num(s.margin_of_safety), 'right', MOS_TIP],
    ['roe', 'ROE', s => num(s.roe), 'right', ROE_TIP],
    ['fscore', 'F-Score', s => (s.f_score_tests ? s.f_score_points / s.f_score_tests : null), 'right', FSCORE_TIP],
    ['trend', 'Trend', s => trendScore(s), 'left', 'Price against its 50- and 200-day averages, and the daily RSI'],
];

function trendScore(s) {
    const t = s.trend || {}, p = s.current_price;
    if (!t.sma50) return null;
    return (p > t.sma50 ? 1 : 0) + (t.sma200 && p > t.sma200 ? 1 : 0) + (t.sma50 && t.sma200 && t.sma50 > t.sma200 ? 1 : 0);
}

function Trend({ stock }) {
    const t = stock.trend || {}, p = stock.current_price;
    if (!t.sma50) return <span className="text-slate-400">—</span>;
    const dot = (ok, label) => (
        <span title={`${label}: price ${ok ? 'above' : 'below'}`} className={`inline-flex items-center gap-0.5 ${ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {ok ? '▲' : '▼'}<span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
        </span>
    );
    return (
        <span className="inline-flex items-center gap-2 text-xs whitespace-nowrap">
            {dot(p > t.sma50, '50d')}{t.sma200 ? dot(p > t.sma200, '200d') : null}
            {t.rsi14 != null && <span title="Daily RSI 14" className={`text-[11px] ${t.rsi14 >= 70 ? 'text-amber-600 dark:text-amber-400 font-semibold' : t.rsi14 <= 30 ? 'text-sky-600 dark:text-sky-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>RSI {Math.round(t.rsi14)}</span>}
        </span>
    );
}

const pctText = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);

function Metric({ label, value, tone = '', tip }) {
    return (
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1">{label}{tip && <InfoTip title={label}>{tip}</InfoTip>}</div>
            <div className={`font-mono font-bold text-sm ${tone || 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
        </div>
    );
}

/** Everything about one stock: chart, why, analysts, timing, fundamentals. */
function StockDetail({ stock, market, onClose }) {
    const cur = stock.currency || (market === 'IN' ? 'INR' : 'USD');
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{stock.symbol}</h2>
                        <StatusBadge status={stock.investment_status} />
                        <AgentTag stock={stock} compact />
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{stock.name}{stock.sector ? ` · ${stock.sector}` : ''}</div>
                </div>
                <div className="text-right shrink-0">
                    <div className="font-mono text-lg font-bold text-slate-900 dark:text-white">{formatMoney(stock.current_price, cur, 2)}</div>
                    <div className="flex items-center gap-1 justify-end mt-1">
                        <a href={tradingViewUrl(stock.symbol, market)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 h-11 sm:h-auto px-2.5 sm:py-1 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700">
                            TradingView <ExternalLink size={11} />
                        </a>
                        {onClose && <button onClick={onClose} aria-label="Close" className="w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"><X size={16} /></button>}
                    </div>
                </div>
            </div>
            <MiniStockChart symbol={stock.symbol} market={market} height={220} />
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
                <div className="font-semibold text-slate-900 dark:text-white mb-1">Why {stock.investment_status}</div>
                {stock.action_reason}
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400"><b>Timing:</b> {stock.execution_timing || 'N/A'}</div>
            </div>
            <AnalystTarget stock={stock} />
            <HoldingPeriod stock={stock} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Metric label="ROE" value={stock.roe != null ? `${stock.roe.toFixed(1)}%` : '—'} tip={ROE_TIP} />
                <Metric label="F-Score" value={fScoreText(stock)} tip={FSCORE_TIP} />
                <Metric label="Margin of safety" value={mosText(stock)} tone={mosClass(stock)} tip={MOS_TIP} />
                <Metric label="Revenue growth" value={pctText(stock.revenue_growth)} />
                <Metric label="EPS growth" value={pctText(stock.eps_growth)} />
                <Metric label="Gross margin" value={stock.gross_margin != null ? `${stock.gross_margin.toFixed(1)}%` : '—'} />
                <Metric label="Debt / equity" value={stock.debt_to_equity != null ? stock.debt_to_equity.toFixed(2) : '—'} />
                <Metric label="PEG" value={stock.peg != null ? stock.peg.toFixed(2) : '—'} />
                <Metric label="RSI (daily)" value={stock.trend?.rsi14 != null ? Math.round(stock.trend.rsi14) : '—'} />
            </div>
            {stock.f_score_note && <p className="text-[11px] text-amber-700 dark:text-amber-400">{stock.f_score_note}</p>}
        </div>
    );
}

export default function InvestmentScreener({ market = 'IN', onSource }) {
    const [stocks, setStocks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showConfig, setShowConfig] = useState(false);
    const [criteria, setCriteria] = useState(() => savedCriteria() || DEFAULT_CRITERIA);
    const [snapshotAt, setSnapshotAt] = useState(null);
    const [source, setSource] = useState(null);
    const liveBase = useLiveApiBase();
    const [filter, setFilter] = useState(() => { try { return localStorage.getItem('screenerFilter') || 'passing'; } catch { return 'passing'; } });
    const [sort, setSort] = useState({ key: 'upside', dir: -1 });
    const [selected, setSelected] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Top 5 opens as a full page; '#top5' lets the back button return here
    const [showTopPicks, setShowTopPicks] = useState(() => window.location.hash === '#top5');
    const openTopPicks = () => { if (window.location.hash !== '#top5') window.history.pushState(null, '', '#top5'); setShowTopPicks(true); };
    const closeTopPicks = () => { if (window.location.hash === '#top5') window.history.back(); else setShowTopPicks(false); };
    useEffect(() => {
        const onPop = () => setShowTopPicks(window.location.hash === '#top5');
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const chooseFilter = (f) => { setFilter(f); try { localStorage.setItem('screenerFilter', f); } catch { /* ignore */ } };

    const fetchScreenerData = async (crit = criteria) => {
        setLoading(true);
        setError(null);
        try {
            const { source: src, body } = await getData(`/api/investment/screener?market=${market}`, `screener-${market}.json`,
                b => Array.isArray(b?.data) && b.data.length > 0);
            setStocks((body.data || []).map(s => applyCriteria(s, crit)));
            setSnapshotAt(body.generated_at);
            setSource(src);
            onSource?.(src);
        } catch (err) {
            setStocks([]);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchScreenerData(); }, [market, liveBase]);
    useEffect(() => {
        if (source !== 'live') return undefined;
        const id = setInterval(() => fetchScreenerData(), LIVE_REFRESH_MS);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, market, criteria]);

    const analyzeStock = async (symbol) => {
        if (!symbol) return;
        setIsAnalyzing(true);
        setError(null);
        try {
            if (!hasLiveApi()) throw new Error(`${symbol.toUpperCase()} isn't in the published list. Analysing any symbol needs live data (the Snapshot button at the top).`);
            const data = await liveJson(`/api/investment/analyze/${encodeURIComponent(symbol.toUpperCase())}?market=${market}`);
            const row = applyCriteria(data.data, criteria);
            setStocks(prev => [row, ...prev.filter(s => s.symbol !== row.symbol)]);
            setSelected(row.symbol);
            chooseFilter('all');
            setSearchQuery('');
        } catch (err) {
            setError(err.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Suggestions: the live API's search, else the loaded list
    useEffect(() => {
        if (searchQuery.length < 2) { setSuggestions([]); return undefined; }
        const timer = setTimeout(async () => {
            try {
                if (hasLiveApi()) {
                    const data = await liveJson(`/api/investment/search?q=${encodeURIComponent(searchQuery)}&market=${market}`);
                    setSuggestions(data.data || []);
                } else {
                    const q = searchQuery.toLowerCase();
                    setSuggestions(stocks.filter(s => s.symbol.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q))
                        .slice(0, 8).map(s => ({ symbol: s.symbol, name: s.name, exchange: market === 'IN' ? 'NSE' : '' })));
                }
            } catch { setSuggestions([]); }
        }, 250);
        return () => clearTimeout(timer);
    }, [searchQuery, market, stocks]);

    const pickSuggestion = (symbol) => {
        setShowSuggestions(false);
        const hit = stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
        if (hit) { setSelected(hit.symbol); setSearchQuery(''); if (!FILTERS.find(f => f[0] === filter)[2](hit)) chooseFilter('all'); }
        else analyzeStock(symbol);
    };

    const counts = Object.fromEntries(FILTERS.map(([k, , fn]) => [k, stocks.filter(fn).length]));
    const q = searchQuery.trim().toLowerCase();
    const col = COLUMNS.find(c => c[0] === sort.key);
    const rows = stocks
        .filter(FILTERS.find(f => f[0] === filter)?.[2] || (() => true))
        .filter(s => !q || s.symbol.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q))
        .sort((a, b) => {
            const va = col[2](a), vb = col[2](b);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
        });
    const selStock = stocks.find(s => s.symbol === selected) || null;
    const cur = (s) => s.currency || (market === 'IN' ? 'INR' : 'USD');
    const toggleSort = (key) => setSort(s => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'symbol' ? 1 : -1 }));

    if (showTopPicks) {
        return <div className="max-w-[1600px] mx-auto p-3 md:p-5"><TopPicksPage market={market} onBack={closeTopPicks} /></div>;
    }

    return (
        <div className="max-w-[1600px] mx-auto p-3 md:p-5">
            {/* Title + actions */}
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">{market === 'IN' ? 'NIFTY 50' : 'US large caps'} · long-term screener</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>Quality (ROE, Piotroski F-Score) + value (margin of safety to analysts’ target) + trend.</span>
                        {snapshotAt && <span title={new Date(snapshotAt).toLocaleString()}>{source === 'live' ? 'Live prices' : 'Snapshot'} · updated {ageText(snapshotAt)}</span>}
                        <button onClick={() => fetchScreenerData()} className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" aria-label="Refresh">
                            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={openTopPicks} className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
                        <Trophy size={15} /> Top 5 to invest
                    </button>
                    <button onClick={() => setShowConfig(true)} aria-label="My criteria" className="inline-flex items-center justify-center gap-1.5 h-11 min-w-[44px] sm:h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold">
                        <Settings2 size={15} /> <span className="hidden sm:inline">My criteria</span>
                    </button>
                </div>
            </div>

            {/* Summary tiles double as filters */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3" role="tablist" aria-label="Filter">
                {FILTERS.map(([key, label]) => (
                    <button key={key} role="tab" aria-selected={filter === key} onClick={() => chooseFilter(key)}
                        className={`text-left rounded-xl border px-3 py-2 transition-colors ${filter === key
                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-cardbg hover:border-slate-300 dark:hover:border-slate-600'}`}>
                        <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">{loading && !stocks.length ? '·' : counts[key]}</div>
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">{label}</div>
                    </button>
                ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                Your criteria: ROE ≥ {criteria.roe_min}% · F-Score ≥ {criteria.f_score_min}/9 · margin of safety ≥ {criteria.margin_of_safety_min}%.
                {' '}<b>Buy now</b> = passes and the trend is up; <b>Buy on dip</b> = passes, wait for the trend.
            </p>

            {/* Search */}
            <div className="relative mb-3 max-w-md">
                <Search size={15} className="absolute left-2.5 top-3.5 sm:top-2.5 text-slate-400" />
                <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)} onFocus={() => setShowSuggestions(true)}
                    onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim()) pickSuggestion(suggestions[0]?.symbol || searchQuery.trim()); }}
                    placeholder={`Find a stock (${market === 'IN' ? 'e.g. RELIANCE, TCS' : 'e.g. AAPL, NVDA'})`}
                    className="w-full h-11 sm:h-9 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg max-h-64 overflow-y-auto">
                        {suggestions.map(sg => (
                            <button key={sg.symbol} onMouseDown={() => pickSuggestion(sg.symbol)} className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex justify-between gap-2">
                                <span className="font-semibold text-sm">{sg.symbol}</span><span className="text-xs text-slate-500 truncate">{sg.name}</span>
                            </button>
                        ))}
                    </div>
                )}
                {isAnalyzing && <p className="text-xs text-slate-500 mt-1">Analysing…</p>}
            </div>

            {error && (
                <div className="mb-3 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-400 flex gap-2">
                    <AlertCircle size={17} className="shrink-0" /> {error}
                </div>
            )}

            <div className="flex gap-4 items-start">
                {/* Table (desktop) */}
                <div className="flex-1 min-w-0">
                    <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-cardbg overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {COLUMNS.map(([key, label, , align, tip]) => (
                                        <th key={key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
                                            <button onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200" aria-label={`Sort by ${label}`}>
                                                {label}{sort.key === key ? (sort.dir < 0 ? <ArrowDown size={11} /> : <ArrowUp size={11} />) : <ArrowUpDown size={11} className="opacity-40" />}
                                            </button>
                                            {tip && typeof tip !== 'string' && <InfoTip title={label}>{tip}</InfoTip>}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {loading && !stocks.length ? (
                                    <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-slate-500">Loading…</td></tr>
                                ) : rows.length === 0 ? (
                                    <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-slate-500">
                                        {q ? <>No match for “{searchQuery}”. <button className="underline" onClick={() => analyzeStock(searchQuery)}>Analyse {searchQuery.toUpperCase()}</button></>
                                            : stocks.length ? <>Nothing in “{FILTERS.find(f => f[0] === filter)[1]}” right now. <button className="underline" onClick={() => chooseFilter('all')}>Show all {stocks.length}</button></> : 'No stocks loaded.'}
                                    </td></tr>
                                ) : rows.map(s => (
                                    <tr key={s.symbol} onClick={() => setSelected(sel => (sel === s.symbol ? null : s.symbol))}
                                        className={`cursor-pointer border-b border-slate-100 dark:border-slate-800/60 ${selected === s.symbol ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
                                        <td className="px-3 py-2">
                                            <div className="font-bold text-slate-900 dark:text-white">{s.symbol}</div>
                                            <div className="text-[11px] text-slate-500 truncate max-w-[180px]">{s.name}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{formatMoney(s.current_price, cur(s), 2)}</td>
                                        <td className="px-3 py-2"><StatusBadge status={s.investment_status} /></td>
                                        <td className={`px-3 py-2 text-right font-mono ${s.upside_pct > 0 ? 'text-green-600 dark:text-green-400' : s.upside_pct < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>{pctText(s.upside_pct)}</td>
                                        <td className={`px-3 py-2 text-right font-mono ${mosClass(s)}`}>{mosText(s)}</td>
                                        <td className={`px-3 py-2 text-right font-mono ${s.roe >= criteria.roe_min ? 'text-green-600 dark:text-green-400' : ''}`}>{s.roe != null ? `${s.roe.toFixed(1)}%` : '—'}</td>
                                        <td className="px-3 py-2 text-right font-mono">{fScoreText(s)}</td>
                                        <td className="px-3 py-2"><Trend stock={s} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Cards (phone) */}
                    <div className="md:hidden flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            Sort
                            <select value={sort.key} onChange={e => setSort({ key: e.target.value, dir: e.target.value === 'symbol' ? 1 : -1 })}
                                className="h-11 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-sm">
                                {COLUMNS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                            </select>
                        </div>
                        {loading && !stocks.length && <div className="p-6 text-center text-slate-500">Loading…</div>}
                        {!loading && rows.length === 0 && <div className="p-6 text-center text-slate-500">Nothing here. <button className="underline" onClick={() => chooseFilter('all')}>Show all</button></div>}
                        {rows.map(s => (
                            <button key={s.symbol} onClick={() => setSelected(s.symbol)}
                                className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-cardbg p-3 active:bg-slate-50 dark:active:bg-slate-800">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0"><div className="font-bold text-slate-900 dark:text-white">{s.symbol}</div><div className="text-[11px] text-slate-500 truncate">{s.name}</div></div>
                                    <div className="text-right"><div className="font-mono font-bold">{formatMoney(s.current_price, cur(s), 2)}</div><StatusBadge status={s.investment_status} /></div>
                                </div>
                                <div className="mt-2 grid grid-cols-4 gap-1 text-[11px]">
                                    <span><span className="text-slate-500">Upside </span><b className={s.upside_pct > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{pctText(s.upside_pct, 0)}</b></span>
                                    <span><span className="text-slate-500">MoS </span><b className={mosClass(s)}>{hasMos(s) ? `${Math.round(s.margin_of_safety)}%` : 'N/A'}</b></span>
                                    <span><span className="text-slate-500">ROE </span><b>{s.roe != null ? `${Math.round(s.roe)}%` : '—'}</b></span>
                                    <span><span className="text-slate-500">F </span><b>{fScoreText(s)}</b></span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Detail: side panel on desktop */}
                {selStock && (
                    <aside className="hidden md:block w-[440px] shrink-0 sticky top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-cardbg p-4">
                        <StockDetail stock={selStock} market={market} onClose={() => setSelected(null)} />
                    </aside>
                )}
            </div>
            {!selStock && rows.length > 0 && <p className="hidden md:block mt-2 text-[11px] text-slate-500 dark:text-slate-400">Click a stock for its chart, the reasoning and the analysts’ target. Click a column to sort.</p>}

            {/* Detail: bottom sheet on phones */}
            {selStock && (
                <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={() => setSelected(null)}>
                    <div className="max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-white dark:bg-cardbg px-4 pb-6 pt-2 pb-safe" onClick={e => e.stopPropagation()}>
                        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
                        <StockDetail stock={selStock} market={market} onClose={() => setSelected(null)} />
                    </div>
                </div>
            )}

            {showConfig && (
                <CriteriaConfigModal currentCriteria={criteria} onClose={() => setShowConfig(false)}
                    onSave={(c) => { setCriteria(c); setShowConfig(false); fetchScreenerData(c); }} />
            )}
        </div>
    );
}
