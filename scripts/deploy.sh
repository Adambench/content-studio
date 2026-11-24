#!/usr/bin/env bash
# From the laptop: push, then make ai-server run exactly what's pushed and restart the app.
# The checkout on ai-server is never edited by hand (it's reset to the pushed branch). Packages are reinstalled
# only when package-lock.json changed: ai-server's line is slow.
#
#   npm run deploy            # the current branch
set -euo pipefail

HOST="${CS_DEPLOY_HOST:-bouyaka@ai-server}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

git push -q origin "$BRANCH"
# The script goes in on stdin, so every command in it that could read stdin gets </dev/null.
ssh -o ServerAliveInterval=15 "$HOST" bash -s -- "$BRANCH" <<'EOF'
set -euo pipefail
BRANCH=$1
export PATH=$HOME/.local/bin:$PATH
if [ ! -d ~/content-studio ]; then git clone -q https://github.com/Adambench/content-studio.git ~/content-studio; fi
cd ~/content-studio
lock_before=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)
git fetch -q origin
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
git reset -q --hard "origin/$BRANCH"
if [ ! -f ~/.config/systemd/user/content-studio.service ]; then
  bash scripts/setup-server.sh </dev/null
  exit 0
fi
if [ "$lock_before" != "$(sha1sum package-lock.json | cut -d' ' -f1)" ] || [ ! -d node_modules ]; then
  PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error --prefer-offline --fetch-retries=6 --fetch-retry-mintimeout=5000 </dev/null
fi
npm run build -w web >/dev/null </dev/null
systemctl --user restart content-studio
sleep 2
curl -fsS http://127.0.0.1:8787/api/health
EOF
echo
echo "Deployed $BRANCH ($(git rev-parse --short HEAD)) to $HOST"
