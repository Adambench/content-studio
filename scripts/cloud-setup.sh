#!/usr/bin/env bash
# Gets a Claude Code cloud session (claude.ai/code, `claude --cloud`) ready to build and test the app: Node 24,
# FFmpeg, a virtual display for Electron, the libraries Electron and the renderer's Chrome need, espeak-ng for spoken
# test footage, then `npm ci`. Run by the SessionStart hook in .claude/settings.json; does nothing outside the cloud.
# Each part is skipped when it's already done, so resuming a session costs a few seconds.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 1

log() { echo "[cloud-setup] $*" >&2; }

# Node 24, like CI and the laptop (the image has 20–22; npm's allowScripts needs npm 11).
NODE_DIR=/opt/node24
if [ ! -x "$NODE_DIR/bin/node" ]; then
  log "installing Node 24"
  tarball=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep -o 'node-v[0-9.]*-linux-x64.tar.xz' | head -1)
  mkdir -p "$NODE_DIR" && curl -fsSL "https://nodejs.org/dist/latest-v24.x/$tarball" | tar -xJ -C "$NODE_DIR" --strip-components=1 \
    || log "Node 24 download failed"
fi
export PATH="$NODE_DIR/bin:$PATH"
# Later Bash commands in the session get the same PATH.
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"

# System packages: FFmpeg, Xvfb (Electron needs a display), Electron/Chrome libraries, fonts, espeak-ng.
if ! command -v ffmpeg >/dev/null || ! command -v xvfb-run >/dev/null || ! command -v espeak-ng >/dev/null; then
  log "installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ffmpeg xvfb xauth espeak-ng python3-venv \
    libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgbm1 libgtk-3-0t64 libasound2t64 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxss1 libxtst6 libpango-1.0-0 libcairo2 libsecret-1-0 \
    fonts-liberation fonts-noto-core fonts-noto-color-emoji >/dev/null \
    || log "apt install failed"
fi

# npm ci when the lockfile or a workspace's package.json changed since the last good install.
hashes=node_modules/.cloud-setup.sha256
inputs=(scripts/cloud-setup.sh package.json package-lock.json server/package.json web/package.json desktop/package.json mobile/package.json)
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  log "npm ci"
  rm -f "$hashes"
  if npm ci --no-audit --no-fund; then
    sha256sum "${inputs[@]}" > "$hashes"
  else
    log "npm ci failed — run it again and read the error"
  fi
fi

# Electron 44 has no install script any more: its binary downloads on first `require('electron')`, which the
# `node_modules/electron/dist/electron` commands in CLAUDE.md never do. Fetch it now (from GitHub releases).
if [ -f node_modules/electron/install.js ] && [ ! -x node_modules/electron/dist/electron ]; then
  log "downloading the Electron binary"
  node node_modules/electron/install.js || log "Electron download failed"
fi

log "ready (node $(node -v), $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3))"
exit 0
