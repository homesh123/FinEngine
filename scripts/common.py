"""Shared helpers for the FinEngine data job (runs in GitHub Actions, not the browser).

Yahoo Finance, SEC and the House Clerk don't send CORS headers, so a static site
can't call them from the browser. This job calls them server-side and writes
plain JSON next to the site; the pages then only read same-origin files.
"""
import json
import math
import os
import time
from datetime import datetime, timezone

import requests

# SEC asks every client to identify itself (https://www.sec.gov/os/accessing-edgar-data)
SEC_UA = os.environ.get('SEC_USER_AGENT', 'FinEngine data job (github.com/homesh123/FinEngine) admin@example.com')

_session = requests.Session()
_session.headers['User-Agent'] = SEC_UA


def http_json(url, timeout=20, retries=2):
    for attempt in range(retries + 1):
        try:
            r = _session.get(url, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries:
                raise
            time.sleep(1.5 * (attempt + 1))


def http_bytes(url, timeout=30):
    r = _session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.content


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def num(v, digits=None):
    """float or None (NaN/inf/None/strings → None)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, digits) if digits is not None else f


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), allow_nan=False, default=str)
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def rsi(closes, n=14):
    """Wilder RSI of a pandas Series → last value."""
    d = closes.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, float('nan'))
    out = 100 - 100 / (1 + rs)
    return out.fillna(100.0)


def atr(df, n=14):
    """Wilder ATR series of an OHLC DataFrame (columns Open/High/Low/Close)."""
    import pandas as pd
    prev = df['Close'].shift(1)
    tr = pd.concat([df['High'] - df['Low'], (df['High'] - prev).abs(), (df['Low'] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()
