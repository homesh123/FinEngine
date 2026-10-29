// App-wide confirmation dialog (replaces the browser's window.confirm).
//   if (!(await confirmDialog({ title: 'Remove all indicators?', message: '…', confirmLabel: 'Remove all', danger: true }))) return;
// <ConfirmHost /> (mounted once in App.jsx) renders the dialog.
let listener = null;
const queue = [];

export function confirmDialog(opts) {
    return new Promise((resolve) => {
        queue.push({ ...opts, resolve });
        if (listener) listener();
        else {                                           // host not mounted (should not happen): fall back
            const q = queue.pop();
            resolve(window.confirm([q.title, q.message].filter(Boolean).join('\n\n')));
        }
    });
}

/** Used by ConfirmHost: subscribe to new requests; returns the current one. */
export function subscribeConfirm(fn) {
    listener = fn;
    return () => { if (listener === fn) listener = null; };
}
export const currentConfirm = () => queue[0] || null;
export function settleConfirm(result) {
    const q = queue.shift();
    if (q) q.resolve(result);
    if (listener) listener();
}
