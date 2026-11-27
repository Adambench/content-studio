#!/usr/bin/env bash
# Sets up ai-server (the GTX 1070 PC) to run Content Studio, as my normal user, no root for the app itself.
# Safe to run again: each step skips what's already there.
#
#   bash scripts/setup-server.sh            # from the repo checkout on ai-server (~/content-studio)
#
# Installs into ~/.local: Node 24, FFmpeg (BtbN's static build: NVENC, libplacebo, zimg), uv. Builds the web UI,
# installs a systemd user service on 127.0.0.1:8787 and puts it on the tailnet with Tailscale Serve (HTTPS, :8443).
# The engine's Python tools and models come with the phase that needs them (P1).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$HOME/.local/bin"
mkdir -p "$BIN"
export PATH="$BIN:$PATH"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
# Downloads go to a file first, resumed and retried: ai-server's line sometimes drops a long transfer.
fetch() {
  local url=$1 out=$2 i
  for i in 1 2 3 4 5 6 7 8; do
    curl -fL -sS --connect-timeout 20 -C - -o "$out" "$url" && return 0
    echo "  download broke, resuming ($i)…"
    sleep 3
  done
  return 1
}

say "Machine"
echo "$(hostname) · $(. /etc/os-release && echo "$PRETTY_NAME") · $(nproc) threads · $(free -g | awk '/Mem:/ {print $2}') GB"
if command -v nvidia-smi >/dev/null; then
  nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
else
  echo "No nvidia-smi: renders will encode on the CPU (x264)."
fi

say "Node 24"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  tmp=$(mktemp -d)
  fetch https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt "$tmp/sums"
  version=$(grep -m1 -o 'node-v24[^ ]*-linux-x64.tar.xz' "$tmp/sums")
  fetch "https://nodejs.org/dist/latest-v24.x/$version" "$tmp/node.tar.xz"
  mkdir -p "$HOME/.local/node"
  tar -xJf "$tmp/node.tar.xz" -C "$HOME/.local/node" --strip-components=1
  ln -sf "$HOME/.local/node/bin/node" "$HOME/.local/node/bin/npm" "$HOME/.local/node/bin/npx" "$BIN/"
  rm -r "$tmp"
fi
node -v

say "FFmpeg (static, with NVENC and libplacebo)"
# FFmpeg 8.1: BtbN builds 9.0 and master against NVENC API 13.1 (driver 610+), and the 1070's last driver branch is
# 580 (API 13.0). The check encodes a frame, so a build whose NVENC can't open is replaced.
nvenc_ok() { ffmpeg -hide_banner -v error -f lavfi -i color=black:s=256x256:d=0.1 -c:v h264_nvenc -f null - >/dev/null 2>&1; }
if ! command -v ffmpeg >/dev/null || { command -v nvidia-smi >/dev/null && ! nvenc_ok; }; then
  tmp=$(mktemp -d)
  fetch https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz "$tmp/ffmpeg.tar.xz"
  tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp" --strip-components=1
  install -m 755 "$tmp/bin/ffmpeg" "$tmp/bin/ffprobe" "$BIN/"
  rm -r "$tmp"
fi
ffmpeg -hide_banner -version | head -1
ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'h264_nvenc|hevc_nvenc' | awk '{print "  encoder", $2}' || true
ffmpeg -hide_banner -filters 2>/dev/null | grep -qE ' libplacebo ' && echo "  filter libplacebo" || true

say "uv (Python for the engine's tools)"
if ! command -v uv >/dev/null; then
  tmp=$(mktemp -d)
  fetch https://astral.sh/uv/install.sh "$tmp/uv.sh"
  for i in 1 2 3; do env UV_NO_MODIFY_PATH=1 sh "$tmp/uv.sh" && break; sleep 3; done
  rm -r "$tmp"
fi
uv --version

say "The app"
cd "$REPO"
PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund --fetch-retries=6 --fetch-retry-mintimeout=5000
npm run build -w web

say "Service"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/content-studio.service" <<EOF
[Unit]
Description=Content Studio
After=network-online.target

[Service]
WorkingDirectory=$REPO/server
ExecStart=$BIN/node src/index.ts
Environment=NODE_ENV=production
Environment=PATH=$BIN:/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now content-studio
systemctl --user restart content-studio
# Keep it running with nobody logged in (after a reboot).
if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  loginctl enable-linger "$USER" 2>/dev/null || echo "Run once: sudo loginctl enable-linger $USER   (keeps the app up after a reboot without a login)"
fi
sleep 2
curl -fsS http://127.0.0.1:8787/api/health && echo

# Port 8443, on the tailnet and (Funnel, since 2026-11-26) the internet for the phone, which can't run Tailscale: the
# app lets only paired devices in from there. 443 belongs to Open WebUI (with its own Funnel): never touched.
say "Tailscale Funnel (HTTPS on port 8443; off the tailnet only paired devices get in)"
if tailscale funnel --bg --https=8443 http://127.0.0.1:8787 >/dev/null 2>&1; then
  tailscale serve status 2>/dev/null | grep ':8443' || true
else
  echo "Run once: sudo tailscale set --operator=$USER   then run this script again."
fi

# The Agent SDK brings its own Claude binary; the login is a long-lived token from `claude setup-token`.
say "Claude"
if grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.' "$HOME/.config/content-studio/keys.env" 2>/dev/null || [[ -f "$HOME/.claude/.credentials.json" ]]; then
  echo "Logged in."
else
  echo "Not logged in: run \`claude setup-token\` (on the laptop is fine) and put CLAUDE_CODE_OAUTH_TOKEN=… in ~/.config/content-studio/keys.env (chmod 600)."
fi
