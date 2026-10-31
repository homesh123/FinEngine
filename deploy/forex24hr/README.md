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

Deploy or update, from the Mac with the SSH key:

```bash
bash deploy/forex24hr/deploy-from-mac.sh            # or: ... main
```

On the server (PowerShell):

| What you want | Command |
|---|---|
| Is it running? | `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8100/api/health` |
| Last log lines | `Get-Content C:\FinEngine\logs\api.log -Tail 30` |
| Restart it | `Stop-ScheduledTask 'FinEngine live API'; Start-ScheduledTask 'FinEngine live API'` |

It needs no Remote Desktop log-on after a server restart (unlike TradeSagar and MT5).
Then in the site, click **Snapshot** and paste `https://app.forex24hr.com/finengine`.

## Moving to a new server

Nothing on GitHub depends on this server: the site and its 15-minute snapshot keep
working while you move. Only the live data (the **Live** button) needs the API.

**What the new server needs**
- Outbound internet to `query1/query2.finance.yahoo.com`, `www.sec.gov`, `data.sec.gov`,
  `disclosures-clerk.house.gov`, `www.nasdaqtrader.com`, `pypi.org` (install only).
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
   the venv, the startup task, and the nginx `/finengine/` location, and checks `/api/health`.
4. Keep `SEC_USER_AGENT` (in `C:\FinEngine\finengine.env`): SEC asks for a name and email.
5. **DNS:** if the hostname stays `app.forex24hr.com`, point its A record (GoDaddy) at the new IP. If you use a
   new hostname, users paste the new URL under the **Snapshot** button, or bake it into the site with
   `VITE_API_BASE`.
6. Check from a browser: `https://<hostname>/finengine/api/health` answers `{"ok": true, ...}`.
7. **Old server:** stop and remove the service, and take the location out of nginx:
   ```powershell
   Unregister-ScheduledTask 'FinEngine live API' -Confirm:$false
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
and get a certificate with `certbot --nginx`. Update with `cd /opt/finengine && sudo git pull && sudo systemctl restart finengine-api`.
