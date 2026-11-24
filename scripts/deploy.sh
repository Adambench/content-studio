#!/usr/bin/env bash
# From the laptop: push, then make ai-server run exactly what's pushed and restart the app.
# The checkout on ai-server is never edited by hand (it's reset to the pushed branch).
#
#   npm run deploy            # the current branch
set -euo pipefail

HOST="${CS_DEPLOY_HOST:-bouyaka@ai-server}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

git push -q origin "$BRANCH"
ssh "$HOST" "bash -lc 'set -e
  export PATH=\$HOME/.local/bin:\$PATH
  if [ ! -d ~/content-studio ]; then git clone -q https://github.com/Adambench/content-studio.git ~/content-studio; fi
  cd ~/content-studio
  git fetch -q origin
  git checkout -q $BRANCH 2>/dev/null || git checkout -q -b $BRANCH origin/$BRANCH
  git reset -q --hard origin/$BRANCH
  if [ ! -f ~/.config/systemd/user/content-studio.service ]; then bash scripts/setup-server.sh; exit 0; fi
  PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error --fetch-retries=6 --fetch-retry-mintimeout=5000
  npm run build -w web >/dev/null
  systemctl --user restart content-studio
  sleep 2
  curl -fsS http://127.0.0.1:8787/api/health'"
echo
echo "Deployed $BRANCH ($(git rev-parse --short HEAD)) to $HOST"
