#!/usr/bin/env bash
# Deploy the FinEngine live API to the Forex24hr server (C:\FinEngine), from the Mac
# that holds ~/.ssh/forex24hr_vps (SSH is only open to the home network).
#
#   bash deploy/forex24hr/deploy-from-mac.sh                # the PR branch
#   bash deploy/forex24hr/deploy-from-mac.sh main           # another branch
set -euo pipefail

BRANCH="${1:-ccr-acae6653-6ztlfg}"
KEY="${FOREX24HR_KEY:-$HOME/.ssh/forex24hr_vps}"
HOST="${FOREX24HR_HOST:-administrator@103.252.119.28}"
SSH=(ssh -i "$KEY" -o ConnectTimeout=15 "$HOST")

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "== Fetching homesh123/FinEngine ($BRANCH)"
git clone --quiet --depth 1 --branch "$BRANCH" https://github.com/homesh123/FinEngine.git "$tmp/src"
(cd "$tmp/src" && zip -qr "$tmp/finengine.zip" scripts server vendor deploy -x '*/__pycache__/*')

echo "== Uploading to $HOST:C:/FinEngine/"
"${SSH[@]}" "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force -Path C:\\FinEngine | Out-Null\""
scp -i "$KEY" -o ConnectTimeout=15 "$tmp/finengine.zip" "$tmp/src/deploy/forex24hr/install-finengine.ps1" "$HOST:C:/FinEngine/"

echo "== Installing on the server"
"${SSH[@]}" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\FinEngine\\install-finengine.ps1"

echo "== Checking from this Mac"
curl -fsS --max-time 20 https://app.forex24hr.com/finengine/api/health && echo
