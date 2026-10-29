// Drag an absolutely positioned box (an info panel over the chart) by a handle.
// The box stays inside its positioned parent (the chart area); the offset is
// remembered per browser. Double-click the handle to put it back.
import { useCallback, useEffect, useRef, useState } from 'react';

const read = (key) => {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : { x: 0, y: 0 }; }
    catch { return { x: 0, y: 0 }; }
};

export function useDraggable(id) {
    const key = `ts_box_${id}`;
    const [pos, setPos] = useState(() => read(key));
    const boxRef = useRef(null);
    const drag = useRef(null);

    // Keep the box inside its parent (e.g. after a resize or a layout change)
    const clamp = useCallback((p) => {
        const el = boxRef.current, parent = el?.offsetParent;
        if (!el || !parent) return p;
        const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect();
        // where the box would be without the current offset
        const baseL = r.left - pos.x, baseT = r.top - pos.y;
        const x = Math.max(pr.left - baseL, Math.min(pr.right - r.width - baseL, p.x));
        const y = Math.max(pr.top - baseT, Math.min(pr.bottom - r.height - baseT, p.y));
        return { x: Math.round(x), y: Math.round(y) };
    }, [pos.x, pos.y]);

    const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        drag.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y, pid: e.pointerId };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        e.preventDefault();
        e.stopPropagation();          // don't pan the chart underneath
    };
    const onPointerMove = (e) => {
        const d = drag.current;
        if (!d) return;
        setPos(clamp({ x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy }));
    };
    const end = (e) => {
        if (!drag.current) return;
        try { e.currentTarget.releasePointerCapture(drag.current.pid); } catch { /* released */ }
        drag.current = null;
        setPos(p => { try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage unavailable */ } return p; });
    };
    const reset = () => {
        setPos({ x: 0, y: 0 });
        try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    };

    // Re-clamp when the window (and so the chart) changes size
    useEffect(() => {
        const onResize = () => setPos(p => clamp(p));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [clamp]);

    return {
        boxRef,
        boxStyle: { translate: `${pos.x}px ${pos.y}px` },
        handleProps: {
            onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onDoubleClick: reset,
            style: { cursor: 'grab', touchAction: 'none' },
            title: 'Drag to move · double-click to reset',
        },
    };
}
