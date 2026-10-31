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

  Day Trader desk (runs the day-trader-skill in vendor/, see scripts/skill_desk.py):
    /api/desk                                 scanner, entry, exit, Time Machine, news, analyst, congress (cached 60 s)
    /api/desk/bars?symbol=                    today's and recent 5-minute bars
    /api/desk/plan?symbol=&target=2R&stop=or-mid    re-plan one breakout (exit + Time Machine)
    POST /api/desk/size-risk {plan, settings} trader-budget + trader-risk with your budget and limits
    add market=IN to /api/desk, /api/desk/bars and /api/desk/plan for the NSE desk (scripts/market_desk.py);
    India sizing and the risk check run in the browser (src/utils/dayTrader.js, same rules)
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))

import screener  # noqa: E402
import market_desk  # noqa: E402
import skill_desk  # noqa: E402
from build_data import CRITERIA  # noqa: E402
from common import now_iso  # noqa: E402

FUNDAMENTALS_TTL = 12 * 3600
PRICE_TTL = 60
DESK_TTL = 60
ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN', '*')
RULE_RE = re.compile(r'^(\d+(\.\d+)?R|price:\d+(\.\d+)?|or-mid|or-low|pct:\d+(\.\d+)?|atr:\d+(\.\d+)?)$')
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

_desk_lock = threading.Lock()
_desk_dir = {'path': None}          # work folder of the newest desk build (its charts are reused)


def desk():
    """The whole desk, rebuilt from live Yahoo bars at most once a minute."""
    def build():
        with _desk_lock:
            work = tempfile.mkdtemp(prefix='desk-')
            doc, bars = skill_desk.build_desk(work, log=lambda *_: None)
            old, _desk_dir['path'] = _desk_dir['path'], work
            if old:
                shutil.rmtree(old, ignore_errors=True)
            return dict(doc, generated_at=now_iso(), live=True), bars
    return cache.get(('desk',), DESK_TTL, build)


_in_charts = {}                     # NSE charts of the newest India desk build


def india_desk():
    """The NSE desk (the skill's rules on NSE hours), rebuilt at most once a minute."""
    def build():
        doc, bars = market_desk.build_india_desk(log=lambda *_: None, keep_charts=_in_charts)
        return dict(doc, generated_at=now_iso(), live=True), bars
    return cache.get(('desk', 'IN'), DESK_TTL, build)


def india_chart(sym):
    india_desk()
    if sym not in _in_charts:
        _in_charts[sym] = cache.get(('chart', sym + '.NS'), DESK_TTL, lambda: skill_desk.fetch_chart(sym + '.NS'))
    return _in_charts[sym]


def india_bars(sym):
    s = market_desk.NSE
    return skill_desk.compact_bars_tz(india_chart(sym), s.zone, s.open_min, s.close_min)


def india_replan(sym, target, stop):
    doc, _ = india_desk()
    entry = (doc['plans'].get(sym) or {}).get('entry')
    if not entry or entry.get('status') != 'triggered':
        raise ValueError(f'{sym} has no triggered breakout on this desk')
    if not re.fullmatch(r'\d+(\.\d+)?R', target) or stop not in ('or-mid', 'or-low'):
        raise ValueError('India re-plans take an R target and an or-mid / or-low stop')
    s = market_desk.NSE
    p = market_desk.plan(entry, s, stop, target)
    if 'refused' in p:
        raise ValueError(p['refused'])
    bars = market_desk.parse_chart(india_chart(sym), s, datetime.now(timezone.utc))
    return {'symbol': sym, 'entry': entry, 'plan': p, 'timemachine': market_desk.time_machine(bars, p, s)}


def chart_path(sym):
    """A 60-day chart for one symbol: from the newest desk build, else fetched now."""
    desk()
    path = os.path.join(_desk_dir['path'], 'charts', f'{sym}.json')
    if not os.path.exists(path):
        text = cache.get(('chart', sym), DESK_TTL, lambda: skill_desk.fetch_chart(sym))
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    return path


def desk_bars(sym):
    with open(chart_path(sym), encoding='utf-8') as f:
        return skill_desk.compact_bars(f.read())


def replan(sym, target, stop):
    doc, _ = desk()
    with tempfile.TemporaryDirectory() as work:
        skill_desk.write_config(work)
        return skill_desk.plan_symbol(work, sym, chart_path(sym), doc['as_of'], target=target, stop=stop)


def size_risk(body):
    plan, settings = body.get('plan'), body.get('settings') or {}
    if not isinstance(plan, dict) or not isinstance(settings, dict):
        raise ValueError('plan and settings must be objects')
    clean = {}
    for k, v in settings.items():
        if k in skill_desk.DEFAULT_CONFIG and isinstance(v, (int, float, str, bool)) and not isinstance(skill_desk.DEFAULT_CONFIG[k], list):
            clean[k] = v
    with tempfile.TemporaryDirectory() as work:     # on the desk's clock, like the plan it sizes
        return skill_desk.size_and_check(work, plan, clean, desk()[0]['as_of'])


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
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
            if path == '/api/desk':
                return self._send(200, (india_desk() if market == 'IN' else desk())[0])
            if path in ('/api/desk/bars', '/api/desk/plan'):
                sym = q.get('symbol', '').upper()
                if not SYMBOL_RE.match(sym):
                    return self._send(400, {'detail': 'Invalid symbol'})
                if path == '/api/desk/bars':
                    return self._send(200, {'symbol': sym, 'bars': india_bars(sym) if market == 'IN' else desk_bars(sym)})
                target, stop = q.get('target', skill_desk.TARGET), q.get('stop', skill_desk.STOP)
                if not (RULE_RE.match(target) and RULE_RE.match(stop)):
                    return self._send(400, {'detail': 'Invalid target or stop rule'})
                if market == 'IN':
                    try:
                        return self._send(200, india_replan(sym, target, stop))
                    except ValueError as e:
                        return self._send(400, {'detail': str(e)})
                return self._send(200, replan(sym, target, stop))
            return self._send(404, {'detail': 'Not found'})
        except Exception as e:
            return self._send(502, {'detail': f'Upstream data error: {e}'})

    def do_POST(self):
        if urlparse(self.path).path.rstrip('/') != '/api/desk/size-risk':
            return self._send(404, {'detail': 'Not found'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n > 64 * 1024:
                return self._send(413, {'detail': 'Too large'})
            return self._send(200, size_risk(json.loads(self.rfile.read(n) or b'{}')))
        except (ValueError, TypeError) as e:
            return self._send(400, {'detail': str(e)})
        except Exception as e:
            return self._send(502, {'detail': f'Skill error: {e}'})

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))


def warm(every=DESK_TTL - 5):
    """Keep the desk and the screeners built in the background, so requests answer at once."""
    def loop():
        while True:
            for name, job in (('desk', desk), ('desk IN', india_desk), ('screener US', lambda: screener_rows('US')),
                              ('screener IN', lambda: screener_rows('IN'))):
                try:
                    job()
                except Exception as e:      # an outage must not stop the loop
                    print(f'warm {name}: {e}', file=sys.stderr, flush=True)
            time.sleep(every)
    threading.Thread(target=loop, daemon=True, name='warm').start()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8000)))
    ap.add_argument('--warm', action='store_true', help='build the desk and screeners in the background, every minute')
    a = ap.parse_args()
    if a.warm:
        warm()
    print(f'FinEngine live API on http://{a.host}:{a.port}', flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
