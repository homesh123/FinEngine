import React, { useEffect } from 'react';

export default function DayTrader() {
  useEffect(() => {
    // Redirect to the standalone PyScript day trader page with live stock data
    window.location.href = '/daytrader.html';
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-darkbg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
        <p className="text-slate-600 dark:text-slate-300">Loading live stock data&hellip;</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">Redirecting to /daytrader.html</p>
      </div>
    </div>
  );
}
