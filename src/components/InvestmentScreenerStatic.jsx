import React, { useState, useEffect } from 'react';
import { RefreshCw, Settings, Search, ChevronDown, ChevronUp, TrendingUp, AlertTriangle, Plus, ArrowLeft } from 'lucide-react';
import MiniStockChart from './MiniStockChart';
import ChartLinkButton from './ChartLinkButton';
import InfoTip from './InfoTip';
import TopPicksPage from './TopPicksPage';
import CriteriaConfigModal from './CriteriaConfigModal';
import { formatMoney } from '../utils/money';

// Helper functions...
function FScore({ stock }) {
    if (stock.f_score == null && stock.f_score_points == null) return <span className="text-slate-400">-</span>;
    const pts = stock.f_score_points != null ? stock.f_score_points : stock.f_score;
    const tests = stock.f_score_tests != null ? stock.f_score_tests : 9;
    return (
        <span className="text-xs md:text-sm font-bold text-slate-700 dark:text-slate-300">
            {pts}/{tests}
            {stock.f_score_note && <div className="text-[9px] text-amber-600 dark:text-amber-400">{stock.f_score_note}</div>}
        </span>
    );
}

function MarginOfSafety({ stock }) {
    const hasMos = typeof stock.margin_of_safety === 'number';
    if (!hasMos) return <span className="text-slate-400">N/A</span>;
    const val = stock.margin_of_safety;
    const cls = val > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
    return <span className={`text-xs md:text-sm font-semibold ${cls}`}>{val > 0 ? '+' : ''}{val.toFixed(1)}%</span>;
}

function StatusBadge({ status }) {
    let cls = "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400";
    if (status && status.includes("BUY")) cls = "text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400";
    if (status && status.includes("SELL")) cls = "text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400";
    return <span className={`px-2 py-1 rounded text-xs font-bold ${cls}`}>{status || "N/A"}</span>;
}

function AnalystTarget({ stock }) {
    if (!stock.target_price || typeof stock.upside_pct !== 'number') {
        return <div className="text-[11px] text-slate-500 dark:text-slate-400">No analyst target available for this stock.</div>;
    }
    const up = stock.upside_pct;
    return (
        <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1 text-[11px] bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-200">
            <span className="font-semibold">Analysts' target</span>
            <span className="font-mono font-bold">{formatMoney(stock.target_price, stock.currency || 'INR')}</span>
            <span className={`font-bold ${up >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>({up >= 0 ? '+' : ''}{up.toFixed(1)}%)</span>
            <span className="text-indigo-700/80 dark:text-indigo-300/80">within 12 months · by {stock.target_by}</span>
        </div>
    );
}

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
    const [market, setMarket] = useState(() => {
        try { return localStorage.getItem('screenerMarket') === 'IN' ? 'IN' : 'US'; } catch { return 'US'; }
    });
    const [chartOf, setChartOf] = useState(null);
    const toggleChart = (sym) => setChartOf(c => (c === sym ? null : sym));
    const changeMarket = (m) => {
        if (m === market) return;
        try { localStorage.setItem('screenerMarket', m); } catch { }
        setStocks([]);
        setSearchQuery('');
        setSuggestions([]);
        setChartOf(null);
        setMarket(m);
    };

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

    const [criteria, setCriteria] = useState({});
    const [searchQuery, setSearchQuery] = useState("");
    const [agentOnly, setAgentOnly] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isSearching, setIsSearching] = useState(false);

    const fetchScreenerData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Try static JSON first (works on GitHub Pages without backend)
            const staticFile = market === 'IN' ? './screener_results.json' : './screener_results_us.json';
            const res = await fetch(staticFile, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                setStocks(Array.isArray(data) ? data : (data.data || []));
                setLoading(false);
                return;
            }
            // Fallback to API if available
            const apiRes = await fetch(`/api/investment/screener?market=${market}`, { cache: 'no-store' });
            if (!apiRes.ok) throw new Error('Failed to fetch screener data');
            const apiData = await apiRes.json();
            setStocks(apiData.data || []);
        } catch (err) {
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
            const res = await fetch(`/api/investment/analyze/${encodeURIComponent(symbol.toUpperCase())}?market=${market}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to analyze stock');
            setStocks(prev => {
                const existingIdx = prev.findIndex(s => s.symbol === data.data.symbol);
                if (existingIdx >= 0) {
                    const newStocks = [...prev];
                    newStocks[existingIdx] = data.data;
                    return newStocks;
                }
                return [data.data, ...prev];
            });
            setSearchQuery("");
        } catch (err) {
            setError(err.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    useEffect(() => {
        fetchScreenerData();
    }, [market]);

    // ... rest of component would be similar, simplified for brevity
    // For now, just return basic UI
    if (showTopPicks) {
        return <TopPicksPage market={market} onBack={closeTopPicks} />;
    }

    const filteredStocks = stocks.filter(s => {
        if (agentOnly && !(s.agent && s.agent.suggested)) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return s.symbol?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q);
        }
        return true;
    });

    return (
        <div className="flex-1 overflow-auto bg-white dark:bg-darkbg p-3 md:p-6">
            <div className="w-full">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 md:mb-6">
                    <div className="flex flex-col gap-2">
                        <h1 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100">Stock Investment Screener</h1>
                        <div role="radiogroup" aria-label="Market" className="inline-flex self-start p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            <button role="radio" aria-checked={market === 'IN'} onClick={() => changeMarket('IN')} className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${market === 'IN' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>🇮🇳 India</button>
                            <button role="radio" aria-checked={market === 'US'} onClick={() => changeMarket('US')} className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${market === 'US' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>🇺🇸 US</button>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full md:w-auto">
                        <button onClick={openTopPicks} className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm font-semibold transition-colors shadow-sm">
                            <TrendingUp size={16} />Top 5 to Invest
                        </button>
                        <button onClick={fetchScreenerData} className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-semibold transition-colors">
                            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />Refresh
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
                        <AlertTriangle className="text-red-500 mt-0.5" size={20} />
                        <div>
                            <h3 className="text-red-800 dark:text-red-400 font-bold text-sm">Error Loading Data</h3>
                            <p className="text-red-600 dark:text-red-500 text-xs mt-1">{error}</p>
                        </div>
                    </div>
                )}

                <div className="hidden md:flex gap-4 items-start">
                    <div className="flex-1 min-w-0 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                                        <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Symbol / Name</th>
                                        <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Price</th>
                                        <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">ROE (%)</th>
                                        <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">F-Score</th>
                                        <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Margin of Safety</th>
                                        <th className="p-2 md:p-4 text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Action & Timing</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && stocks.length === 0 ? (
                                        <tr><td colSpan="6" className="p-8 text-center text-slate-500">Loading screener data...</td></tr>
                                    ) : filteredStocks.length === 0 ? (
                                        <tr><td colSpan="6" className="p-8 text-center text-slate-500">No stocks match the current criteria.</td></tr>
                                    ) : (
                                        filteredStocks.map((stock, idx) => (
                                            <tr key={idx} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                <td className="p-2 md:p-4">
                                                    <div className="font-bold text-slate-800 dark:text-slate-200 text-xs md:text-base flex items-center gap-1.5">
                                                        {stock.symbol}
                                                        <ChartLinkButton symbol={stock.symbol} market={market} compact={true} active={chartOf === stock.symbol} onOpen={() => toggleChart(stock.symbol)} />
                                                    </div>
                                                    <div className="text-[10px] md:text-xs text-slate-500 truncate max-w-[80px] md:max-w-[200px]">{stock.name}</div>
                                                </td>
                                                <td className="p-2 md:p-4 text-right font-mono text-xs md:text-sm text-slate-700 dark:text-slate-300">{formatMoney(stock.current_price, stock.currency || (market === 'IN' ? 'INR' : 'USD'))}</td>
                                                <td className="p-2 md:p-4 text-right"><span className={`text-xs md:text-sm font-semibold ${stock.roe >= 15 ? "text-green-600 dark:text-green-400" : "text-slate-700 dark:text-slate-300"}`}>{stock.roe?.toFixed(1)}%</span></td>
                                                <td className="p-2 md:p-4 text-right"><FScore stock={stock} /></td>
                                                <td className="p-2 md:p-4 text-right"><MarginOfSafety stock={stock} /></td>
                                                <td className="p-2 md:p-4">
                                                    <div className="flex flex-col items-start gap-1">
                                                        <div className="flex items-center gap-2">
                                                            <StatusBadge status={stock.investment_status} />
                                                            <AnalystTarget stock={stock} />
                                                            <AgentTag stock={stock} />
                                                        </div>
                                                        <div className="mt-1"><AnalystTarget stock={stock} /></div>
                                                        <span className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold mt-1">Timing: {stock.execution_timing || "N/A"}</span>
                                                        <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 mt-0.5 max-w-md"><span className="font-semibold text-slate-600 dark:text-slate-300">Why: </span>{stock.action_reason}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {chartOf && (
                        <div className="w-[45%] shrink-0 sticky top-0">
                            <MiniStockChart symbol={chartOf} market={market} onClose={() => setChartOf(null)} height={360} />
                        </div>
                    )}
                </div>
            </div>
            {showConfig && <CriteriaConfigModal currentCriteria={criteria} onClose={() => setShowConfig(false)} onSave={(c) => { setCriteria(c); setShowConfig(false); fetchScreenerData(); }} />}
        </div>
    );
}
