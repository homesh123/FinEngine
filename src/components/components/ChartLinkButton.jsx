import React from 'react';
import { LineChart } from 'lucide-react';
import { openStockChart } from '../utils/openChart';

/** "Chart" button beside a stock: shows its chart here (onOpen), else opens it on the chart platform. */
export default function ChartLinkButton({ symbol, market, compact = false, onOpen, active = false }) {
    return (
        <button type="button" title={active ? `Hide ${symbol} chart` : `Show ${symbol} chart`} aria-label={`${active ? 'Hide' : 'Show'} ${symbol} chart`} aria-pressed={active}
            onClick={(e) => { e.stopPropagation(); if (onOpen) onOpen(); else openStockChart(symbol, market); }}
            className={`inline-flex items-center gap-1 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${active ? 'bg-indigo-600 text-white' : 'text-indigo-600 dark:text-indigo-300 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20'}`}>
            <LineChart size={12} />{!compact && 'Chart'}
        </button>
    );
}
