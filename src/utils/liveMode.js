// Live mode (?live=true, e.g. a big screen or a stream): Pro features without ads,
// dark theme, no Signal Tester, and the chart keeps following the live candle.
// Read from the URL on every load; in-app navigation keeps the query string (route.js).
export const LIVE_MODE = new URLSearchParams(window.location.search).get('live') === 'true';
