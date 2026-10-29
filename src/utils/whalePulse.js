// ─── Whale Pulse — big-trade bubbles, absorption, deep pressure ─────────────
// Our own build of the "big trades / absorption / deep pressure" idea (concept
// from a public TradingView description; no code copied):
//  • Pressure of a bar = buy volume − sell volume. Uses the real lower-timeframe
//    split when the chart has it (ltfDelta: 1m bars inside the candle), else the
//    close-location proxy (2·(C−L)/(H−L) − 1) × volume.
//  • Big-trade bubble: pressure's z-score vs the previous `lookback` bars
//    (current bar excluded) ≥ z1 / z2 / z3 → small / medium / large, and volume
//    ≥ minRelVol × its recent average.
//  • Absorption: big pressure but the bar barely moved that way (net move in the
//    pressure's direction < absBody × ATR) — the other side soaked it up.
//  • Deep pressure: the last `deepBars` bars mostly pushed one way and their
//    summed pressure's z-score ≥ deepZ — pressure building under the surface.
//  • Record: after medium/large bubbles, how often price continued over the next
//    `horizon` bars; after absorption, how often it reversed (closed bars only).
// Closed-bar values never change afterwards; the live bar updates as it forms.

export const WHALE_DEFAULTS = {
    wpLookback: 20, wpZ1: 2.0, wpZ2: 3.0, wpZ3: 4.0, wpMinRelVol: 1.2,
    wpAbsorption: true, wpAbsBody: 0.25,
    wpDeep: true, wpDeepBars: 5, wpDeepZ: 2.5,
    wpBubbles: true, wpScale: 1, wpLabels: true, wpRecord: true, wpHorizon: 5,
};

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function calcWhalePulse(c, settings = {}) {
    const s = { ...WHALE_DEFAULTS, ...settings };
    const n = c.length;
    const L = Math.max(5, Math.min(200, Math.round(num(s.wpLookback, 20))));
    const z1 = num(s.wpZ1, 2), z2 = num(s.wpZ2, 3), z3 = num(s.wpZ3, 4);
    const minRv = num(s.wpMinRelVol, 1.2), absBody = num(s.wpAbsBody, 0.25);
    const D = Math.max(2, Math.min(20, Math.round(num(s.wpDeepBars, 5)))), deepZ = num(s.wpDeepZ, 1.5);
    const H = Math.max(1, Math.min(50, Math.round(num(s.wpHorizon, 5))));
    const res = { bubbles: 0, absorptions: 0, deep: 0, source: 'clv', record: null };
    if (n < L + D + 2) return res;

    // pressure per bar
    const d = new Float64Array(n);
    let real = 0;
    for (let i = 0; i < n; i++) {
        const k = c[i], v = k.volume || 0;
        if (k.ltfDelta != null && v > 0) { d[i] = k.ltfDelta; real++; }
        else d[i] = (k.high > k.low ? 2 * (k.close - k.low) / (k.high - k.low) - 1 : 0) * v;
    }
    res.source = real > n / 2 ? 'ltf' : 'clv';
    // rolling D-bar pressure sums
    const sumD = new Float64Array(n);
    for (let i = 0; i < n; i++) sumD[i] = d[i] + (i ? sumD[i - 1] : 0) - (i >= D ? d[i - D] : 0);

    const stats = (arr, from, to) => {       // mean, sd of arr[from..to]
        let m = 0, q = 0, k = 0;
        for (let j = from; j <= to; j++) { m += arr[j]; q += arr[j] * arr[j]; k++; }
        m /= k; return [m, Math.sqrt(Math.max(0, q / k - m * m))];
    };

    for (let i = L; i < n; i++) {
        const k = c[i];
        k.wpBubble = k.wpAbs = k.wpDeep = null;
        // volume vs its recent average (current bar excluded)
        let vs = 0; for (let j = i - L; j < i; j++) vs += c[j].volume || 0;
        const rv = vs > 0 ? (k.volume || 0) / (vs / L) : 1;
        const [m, sd] = stats(d, i - L, i - 1);
        const z = sd > 0 ? (d[i] - m) / sd : 0;
        const dir = z > 0 ? 1 : -1, az = Math.abs(z);
        const atr = k.atr || (k.high - k.low) || 1;
        if (az >= z1 && rv >= minRv) {
            const size = az >= z3 ? 3 : az >= z2 ? 2 : 1;
            k.wpBubble = { dir, size, z, rv, delta: d[i] };
            res.bubbles++;
            // absorption: pressure without the matching move
            if (dir * (k.close - k.open) < absBody * atr) { k.wpAbs = { dir, z }; res.absorptions++; }
        }
        // deep pressure: most of the last D bars pushed the same way, sum unusually large
        if (i >= L + D) {
            let same = 0; for (let j = i - D + 1; j <= i; j++) if (Math.sign(d[j]) === Math.sign(sumD[i])) same++;
            const [m2, sd2] = stats(sumD, i - L, i - 1);
            const zz = sd2 > 0 ? (sumD[i] - m2) / sd2 : 0;
            if (Math.abs(zz) >= deepZ && same >= Math.ceil(D * 0.8)) { k.wpDeep = { dir: zz > 0 ? 1 : -1, z: zz }; res.deep++; }
        }
    }

    // record (closed bars, outcome known): continuation after medium/large bubbles, reversal after absorption
    const last = n - 2;
    let bn = 0, bw = 0, an = 0, aw = 0;
    for (let i = L; i + H <= last; i++) {
        const k = c[i], move = c[i + H].close - k.close;
        if (k.wpBubble && k.wpBubble.size >= 2 && !k.wpAbs) { bn++; if (Math.sign(move) === k.wpBubble.dir) bw++; }
        if (k.wpAbs) { an++; if (Math.sign(move) === -k.wpAbs.dir) aw++; }
    }
    res.record = { horizon: H, bubbles: bn, bubbleWins: bw, abs: an, absWins: aw };
    return res;
}
