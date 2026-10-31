"""FinEngine live API: fresh market data for the static site, with CORS.

The site on GitHub Pages can't call Yahoo Finance itself (Yahoo sends no CORS
headers), so this small server does it and answers with
Access-Control-Allow-Origin. Run it anywhere Python runs (Render, Fly.io, a
VPS, your own PC) and paste its URL into the site's "Live data" setting.

    pip install -r scripts/requirements.txt
    python server/live_api.py --port 8000

Endpoints (all GET, JSON):
    /api/health
    /api/investment/screener?market=US|IN    fundamentals (cached 12 h) + live price
    /api/investment/analyze/<SYMBOL>?market=  any symbol, on demand
    /api/investment/search?q=&market=
    /api/investment/criteria                  default criteria (the browser applies them)
    /api/history?symbol=<YAHOO SYMBOL>        daily candles
"""
import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))

import screener  # noqa: E402
from build_data import CRITERIA  # noqa: E402
from common import now_iso  # noqa: E402

FUNDAMENTALS_TTL = 12 * 3600
PRICE_TTL = 60
ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN', '*')
SYMBOL_RE = re.compile(r'^[A-Z0-9.\-&^=]{1,20}$')


class TTLCache:
    def __init__(self):
        self._data, self._lock = {}, threading.Lock()

    def get(self, key, ttl, compute):
        with self._lock:
            hit = self._data.get(key)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
        value = compute()
        with self._lock:
            self._data[key] = (time.time(), value)
        return value


cache = TTLCache()


def analyzed(symbol, market):
    """(row, daily candles) for one stock; the expensive part, cached for hours."""
    return cache.get(('analyze', symbol, market), FUNDAMENTALS_TTL, lambda: screener.analyze(symbol, market))


def live_prices(symbols):
    """Last traded price for many Yahoo symbols in one request (1-minute bars, today)."""
    import yfinance as yf

    def fetch():
        df = yf.download(symbols, period='1d', interval='1m', progress=False, group_by='ticker', threads=True)
        out = {}
        for s in symbols:
            try:
                # yfinance nests columns under the ticker (even for one symbol in recent versions)
                col = df[s]['Close'] if isinstance(df.columns, pd.MultiIndex) else df['Close']
                col = col.dropna()
                if len(col):
                    out[s] = float(col.iloc[-1])
            except (KeyError, IndexError, TypeError):
                pass
        return out
    return cache.get(('prices', tuple(sorted(symbols))), PRICE_TTL, fetch)


def with_live_price(row, price):
    """Recompute the price-dependent fields of a cached fundamentals row."""
    if not price:
        return row
    r = dict(row, current_price=round(price, 2), price_live=True)
    t = r.get('target_price')
    if t:
        r['margin_of_safety'] = round((t - price) / t * 100, 2)
        r['upside_pct'] = round((t - price) / price * 100, 2)
    return r


def screener_rows(market):
    syms = screener.UNIVERSES[market]
    errors = []

    def one(sym):
        try:
            return analyzed(sym, market)[0]
        except Exception as e:
            errors.append(f'{sym}: {e}')
            return None
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = [r for r in pool.map(one, syms) if r]
    prices = live_prices([screener.yahoo_symbol(r['symbol'], market) for r in rows]) if rows else {}
    rows = [with_live_price(r, prices.get(screener.yahoo_symbol(r['symbol'], market))) for r in rows]
    return {'generated_at': now_iso(), 'market': market, 'live': True,
            'universe': 'US large caps' if market == 'US' else 'NIFTY 50', 'data': rows, 'errors': errors}


def search(q, market):
    import yfinance as yf
    quotes = yf.Search(q, max_results=10, news_count=0).quotes or []
    out = []
    for item in quotes:
        sym = item.get('symbol', '')
        if item.get('quoteType') not in ('EQUITY', 'ETF'):
            continue
        is_in = sym.endswith('.NS') or sym.endswith('.BO')
        if (market == 'IN') != is_in:
            continue
        out.append({'symbol': sym.removesuffix('.NS').removesuffix('.BO') if market == 'IN' else sym,
                    'name': item.get('shortname') or item.get('longname') or sym, 'exchange': item.get('exchange', '')})
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = 'FinEngineLive/1.0'

    def _send(self, status, body):
        data = json.dumps(body, default=str).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        market = 'IN' if q.get('market', 'US').upper() == 'IN' else 'US'
        path = url.path.rstrip('/')
        try:
            if path == '/api/health':
                return self._send(200, {'ok': True, 'time': now_iso()})
            if path == '/api/investment/screener':
                return self._send(200, screener_rows(market))
            if path == '/api/investment/criteria':
                return self._send(200, CRITERIA)
            if path == '/api/investment/search':
                return self._send(200, {'data': search(q.get('q', '')[:40], market)})
            if path.startswith('/api/investment/analyze/'):
                sym = unquote(path.rsplit('/', 1)[1]).upper()
                if not SYMBOL_RE.match(sym):
                    return self._send(400, {'detail': 'Invalid symbol'})
                row = analyzed(sym, market)[0]
                price = live_prices([screener.yahoo_symbol(sym, market)]).get(screener.yahoo_symbol(sym, market))
                return self._send(200, {'data': with_live_price(row, price)})
            if path == '/api/history':
                ysym = q.get('symbol', '').upper()
                if not SYMBOL_RE.match(ysym):
                    return self._send(400, {'detail': 'Invalid symbol'})
                market_of = 'IN' if ysym.endswith('.NS') else 'US'
                base = ysym.removesuffix('.NS') if market_of == 'IN' else ysym
                return self._send(200, analyzed(base, market_of)[1])
            return self._send(404, {'detail': 'Not found'})
        except Exception as e:
            return self._send(502, {'detail': f'Upstream data error: {e}'})

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8000)))
    a = ap.parse_args()
    print(f'FinEngine live API on http://{a.host}:{a.port}', flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
