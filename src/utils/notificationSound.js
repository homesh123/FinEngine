// Shared notification sound utility.
// Plays a resonant, bell-like chime (C5 + C6 + C7 harmonics) that decays
// over ~5 seconds. Uses the Web Audio API so no external asset files are needed.
let audioCtx = null;
let resumed = false;

const ensureContext = () => {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;
        }
    }
    return audioCtx;
};

// Proactively resume the audio context on the first user gesture to satisfy
// browser autoplay policies. Listens to multiple gesture types and retries
// until the context is actually running (not just once).
const resumeOnGesture = () => {
    const ctx = ensureContext();
    if (ctx && ctx.state === 'suspended' && !resumed) {
        ctx.resume().then(() => { resumed = true; }).catch(() => {});
    }
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(evt => {
        document.addEventListener(evt, resumeOnGesture, { once: true });
    });
}

/**
 * Play the bell notification chime.
 * @param {number} durationMs - How long the chime should ring (default 5000ms).
 */
// Several charts (chart tabs) can alert at the same moment — ring once.
let lastPlayedAt = 0;

export const playNotificationSound = (durationMs = 5000) => {
    const wallNow = Date.now();
    if (wallNow - lastPlayedAt < 2000) return;
    const ctx = ensureContext();
    if (!ctx) return;
    lastPlayedAt = wallNow;

    // Try to resume if suspended. This is called from polling callbacks (not
    // user gestures), so browsers may reject the resume — we catch and fall
    // back to trying again on the next gesture.
    if (ctx.state === 'suspended') {
        ctx.resume().then(() => { resumed = true; }).catch(() => {});
        // If still suspended after resume attempt, don't play — browser policy
        if (ctx.state === 'suspended') return;
    }

    const now = ctx.currentTime;
    const durSec = Math.max(0.5, durationMs) / 1000;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.5, now);
    masterGain.connect(ctx.destination);

    // Bell-like chime: fundamental + octave + double-octave (C5, C6, C7)
    const frequencies = [523.25, 1046.5, 2093.0];
    const gains = [0.25, 0.15, 0.08];

    frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        // Quick attack, long smooth decay to produce a ringing bell tail.
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(gains[i], now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + durSec + 0.05);
    });
};

// Allow other modules to manually unlock audio (e.g. from an "Enable Sound" button)
export const resumeAudioContext = () => {
    const ctx = ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
        ctx.resume().then(() => { resumed = true; }).catch(() => {});
    }
    return ctx.state === 'running';
};

export const isAudioRunning = () => {
    const ctx = ensureContext();
    return !!ctx && ctx.state === 'running';
};