# FinEngine work log: live data, the day-trader-skill, new logo, server deploy

Dates: 29–31 October 2026 · Branch `ccr-acae6653-6ztlfg` · [PR #1](https://github.com/homesh123/FinEngine/pull/1) into `main`

This log records what was broken, what was changed and why, how the results
were checked, what is still limited, and what is left to do.

---

## 1. Status

| Item | State |
|---|---|
| Code changes | Done, on the branch, in PR #1 |
| Tests | 15 FinEngine tests + the skill's 315 tests pass |
| GitHub Pages | **Waiting on you:** Settings → Pages → Source → **GitHub Actions**, then merge PR #1 |
| Live API on the Forex24hr server | **Not deployed yet:** scripts are ready (`deploy/forex24hr/`) and need a run from the Mac |
| Old TradeSagar text pages | Logo replaced; text and links still say TradeSagar (decision pending, see section 9) |

---

## 2. What was wrong

1. **No backend.** The screener called `/api/investment/*` and the chart called
   `/api/history`. These endpoints belong to the TradeSagar FastAPI server and
   are not in this repo, so on GitHub Pages every call returned 404.
2. **CORS.** A page on `github.io` cannot read Yahoo Finance, SEC EDGAR or
   Nasdaq from the browser: they send no `Access-Control-Allow-Origin` header.
   The PyScript page (`public/daytrader.html`) runs into the same wall, because
   its `js.fetch` calls go to `query1.finance.yahoo.com` from the browser.
3. **The source did not build.** `src/pages/DayTrader.jsx` imported icons that
   don't exist in lucide (`Scanner`, `StopWatch`) and used `ArrowLeft` without
   importing it. So the *Deploy to GitHub Pages* workflow could never publish
   the current code.
4. **A stale bundle was being served.** The root `index.html` had been replaced
   by a compiled build, and copies of `public/` plus `assets/` were committed at
   the root. With Pages deploying from the branch, visitors got that old build.
5. **Two deployments race.** Both GitHub's branch build (*pages build and
   deployment*) and the Actions workflow publish on every push to `main`.

---

## 3. How it works now

```
                     GitHub Actions (every 15 min in US market hours, daily for fundamentals)
                     scripts/build_data.py
 Yahoo / SEC /  ───► ├─ screener.py      fundamentals, F-Score, daily candles
 House Clerk         └─ skill_desk.py    runs the day-trader-skill's own tools
                              │
                              ▼  JSON in ./data/ (same origin: no CORS)
 Browser ◄──── GitHub Pages: React app (screener + Day Trader desk)
    │
    └── optional "Live data" ──► https://app.forex24hr.com/finengine/  (nginx, existing cert)
                                   └─ C:\FinEngine  server/live_api.py on 127.0.0.1:8100
                                      (same Python code, fresh data, CORS headers)
```

- **Snapshot mode (default):** the site reads `./data/*.json` that the workflow publishes.
- **Live mode:** the header button (**Snapshot / Live**) stores a live-API URL in the
  browser. Live calls are tried first, and the snapshot is the fallback.
- **One source of truth for trading logic:** the day-trader-skill's Python. The
  browser only has ports of its sizing, risk and Time Machine rules, for when no
  live API is connected (section 6).

---

## 4. Changes, by area

### 4.1 Build and deployment
- `index.html` builds from `./src/main.jsx` again. Removed the committed `assets/`
  bundles and the root copies of `public/` files.
- `.github/workflows/deploy.yml`:
  - Triggers: push to `main`, by hand, and a schedule (every 15 min, Mon–Fri
    13:00–21:59 UTC; daily at 01:20 UTC).
  - Steps: build the site, run both test suites, run `scripts/build_data.py`
    into `dist/data`, then deploy.
  - Data step: `continue-on-error`, so a data outage can't block the site.
  - Fundamentals: cached between runs with `actions/cache`.
  - `pdftotext` (poppler) is installed so Congress PTRs can be read row by row.
- Routing: `#daytrader` opens the desk, and anything else opens the screener.
  Hash changes switch pages without a reload. Paths are relative, so the site
  works under `/FinEngine/`.

### 4.2 Screener (main page)
- **Data layer** (`src/utils/dataSource.js`): live API if one is set, else the snapshot.
- **Data job** (`scripts/screener.py`): 30 US large caps and the NIFTY 50.
  - Metrics: ROE, Piotroski F-Score (tests with missing data are skipped;
    lenders are marked), the analysts' target and margin of safety, holding horizon.
  - Daily trend: 50/200-day averages, RSI, ATR.
  - Daily candles for the chart.
- **Criteria applied in the browser** (`src/utils/screenerRules.js`):
  - BUY / BUY ON DIP / WATCH / AVOID, from your saved criteria. *Criteria Config*
    saves in the browser.
  - **"Only stocks that pass my criteria"** filter, on by default, showing
    "x of y pass".
  - Live mode refreshes every minute.
- **Top 5** is ranked in the browser from the same data.
- **Day Trader banner** at the top of the main screen, plus a header button.
- **"Full chart"** opens Yahoo Finance; the chart app it used to target isn't in this repo.

### 4.3 Live API (`server/live_api.py`)
- Standard-library HTTP server with CORS (`ALLOWED_ORIGIN`, default `*`).
- Endpoints:

| Endpoint | What |
|---|---|
| `GET /api/health` | up? |
| `GET /api/investment/screener?market=US\|IN` | fundamentals (cached 12 h) + live price (60 s) |
| `GET /api/investment/analyze/<SYM>` | any symbol on demand |
| `GET /api/investment/search?q=` | Yahoo search, filtered by market |
| `GET /api/history?symbol=` | daily candles |
| `GET /api/desk` | the whole Day Trader desk (rebuilt at most once a minute) |
| `GET /api/desk/bars?symbol=` | 60 days of 5-minute bars |
| `GET /api/desk/plan?symbol=&target=&stop=` | re-plan: exit planner + Time Machine |
| `POST /api/desk/size-risk` | `size.py` + `check.py` with your budget and limits |

- `--warm` keeps the desk and both screeners built in the background.
- Symbols and stop/target rules are validated before use; bodies over 64 KB are refused.

### 4.4 Day Trader desk and the day-trader-skill
- **The skill.** The page `cloud9markets.com/day-trader-skill.html` was blocked
  by this environment's network policy, but its source is open:
  [Jakeschincariol/day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill) (MIT).
  - It is vendored **unmodified** in `vendor/day-trader-skill` at commit
    `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd`; see `vendor/README.md`.
  - Before vendoring, its code was reviewed. It only reads public data (Yahoo,
    Nasdaq Trader, SEC, House Clerk, Stooq). It never places orders. It writes
    only to its own `trader/` folder. Its only subprocess is an optional local `pdftotext`.
- **The bridge** (`scripts/skill_desk.py`) calls the skill's tools with `--json`:

| Tab | Skill tool |
|---|---|
| Scanner | `scan.py orb` (opening-range breakouts) + `scan.py daily` (pre-market setups) |
| News | `news.py` (Yahoo headlines, SEC 8-Ks, today's move) |
| Entry Timer | `entry.py check` |
| Exit Planner | `exit.py plan` (default stop: range midpoint, target 2R; 1R/1.5R/3R and range low selectable) |
| Time Machine | `timemachine.py run` (10,000 replays, seed 19, + the same rule on every past session) |
| Budget | `size.py` |
| Risk Manager | `check.py` |
| Order Desk | paper only, needs a typed **yes** (like `trader-broker`, nothing reaches a broker) |
| Alerts | `alerts.py clock` + browser notifications (stop, target, flat-by, watched triggers) |
| Earnings Analyst | `facts.py` (SEC XBRL quarters, what changed, earnings release links) |
| Congress | `ptr.py index` + `ptr.py fetch` (trades inside the newest House PTRs) |

- **One Yahoo request per symbol** (60 days of 5-minute bars) feeds the scanner,
  the entry timer and the Time Machine through their `--offline` option, so all
  three see the same bars. The browser gets a compact copy for the chart.
- **Watchlist:** 40 liquid US stocks (`DT_WATCHLIST`); up to 8 breakouts are
  carried through entry → exit → Time Machine (`DT_MAX_PLANS`).
- **Clock:** the desk is pinned to the newest complete 5-minute bar. After the
  close it shows the last session.
- Each panel is labelled with the tool that produced it. "· browser" marks a
  browser fallback.
- FinEngine's own earlier reimplementation (`scripts/daytrader.py`) was removed.

### 4.5 New logo
- Indigo-to-violet rounded tile, white "F", emerald rising trend arrow. It reads
  on dark and light backgrounds and at 16 px.
- Files: `public/logo.svg`, `logo-light.svg` and `favicon.svg` (all the same
  mark). Rendered from it: `favicon.png` (192), `favicon-512.png`,
  `apple-touch-icon.png` (180, square corners for iOS) and `favicon.ico` (16/32/48).
- `site.webmanifest` renamed to FinEngine, and `index.html` links the PNG,
  apple-touch and manifest icons.

### 4.6 Server deployment (Forex24hr VPS, Windows Server 2016)
Files in `deploy/forex24hr/` (details in its README):

| File | What it does |
|---|---|
| `deploy-from-mac.sh` | Clones the branch, zips `scripts server vendor deploy`, uploads with `~/.ssh/forex24hr_vps`, runs the installer, checks the public URL |
| `install-finengine.ps1` | Unpacks to `C:\FinEngine\app`, installs Python 3.12 if no 3.9+ is present, creates `C:\FinEngine\venv`, writes `finengine.env`, registers the scheduled task **FinEngine live API** (SYSTEM, at boot, restarts on failure), waits for `/api/health`, adds `include finengine-location.conf;` to the `app.forex24hr.com` server blocks (backup first; `nginx -t`; restores the backup if the test fails), reloads nginx |
| `run-api.cmd` | Starts `live_api.py --warm` on `127.0.0.1:8100`, logging to `C:\FinEngine\logs\api.log` |
| `finengine-location.conf` | `location /finengine/` → `127.0.0.1:8100`, 300 s timeouts |

Isolation from the existing services:
- TradeSagar (`C:\ChartStudio`, port 8000) and its Python are not touched.
- Unlike TradeSagar, this service needs no Remote Desktop log-on after a restart.

Windows fixes in the code:
- `tzdata` for time zones.
- UTF-8 for every file the code reads or writes, and Python's UTF-8 mode for the
  skill's tools (the server's default code page is cp1252).

### 4.7 Merge with `main`
`main` had four newer commits from the Mac: the PyScript `daytrader.html`, static
screener JSON, `InvestmentScreenerStatic.jsx` and rebuilt bundles. The merge
(`57de1e9`):
- Keeps their new files.
- Uses this branch's version where both sides rewrote the same file
  (`index.html`, `InvestmentScreener.jsx`, `DayTrader.jsx`).
- Drops the regenerated `assets/` bundles and the root copy of `daytrader.html`.

---

## 5. Validation

**Against the skill's published example.** This is the skill README's TSLA
trade on Monday 19 Oct 2026, run on its recorded real 5-minute bars.

| Step | Skill README | FinEngine desk |
|---|---|---|
| Scanner | range 354.47–362.18, 10:15 close 364.18 (+0.55 %) | same |
| Entry | triggered 10:15 AM at 364.18 | same |
| Exit (1R) | stop 358.32 (risk 5.86), target 370.04 | same |
| Time Machine | target 29.4 %, stop 25.5 %, neither 45.1 % | same (0.2938 / 0.2548 / 0.4514) |
| History | 59 sessions, fired 33: 13 target, 15 stop, 5 neither | same |
| Budget ($5,000, $50 max loss) | 8 shares, $2,913.44, max loss $46.88 | same |
| Risk | PASS | PASS |

Tests (all run in CI):
- `vendor/day-trader-skill/tests`: the skill's own **315 tests**, all pass.
- `scripts/test_build_data.py`: the table above, plus the screener's F-Score and
  margin of safety, and a full snapshot build.
- `scripts/test_live_api.py`:
  - Live prices replace cached ones, and margin of safety is recomputed.
  - CORS headers are sent.
  - The desk endpoints run the skill, and bad symbols or rules are refused.
- `scripts/test_js_parity.py` compares the browser fallbacks with the skill's Python:
  - Sizing and PASS/BLOCK reasons are **identical** on 9 scenarios (binding
    limits, refusals, entry window, daily loss).
  - Time Machine odds agree within 1.5 points (browser: 29.1 / 25.7 / 45.1).

In the browser (headless Chromium, site served under `/FinEngine/`):
- Both pages work in snapshot and live mode with no console errors.
- Live mode returns the skill's exact numbers.
- The criteria filter hides failing stocks.
- The logo shows correctly in both themes.

**Bugs found and fixed during validation:**
- **Time Machine:** the browser replayed the whole day instead of starting at
  the entry (target 46.0 % instead of 29.4 %). Fix: plans now carry
  `entry_time` and `entry_bar`.
- **Live prices:** with one symbol, recent yfinance still nests columns under the
  ticker, so the live price was silently ignored.
- **Risk Manager:** an earlier version let a "coin flip" trade pass.

**Not yet verified:** real live market data. This development sandbox cannot
reach Yahoo, SEC or the server, so the first workflow run (and the first server
deploy) is the live test. Check their logs. The PowerShell installer was reviewed
by hand; no PowerShell was available to run it.

---

## 6. Technical limitations

- **GitHub Pages is static.** Live data needs the live API on a server (the
  Forex24hr VPS). Without it:
  - The desk refreshes about every 15 minutes in US market hours, and fundamentals daily.
  - GitHub's scheduler often runs late, and pauses scheduled workflows after 60
    days without repository activity.
  - Changing stop/target, budget or limits uses the browser fallbacks: no
    history replay, and slightly different Time Machine draws.
- **Yahoo's free endpoints are unofficial:** they can lag, rate-limit or change
  without notice. NSE quotes are delayed.
- **40-stock watchlist,** not the skill's full ~5,900-stock universe, to stay
  polite to Yahoo every 15 minutes.
- **Long trades only.** The skill plans opening-range breakouts on the long side.
- **Paper only.** No order ever reaches a broker; the paper book is stored per browser.
- **Congress: House only.** Senate filings sit behind an agreement that has to
  be accepted by hand.
- **Analyse any symbol** (outside the saved lists) works only with the live API.
- **Alerts** ring only while the page is open.
- **`public/daytrader.html`** (PyScript) is still published at `/daytrader.html`
  but cannot load data on github.io (CORS). The Day Trader link opens the new desk.

---

## 7. Commits on the branch

| Commit | What |
|---|---|
| `55ffaee` | Fix data loading on GitHub Pages; data job; first desk |
| `d298bcf` | Live data API, criteria filter, Day Trader entry on the main screen |
| `c806a1b` | Run the real day-trader-skill on the desk, live or snapshot |
| `57de1e9` | Merge `main` |
| `4f4c0b1` | New FinEngine logo |
| `8396321` | Deploy the live API to the Forex24hr server (`C:\FinEngine`) |

---

## 8. How to

**Run locally**
```bash
npm ci && pip install -r scripts/requirements.txt
python scripts/build_data.py --out public/data     # needs internet
npm run dev
```

**Run the tests**
```bash
python -m unittest discover -s vendor/day-trader-skill/tests
SEC_USER_AGENT="Your Name you@example.com" python -m unittest discover -s scripts
```

**Live API on any machine**
```bash
python server/live_api.py --port 8000 --warm
```
Then click **Snapshot** in the site header and paste the server's HTTPS URL.

**Deploy or update the server** (from the Mac, on the home network)
```bash
bash deploy/forex24hr/deploy-from-mac.sh            # or: ... main
```
Then paste `https://app.forex24hr.com/finengine` under **Snapshot**.

**Update the vendored skill:** replace `vendor/day-trader-skill` with the new
upstream version, update the commit in `vendor/README.md`, and run both test suites.

**Knobs** (environment variables for the data job and live API):

| Variable | Default | What |
|---|---|---|
| `DT_WATCHLIST` | 40 liquid US stocks | symbols the desk scans |
| `DT_MAX_PLANS` | 8 | breakouts carried through to the Time Machine |
| `DT_TARGET` / `DT_STOP` | `2R` / `or-mid` | the desk's default plan |
| `DT_PTR_DETAIL` | 8 | newest PTRs read row by row |
| `SEC_USER_AGENT` | (required by SEC) | name and email sent to SEC |
| `ALLOWED_ORIGIN` | `*` | CORS origin of the live API |
| `VITE_API_BASE` | empty | bake a live-API URL into the site build |

---

## 9. Left to do

1. **GitHub → Settings → Pages → Source → GitHub Actions.** Do this before merging
   PR #1: while Pages deploys from the branch, the merge would serve the source
   `index.html` and the site would be blank.
2. **Merge PR #1**, then check the first workflow run (tests, data step, deploy).
3. **Deploy the live API** with `deploy/forex24hr/deploy-from-mac.sh`. Or connect
   a Mac folder to a Claude session via Remote Control and have it run the deploy:
   the Desktop folder was not offered to cloud sessions, so updating the Claude
   app or adding another folder may be needed.
4. Optionally bake `https://app.forex24hr.com/finengine` into the site
   (`VITE_API_BASE`), so every visitor gets live data without pasting the URL.
5. Decide on the old TradeSagar pages (`about.html`, `privacy.html`,
   `disclaimer.html`, `ocean.html`, `llms.txt`, `robots.txt`, `sitemap.xml`):
   rebrand them for FinEngine, or remove them. The privacy and disclaimer pages
   are legal text written for TradeSagar's service and domains.
6. Optionally stop the second, racing deployment: once the source is GitHub
   Actions, the branch build stops by itself.

*Educational only, not financial advice. Most day traders lose money: paper trade first.*
