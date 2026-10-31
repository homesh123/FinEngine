import React, { useState, useEffect } from 'react';
import ChartLinkButton from './ChartLinkButton';
import MiniStockChart from './MiniStockChart';
import { Settings2, RefreshCw, AlertCircle, Trophy } from 'lucide-react';
import CriteriaConfigModal from './CriteriaConfigModal';
import InfoTip from './InfoTip';
import TopPicksPage from './TopPicksPage';
import { formatMoney } from '../utils/money';
import { ageText, getData, hasLiveApi, liveJson } from '../utils/dataSource';
import { applyCriteria, DEFAULT_CRITERIA, savedCriteria } from '../utils/screenerRules';

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
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Horizon: {stock.holding_horizon}</span>
        ) : null;
    }
    return (
        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium
                          bg-slate-50 border-slate-200 text-slate-700
                          dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
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
            className={`inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 font-semibold ${compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'}`}>
            🤖 Agent suggested{!compact && <span className="opacity-70">{Math.round((a.confidence || 0) * 100)}%</span>}
        </span>
    );
}

export default function InvestmentScreener() {
    const [stocks, setStocks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showConfig, setShowConfig] = useState(false);
    // India / US toggle (remembered per browser)
    const [market, setMarket] = useState(() => {
        try { return localStorage.getItem('screenerMarket') === 'IN' ? 'IN' : 'US'; } catch { return 'US'; }   // US by default
    });
    const [chartOf, setChartOf] = useState(null);       // stock whose chart shows beside the list
    const toggleChart = (sym) => setChartOf(c => (c === sym ? null : sym));
    const changeMarket = (m) => {
        if (m === market) return;
        try { localStorage.setItem('screenerMarket', m); } catch { /* storage unavailable */ }
        setStocks([]);
        setSearchQuery('');
        setSuggestions([]);
        setChartOf(null);
        setMarket(m);
    };

    // Top 5 opens as a full page; '#top5' in the URL lets the browser/phone
    // back button return to the screener (and allows linking to /invest#top5).
    const [showTopPicks, setShowTopPicks] = useState(() => window.location.hash === '#top5');
    const openTopPicks = () => {
        if (window.location.hash !== '#top5') window.history.pushState(null, '', '#top5');
        setShowTopPicks(true);
    };
    const closeTopPicks = () => {
        if (window.location.hash === '#top5') window.history.back();
        else setShowTopPicks(false);
    };
    useEffect(() => {
        const onPop = () => setShowTopPicks(window.location.hash === '#top5');
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);
    const [criteria, setCriteria] = useState(() => savedCriteria() || DEFAULT_CRITERIA);
    const [snapshotAt, setSnapshotAt] = useState(null);   // when the published snapshot was built
    const [searchQuery, setSearchQuery] = useState("");
    const [agentOnly, setAgentOnly] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearching, setIsSearching] = useState(false);

    const fetchScreenerData = async (crit = criteria) => {
        setLoading(true);
        setError(null);
        try {
            const { source, body } = await getData(`/api/investment/screener?market=${market}`, `screener-${market}.json`);
            const rows = body.data || [];
            // The snapshot has raw metrics only; statuses come from the criteria saved in this browser
            setStocks(source === 'live' ? rows : rows.map(s => applyCriteria(s, crit)));
            setSnapshotAt(source === 'live' ? null : body.generated_at);
            if (source === 'live') {
                const critData = await liveJson('/api/investment/criteria').catch(() => null);
                if (critData) setCriteria(critData);
            }
        } catch (err) {
            setStocks([]);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const analyzeStock = async (symbol) => {
        if (!symbol) return;
        setIsAnalyzing(true);
        setError(null);
        try {
            if (!hasLiveApi()) {
                throw new Error(`${symbol.toUpperCase()} isn't in the published snapshot. Analysing any symbol on demand needs a live backend (set VITE_API_BASE) — add it to the universe in scripts/screener.py to include it in the snapshot.`);
            }
            const data = await liveJson(`/api/investment/analyze/${encodeURIComponent(symbol.toUpperCase())}?market=${market}`);
            
            // Check if already in list and update, otherwise add
            setStocks(prev => {
                const existingIdx = prev.findIndex(s => s.symbol === data.data.symbol);
                if (existingIdx >= 0) {
                    const newStocks = [...prev];
                    newStocks[existingIdx] = data.data;
                    return newStocks;
                }
                return [data.data, ...prev];
            });
            setSearchQuery(""); // Clear search to show the result
        } catch (err) {
            setError(err.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    useEffect(() => {
        fetchScreenerData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market]);

    useEffect(() => {
        if (!searchQuery || searchQuery.length < 2) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            try {
                if (hasLiveApi()) {
                    const data = await liveJson(`/api/investment/search?q=${encodeURIComponent(searchQuery)}&market=${market}`);
                    setSuggestions(data.data || []);
                } else {
                    const q = searchQuery.toLowerCase();   // static site: search the snapshot's stocks
                    setSuggestions(stocks.filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
                        .slice(0, 8).map(s => ({ symbol: s.symbol, name: s.name, exchange: market === 'IN' ? 'NSE' : '' })));
                }
                setShowSuggestions(true);
            } catch (err) {
                console.error("Failed to fetch suggestions", err);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery, market, stocks]);

    const handleSuggestionClick = (symbol) => {
        setSearchQuery(symbol);
        setShowSuggestions(false);
        // Automatically trigger analyze if it's not already in the table
        const exists = stocks.some(s => s.symbol.toUpperCase() === symbol.toUpperCase());
        if (!exists) {
            analyzeStock(symbol);
        }
    };

    const getStatusColor = (status) => {
        if (status.includes('BUY')) return 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400';
        if (status.includes('SELL')) return 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400';
        return 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400';
    };

    const filteredStocks = stocks.filter((stock) =>
        (!agentOnly || stock.agent?.suggested) && (
        stock.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (stock.name || '').toLowerCase().includes(searchQuery.toLowerCase()))
    );
    const agentCount = stocks.filter(s => s.agent?.suggested).length;

    if (showTopPicks) {
        return (
            <div className="flex-1 overflow-auto bg-white dark:bg-darkbg p-3 md:p-6">
                <TopPicksPage market={market} onBack={closeTopPicks} />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto bg-white dark:bg-darkbg p-3 md:p-6">
            <div className="w-full">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 md:mb-6">
                    <div className="flex flex-col gap-2">
                        <h1 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100">Stock Investment Screener</h1>
                        {snapshotAt && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400" title={new Date(snapshotAt).toLocaleString()}>
                                Data snapshot from {ageText(snapshotAt)} · refreshed daily by GitHub Actions from Yahoo Finance
                            </p>
                        )}
                        {/* Market toggle */}
                        <div role="radiogroup" aria-label="Market" className="inline-flex self-start p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            {[{ id: 'IN', label: '🇮🇳 India' }, { id: 'US', label: '🇺🇸 US' }].map(m => (
                                <button
                                    key={m.id}
                                    role="radio"
                                    aria-checked={market === m.id}
                                    onClick={() => changeMarket(m.id)}
                                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                                        market === m.id
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                    }`}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        {market === 'IN' && stocks.some(s => s.agent) && (
                            <label className="inline-flex items-center gap-2 self-start text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                                <input type="checkbox" checked={agentOnly} onChange={e => setAgentOnly(e.target.checked)} className="w-3.5 h-3.5 accent-violet-600" />
                                🤖 Agent suggested only <span className="text-slate-400">({agentCount} of {stocks.length})</span>
                                <span className="text-slate-400 hidden md:inline">· our own model on daily candles says BUY with a tested edge; updated daily</span>
                            </label>
                        )}
                    </div>
                    <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full md:w-auto">
                        <div className="relative flex-1 sm:flex-none">
                            <input 
                                type="text"
                                placeholder="Search symbol or name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => {
                                    if (suggestions.length > 0) setShowSuggestions(true);
                                }}
                                onBlur={() => {
                                    // Delay hide to allow click on suggestion
                                    setTimeout(() => setShowSuggestions(false), 200);
                                }}
                                className="w-full px-3 py-2 pl-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            />
                            <svg className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            
                            {/* Auto-suggest Dropdown */}
                            {showSuggestions && (
                                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-lg max-h-60 overflow-y-auto">
                                    {isSearching && suggestions.length === 0 ? (
                                        <div className="px-4 py-2 text-sm text-slate-500">Searching...</div>
                                    ) : suggestions.length > 0 ? (
                                        suggestions.map((s, i) => (
                                            <div 
                                                key={i} 
                                                className="px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-700/50 last:border-0"
                                                onClick={() => handleSuggestionClick(s.symbol)}
                                            >
                                                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">{s.symbol}</div>
                                                <div className="text-xs text-slate-500 flex justify-between">
                                                    <span className="truncate">{s.name}</span>
                                                    <span className="ml-2 font-mono">{s.exchange}</span>
                                                </div>
                                            </div>
                                        ))
                                    ) : null}
                                </div>
                            )}
                        </div>
                        <button
                            onClick={openTopPicks}
                            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm font-semibold transition-colors shadow-sm"
                        >
                            <Trophy size={16} />
                            Top 5 to Invest
                        </button>
                        <button 
                            onClick={() => fetchScreenerData()}
                            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-semibold transition-colors"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                        <button 
                            onClick={() => setShowConfig(true)}
                            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm font-semibold transition-colors shadow-sm"
                        >
                            <Settings2 size={16} />
                            Criteria Config
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
                        <AlertCircle className="text-red-500 mt-0.5" size={20} />
                        <div>
                            <h3 className="text-red-800 dark:text-red-400 font-bold text-sm">Error Loading Data</h3>
                            <p className="text-red-600 dark:text-red-500 text-xs mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {/* Phones: the chosen stock's chart above the list */}
                {chartOf && <div className="md:hidden mb-3"><MiniStockChart symbol={chartOf} market={market} onClose={() => setChartOf(null)} height={240} /></div>}

                {/* Desktop Table View, with the chosen stock's chart beside it */}
                <div className="hidden md:flex gap-4 items-start">
                <div className="flex-1 min-w-0 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                                    <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Symbol / Name</th>
                                    <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Price</th>
                                    <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">ROE (%)<InfoTip title="ROE (Return on Equity)">{ROE_TIP}</InfoTip></th>
                                    <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">F-Score<InfoTip title="F-Score (Piotroski)">{FSCORE_TIP}</InfoTip></th>
                                    <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Margin of Safety<InfoTip title="Margin of Safety">{MOS_TIP}</InfoTip></th>
                                    <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Action & Timing</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && stocks.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-slate-500">Loading screener data...</td>
                                    </tr>
                                ) : (() => {
                                    if (filteredStocks.length === 0 && stocks.length === 0 && !searchQuery) {
                                        return (
                                            <tr>
                                                <td colSpan="6" className="p-8 text-center text-slate-500">No stocks match the current criteria.</td>
                                            </tr>
                                        );
                                    }
                                    
                                    if (filteredStocks.length === 0) {
                                        return (
                                            <tr>
                                                <td colSpan="6" className="p-8 text-center">
                                                    <p className="text-slate-500 mb-4">No stocks in the default list match "{searchQuery}".</p>
                                                    {searchQuery.length > 0 && (
                                                        <button 
                                                            onClick={() => analyzeStock(searchQuery)}
                                                            disabled={isAnalyzing}
                                                            className="inline-flex justify-center items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-semibold transition-colors disabled:opacity-50"
                                                        >
                                                            {isAnalyzing ? (
                                                                <><RefreshCw size={16} className="animate-spin" /> Analyzing...</>
                                                            ) : (
                                                                <>Analyze "{searchQuery.toUpperCase()}"</>
                                                            )}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    }
                                    
                                    return filteredStocks.map((stock, idx) => (
                                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                            <td className="p-2 md:p-4">
                                                <div className="font-bold text-slate-800 dark:text-slate-200 text-xs md:text-base flex items-center gap-1.5">{stock.symbol}<ChartLinkButton symbol={stock.symbol} market={market} compact active={chartOf === stock.symbol} onOpen={() => toggleChart(stock.symbol)} /></div>
                                                <div className="text-[10px] md:text-xs text-slate-500 truncate max-w-[80px] md:max-w-[200px]">{stock.name}</div>
                                            </td>
                                            <td className="p-2 md:p-4 text-right font-mono text-xs md:text-sm text-slate-700 dark:text-slate-300">
                                                {formatMoney(stock.current_price, stock.currency || 'INR', 2)}
                                            </td>
                                            <td className="p-2 md:p-4 text-right">
                                                <span className={`text-xs md:text-sm font-semibold ${stock.roe >= (criteria.roe_min || 15) ? 'text-green-600 dark:text-green-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    {stock.roe.toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="p-2 md:p-4 text-right">
                                                <span className="text-xs md:text-sm font-bold text-slate-700 dark:text-slate-300">{fScoreText(stock)}</span>
                                                {stock.f_score_note && (
                                                    <div className="text-[9px] text-amber-600 dark:text-amber-400">{stock.f_score_note}</div>
                                                )}
                                            </td>
                                            <td className="p-2 md:p-4 text-right">
                                                <span className={`text-xs md:text-sm font-semibold ${mosClass(stock)}`}>
                                                    {mosText(stock)}
                                                </span>
                                            </td>
                                            <td className="p-2 md:p-4">
                                                <div className="flex flex-col items-start gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(stock.investment_status)}`}>
                                                            {stock.investment_status}
                                                        </span>
                                                        <HoldingPeriod stock={stock} />
                                                        <AgentTag stock={stock} />
                                                    </div>
                                                    <div className="mt-1"><AnalystTarget stock={stock} /></div>
                                                    <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold mt-1">
                                                        Timing: {stock.execution_timing || "N/A"}
                                                    </span>
                                                    <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">
                                                        <span className="font-semibold text-slate-600 dark:text-slate-300">Why: </span>{stock.action_reason}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    ));
                                })()}
                            </tbody>
                        </table>
                    </div>
                </div>
                {chartOf && <div className="w-[45%] shrink-0 sticky top-0"><MiniStockChart symbol={chartOf} market={market} onClose={() => setChartOf(null)} height={360} /></div>}
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden flex flex-col gap-3">
                    {loading && stocks.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">Loading screener data...</div>
                    ) : filteredStocks.length === 0 && stocks.length === 0 && !searchQuery ? (
                        <div className="p-8 text-center text-slate-500">No stocks match the current criteria.</div>
                    ) : filteredStocks.length === 0 ? (
                        <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                            <p className="text-slate-500 mb-4">No stocks in the default list match "{searchQuery}".</p>
                            {searchQuery.length > 0 && (
                                <button 
                                    onClick={() => analyzeStock(searchQuery)}
                                    disabled={isAnalyzing}
                                    className="inline-flex justify-center items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-semibold transition-colors disabled:opacity-50"
                                >
                                    {isAnalyzing ? (
                                        <><RefreshCw size={16} className="animate-spin" /> Analyzing...</>
                                    ) : (
                                        <>Analyze "{searchQuery.toUpperCase()}"</>
                                    )}
                                </button>
                            )}
                        </div>
                    ) : (
                        filteredStocks.map((stock, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-900 rounded-lg p-3 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-2 relative">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1 pr-2">
                                        <div className="font-bold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-1.5">{stock.symbol}<ChartLinkButton symbol={stock.symbol} market={market} active={chartOf === stock.symbol} onOpen={() => { toggleChart(stock.symbol); window.scrollTo?.(0, 0); }} /></div>
                                        <div className="text-[10px] text-slate-500 line-clamp-1">{stock.name}</div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="font-mono font-bold text-sm text-slate-800 dark:text-slate-200">{formatMoney(stock.current_price, stock.currency || 'INR', 2)}</div>
                                        <span className={`px-2 py-0.5 mt-1 inline-block rounded text-[10px] font-bold ${getStatusColor(stock.investment_status)}`}>
                                            {stock.investment_status}
                                        </span>
                                        <div className="mt-1"><AgentTag stock={stock} compact /></div>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-100 dark:border-slate-800/80 mt-1">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">ROE<InfoTip title="ROE (Return on Equity)">{ROE_TIP}</InfoTip></span>
                                        <span className={`text-xs font-semibold ${stock.roe >= (criteria.roe_min || 15) ? 'text-green-600 dark:text-green-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {stock.roe.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="flex flex-col text-center border-x border-slate-100 dark:border-slate-800/80 px-1">
                                        <span className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">F-Score<InfoTip title="F-Score (Piotroski)">{FSCORE_TIP}</InfoTip></span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{fScoreText(stock)}</span>
                                        {stock.f_score_note && <span className="text-[9px] text-amber-600 dark:text-amber-400">{stock.f_score_note}</span>}
                                    </div>
                                    <div className="flex flex-col text-right">
                                        <span className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Margin of Safety<InfoTip title="Margin of Safety">{MOS_TIP}</InfoTip></span>
                                        <span className={`text-xs font-semibold ${mosClass(stock)}`}>
                                            {mosText(stock)}
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="flex flex-col gap-1.5 mt-1 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded border border-slate-100 dark:border-slate-700/30">
                                    <div className="flex justify-between items-center text-[10px] text-slate-600 dark:text-slate-400 font-medium">
                                        <span className="flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                                            Timing: {stock.execution_timing || "N/A"}
                                        </span>
                                    </div>
                                    <div className="flex flex-col items-start gap-1.5">
                                        <HoldingPeriod stock={stock} compact />
                                        <AnalystTarget stock={stock} />
                                    </div>
                                    <div className="text-[11px] text-slate-700 dark:text-slate-300 italic mt-0.5 leading-relaxed">
                                        <strong>Why:</strong> {stock.action_reason || "No explanation available for this stock."}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {showConfig && (
                <CriteriaConfigModal 
                    currentCriteria={criteria} 
                    onClose={() => setShowConfig(false)} 
                    onSave={(newCrit) => {
                        setCriteria(newCrit);
                        setShowConfig(false);
                        fetchScreenerData(newCrit); // re-screen with the new criteria
                    }} 
                />
            )}
        </div>
    );
}
