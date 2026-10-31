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
| `auto-update.ps1` | Run every 5 minutes by the task **FinEngine auto-update**: installs each backend commit on `main` (see 6d) |
| `backend-hash.ps1` | Fingerprint of `scripts server vendor deploy`, so website-only commits don't restart the API |

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

## 6a. After launch (31 Oct)

**PR #1 merged.** The first live run fetched real data (40 desk charts and both screeners), but the Day Trader page
said "No data snapshot yet". The skill's scanner only runs between 9:50 AM (the first bar after the opening range)
and 3:30 PM ET (the last entry time), and the run was on a Saturday, so it refused.

**PR #2 (merged):**
- Outside that window the desk replays a session as of 3:30 PM: the same day after 3:30 (and on weekends), the
  previous session before 9:50. The page says which session it is showing.
- A failing scanner or clock no longer blanks the desk.
- `LTIM` was dropped from the NIFTY list: Yahoo reports it as delisted.

**India desk.** The skill hard-codes NYSE hours, so NSE stocks use `scripts/market_desk.py`: the skill's rules
with the exchange session as a parameter.
- **Sessions:**
  - NSE: 09:15–15:30 IST, 75 bars; entries 09:30–15:00; flat by 15:25; ₹ budget defaults.
  - NYSE: 9:30–16:00 ET, 78 bars.
- **Proof the rules are the same:** run with the NYSE session on the skill's recorded TSLA day, the port
  reproduces the skill draw for draw. That covers the entry, the plan, the Time Machine (29.38 / 25.48 / 45.14 %,
  bands and history trades identical), and the daily setups (0 mismatches on 500 random series in the tests,
  3,000 in a one-off check). See `scripts/test_market_desk.py`.
- **On the page:** a 🇺🇸 US / 🇮🇳 India switch on the Day Trader desk. India panels are marked "NSE port". The
  Earnings Analyst and Congress tabs are US-only (they read SEC and US House filings). India news is Yahoo
  headlines only. India budget and risk use the browser ports (the skill's tools run on New York time).
- **Data:** the snapshot job also writes `daytrader-IN.json` and `intraday-IN/`, and runs every 15 min in NSE
  hours (03:45–10:00 UTC).
- **Live API:** `market=IN` on `/api/desk`, `/api/desk/bars` and `/api/desk/plan`.

**Live data for both markets** comes from the live API on the Forex24hr server once it is deployed (section 9). The
snapshot is the fallback. Moving the API to another server: `deploy/forex24hr/README.md`, "Moving to a new
server".

## 6b. UX redesign (31 Oct)

**Whole app**
- One header for both pages: FinEngine, **Screener / Day Trader**, a single 🇮🇳 India / 🇺🇸 US switch
  (India by default, shared by both pages; earlier per-page choices carry over), Live/Snapshot, theme.

**Screener**
- Summary tiles that double as filters: Pass my criteria / Buy now / Buy on dip / Watch / All.
- A compact table you can sort by any column: price, signal, upside, margin of safety, ROE, F-Score, and trend
  (50 / 200-day, RSI).
- Click a stock for a detail panel (a bottom sheet on phones): chart, why, timing, analysts' target, holding
  period, nine key numbers, and **TradingView**.

**Day Trader:** the trade on one page instead of 7 tab clicks.
- Breakouts list on the left; the selected trade on the right.
- A step strip (Setup → Plan → Odds → Size → Risk → Order) that jumps to each section and is coloured by status.
- Secondary tabs: News, Orders & alerts, Earnings and Congress (the last two US only).

**TradingView:** charts open there (`NSE:` prefix for India, e.g. `NSE:M_M`; `BRK.B` for US class shares).

**Paper orders:** kept per market ($ and ₹ books don't mix).

**Apple Human Interface Guidelines**, checked by an automated phone audit:
- Bottom tab bar for the two pages on phones, clear of the home indicator (`viewport-fit=cover`, safe-area padding).
- Every control at least 44 × 44 pt on phones. The (i) icons stay small but have a 44 pt tap area, verified by
  hit-testing.
- No text under 11 px.
- Visible keyboard focus; animations respect Reduce Motion.
- A grabber on the bottom sheet.
- One Watch control per trade instead of two; no truncated dropdowns.

**Checked:**
- No horizontal overflow at 390 px; no console errors.
- Desktop and phone flows: filters, sorting, detail, search, re-plan (1R gives coin flip 29.1 / 25.7), size,
  risk PASS, paper order, India switch (₹, 170 shares), market kept across pages, bottom tabs.
- The "UI UX Pro Max" skill isn't installed in this environment; the review followed Apple's guidelines directly.

## 6c. Indian stocks: the `.NS` fix and Upstox via TradeSagar (31 Oct)

**`.NS` fix (PR #5).** After #3 the India desk published nothing: Yahoo answered 404 for every NSE stock. The skill's
Yahoo client turns `.` into `-` for US class shares (BRK.B → BRK-B), so `RELIANCE.NS` became `RELIANCE-NS`. The India desk
now uses its own fetcher, `market_desk.fetch_chart`, which keeps the symbol as given, with the same query2 → query1
fallback and 429 retry. A test pins the URLs.

**Second India failure (PR #7).** After the `.NS` fix the next run failed with `'>' not supported between instances
of 'dict' and 'dict'`. The desk picked the newest bar across stocks with `max()` over dicts. The tests used a single
stock, where `max()` never compares, so they missed it. The fix compares by (date, time), and a two-stock test now
reproduces the original error without the fix.

**Upstox, reusing TradeSagar's login.** TradeSagar (`C:\ChartStudio\backend`, port 8000) already logs in to Upstox
every day, so FinEngine doesn't log in separately.
- **Where it applies:** only the live API on the Forex24hr server.
  - It asks TradeSagar's `/api/upstox/status` whether Upstox is connected.
  - If it is, it gets NSE 5-minute candles from `/api/upstox/history?symbol=NSE:<SYM>&interval=5min`.
- **Merge rule:** Upstox candles replace Yahoo's for every day Upstox covers (today, live). Yahoo keeps the older
  sessions, because the Time Machine needs at least 20 full ones.
- **Fallback:** if TradeSagar isn't running (after a restart, until someone logs in by Remote Desktop), Upstox isn't
  logged in, or the token is missing, the desk uses Yahoo. The Day Trader page shows **Data: Upstox (via TradeSagar) +
  Yahoo history** or **Data: Yahoo Finance**; the tooltip gives the reason.
- **The token never leaves the server.** The installer reads TradeSagar's `TRADING_API_TOKEN` from
  `C:\ChartStudio\backend\.env.local` and writes `TRADESAGAR_TOKEN` and `TRADESAGAR_API` into
  `C:\FinEngine\finengine.env`, restricted to Administrators and SYSTEM. Nothing is in the repo or the website.
- **The GitHub snapshot stays on Yahoo:** GitHub Actions can't reach TradeSagar's backend on the server.
- **Tests:** `test_market_desk.py` runs a fake TradeSagar backend and checks three cases:
  - Upstox logged in: its candles win for today (prices +1.00 in the fake show up) and the history stays Yahoo's
    (59 sessions).
  - Logged out: Yahoo.
  - Backend down: Yahoo, with the reason.
- **Data licence:** Upstox and NSE terms generally cover personal use; check them before showing this data publicly.

## 6d. Auto-deploy of backend commits to the server (31 Oct)

Ask: when backend changes are committed, the server should deploy them by itself.

- **Pull, not push.** SSH on the server is open only to the home network, so GitHub Actions can't log in to it, and
  storing a server key on GitHub would be a risk. The server asks GitHub instead.
- **The task:** `install-finengine.ps1` registers **FinEngine auto-update** (SYSTEM, every 5 minutes, one run at a
  time, survives restarts). It runs `C:\FinEngine\auto-update.ps1`:
  1. Newest commit on `main` from `api.github.com` (public repo, no token). Same as `deployed.json`: done.
  2. Downloads the commit from `codeload.github.com` and fingerprints `scripts`, `server`, `vendor`, `deploy`
     (SHA-256 of every file). Same fingerprint (a website-only commit): records the commit, no restart.
  3. Otherwise runs that commit's own installer (`-FromAutoUpdate -Sha <commit>`), which stops the API, unpacks,
     updates packages, restarts the task, checks `/api/health` and nginx.
  4. If the install fails, it reinstalls `finengine.prev.zip` with the previous installer and marks the commit
     `failed_sha` so it isn't retried every 5 minutes. The next commit is tried normally.
- **Files on the server:** `deployed.json` (commit, fingerprint, time), `logs\auto-update.log`, `logs\install.log`.
- **One-time step:** the server still runs the version from before this change, which has no auto-update task. Run
  `bash deploy/forex24hr/deploy-from-mac.sh` once from the Mac (it now defaults to `main` and passes the commit);
  after that, merging to `main` is the whole deployment.
- **Not tested on Windows from here:** there is no PowerShell in the build sandbox. The scripts use only Windows
  PowerShell 5.1 commands (Server 2016), are ASCII, and avoid `>>` (UTF-16 in 5.1). The first run after the Mac
  deploy shows in `logs\auto-update.log`.

## 7. Commits on the branch

| Commit | What |
|---|---|
| `55ffaee` | Fix data loading on GitHub Pages; data job; first desk |
| `d298bcf` | Live data API, criteria filter, Day Trader entry on the main screen |
| `c806a1b` | Run the real day-trader-skill on the desk, live or snapshot |
| `57de1e9` | Merge `main` |
| `4f4c0b1` | New FinEngine logo |
| `8396321` | Deploy the live API to the Forex24hr server (`C:\FinEngine`) |
| `a5a8486` | PR #2: fix the empty desk outside 9:50 AM–3:30 PM ET |
| (PR #3) | India (NSE) desk, live API `market=IN`, server-move guide |
| PR #4 | UX redesign (one app shell, sortable screener, trade workspace, Apple HIG) |
| PR #5 | India desk: keep `.NS` in Yahoo chart URLs |
| PR #6 | Indian stocks from Upstox via TradeSagar, with Yahoo fallback |
| PR #7 | India desk: newest bar across several stocks (max over dicts) |
| PR #8 | Live-data timeout and a hint when the page never starts |
| PR #9 | Server auto-deploys backend commits on `main` |

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

**Deploy or update the server:** merge to `main`; the server installs backend changes within about 5 minutes.
Only the first time (or on a new server), from the Mac on the home network:
```bash
bash deploy/forex24hr/deploy-from-mac.sh            # main; or: ... other-branch
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
3. **Deploy the live API once more** with `deploy/forex24hr/deploy-from-mac.sh` (live data for US and India); this
   also turns on auto-update, so later backend commits on `main` install themselves. Or connect
   a Mac folder to a Claude session via Remote Control and have it run the deploy:
   the Desktop folder was not offered to cloud sessions, so updating the Claude
   app or adding another folder may be needed.
4. Optionally bake `https://app.forex24hr.com/finengine` into the site
   (`VITE_API_BASE`), so every visitor gets live data without pasting the URL.
5. Decide on the old TradeSagar pages (`about.html`, `privacy.html`,
   `disclaimer.html`, `ocean.html`, `llms.txt`, `robots.txt`, `sitemap.xml`):
   rebrand them for FinEngine, or remove them. The privacy and disclaimer pages
   are legal text written for TradeSagar's service and domains.
6. If the server ever changes, follow "Moving to a new server" in `deploy/forex24hr/README.md`.
7. Optionally stop the second, racing deployment: once the source is GitHub
   Actions, the branch build stops by itself.

*Educational only, not financial advice. Most day traders lose money: paper trade first.*
