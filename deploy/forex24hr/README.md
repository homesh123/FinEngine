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
