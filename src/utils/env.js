// Runtime environment check (domain lock). TradeSagar runs on forex24hr.com and
// tradesagar.com and their subdomains, plus localhost / private-network addresses for
// development. Elsewhere the app, the chart engine and the data worker refuse
// to run — a copied bundle hosted on another domain does not work as-is.
// The domains are stored encoded so they aren't plain searchable strings.
// (Client code can never be made impossible to copy; this raises the effort.)

const _k = ['QbvNmLyhGNygXZy9mZ', '02bj5ichdWYzVGZhJHd'];   // encoded, reversed

function _host() {
    try { return String((typeof self !== 'undefined' && self.location && self.location.hostname) || '').toLowerCase(); }
    catch { return ''; }
}

function _domain(k) {
    try {
        const b = k.split('').reverse().join('');
        return atob(b.length % 4 ? b + '='.repeat(4 - (b.length % 4)) : b);
    } catch { return '\u0000'; }
}

const _dev = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
    || /^10\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)
    || h.endsWith('.localhost') || h.endsWith('.local');

let _cache = null;
/** true when running on an allowed host. */
export function envReady() {
    if (_cache !== null) return _cache;
    const h = _host();
    _cache = !!h && (_dev(h) || _k.map(_domain).some(d => h === d || h.endsWith('.' + d)));
    return _cache;
}
