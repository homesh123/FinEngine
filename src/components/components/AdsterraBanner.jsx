import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ADSTERRA_BANNERS, ADSTERRA_SCRIPT_HOST } from '../config/ads';

/**
 * One Adsterra banner (e.g. size "300x250").
 *
 * Adsterra's banner code sets a global `atOptions` and then loads invoke.js, so
 * two banners on the same page would overwrite each other. Each banner therefore
 * runs inside its own sandboxed iframe, isolated from the other banners (it can't
 * navigate the app without a user click). It only loads when scrolled
 * into view, and it's scaled down when the available width/height is smaller
 * than the banner (e.g. 728×90 in the sidebar, 160×600 on short screens).
 */
export default function AdsterraBanner({ size, maxWidth, maxHeight }) {
    const cfg = ADSTERRA_BANNERS[size];
    const boxRef = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = boxRef.current;
        if (!el || visible) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
        }, { rootMargin: '200px' });
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);

    const srcDoc = useMemo(() => {
        if (!cfg?.key) return null;
        const src = cfg.src || `${ADSTERRA_SCRIPT_HOST}/${cfg.key}`;
        const options = JSON.stringify({ key: cfg.key, format: 'iframe', height: cfg.height, width: cfg.width, params: {} });
        return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>`
            + `<script>atOptions = ${options};</script>`
            + `<script src="${src.startsWith('//') ? `https:${src}` : src}"></script>`
            + `</body></html>`;
    }, [cfg]);

    if (!cfg) return null;
    const scale = Math.min(1,
        maxWidth ? maxWidth / cfg.width : 1,
        maxHeight ? maxHeight / cfg.height : 1);
    const boxW = Math.round(cfg.width * scale), boxH = Math.round(cfg.height * scale);

    return (
        <div ref={boxRef} style={{ width: boxW, height: boxH, contain: 'strict' }} className="relative mx-auto">
            {srcDoc ? (
                visible && (
                    <iframe
                        title={`Advertisement ${size}`}
                        srcDoc={srcDoc}
                        width={cfg.width}
                        height={cfg.height}
                        scrolling="no"
                        loading="lazy"
                        // Adsterra's script needs cookies/storage (it serves nothing in an
                        // opaque-origin frame), so allow-same-origin is required. The sandbox
                        // still stops the ad redirecting the app without a user click.
                        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
                        style={{ border: 0, width: cfg.width, height: cfg.height, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left', display: 'block' }}
                    />
                )
            ) : (
                <div className="w-full h-full rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700/70 flex flex-col items-center justify-center gap-1 text-center px-2 bg-white/60 dark:bg-white/[0.03]">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Ad slot {cfg.width}×{cfg.height}</span>
                    {boxH >= 60 && <span className="text-[9px] text-slate-500 dark:text-slate-400">Add the Adsterra key in src/config/ads.js</span>}
                </div>
            )}
        </div>
    );
}
