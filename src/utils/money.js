// Currency formatting for the investment screens (INR → ₹, USD → $)
const SYMBOLS = { INR: '₹', USD: '$' };
const LOCALES = { INR: 'en-IN', USD: 'en-US' };

export function currencySymbol(currency) {
    return SYMBOLS[currency] ?? (currency ? `${currency} ` : '₹');
}

export function formatMoney(value, currency = 'INR', digits = 0) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    const n = Number(value).toLocaleString(LOCALES[currency] || 'en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
    return `${currencySymbol(currency)}${n}`;
}
