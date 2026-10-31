import React, { useState } from 'react';
import { Zap, Sun, Moon } from 'lucide-react';
import InvestmentScreener from './components/InvestmentScreener';

// Theme saved by the chart app (default dark)
function savedTheme() {
    try {
        return JSON.parse(localStorage.getItem('chartState') || '{}').theme === 'light' ? 'light' : 'dark';
    } catch {
        return 'dark';
    }
}

/**
 * Stock Investment Screener — the site's main page.
 */
export default function InvestPage() {
    const [theme, setTheme] = useState(savedTheme);
    const dark = theme === 'dark';

    return (
        <div className={dark ? 'dark' : ''}>
            <div className="h-[100dvh] flex flex-col bg-white dark:bg-darkbg text-slate-800 dark:text-slate-300 font-sans antialiased">
                <header className="shrink-0 flex items-center justify-between gap-3 px-3 md:px-6 h-12 border-b border-slate-200 dark:border-borderdark bg-white dark:bg-cardbg">
                    <a href="./" className="flex items-center gap-2 font-brand text-lg font-semibold tracking-[-0.02em] text-slate-900 dark:text-white"><img src="./logo-light.svg" alt="" width="24" height="24" className="dark:hidden" /><img src="./logo.svg" alt="" width="24" height="24" className="hidden dark:block" /><span>Fin<span className="text-emerald-600 dark:text-emerald-400">Engine</span></span></a>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setTheme(dark ? 'light' : 'dark')}
                            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-borderdark text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surfacebg"
                        >
                            {dark ? <Sun size={15} /> : <Moon size={15} />}
                        </button>
                        <a
                            href="./#daytrader"
                            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-borderdark text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-surfacebg"
                        >
                            <Zap size={14} /> Day Trader
                        </a>
                    </div>
                </header>
                <main className="flex-1 min-h-0 flex flex-col">
                    <InvestmentScreener />
                </main>
            </div>
        </div>
    );
}
