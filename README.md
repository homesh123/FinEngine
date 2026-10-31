# FinEngine

Static site on GitHub Pages:

- **Stock Investment Screener** (`./`): ROE, Piotroski F-Score and margin of safety for US large caps and the NIFTY 50, with a Top 5 page and daily charts.
- **Day Trader desk** (`./#daytrader`, also linked from the main screen): runs the open-source [day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill) (MIT), vendored unmodified in `vendor/day-trader-skill`. Scanner → News → Entry Timer → Exit Planner → Time Machine → Budget → Risk Manager → Order Desk (paper) → Alerts, plus Earnings Analyst and Congress (House PTRs). `scripts/skill_desk.py` calls the skill's own tools with `--json`; one Yahoo request per symbol (60 days of 5-minute bars) feeds the scanner, entry timer and Time Machine.

### Validation

- The skill's own 315 tests (recorded real market data) run in CI.
- `scripts/test_build_data.py` runs FinEngine's desk on the skill's recorded TSLA session (2026-10-19) and checks the README's numbers: range 354.47–362.18, trigger 10:15 AM at 364.18, stop 358.32, target 370.04 (1R), Time Machine 29.4 % / 25.5 % / 45.1 %, history 33 of 59 (13 / 15 / 5), 8 shares, $2,913.44, $46.88, PASS.
- `scripts/test_js_parity.py` checks the browser fallbacks (`src/utils/dayTrader.js`, used when no live API is connected) against the skill: sizing and PASS/BLOCK verdicts are identical on 9 scenarios, and the Time Machine's odds agree within 1.5 points (the browser uses a different random generator).

## Where the data comes from (and why there's no CORS problem)

Yahoo Finance, SEC EDGAR and the House Clerk don't send CORS headers, so a page on `github.io` can't call them from the browser. Instead, `scripts/build_data.py` fetches them **server-side in GitHub Actions** and publishes JSON next to the site (`./data/*.json`). The pages read those same-origin files.

| Snapshot | Refreshed |
| --- | --- |
| Day Trader desk (5-minute bars, news, filings, earnings, congress) | every 15 min, Mon–Fri 13:00–21:59 UTC (US market hours) |
| Screener fundamentals + daily candles | once a day (01:20 UTC) |

GitHub's scheduler can run late, and Yahoo's prices are delayed. Treat the desk as near-real-time, not tick-by-tick. GitHub also pauses scheduled workflows after 60 days with no repository activity.

## Live data

For live prices, run the FinEngine live API on any server you control. It fetches from Yahoo server-side and adds CORS headers:

```bash
pip install -r scripts/requirements.txt
python server/live_api.py --port 8000        # honours $PORT (Render, Fly.io, Railway…)
```

The Day Trader desk then runs the skill live as well (rebuilt at most once a minute), and changing the stop/target, budget or limits re-runs the skill's exit planner, Time Machine, `size.py` and `check.py`. Set `SEC_USER_AGENT="Your Name you@example.com"` on the server (SEC requires it) and install `pdftotext` (poppler) to read Congress PTRs row by row.

Then click **Snapshot** in the site header and paste the server's HTTPS URL (it's saved in your browser). You can also bake it in at build time with `VITE_API_BASE`. Fundamentals are cached for 12 hours and prices for 60 seconds. The screener refreshes every minute and applies your criteria to the live prices. If the server is unreachable, the site falls back to the snapshot.

Limits:
- GitHub Pages can't run a server, so the live API has to be hosted somewhere else. Without it the site shows the snapshot (about every 15 minutes in US market hours, fundamentals daily), and re-planning uses the browser fallbacks: no history replay, and slightly different Time Machine draws.
- Yahoo's free endpoints are unofficial: they can lag, rate-limit or change without notice. NSE (India) quotes from Yahoo are delayed.
- The desk scans a 40-stock watchlist (`DT_WATCHLIST`), not the skill's full ~5,900-stock universe, to stay polite to Yahoo every 15 minutes.
- The skill plans longs only (opening-range breakouts), and its Order Desk never sends orders to a broker; neither does FinEngine (paper only).
- Congress covers the House only (Senate filings require accepting an agreement by hand).

Hosted: the live API runs on the Forex24hr server at `https://app.forex24hr.com/finengine` (see `deploy/forex24hr/README.md`).

## Setup

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the *Deploy to GitHub Pages* workflow by hand). The first run publishes the data.

## Local development

```bash
npm ci
pip install -r scripts/requirements.txt
python scripts/build_data.py --out public/data   # fetch a snapshot (needs internet)
npm run dev
python -m unittest discover -s scripts            # offline tests for the data job
```

Educational only, not financial advice. The Order Desk is paper-only: orders are kept in your browser.
