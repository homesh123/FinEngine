import React, { useEffect, useRef, useState } from 'react';
import TradersInterestWidget from './TradersInterestWidget';
import RecentTradesCard from './RecentTradesCard';
import SignalTestPanel from './SignalTestPanel';
import { LIVE_MODE } from '../utils/liveMode';
import ProjectionCard, { projectionOf } from './ProjectionCard';
import { MarketHoursCard, MarketClockSidebar } from './MarketHours';
import { usePredictionSignal } from '../hooks/usePredictionSignal';
import AdsterraBanner from './AdsterraBanner';
import { useProMode } from '../hooks/useProMode';
import { ADSTERRA_BANNERS, SIDEBAR_AD_SLOTS, SIDEBAR_SMALL_SLOTS } from '../config/ads';

// Sidebar ads: sizes and Adsterra keys are configured in src/config/ads.js.
// The sidebar widens to fit the widest chosen size (up to 360px wide banners);
// wider horizontal banners (468×60, 728×90) are scaled down to fit.
const SIDEBAR_PAD = 24;
const MAX_NATIVE_AD_W = 360;
const sidebarAdSizes = SIDEBAR_AD_SLOTS.filter(size => ADSTERRA_BANNERS[size]);
const widestAd = Math.max(0, ...sidebarAdSizes.map(size => Math.min(ADSTERRA_BANNERS[size].width, MAX_NATIVE_AD_W)));
const SIDEBAR_AD_WIDTH = Math.max(288, widestAd + SIDEBAR_PAD);

function AdSlot({ size, maxHeight }) {
    return (
        <div className="flex flex-col items-center px-3 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-cardbg">
            <AdsterraBanner size={size} maxWidth={SIDEBAR_AD_WIDTH - SIDEBAR_PAD} maxHeight={maxHeight} />
        </div>
    );
}

function SidebarAds() {
    // One banner at its natural size (the Traders Interest panel fills the rest)
    return (
        <div className="hidden md:block shrink-0">
            {sidebarAdSizes.map((size) => <AdSlot key={size} size={size} />)}
        </div>
    );
}

// Under the meter: the small banner, plus a second one whenever the remaining
// sidebar height has room for it (never cut off; re-checked on resize).
const smallSlots = SIDEBAR_SMALL_SLOTS.filter(size => ADSTERRA_BANNERS[size]?.key);
const SMALL_AD_SLOT_H = 47 + 12;   // banner scaled to 300px wide + gap
function MeterAndSmallAds({ children }) {
    const boxRef = useRef(null), contentRef = useRef(null);
    const [extra, setExtra] = useState(0);
    useEffect(() => {
        const box = boxRef.current, content = contentRef.current;
        if (!box || !content) return undefined;
        const measure = () => {
            // free height if no extra banners were shown
            const free = box.clientHeight - (content.offsetHeight - extra * SMALL_AD_SLOT_H);
            const n = Math.max(0, Math.min(smallSlots.length - 1, Math.floor(free / SMALL_AD_SLOT_H)));
            setExtra(prev => (prev === n ? prev : n));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(box);
        ro.observe(content);   // meter collapsed / data arrived
        return () => ro.disconnect();
    }, [extra]);
    return (
        <div ref={boxRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar hidden md:block">
            <div ref={contentRef}>
                {children}
                {smallSlots.slice(0, 1 + extra + 1).map(size => ( // add one more small ad
                    <div key={size} className="flex justify-center px-3 pb-3">
                        <AdsterraBanner size={size} maxWidth={SIDEBAR_AD_WIDTH - SIDEBAR_PAD} />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Compact pro-mode ad placeholder banner ────────────────────────────────────
function AdPlaceholderBanner() {
    return (
        <div className="hidden md:flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800
                        bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900/40 dark:to-black/30 shrink-0">
            <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700/50">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-[8px] font-bold text-indigo-600 dark:text-indigo-400 tracking-wider">PRO</span>
            </div>
        </div>
    );
}

export default function Sidebar({ state, setState, rawData, dataset }) {
    const { isProMode } = useProMode();
    // future-candle projection of the main chart (standard chart types), in plain words
    const pp = projectionOf(dataset, state);
    const signal = usePredictionSignal(dataset, state);
    const card = pp ? <ProjectionCard pp={pp} dark={state.theme === 'dark'} signal={signal} symbol={state.symbol} tf={Number(state.timeframe)} /> : null;

    return (
        // Normal mode: wide enough for the configured ad sizes; Pro mode: 288px
        <div
            style={isProMode ? undefined : { '--ad-sidebar-w': `${SIDEBAR_AD_WIDTH}px` }}
            className={`w-full ${isProMode ? 'md:w-72' : 'md:w-[var(--ad-sidebar-w)]'} md:h-full bg-white dark:bg-cardbg border-t md:border-t-0 border-l border-slate-200/80 dark:border-borderdark flex flex-col shrink-0 relative z-20 overflow-hidden`}>

            {isProMode ? (
                /* ═══════════════════════════════════════════════════════════
                   PRO MODE: Slim ad banner + full Gauge + MTF Traders Interest
                   ═══════════════════════════════════════════════════════════ */
                <>
                    {card}
                    <RecentTradesCard />{/* Indian trades: only while Upstox is connected (owner) */}
                    {state.showTradersInterest !== false && (
                        <div className="p-0 md:px-3 md:pb-3 md:pt-2">
                            <TradersInterestWidget dataset={dataset} state={state} setState={setState} compact />
                        </div>
                    )}
                    {/* live mode on desktop: the full market list below replaces this summary */}
                    <div className={LIVE_MODE ? 'md:hidden' : undefined}><MarketHoursCard dark={state.theme === 'dark'} /></div>
                    <AdPlaceholderBanner />
                    <div className="flex-1 overflow-y-auto custom-scrollbar hidden md:block">
                        {LIVE_MODE && <MarketClockSidebar />}
                        {/* Signal Tester — embedded in sidebar, Pro Mode only (Chart Settings → Show Signal Tester) */}
                        {state.showSignalTester === true && !LIVE_MODE && <SignalTestPanel
                            defaultSymbol={state?.symbol || 'XAUUSD'}
                            defaultPrice=""
                            inline={true}
                        />}
                    </div>
                </>
            ) : (
                /* ═══════════════════════════════════════════════════════════
                   NORMAL MODE: right panel shows Adsterra banners
                   ═══════════════════════════════════════════════════════════ */
                <>
                    {card}
                    <RecentTradesCard />
                    {state.showTradersInterest !== false && (
                        <div className="px-3 pb-2 pt-2">
                            <TradersInterestWidget dataset={dataset} state={state} setState={setState} compact />
                        </div>
                    )}
                    <MarketHoursCard dark={state.theme === 'dark'} />
                    <SidebarAds />
                    <MeterAndSmallAds>
                    </MeterAndSmallAds>
                </>
            )}

        </div>
    );
}

