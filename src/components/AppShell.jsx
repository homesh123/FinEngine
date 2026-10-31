import React from 'react';
import { LineChart, Moon, Sun, Zap } from 'lucide-react';
import LiveDataButton from './LiveDataButton';

// One header for the whole app: brand, the two pages, the market (shared by
// both pages), live/snapshot status and the theme. Fits a 360 px phone.

const MARKETS = [['IN', '🇮🇳', 'India'], ['US', '🇺🇸', 'US']];
const PAGES = [['screener', './#', LineChart, 'Screener'], ['daytrader', './#daytrader', Zap, 'Day Trader']];

export function MarketSwitch({ market, onChange, className = '' }) {
    return (
        <div role="radiogroup" aria-label="Market" className={`inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-surfacebg border border-slate-200 dark:border-borderdark ${className}`}>
            {MARKETS.map(([m, flag, label]) => (
                <button key={m} role="radio" aria-checked={market === m} onClick={() => onChange(m)} title={`${label} stocks`}
                    className={`min-w-[44px] h-10 sm:h-auto px-2 sm:px-2.5 sm:py-1 rounded-md text-xs font-semibold whitespace-nowrap ${market === m
                        ? 'bg-white dark:bg-cardbg text-emerald-700 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                    {flag}<span className="hidden sm:inline"> {label}</span>
                </button>
            ))}
        </div>
    );
}

export default function AppShell({ page, market, onMarket, dark, onTheme, source, children }) {
    return (
        <div className={dark ? 'dark' : ''}>
            <div className="min-h-[100dvh] flex flex-col bg-slate-50 dark:bg-darkbg text-slate-800 dark:text-slate-200 font-sans antialiased">
                <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-borderdark bg-white/95 dark:bg-cardbg/95 backdrop-blur">
                    <div className="max-w-[1600px] mx-auto px-3 md:px-5 h-14 sm:h-12 flex items-center gap-2 md:gap-4">
                        <a href="./#" className="shrink-0 flex items-center gap-2 min-h-[44px] font-brand text-lg font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
                            <img src="./logo.svg" alt="" width="24" height="24" />
                            <span>Fin<span className="text-emerald-600 dark:text-emerald-400">Engine</span></span>
                        </a>
                        <nav className="hidden sm:flex items-center gap-1" aria-label="Pages">
                            {PAGES.map(([key, href, Icon, label]) => (
                                <a key={key} href={href} aria-current={page === key ? 'page' : undefined}
                                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-sm font-semibold whitespace-nowrap ${page === key
                                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-surfacebg'}`}>
                                    <Icon size={15} /> {label}
                                </a>
                            ))}
                        </nav>
                        <div className="ml-auto flex items-center gap-1.5 md:gap-2">
                            <MarketSwitch market={market} onChange={onMarket} />
                            <LiveDataButton source={source} />
                            <button onClick={onTheme} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
                                className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg border border-slate-200 dark:border-borderdark text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-surfacebg">
                                {dark ? <Sun size={15} /> : <Moon size={15} />}
                            </button>
                        </div>
                    </div>
                </header>
                <main className="flex-1 min-h-0 pb-16 sm:pb-0">{children}</main>
                {/* Phones: top-level pages in a bottom tab bar (Apple HIG), clear of the home indicator */}
                <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-borderdark bg-white/95 dark:bg-cardbg/95 backdrop-blur pb-safe" aria-label="Pages">
                    <div className="grid grid-cols-2">
                        {PAGES.map(([key, href, Icon, label]) => (
                            <a key={key} href={href} aria-current={page === key ? 'page' : undefined}
                                className={`flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-semibold ${page === key ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                <Icon size={20} /> {label}
                            </a>
                        ))}
                    </div>
                </nav>
                <footer className="mb-16 sm:mb-0 border-t border-slate-200 dark:border-borderdark px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400 text-center">
                    Educational only, not financial advice. Data: Yahoo Finance (can lag), SEC EDGAR, House Clerk.
                    {' '}<a className="underline" href="./disclaimer.html">Disclaimer</a> · <a className="underline" href="./privacy.html">Privacy</a>
                    {' '}<button onClick={onTheme} className="sm:hidden underline ml-1">{dark ? 'Light theme' : 'Dark theme'}</button>
                </footer>
            </div>
        </div>
    );
}
