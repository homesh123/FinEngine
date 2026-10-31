# FinEngine live API on the Forex24hr server

| What | Where |
|---|---|
| Code | `C:\FinEngine\app` |
| Python environment (separate from TradeSagar) | `C:\FinEngine\venv` |
| Settings (`SEC_USER_AGENT`) | `C:\FinEngine\finengine.env` |
| Log | `C:\FinEngine\logs\api.log` (install: `install.log`) |
| Process | `127.0.0.1:8100`, scheduled task **FinEngine live API** (SYSTEM, at boot, restarts if it stops) |
| Public URL | `https://app.forex24hr.com/finengine/` via nginx (`conf\finengine-location.conf`, included in the app.forex24hr.com server blocks) |
| nginx backups | `C:\FinEngine\backup\` |
| Auto-update | scheduled task **FinEngine auto-update** (SYSTEM, every 5 minutes), `C:\FinEngine\auto-update.ps1`, log `C:\FinEngine\logs\auto-update.log` |
| Installed version | `C:\FinEngine\deployed.json` (commit, backend fingerprint, time) |

First install (once), from the Mac with the SSH key:

```bash
bash deploy/forex24hr/deploy-from-mac.sh            # main; or: ... other-branch
```

## Auto-deploy: every backend commit on main

After that first install, **you don't deploy by hand any more**. Merge to `main` and within about 5 minutes the server
installs it by itself:

1. Every 5 minutes the task **FinEngine auto-update** asks GitHub for the newest commit on `main`
   (`api.github.com`, no key needed: the repository is public).
2. New commit: it downloads it from `codeload.github.com` and fingerprints `scripts`, `server`, `vendor` and `deploy`.
   If only the website changed (`src/`, `public/`, ...), the fingerprint is the same and nothing is restarted.
3. Backend changed: it runs that commit's own `install-finengine.ps1` (new packages, new nginx location, restart,
   health check).
4. If the install fails, it reinstalls the previous version (`C:\FinEngine\finengine.prev.zip`) and skips that commit;
   the next commit is tried as usual. Look in `logs\auto-update.log` and `logs\install.log`.

Why the server pulls instead of GitHub pushing: SSH on this server is open only to the home network, so GitHub
Actions can't reach it, and this way no server password or key is stored on GitHub.

| What you want | Command (PowerShell on the server) |
|---|---|
| What's installed | `Get-Content C:\FinEngine\deployed.json` |
| Last updates | `Get-Content C:\FinEngine\logs\auto-update.log -Tail 20` |
| Update now | `Start-ScheduledTask 'FinEngine auto-update'` |
| Reinstall now, even if unchanged | `powershell -ExecutionPolicy Bypass -File C:\FinEngine\auto-update.ps1 -Force` |
| Pause auto-update (e.g. testing a branch) | `Disable-ScheduledTask 'FinEngine auto-update'` (back on: `Enable-ScheduledTask ...`) |

Notes:
- It follows `main` only. A branch deployed from the Mac for a test is replaced at the next backend commit on `main`
  (pause the task while you test).
- A change to `auto-update.ps1` itself is picked up by the next run. A change to the *task* (its schedule) only
  applies after a deploy from the Mac.
- If the repository is made private, the server can't see it any more without a token: auto-update then logs
  "GitHub not reachable" and the running version keeps working.

On the server (PowerShell):

| What you want | Command |
|---|---|
| Is it running? | `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8100/api/health` |
| Last log lines | `Get-Content C:\FinEngine\logs\api.log -Tail 30` |
| Restart it | `Stop-ScheduledTask 'FinEngine live API'; Start-ScheduledTask 'FinEngine live API'` |

It needs no Remote Desktop log-on after a server restart (unlike TradeSagar and MT5).
Then in the site, click **Snapshot** and paste `https://app.forex24hr.com/finengine`.

## Indian stocks from Upstox (through TradeSagar)

The India desk asks TradeSagar's backend on this server (`http://127.0.0.1:8000`) for NSE 5-minute candles from its
Upstox login. Upstox candles replace Yahoo's for the days they cover (today); Yahoo keeps older sessions.

- **Setup:** none. The installer copies TradeSagar's `TRADING_API_TOKEN` (from `C:\ChartStudio\backend\.env.local`)
  into `C:\FinEngine\finengine.env` as `TRADESAGAR_TOKEN`, readable by Administrators and SYSTEM only.
- **If TradeSagar's token changes:** run the deploy again, or edit `TRADESAGAR_TOKEN=` in `C:\FinEngine\finengine.env`
  and restart the task (`Stop-ScheduledTask 'FinEngine live API'; Start-ScheduledTask 'FinEngine live API'`).
- **Upstox login:** log in to Upstox in TradeSagar as usual each day. Until then, and whenever TradeSagar's backend
  isn't running (after a restart, before the Remote Desktop log-on), the desk uses Yahoo.
- **Which source is live:** the Day Trader page shows "Data: Upstox (via TradeSagar) + Yahoo history" or
  "Data: Yahoo Finance"; hover it for the reason.
- **Moving servers:** if TradeSagar stays on the old server, set `TRADESAGAR_API=` to its address (HTTPS if not local),
  or leave the token out to use Yahoo only.

## Moving to a new server

Nothing on GitHub depends on this server: the site and its 15-minute snapshot keep
working while you move. Only the live data (the **Live** button) needs the API.

**What the new server needs**
- Outbound internet to `query1/query2.finance.yahoo.com`, `www.sec.gov`, `data.sec.gov`,
  `disclosures-clerk.house.gov`, `www.nasdaqtrader.com`, `pypi.org` (install only), `api.github.com` and
  `codeload.github.com` (auto-update).
- Python 3.9 or newer. On Windows the installer puts Python 3.12 in `C:\Python312` if there is none.
- A web server with HTTPS for a hostname you control (the site is HTTPS, so browsers refuse a plain-HTTP API).
- Inbound 80/443 open; SSH (22) open to your home IP range for deploys.
- About 1 GB RAM free and 2 GB disk for `C:\FinEngine`.

**Windows server with nginx (like this one)**
1. Install OpenSSH Server, nginx and an HTTPS certificate for the hostname (win-acme, as on this server).
   Copy your SSH public key to the new server (`administrator_authorized_keys`).
2. If the nginx folder or hostname differ, pass them to the installer: edit the last line of
   `deploy/forex24hr/deploy-from-mac.sh` to
   `... install-finengine.ps1 -NginxDir C:\nginx-x.y.z -PublicHost api.example.com`.
3. From the Mac:
   ```bash
   FOREX24HR_HOST=administrator@NEW.IP.ADDRESS bash deploy/forex24hr/deploy-from-mac.sh
   ```
   (`FOREX24HR_KEY=~/.ssh/other_key` if the key changes.) The installer creates `C:\FinEngine`,
   the venv, the startup task, the auto-update task and the nginx `/finengine/` location, and checks `/api/health`.
   From then on the new server installs backend commits on `main` by itself (it needs outbound access to
   `api.github.com` and `codeload.github.com`).
4. Keep `SEC_USER_AGENT` (in `C:\FinEngine\finengine.env`): SEC asks for a name and email.
5. **DNS:** if the hostname stays `app.forex24hr.com`, point its A record (GoDaddy) at the new IP. If you use a
   new hostname, users paste the new URL under the **Snapshot** button, or bake it into the site with
   `VITE_API_BASE`.
6. Check from a browser: `https://<hostname>/finengine/api/health` answers `{"ok": true, ...}`.
7. **Old server:** stop and remove the service, and take the location out of nginx:
   ```powershell
   Unregister-ScheduledTask 'FinEngine live API' -Confirm:$false
   Unregister-ScheduledTask 'FinEngine auto-update' -Confirm:$false   # or it keeps installing there
   # delete the "include finengine-location.conf;" lines in C:\nginx-*\conf\*.conf, then:
   C:\forex24hr\reload-nginx.cmd
   ```
   `C:\FinEngine` can then be deleted.

**Linux server (Ubuntu/Debian) instead**
```bash
sudo apt-get install -y python3-venv nginx poppler-utils git
sudo git clone https://github.com/homesh123/FinEngine.git /opt/finengine
sudo python3 -m venv /opt/finengine/venv && sudo /opt/finengine/venv/bin/pip install -r /opt/finengine/scripts/requirements.txt
sudo tee /etc/systemd/system/finengine-api.service >/dev/null <<'UNIT'
[Unit]
Description=FinEngine live API
After=network-online.target
[Service]
WorkingDirectory=/opt/finengine
Environment=SEC_USER_AGENT=FinEngine you@example.com
Environment=PYTHONUTF8=1
ExecStart=/opt/finengine/venv/bin/python server/live_api.py --host 127.0.0.1 --port 8100 --warm
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable --now finengine-api        # starts now and at every boot
```
Then put the contents of `finengine-location.conf` inside your HTTPS `server { }` block, `sudo nginx -t && sudo systemctl reload nginx`,
and get a certificate with `certbot --nginx`. Update with `cd /opt/finengine && sudo git pull && sudo systemctl restart finengine-api`;
to auto-deploy like on Windows, run that every 5 minutes from cron
(`*/5 * * * * cd /opt/finengine && git fetch -q && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && git merge -q --ff-only origin/main && venv/bin/pip install -q -r scripts/requirements.txt && systemctl restart finengine-api`).
