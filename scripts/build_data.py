"""Build the JSON snapshots the static site reads.

    python scripts/build_data.py --out public/data          # local dev (vite serves public/)
    python scripts/build_data.py --out dist/data                       # GitHub Actions

Fundamentals (screener) change slowly and take a few minutes, so they are rebuilt
once a day and reused from --cache in between; the day-trader desk is rebuilt on
every run. A failure in one part never stops the other from being written.
"""
import argparse
import os
import shutil
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))

from common import now_iso, read_json, write_json  # noqa: E402

CRITERIA = {
    'roe_min': 15.0, 'roic_min': 15.0, 'eps_growth_min': 12.0, 'revenue_growth_min': 10.0,
    'gross_margin_min': 40.0, 'debt_to_equity_max': 0.5, 'peg_max': 1.5,
    'margin_of_safety_min': 20.0, 'f_score_min': 7,
}


def log(msg):
    print(msg, flush=True)


def build_screener(cache_dir, force):
    import screener
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    stamp = os.path.join(cache_dir, 'screener', 'built.txt')
    if not force and os.path.exists(stamp) and open(stamp).read().strip() == today:
        log('screener: reusing today\'s cached fundamentals')
        return
    for market in ('US', 'IN'):
        log(f'screener {market}: analysing {len(screener.UNIVERSES[market])} stocks')
        rows, history, errors = screener.build(market, log)
        if not rows:
            log(f'screener {market}: no data, keeping the previous snapshot')
            continue
        write_json(os.path.join(cache_dir, 'screener', f'screener-{market}.json'),
                   {'generated_at': now_iso(), 'market': market, 'universe': 'US large caps' if market == 'US' else 'NIFTY 50',
                    'data': rows, 'errors': errors})
        for sym, bars in history.items():
            write_json(os.path.join(cache_dir, 'screener', 'history', f'{sym}.json'), bars)
    with open(stamp, 'w') as f:
        f.write(today)


def build_desk(cache_dir):
    """The Day Trader desk, from the day-trader-skill's own tools (scripts/skill_desk.py)."""
    import tempfile
    import skill_desk
    dest = os.path.join(cache_dir, 'desk')
    with tempfile.TemporaryDirectory() as work:
        try:
            desk, bars = skill_desk.build_desk(work, log=log)
        except Exception as e:
            if os.path.exists(os.path.join(dest, 'daytrader.json')):
                log(f'desk: {e}; keeping the previous snapshot')
                return
            raise
    desk['generated_at'] = now_iso()
    shutil.rmtree(os.path.join(dest, 'intraday'), ignore_errors=True)
    for sym, rows in bars.items():
        write_json(os.path.join(dest, 'intraday', f'{sym}.json'), {'symbol': sym, 'bars': rows})
    write_json(os.path.join(dest, 'daytrader.json'), desk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='public/data')
    ap.add_argument('--cache', default='.data-cache', help='where daily fundamentals are kept between runs')
    ap.add_argument('--only', choices=['screener', 'desk'])
    ap.add_argument('--force-screener', action='store_true')
    a = ap.parse_args()
    cache = a.cache
    os.makedirs(a.out, exist_ok=True)
    write_json(os.path.join(a.out, 'criteria.json'), CRITERIA)

    if a.only != 'desk':
        try:
            build_screener(cache, a.force_screener)
        except Exception as e:
            log(f'screener failed: {e}')
        src = os.path.join(cache, 'screener')
        if os.path.isdir(src):     # publish the cached fundamentals into the site
            shutil.copytree(src, a.out, dirs_exist_ok=True, ignore=shutil.ignore_patterns('built.txt'))
    if a.only != 'screener':
        try:
            build_desk(cache)
        except Exception as e:
            log(f'desk failed: {e}')
        src = os.path.join(cache, 'desk')
        if os.path.isdir(src):
            shutil.copytree(src, a.out, dirs_exist_ok=True)
    write_json(os.path.join(a.out, 'status.json'), {'generated_at': now_iso()})


if __name__ == '__main__':
    main()
