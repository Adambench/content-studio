#!/usr/bin/env bash
# Sets up a Content Studio compute worker on a Linux home PC (NVIDIA GPU optional): the Python tools (Whisper, Demucs,
# the person matte, the speaker scan, with CUDA builds when there is a GPU), the worker program, its pairing with the
# laptop and a systemd user service that keeps it running.
#
# Usage, from a checkout of this repository on the home PC (Node 22+, Python 3, FFmpeg, the NVIDIA driver):
#   scripts/setup-worker.sh --server https://laptop.tailnet.ts.net --code XXXX-XXXX-XXXX [--name "Desktop 1070"]
# The address and the code come from Settings → Compute on the laptop. Run it again to update.
set -euo pipefail

SERVER="" CODE="" NAME="$(hostname)"
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --code) CODE="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${CS_WORKER_DIR:-$HOME/.local/share/content-studio-worker}"
TOOLS="$DATA/tools"
mkdir -p "$DATA"

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 isn't installed: $2"; exit 1; }; }
need node "install Node 22 or newer"
need python3 "install Python 3 (with venv)"
need ffmpeg "install FFmpeg"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "Node 22 or newer is needed."; exit 1; }

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
  # cu126 still includes the Pascal cards (GTX 10 series, compute capability 6.1); newer CUDA builds drop them.
  export CS_TORCH_INDEX="https://download.pytorch.org/whl/cu126" CS_GPU=1
else
  echo "No NVIDIA GPU found: the tools will run on the CPU."
fi

echo "Installing the tools (a few GB, several minutes)…"
bash "$REPO/server/scripts/setup-tools.sh" "$TOOLS"

echo "Building the worker…"
mkdir -p "$DATA/bin"
(cd "$REPO" && npx --yes esbuild@0.25.12 worker/src/main.ts --bundle --platform=node --format=esm --target=node22 --banner:js='#!/usr/bin/env node' --outfile="$DATA/bin/worker.mjs" --log-level=warning)
rm -rf "$DATA/bin/scripts" && cp -r "$REPO/server/scripts" "$DATA/bin/scripts"

if [ -n "$SERVER" ] && [ -n "$CODE" ]; then
  CS_WORKER_DIR="$DATA" node "$DATA/bin/worker.mjs" pair --server "$SERVER" --code "$CODE" --name "$NAME"
elif [ ! -f "$DATA/config.json" ]; then
  echo "Not paired: run again with --server and --code from Settings → Compute."; exit 1
fi

# The cuBLAS and cuDNN wheels' libraries, for faster-whisper's CUDA build.
LIBS="$(find "$TOOLS/lib" -path '*nvidia/*/lib' -type d 2>/dev/null | tr '\n' ':')"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/content-studio-worker.service" <<UNIT
[Unit]
Description=Content Studio compute worker
After=network-online.target

[Service]
Environment=CS_WORKER_DIR=$DATA
Environment=CS_WORKER_SCRIPTS=$DATA/bin/scripts
Environment=LD_LIBRARY_PATH=${LIBS%:}
ExecStart=$(command -v node) $DATA/bin/worker.mjs run
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now content-studio-worker.service
loginctl enable-linger "$USER" 2>/dev/null || echo "Tip: run 'sudo loginctl enable-linger $USER' so it starts at boot without a login."
echo "The worker is running. Logs: journalctl --user -u content-studio-worker -f"
