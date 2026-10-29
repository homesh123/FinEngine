import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Pencil, Trash2, Copy, Bell, Volume2, Mail, Webhook, AlarmClock } from 'lucide-react';
import {
    useAlertStore, addAlert, updateAlert, removeAlert, setAlertSettings, clearAlertLog, makeAlert, isMonitored, DEFAULT_MESSAGE,
} from '../utils/alerts/alertStore';
import { ALERT_SOURCES, TRIGGERS, TIMEFRAMES, PLACEHOLDERS, describeCondition, tfLabel } from '../utils/alerts/alertSources';
import { sendTestEmail, sendTestWebhook } from '../utils/alerts/alertDelivery';
import { confirmDialog } from '../utils/confirmDialog';

const input = 'w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500';
const label = 'block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1';
const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold';

/** Small on/off switch. */
function Switch({ checked, onChange, title }) {
    return (
        <button type="button" role="switch" aria-checked={checked} title={title} onClick={() => onChange(!checked)}
            className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
        </button>
    );
}

const EXPIRY_OPTIONS = [
    { value: 'none', label: 'Open-ended', ms: null },
    { value: '1d', label: '1 day', ms: 86400000 },
    { value: '1w', label: '1 week', ms: 7 * 86400000 },
    { value: '1m', label: '1 month', ms: 30 * 86400000 },
];

/** e.g. "Waiting for an open XAU/USD 15m chart" / "Waiting for a 45m chart showing Livermore Gold Trend". */
function waitingText(a) {
    const src = ALERT_SOURCES[a.source];
    const parts = [a.symbol === '*' ? '' : a.symbol, a.timeframe === '*' ? '' : tfLabel(a.timeframe)].filter(Boolean).join(' ');
    let t = `Waiting for ${parts ? `an open ${parts}` : 'an open'} ${src?.requiresFootprint ? 'footprint ' : ''}chart`;
    if (a.onlyWhenShown && a.source !== 'price' && a.source !== 'footprint') t += ` showing ${src?.label}`;
    return `${t} with live data`;
}

/** Create / edit form (Settings + Notifications, like TradingView). */
function AlertEditor({ initial, settings, isPro, onSave, onCancel }) {
    const [a, setA] = useState(initial);
    const [tab, setTab] = useState('settings');
    const [expiry, setExpiry] = useState(initial.expiresAt ? 'keep' : 'none');
    const [hookTest, setHookTest] = useState(null);
    const set = (patch) => setA(prev => ({ ...prev, ...patch }));
    const src = ALERT_SOURCES[a.source];
    const sig = src?.signals[a.signal];
    const isIndicator = a.source !== 'price' && a.source !== 'footprint';

    const changeSource = (source) => {
        const first = Object.keys(ALERT_SOURCES[source].signals)[0];
        const s = ALERT_SOURCES[source].signals[first];
        set({ source, signal: first, value: s.defaultValue ?? (source === 'price' ? a.value : 0) });
    };
    const changeSignal = (signal) => {
        const s = src.signals[signal];
        set({ signal, ...(s.needsValue && s.defaultValue !== undefined && a.source !== 'price' ? { value: s.defaultValue } : {}) });
    };
    const save = () => {
        const opt = EXPIRY_OPTIONS.find(o => o.value === expiry);
        const expiresAt = expiry === 'keep' ? a.expiresAt : opt?.ms ? Date.now() + opt.ms : null;
        onSave({ ...a, name: a.name.trim() || describeCondition(a), expiresAt, value: Number(a.value) || 0 });
    };
    const insert = (ph) => set({ message: `${a.message || ''}{{${ph}}}` });
    const testHook = async () => {
        setHookTest('sending…');
        const r = await sendTestWebhook(a.webhookUrl, a.message && a.message.trim().startsWith('{') ? a.message : undefined);
        setHookTest(r.ok ? 'Test sent ✓' : `Failed: ${r.error}`);
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex border-b border-slate-200 dark:border-slate-700 shrink-0">
                {['settings', 'notifications'].map(t => (
                    <button key={t} type="button" onClick={() => setTab(t)}
                        className={`flex-1 py-2 text-xs font-semibold capitalize ${tab === t ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600' : 'text-slate-500'}`}>{t}</button>
                ))}
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-3 space-y-3">
                {tab === 'settings' ? (
                    <>
                        <div>
                            <span className={label}>Condition</span>
                            <div className="grid grid-cols-2 gap-2">
                                <select className={input} value={a.source} onChange={e => changeSource(e.target.value)}>
                                    {Object.entries(ALERT_SOURCES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                                </select>
                                <select className={input} value={a.signal} onChange={e => changeSignal(e.target.value)}>
                                    {Object.entries(src.signals).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                                </select>
                            </div>
                            {sig?.needsValue && (
                                <input type="number" step="any" className={`${input} mt-2`} value={a.value} onChange={e => set({ value: e.target.value })} placeholder="Value" />
                            )}
                            {src.requiresFootprint && <p className="mt-1 text-[10px] text-amber-500">Checked on charts using the Order Flow (footprint) chart type.</p>}
                        </div>
                        <div>
                            <span className={label}>Applies to</span>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1">
                                    <select className={input} value={a.symbol === '*' ? '*' : 'one'} onChange={e => set({ symbol: e.target.value === '*' ? '*' : (initial.symbol !== '*' ? initial.symbol : a.defaultSymbol || '') })}>
                                        <option value="one">Symbol</option>
                                        <option value="*">Any open chart</option>
                                    </select>
                                    {a.symbol !== '*' && <input className={input} value={a.symbol} onChange={e => set({ symbol: e.target.value.toUpperCase() })} placeholder="e.g. XAU/USD" />}
                                </div>
                                <select className={input} value={a.timeframe} onChange={e => set({ timeframe: e.target.value === '*' ? '*' : Number(e.target.value) })}>
                                    <option value="*">Any timeframe</option>
                                    {TIMEFRAMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                            {isIndicator && (
                                <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                                    <input type="checkbox" checked={a.onlyWhenShown} onChange={e => set({ onlyWhenShown: e.target.checked })} className="rounded" />
                                    Only on charts showing {src.label}
                                </label>
                            )}
                        </div>
                        <div>
                            <span className={label}>Trigger</span>
                            <select className={input} value={a.trigger} onChange={e => set({ trigger: e.target.value })}>
                                {Object.entries(TRIGGERS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                            </select>
                            <p className="mt-1 text-[10px] text-slate-400">{TRIGGERS[a.trigger]?.hint}</p>
                        </div>
                        <div>
                            <span className={label}>Expiration</span>
                            <select className={input} value={expiry} onChange={e => setExpiry(e.target.value)}>
                                {initial.expiresAt && <option value="keep">Keep: {new Date(initial.expiresAt).toLocaleString()}</option>}
                                {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <span className={label}>Alert name</span>
                            <input className={input} value={a.name} maxLength={80} onChange={e => set({ name: e.target.value })} placeholder={describeCondition(a)} />
                        </div>
                        <div>
                            <span className={label}>Message</span>
                            <textarea className={`${input} h-20 resize-y font-mono`} value={a.message} maxLength={2000} onChange={e => set({ message: e.target.value })} />
                            <div className="mt-1 flex flex-wrap gap-1">
                                {PLACEHOLDERS.map(p => (
                                    <button key={p} type="button" onClick={() => insert(p)}
                                        className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] font-mono text-slate-600 dark:text-slate-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40">{`{{${p}}}`}</button>
                                ))}
                            </div>
                            <p className="mt-1 text-[10px] text-slate-400">Click a placeholder to add it. A message written as JSON is sent to webhooks as JSON.</p>
                        </div>
                    </>
                ) : (
                    <div className="space-y-3">
                        <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-200">
                            <span className="flex items-center gap-2"><Bell size={14} /> Show pop-up (in app + browser notification)</span>
                            <input type="checkbox" checked={a.notify.popup} onChange={e => set({ notify: { ...a.notify, popup: e.target.checked } })} className="rounded" />
                        </label>
                        <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-200">
                            <span className="flex items-center gap-2"><Volume2 size={14} /> Play sound</span>
                            <input type="checkbox" checked={a.notify.sound} onChange={e => set({ notify: { ...a.notify, sound: e.target.checked } })} className="rounded" />
                        </label>
                        {isPro ? (<>
                        <div>
                            <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-200">
                                <span className="flex items-center gap-2"><Mail size={14} /> Send email</span>
                                <input type="checkbox" checked={a.notify.email} onChange={e => set({ notify: { ...a.notify, email: e.target.checked } })} className="rounded" />
                            </label>
                            {a.notify.email && (
                                <p className={`mt-1 text-[10px] ${settings.email ? 'text-slate-400' : 'text-amber-500'}`}>
                                    {settings.email ? `To ${settings.email} (change in the Settings tab of the Alerts panel)` : 'Add your email address in the Settings tab of the Alerts panel.'}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-200">
                                <span className="flex items-center gap-2"><Webhook size={14} /> Webhook URL</span>
                                <input type="checkbox" checked={a.notify.webhook} onChange={e => set({ notify: { ...a.notify, webhook: e.target.checked } })} className="rounded" />
                            </label>
                            {a.notify.webhook && (
                                <div className="mt-1 flex gap-2">
                                    <input className={input} value={a.webhookUrl} onChange={e => set({ webhookUrl: e.target.value.trim() })} placeholder="https://…" />
                                    <button type="button" onClick={testHook} disabled={!a.webhookUrl} className={`${btn} bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40`}>Test</button>
                                </div>
                            )}
                            {hookTest && <p className="mt-1 text-[10px] text-slate-500">{hookTest}</p>}
                        </div>
                        </>) : (
                            <p className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                <Mail size={13} /><Webhook size={13} /> Email and webhook alerts are available in Pro mode.
                            </p>
                        )}
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                            Pop-ups and sound also follow the bell button in the toolbar.{isPro ? ' Email and webhooks are sent by the TradeSagar server.' : ''}
                            Alerts are checked while TradeSagar is open in a browser tab (it can be in the background).
                        </p>
                    </div>
                )}
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
                <button type="button" onClick={onCancel} className={`${btn} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700`}>Cancel</button>
                <button type="button" onClick={save} className={`${btn} bg-indigo-600 hover:bg-indigo-700 text-white`}>{initial.createdAt && initial.__editing ? 'Save' : 'Create'}</button>
            </div>
        </div>
    );
}

/**
 * Alerts manager (TradingView-style): list with on/off switches, create/edit,
 * log of fired alerts, and settings (email). Everything is stored in this
 * browser's localStorage.
 */
export default function AlertsPanel({ open, isPro = false, onClose, chartSymbol, chartTimeframe }) {
    const { alerts, settings, log } = useAlertStore();
    const [view, setView] = useState('alerts');          // alerts | log | settings
    const [editing, setEditing] = useState(null);        // alert being created/edited
    const [emailDraft, setEmailDraft] = useState(settings.email);
    const [emailTest, setEmailTest] = useState(null);
    const [, setTick] = useState(0);
    const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

    // Refresh the "watching" status while the panel is open
    useEffect(() => {
        if (!open) return undefined;
        const t = setInterval(() => setTick(n => n + 1), 5000);
        return () => clearInterval(t);
    }, [open]);
    useEffect(() => { setEmailDraft(settings.email); }, [settings.email]);

    const sorted = useMemo(() => [...alerts].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)), [alerts]);
    if (!open) return null;

    const startCreate = () => setEditing(makeAlert({
        symbol: chartSymbol || '*', timeframe: chartTimeframe || '*', onlyWhenShown: false,
        source: 'goldMove', signal: 'any', defaultSymbol: chartSymbol, message: DEFAULT_MESSAGE,
    }));
    const saveAlert = (a) => {
        const { __editing, defaultSymbol, ...clean } = a;
        void defaultSymbol;
        if (__editing) updateAlert(clean.id, clean); else addAlert(clean);
        setEditing(null);
    };
    const openChart = (a) => window.dispatchEvent(new CustomEvent('ts-open-chart', { detail: { symbol: a.symbol, timeframe: a.timeframe } }));
    const testEmail = async () => {
        setAlertSettings({ email: emailDraft.trim() });
        setEmailTest('sending…');
        const r = await sendTestEmail(emailDraft.trim());
        setEmailTest(r.ok ? 'Test email sent ✓' : `Failed: ${r.error}`);
    };

    return (
        <div className="fixed inset-0 z-[300] flex justify-end" role="dialog" aria-label="Alerts">
            <div className="absolute inset-0 bg-black/40 ts-scrim-in" onClick={onClose} />
            <div className="relative w-full sm:w-[440px] h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col ts-sheet-in">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div className="flex items-center gap-2">
                        <AlarmClock size={16} className="text-indigo-500" />
                        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{editing ? (editing.__editing ? 'Edit alert' : 'Create alert') : 'Alerts'}</h2>
                    </div>
                    <div className="flex items-center gap-3">
                        {!editing && (
                            <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {settings.enabled ? 'All on' : 'All paused'}
                                <Switch checked={settings.enabled} onChange={v => setAlertSettings({ enabled: v })} title="Turn all alerts on/off" />
                            </span>
                        )}
                        <button type="button" onClick={editing ? () => setEditing(null) : onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white" aria-label="Close"><X size={16} /></button>
                    </div>
                </div>

                {editing ? (
                    <AlertEditor initial={editing} settings={settings} isPro={isPro} onSave={saveAlert} onCancel={() => setEditing(null)} />
                ) : (
                    <>
                        <div className="flex border-b border-slate-200 dark:border-slate-700 shrink-0">
                            {[['alerts', `Alerts (${alerts.length})`], ['log', `Log (${log.length})`], ['settings', 'Settings']].map(([k, t]) => (
                                <button key={k} type="button" onClick={() => setView(k)}
                                    className={`flex-1 py-2 text-xs font-semibold ${view === k ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600' : 'text-slate-500'}`}>{t}</button>
                            ))}
                        </div>
                        <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
                            {view === 'alerts' && (
                                <div className="p-3 space-y-2">
                                    <button type="button" onClick={startCreate} className={`${btn} w-full justify-center bg-indigo-600 hover:bg-indigo-700 text-white`}><Plus size={14} /> Create alert</button>
                                    {sorted.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No alerts yet.</p>}
                                    {sorted.map(a => {
                                        const watching = a.enabled && settings.enabled && isMonitored(a.id);
                                        const expired = a.expiresAt && Date.now() > a.expiresAt;
                                        const status = !settings.enabled ? 'Paused' : !a.enabled ? (expired ? 'Expired' : 'Off') : watching ? 'Watching' : waitingText(a);
                                        return (
                                            <div key={a.id} className={`rounded-lg border p-2.5 ${a.enabled ? 'border-slate-200 dark:border-slate-700' : 'border-slate-200/60 dark:border-slate-800 opacity-70'}`}>
                                                <div className="flex items-start gap-2">
                                                    <Switch checked={a.enabled} onChange={v => updateAlert(a.id, { enabled: v, ...(v && expired ? { expiresAt: null } : {}) })} title={a.enabled ? 'Turn off' : 'Turn on'} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{a.name || describeCondition(a)}</div>
                                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                                            {a.symbol === '*' ? 'Any chart' : a.symbol} · {tfLabel(a.timeframe)} · {describeCondition(a)} · {TRIGGERS[a.trigger]?.label}
                                                        </div>
                                                        <div className="mt-1 flex items-center gap-2 text-[10px]">
                                                            <span className={watching ? 'text-emerald-500' : 'text-slate-400'}>● {status}</span>
                                                            {!watching && a.enabled && settings.enabled && a.symbol !== '*' && a.timeframe !== '*' && (
                                                                <button type="button" onClick={() => openChart(a)} className="text-indigo-500 hover:underline">Open chart</button>
                                                            )}
                                                        </div>
                                                        <div className="mt-1 flex items-center gap-2 text-slate-400">
                                                            {a.notify.popup && <Bell size={11} title="Pop-up" />}
                                                            {a.notify.sound && <Volume2 size={11} title="Sound" />}
                                                            {a.notify.email && <Mail size={11} title="Email" />}
                                                            {a.notify.webhook && <Webhook size={11} title="Webhook" />}
                                                            {a.lastFiredAt && <span className="text-[10px]">Last: {new Date(a.lastFiredAt).toLocaleString()}</span>}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-slate-400">
                                                        <button type="button" title="Edit" onClick={() => setEditing({ ...a, __editing: true })} className="p-1 hover:text-indigo-500"><Pencil size={13} /></button>
                                                        <button type="button" title="Duplicate" onClick={() => addAlert({ ...a, id: makeAlert().id, name: `${a.name || describeCondition(a)} (copy)`, createdAt: Date.now(), lastFired: {}, lastFiredAt: null })} className="p-1 hover:text-indigo-500"><Copy size={13} /></button>
                                                        <button type="button" title="Delete" onClick={async () => { if (await confirmDialog({ title: 'Delete alert?', message: `"${a.name || describeCondition(a)}" will be deleted.`, confirmLabel: 'Delete', danger: true })) removeAlert(a.id); }} className="p-1 hover:text-red-500"><Trash2 size={13} /></button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {view === 'log' && (
                                <div className="p-3 space-y-2">
                                    {log.length > 0 && <button type="button" onClick={clearAlertLog} className="text-[11px] text-slate-500 hover:text-red-500">Clear log</button>}
                                    {log.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No alerts have fired yet.</p>}
                                    {log.map(e => (
                                        <div key={e.id} className="rounded border border-slate-200 dark:border-slate-700 p-2">
                                            <div className="flex justify-between gap-2">
                                                <span className={`text-xs font-semibold ${e.side === 'buy' ? 'text-emerald-500' : e.side === 'sell' ? 'text-red-500' : 'text-slate-700 dark:text-slate-200'}`}>{e.name}</span>
                                                <span className="text-[10px] text-slate-400 shrink-0">{new Date(e.at).toLocaleString()}</span>
                                            </div>
                                            <div className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{e.message}</div>
                                            {e.results && Object.keys(e.results).length > 0 && (
                                                <div className="mt-1 text-[10px] text-slate-400">{Object.entries(e.results).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {view === 'settings' && (
                                <div className="p-3 space-y-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <span className={label}>Notify on signals from applied indicators</span>
                                            <p className="text-[10px] text-slate-400 leading-snug">Popup, web notification and sound when an indicator on the chart signals at candle close — Gold Move, Livermore, LSR, QIT, MACD H&amp;S, and MACD / RSI (70/30) / DeMarker (0.7/0.3) crosses. No setup needed; your own alerts take precedence.</p>
                                        </div>
                                        <Switch checked={settings.autoIndicatorAlerts !== false} onChange={v => setAlertSettings({ autoIndicatorAlerts: v })} title="Notify on signals from applied indicators" />
                                    </div>
                                    <div>
                                        <span className={label}>Market clock alerts</span>
                                        <p className="text-[10px] text-slate-400 leading-snug mb-1.5">Popup, web notification and sound for the stock exchanges chosen on the market clock (sidebar → Markets → clock → ⚙).</p>
                                        {[['open', 'An exchange opens'], ['preOpen', 'An exchange opens in 15 minutes'], ['close', 'An exchange closes'], ['overlap', 'London–New York overlap starts (busiest forex hours)']].map(([k, t]) => (
                                            <div key={k} className="flex items-center justify-between gap-3 py-0.5">
                                                <span className="text-[11px] text-slate-600 dark:text-slate-300">{t}</span>
                                                <Switch checked={!!settings.marketAlerts?.[k]} onChange={v => setAlertSettings({ marketAlerts: { ...(settings.marketAlerts || {}), [k]: v } })} title={t} />
                                            </div>
                                        ))}
                                    </div>
                                    {isPro && <div>
                                        <span className={label}>Email address for alert emails</span>
                                        <div className="flex gap-2">
                                            <input type="email" className={input} value={emailDraft} onChange={e => setEmailDraft(e.target.value)} onBlur={() => setAlertSettings({ email: emailDraft.trim() })} placeholder="you@example.com" />
                                            <button type="button" onClick={testEmail} disabled={!emailDraft.trim()} className={`${btn} bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 shrink-0`}>Send test</button>
                                        </div>
                                        {emailTest && <p className="mt-1 text-[10px] text-slate-500">{emailTest}</p>}
                                        <p className="mt-1 text-[10px] text-slate-400">Stored only in this browser. Emails are sent by the TradeSagar server (needs SMTP settings there).</p>
                                    </div>}
                                    <div>
                                        <span className={label}>Browser notifications</span>
                                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                            Permission: <b>{perm}</b>
                                            {perm === 'default' && (
                                                <button type="button" className="ml-2 text-indigo-500 hover:underline" onClick={() => Notification.requestPermission().then(setPerm).catch(() => {})}>Allow</button>
                                            )}
                                        </p>
                                        {perm === 'denied' && <p className="mt-1 text-[10px] text-amber-500">Blocked in your browser settings for this site — pop-ups will only show inside the app.</p>}
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-relaxed">
                                        Alerts, their log and these settings are saved in this browser only (localStorage). Alerts are checked while TradeSagar is open
                                        in a browser tab — background tabs are fine. Pop-ups and sound also follow the bell button in the toolbar.
                                    </p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
