# FinEngine

Static site on GitHub Pages:

- **Stock Investment Screener** (`./`): ROE, Piotroski F-Score and margin of safety for US large caps and the NIFTY 50, with a Top 5 page and daily charts.
- **Day Trader desk** (`./#daytrader`): the eleven-skill workflow from the open-source day-trader-skill (Scanner → News → Entry Timer → Exit Planner → Time Machine → Position Sizer → Risk Manager → Order Desk → Alerts, plus Earnings Analyst and Congress Tracker).

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

Then click **Snapshot** in the site header and paste the server's HTTPS URL (it's saved in your browser). You can also bake it in at build time with `VITE_API_BASE`. Fundamentals are cached for 12 hours and prices for 60 seconds. The screener refreshes every minute and applies your criteria to the live prices. If the server is unreachable, the site falls back to the snapshot.

Limits: GitHub Pages can't run a server, so the live API has to be hosted somewhere else. Yahoo's free data is delayed for some exchanges and is unofficial (it can rate-limit or change without notice).

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
