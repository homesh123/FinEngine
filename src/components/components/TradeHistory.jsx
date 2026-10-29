import React, { useState } from 'react';
import { ChevronUp, ChevronDown, ListOrdered } from 'lucide-react';

export default function TradeHistory({ trades }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="flex flex-col border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-darkbg z-30">
            <div 
                className="flex items-center justify-between px-4 py-2 cursor-pointer bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    <ListOrdered className="w-4 h-4" />
                    <span>Trade History ({trades.length})</span>
                </div>
                <div>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronUp className="w-4 h-4 text-slate-500" />}
                </div>
            </div>

            {isOpen && (
                <div className="overflow-auto max-h-64 text-sm bg-white dark:bg-darkbg">
                    {trades.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                            No trades recorded in this session.
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0">
                                <tr>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">Time</th>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">Symbol</th>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">Type</th>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">Volume</th>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">Price</th>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">S/L</th>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">T/P</th>
                                    <th className="py-2 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">Ticket</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.map((trade, i) => (
                                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">
                                            {new Date(trade.time).toLocaleTimeString([], { hour12: false })}
                                        </td>
                                        <td className="py-2 px-4 font-semibold text-slate-700 dark:text-slate-300">{trade.symbol}</td>
                                        <td className={`py-2 px-4 font-bold ${trade.type.toLowerCase() === 'buy' ? 'text-blue-500' : 'text-red-500'}`}>
                                            {trade.type.toUpperCase()}
                                        </td>
                                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{trade.volume}</td>
                                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{trade.price ? parseFloat(trade.price).toFixed(5) : '-'}</td>
                                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{trade.sl ? parseFloat(trade.sl).toFixed(5) : '-'}</td>
                                        <td className="py-2 px-4 text-slate-700 dark:text-slate-300">{trade.tp ? parseFloat(trade.tp).toFixed(5) : '-'}</td>
                                        <td className="py-2 px-4 text-slate-500 text-xs font-mono">{trade.ticket}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
