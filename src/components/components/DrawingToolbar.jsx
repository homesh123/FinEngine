import React, { useEffect, useRef, useState } from 'react';
import {
    TrendingUp, Minus, MoreVertical, Trash2, Square, ArrowUp, ArrowDown, Eraser, Crosshair, Dot,
    ArrowUpLeft, ArrowUpRight, Rows3, Ruler, ChevronRight, Camera, Check,
} from 'lucide-react';
import { takeChartSnapshot } from '../utils/chartSnapshot';
import { confirmDialog } from '../utils/confirmDialog';

// Tool groups (TradingView-style): the button uses the group's last-used tool;
// hover (desktop) or the small arrow (touch) opens the list.
const GROUPS = [
    {
        id: 'cursor', label: 'Cursor',
        tools: [
            { id: 'cursor', icon: Crosshair, label: 'Cross' },
            { id: 'cursor_dot', icon: Dot, label: 'Dot' },
            { id: 'cursor_arrow', icon: ArrowUpLeft, label: 'Arrow' },
            { id: 'eraser', icon: Eraser, label: 'Eraser' },
        ],
    },
    {
        id: 'lines', label: 'Lines',
        tools: [
            { id: 'trendline', icon: TrendingUp, label: 'Trend line', hint: 'Click and drag between two points' },
            { id: 'ray', icon: ArrowUpRight, label: 'Ray', hint: 'Trend line extended to the right' },
            { id: 'horizontal', icon: Minus, label: 'Horizontal line', hint: 'Click a price (support / resistance)' },
            { id: 'vertical', icon: MoreVertical, label: 'Vertical line', hint: 'Click a time' },
        ],
    },
    {
        id: 'fib', label: 'Fibonacci & zones',
        tools: [
            { id: 'fib', icon: Rows3, label: 'Fib retracement', hint: 'Drag from swing start to swing end' },
            { id: 'rectangle', icon: Square, label: 'Rectangle (zone)', hint: 'Drag to mark a price/time zone' },
            { id: 'measure', icon: Ruler, label: 'Price range', hint: 'Drag to measure price change, %, bars and time' },
        ],
    },
    {
        id: 'positions', label: 'Positions',
        tools: [
            { id: 'long_position', icon: ArrowUp, label: 'Long position', hint: 'Click entry, drag to target (stop = 1:1, drag to adjust)' },
            { id: 'short_position', icon: ArrowDown, label: 'Short position', hint: 'Click entry, drag to target (stop = 1:1, drag to adjust)' },
        ],
    },
];

export default function DrawingToolbar({ state, setState }) {
    const [openMenu, setOpenMenu] = useState(null);
    // Last tool used in each group (what the group button shows)
    const [lastInGroup, setLastInGroup] = useState(() => Object.fromEntries(GROUPS.map(g => [g.id, g.tools[0].id])));
    const rootRef = useRef(null);
    const closeTimer = useRef(null);                       // delayed flyout close (hover)
    useEffect(() => () => clearTimeout(closeTimer.current), []);

    // Close an open flyout when tapping elsewhere (touch devices)
    useEffect(() => {
        if (!openMenu) return undefined;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpenMenu(null); };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [openMenu]);

    const activeTool = state.activeTool || 'cursor';
    const setTool = (groupId, toolId) => {
        setState(prev => ({ ...prev, activeTool: toolId }));
        setLastInGroup(prev => ({ ...prev, [groupId]: toolId }));
        setOpenMenu(null);
    };

    // Screenshot: download (and copy) the chart as a PNG
    const [shot, setShot] = useState(null);      // null | 'busy' | 'ok' | 'copied' | 'error'
    const shotTimer = useRef(null);
    useEffect(() => () => clearTimeout(shotTimer.current), []);
    const takeScreenshot = async () => {
        if (shot === 'busy') return;
        setShot('busy');
        try {
            const tfLabel = ({ 1: '1m', 5: '5m', 15: '15m', 30: '30m', 45: '45m', 60: '1H', 240: '4H', 1440: '1D' })[state.timeframe] || `${state.timeframe}m`;
            const r = await takeChartSnapshot({ symbol: state.symbol, timeframe: tfLabel, dark: state.theme === 'dark' });
            setShot(r.copied ? 'copied' : 'ok');
        } catch {
            setShot('error');
        }
        clearTimeout(shotTimer.current);
        shotTimer.current = setTimeout(() => setShot(null), 2200);
    };

    const clearAllDrawings = async () => {
        if (!(await confirmDialog({ title: 'Clear all drawings?', message: `Every drawing on ${state.symbol} will be deleted. This can't be undone.`, confirmLabel: 'Clear drawings', danger: true }))) return;
        setState(prev => {
            const newDrawings = { ...prev.drawings };
            delete newDrawings[prev.symbol];
            return { ...prev, drawings: newDrawings };
        });
    };

    return (
        <div ref={rootRef} className="w-12 h-full bg-slate-50 dark:bg-cardbg border-r border-slate-200 dark:border-borderdark flex flex-col items-center py-2 shrink-0 z-50">
            {GROUPS.map((group, gi) => {
                const groupActive = group.tools.some(t => t.id === activeTool);
                const shown = group.tools.find(t => t.id === (groupActive ? activeTool : lastInGroup[group.id])) || group.tools[0];
                const Icon = shown.icon;
                return (
                    <React.Fragment key={group.id}>
                        {gi === 1 && <div className="w-8 h-px bg-slate-200 dark:bg-slate-800 my-1.5" />}
                        <div className="relative w-full flex justify-center mb-1.5"
                            onMouseEnter={() => { clearTimeout(closeTimer.current); setOpenMenu(group.id); }}
                            onMouseLeave={() => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpenMenu(m => (m === group.id ? null : m)), 250); }}>
                            <button
                                type="button"
                                onClick={() => setTool(group.id, shown.id)}
                                title={`${shown.label}${shown.hint ? ` — ${shown.hint}` : ''}`}
                                aria-label={shown.label}
                                className={`p-2.5 rounded-lg transition-colors flex items-center justify-center relative ${groupActive ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'}`}
                            >
                                <Icon className="w-4 h-4" />
                            </button>
                            {group.tools.length > 1 && (
                                <button
                                    type="button"
                                    aria-label={`More ${group.label.toLowerCase()} tools`}
                                    onClick={() => setOpenMenu(m => (m === group.id ? null : group.id))}
                                    className="absolute right-0 bottom-0 w-3 h-3 flex items-end justify-end text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                >
                                    <ChevronRight className="w-2.5 h-2.5" />
                                </button>
                            )}
                            {openMenu === group.id && (
                                // pl-1 (not ml-1): the gap belongs to the flyout, so moving the
                                // mouse from the button to the menu never leaves the hover area
                                <div className="absolute left-full top-0 pl-1 z-[100]">
                                <div className="w-56 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden ts-pop-in origin-top-left">
                                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</div>
                                    {group.tools.map(tool => {
                                        const TIcon = tool.icon;
                                        const isActive = activeTool === tool.id;
                                        return (
                                            <button
                                                type="button"
                                                key={tool.id}
                                                onClick={() => setTool(group.id, tool.id)}
                                                className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${isActive ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                                            >
                                                <TIcon className="w-4 h-4 mt-0.5 shrink-0" />
                                                <span className="flex flex-col">
                                                    <span className="text-xs font-medium">{tool.label}</span>
                                                    {tool.hint && <span className="text-[10px] text-slate-400 leading-snug">{tool.hint}</span>}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                </div>
                            )}
                        </div>
                    </React.Fragment>
                );
            })}

            <div className="flex-1" />

            <div className="relative w-full flex justify-center mb-1">
                <button
                    type="button"
                    onClick={takeScreenshot}
                    title="Take screenshot (downloads a PNG of the chart)"
                    aria-label="Take screenshot"
                    className={`p-2.5 rounded-lg transition-colors ${shot === 'ok' || shot === 'copied' ? 'text-emerald-600 dark:text-emerald-400' : shot === 'error' ? 'text-red-500' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    {shot === 'ok' || shot === 'copied' ? <Check className="w-4 h-4" /> : <Camera className={`w-4 h-4 ${shot === 'busy' ? 'animate-pulse' : ''}`} />}
                </button>
                {shot && shot !== 'busy' && (
                    <div role="status" className="absolute left-full top-1/2 -translate-y-1/2 ml-1 whitespace-nowrap px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-lg ts-pop-in z-[100]">
                        {shot === 'copied' ? 'Saved & copied' : shot === 'ok' ? 'Screenshot saved' : 'Screenshot failed'}
                    </div>
                )}
            </div>

            <button
                type="button"
                onClick={clearAllDrawings}
                title="Clear all drawings"
                aria-label="Clear all drawings"
                className="p-2.5 mt-auto rounded-lg text-slate-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );
}

