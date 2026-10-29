import React, { useState, useEffect } from 'react';
import { fetchDOM } from '../utils/api';
import { Activity } from 'lucide-react';

export default function DOMPanel({ symbol, currentPrice, tickSize }) {
    const [domData, setDomData] = useState({ bids: [], asks: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        let interval;

        const loadDOM = async () => {
            try {
                const data = await fetchDOM(symbol);
                if (isMounted) {
                    setDomData(data);
                    setLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err.message);
                    setLoading(false);
                }
            }
        };

        setLoading(true);
        loadDOM();

        interval = setInterval(loadDOM, 1000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [symbol]);

    if (loading && domData.bids.length === 0 && domData.asks.length === 0) {
        return (
            <div className="w-64 h-full bg-slate-50 dark:bg-cardbg border-l border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center p-4">
                <Activity className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                <span className="text-xs text-slate-500 font-semibold">Loading DOM...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-64 h-full bg-slate-50 dark:bg-cardbg border-l border-slate-200 dark:border-slate-800 flex flex-col items-center p-4">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-4 uppercase tracking-wider">{symbol} DOM</span>
                <div className="bg-red-50 dark:bg-red-900/20 text-red-500 text-xs p-3 rounded text-center">
                    {error}
                </div>
            </div>
        );
    }

    const hasData = domData.asks.length > 0 || domData.bids.length > 0;

    let finalData = domData;
    let isSimulated = false;

    if (!hasData) {
        if (currentPrice !== null && tickSize) {
            // Generate simulated order book using statistical distributions
            const numLevels = 15;
            const simulatedAsks = [];
            const simulatedBids = [];
            
            // Random walk volume generation for a realistic curve
            const generateVol = (distance) => {
                // Volume tends to cluster a bit away from current price, then tapers off
                const baseVol = 50 + Math.random() * 150;
                const distFactor = Math.abs(distance - 3) < 2 ? 2.0 : 1.0; // Cluster around 3 ticks away
                return Math.floor(baseVol * distFactor * (1 - (distance / numLevels) * 0.5));
            };

            for (let i = 1; i <= numLevels; i++) {
                simulatedAsks.push({
                    price: currentPrice + (i * tickSize),
                    volume: generateVol(i),
                    type: 1
                });
                simulatedBids.push({
                    price: currentPrice - (i * tickSize),
                    volume: generateVol(i),
                    type: 2
                });
            }
            
            // Reverse asks so highest price is at index 0
            simulatedAsks.reverse();
            
            finalData = { asks: simulatedAsks, bids: simulatedBids };
            isSimulated = true;
        } else {
            return (
                <div className="w-64 h-full bg-slate-50 dark:bg-cardbg border-l border-slate-200 dark:border-slate-800 flex flex-col items-center p-4">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-4 uppercase tracking-wider">{symbol} DOM</span>
                    <div className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] p-3 rounded text-center">
                        Level 2 (DOM) data is not available for this symbol from your MT5 broker.
                    </div>
                </div>
            );
        }
    }

    // Find max volume to scale bars
    const maxAskVol = Math.max(...finalData.asks.map(a => a.volume), 0);
    const maxBidVol = Math.max(...finalData.bids.map(b => b.volume), 0);
    const maxVol = Math.max(maxAskVol, maxBidVol, 1); // Avoid div by zero

    return (
        <div className="w-64 h-full bg-white dark:bg-cardbg border-l border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden shrink-0">
            <div className="p-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50 dark:bg-slate-900/50">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{symbol}</span>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Order Book</span>
            </div>
            
            <div className="flex bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shrink-0">
                <div className="flex-1 p-1 text-center text-[10px] font-bold text-slate-500 dark:text-slate-400">Bid Size</div>
                <div className="flex-1 p-1 text-center text-[10px] font-bold text-slate-500 dark:text-slate-400">Price</div>
                <div className="flex-1 p-1 text-center text-[10px] font-bold text-slate-500 dark:text-slate-400">Ask Size</div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col font-mono text-[11px] relative">
                {isSimulated && (
                    <div className="absolute top-2 left-0 right-0 text-center z-20 pointer-events-none">
                        <span className="bg-amber-100 text-amber-700 text-[9px] px-2 py-0.5 rounded shadow border border-amber-200 uppercase font-bold tracking-wider opacity-80">Simulated Data</span>
                    </div>
                )}
                
                {/* Asks (Sell Orders) - Red */}
                <div className="flex flex-col justify-end min-h-[50%]">
                    {finalData.asks.slice().reverse().map((ask, i) => (
                        <div key={`ask-${i}`} className="flex relative hover:bg-slate-50 dark:hover:bg-slate-800/50 group h-5 items-center">
                            {/* Ask Volume Bar */}
                            <div className="absolute right-0 top-0 bottom-0 bg-red-500/10 dark:bg-red-500/20" style={{ width: `${(ask.volume / maxVol) * 50}%` }}></div>
                            
                            <div className="flex-1 text-center text-slate-400 z-10 opacity-0">-</div>
                            <div className="flex-1 text-center font-bold text-red-500 dark:text-red-400 z-10">{ask.price.toFixed(5)}</div>
                            <div className="flex-1 text-center text-red-600 dark:text-red-300 z-10">{ask.volume}</div>
                        </div>
                    ))}
                </div>

                {/* Spread Divider */}
                <div className="h-px bg-slate-200 dark:bg-slate-700 my-1 shrink-0"></div>

                {/* Bids (Buy Orders) - Green */}
                <div className="flex flex-col justify-start min-h-[50%]">
                    {finalData.bids.map((bid, i) => (
                        <div key={`bid-${i}`} className="flex relative hover:bg-slate-50 dark:hover:bg-slate-800/50 group h-5 items-center">
                            {/* Bid Volume Bar */}
                            <div className="absolute left-0 top-0 bottom-0 bg-emerald-500/10 dark:bg-emerald-500/20" style={{ width: `${(bid.volume / maxVol) * 50}%` }}></div>
                            
                            <div className="flex-1 text-center text-emerald-600 dark:text-emerald-400 z-10">{bid.volume}</div>
                            <div className="flex-1 text-center font-bold text-emerald-500 dark:text-emerald-400 z-10">{bid.price.toFixed(5)}</div>
                            <div className="flex-1 text-center text-slate-400 z-10 opacity-0">-</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
