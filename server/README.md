# Yahoo Proxy API

Deploy this on the Windows server behind nginx.

## Setup on Windows
1. Install Node.js
2. Copy server/ to C:\forex24hr\yahoo-proxy\ or C:\ChartStudio\yahoo-proxy\
3. npm install
4. Use nssm or PM2 to run as Windows service
5. Add nginx upstream/reverse proxy to port 8001

## nginx config example
```
location /api/yahoo/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```
