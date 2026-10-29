import React, { useState } from 'react';
import { ChevronUp, ChevronDown, ListOrdered, Briefcase, Activity, XCircle } from 'lucide-react';
import { tradingApi } from '../utils/tradingApi';

export default function Terminal({ trades, positions, activeAccount, onTradeClose }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('positions');

    const handleClosePosition = async (ticket, symbol) => {
        try {
            await tradingApi.close(activeAccount.id, ticket);
            if (onTradeClose) onTradeClose(ticket);
        } catch (error) {
            console.error("Failed to close position", error);
            alert("Failed to close position: " + error.message);
        }
    };

    return (
        <div className={`flex-col border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-darkbg z-30 ${!activeAccount ? 'hidden md:flex' : 'flex'}`}>
            <div className="flex items-center justify-between px-4 py-2 cursor-pointer bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <div className="flex items-center gap-6">
                    <div 
                        className={`flex items-center gap-2 text-sm font-semibold transition-colors ${activeTab === 'positions' && isOpen ? 'text-blue-500' : 'text-slate-700 dark:text-slate-300'}`}
                        onClick={() => { setActiveTab('positions'); setIsOpen(true); }}
                    >
                        <Briefcase className="w-4 h-4" />
                        <span>Positions ({positions.length})</span>
                    </div>
                    <div 
                        className={`flex items-center gap-2 text-sm font-semibold transition-colors ${activeTab === 'history' && isOpen ? 'text-blue-500' : 'text-slate-700 dark:text-slate-300'}`}
                        onClick={() => { setActiveTab('history'); setIsOpen(true); }}
                    >
                        <ListOrdered className="w-4 h-4" />
                        <span>Trade History ({trades.length})</span>
                    </div>
                    <div 
                        className={`flex items-center gap-2 text-sm font-semibold transition-colors ${activeTab === 'risk' && isOpen ? 'text-blue-500' : 'text-slate-700 dark:text-slate-300'}`}
                        onClick={() => { setActiveTab('risk'); setIsOpen(true); }}
                    >
                        <Activity className="w-4 h-4" />
                        <span>Risk Dashboard</span>
                    </div>
                </div>
                <div onClick={() => setIsOpen(!isOpen)}>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500 hover:text-slate-700" /> : <ChevronUp className="w-4 h-4 text-slate-500 hover:text-slate-700" />}
                </div>
            </div>

            {isOpen && (
                <div className="overflow-x-auto overflow-y-auto max-h-72 md:max-h-96 text-sm bg-white dark:bg-darkbg">
                    {activeTab === 'positions' && (
                        positions.length === 0 ? (
                            <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                                No active positions.
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse min-w-[720px]">
                                <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0">
                                    <tr>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Ticket</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Symbol</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Type</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Volume</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Open Price</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">S/L</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">T/P</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Profit</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {positions.map((pos, i) => (
                                        <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <td className="py-2 px-3 text-slate-500 text-xs font-mono">{pos.ticket}</td>
                                            <td className="py-2 px-3 font-semibold text-slate-700 dark:text-slate-300">{pos.symbol}</td>
                                            <td className={`py-2 px-3 font-bold ${pos.type === 'BUY' ? 'text-blue-500' : 'text-red-500'}`}>
                                                {pos.type}
                                            </td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{pos.volume}</td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{parseFloat(pos.open_price).toFixed(5)}</td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{pos.sl > 0 ? parseFloat(pos.sl).toFixed(5) : '-'}</td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{pos.tp > 0 ? parseFloat(pos.tp).toFixed(5) : '-'}</td>
                                            <td className={`py-2 px-3 font-semibold ${pos.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {pos.profit >= 0 ? '+' : ''}{parseFloat(pos.profit).toFixed(2)}
                                            </td>
                                            <td className="py-2 px-3 text-right">
                                                <button 
                                                    onClick={() => handleClosePosition(pos.ticket, pos.symbol)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Close Position"
                                                >
                                                    <XCircle className="w-5 h-5" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )
                    )}

                    {activeTab === 'history' && (
                        trades.length === 0 ? (
                            <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                                No trades recorded in this session.
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse min-w-[600px]">
                                <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0">
                                    <tr>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Time</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Symbol</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Type</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Volume</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Price</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">S/L</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">T/P</th>
                                        <th className="py-2 px-3 text-slate-600 dark:text-slate-400 font-medium text-xs">Ticket</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trades.map((trade, i) => (
                                        <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                                                {new Date(trade.time).toLocaleTimeString([], { hour12: false })}
                                            </td>
                                            <td className="py-2 px-3 font-semibold text-slate-700 dark:text-slate-300">{trade.symbol}</td>
                                            <td className={`py-2 px-3 font-bold ${trade.type.toLowerCase() === 'buy' ? 'text-blue-500' : 'text-red-500'}`}>
                                                {trade.type.toUpperCase()}
                                            </td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{trade.volume}</td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{trade.price ? parseFloat(trade.price).toFixed(5) : '-'}</td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{trade.sl ? parseFloat(trade.sl).toFixed(5) : '-'}</td>
                                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{trade.tp ? parseFloat(trade.tp).toFixed(5) : '-'}</td>
                                            <td className="py-2 px-3 text-slate-500 text-xs font-mono">{trade.ticket}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )
                    )}

                    {activeTab === 'risk' && (
                        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded shadow-sm border border-slate-100 dark:border-slate-700">
                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Account Equity</div>
                                <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                    {activeAccount && activeAccount.metrics ? `$${activeAccount.metrics.equity.toFixed(2)}` : '-'}
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded shadow-sm border border-slate-100 dark:border-slate-700">
                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Daily P&L</div>
                                <div className={`text-lg font-bold ${activeAccount && activeAccount.metrics && activeAccount.metrics.daily_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {activeAccount && activeAccount.metrics ? `${activeAccount.metrics.daily_pnl >= 0 ? '+' : ''}$${activeAccount.metrics.daily_pnl.toFixed(2)}` : '-'}
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded shadow-sm border border-slate-100 dark:border-slate-700">
                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Floating P&L</div>
                                <div className={`text-lg font-bold ${activeAccount && activeAccount.metrics && activeAccount.metrics.floating_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {activeAccount && activeAccount.metrics ? `${activeAccount.metrics.floating_pnl >= 0 ? '+' : ''}$${activeAccount.metrics.floating_pnl.toFixed(2)}` : '-'}
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded shadow-sm border border-slate-100 dark:border-slate-700">
                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Drawdown %</div>
                                <div className={`text-lg font-bold ${activeAccount && activeAccount.metrics && activeAccount.metrics.loss_pct > (activeAccount.maxDailyDrawdown || 3) ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>
                                    {activeAccount && activeAccount.metrics ? `${activeAccount.metrics.loss_pct.toFixed(2)}% / ${activeAccount.maxDailyDrawdown || 3}% limit` : '-'}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
