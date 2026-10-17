#!/usr/bin/env bash
# Sets up a Content Studio compute worker on a Linux home PC (NVIDIA GPU optional): the Python tools (Whisper, Demucs,
# the person matte, the speaker scan, with CUDA builds when there is a GPU), the worker program, its pairing with the
# laptop and a systemd user service that keeps it running. With --with it also sets up the self-hosted models:
#   llm    the text/vision model (Ollama + Qwen3-VL), which the laptop finds by itself      ~20 GB
#   image  pictures (stable-diffusion.cpp + FLUX.1-schnell)                                  ~12 GB
#   video  ~5 s clips (stable-diffusion.cpp + Wan 2.1 T2V 1.3B), made overnight             ~10 GB
#   voice  the creator's cloned voice (Chatterbox, its own Python environment)              ~6 GB
# All of them are licensed for commercial use (Apache 2.0 / MIT).
#
# Usage, from a checkout of this repository on the home PC (Node 22+, Python 3, FFmpeg, the NVIDIA driver; for image
# and video also git, cmake and a C++ compiler, and the CUDA toolkit for the GPU build):
#   scripts/setup-worker.sh --server https://laptop.tailnet.ts.net --code XXXX-XXXX-XXXX [--name "Desktop 1070"]
#                           [--with llm,image,video,voice] [--llm-model qwen3-vl:30b-a3b-instruct]
# The address and the code come from Settings → Compute on the laptop. Run it again to update or to add more --with.
# Suggested split: the GTX 1070 PC --with llm,video,voice; the GTX 1050 Ti PC --with image.
set -euo pipefail

SERVER="" CODE="" NAME="$(hostname)" WITH="" LLM_MODEL="qwen3-vl:30b-a3b-instruct"
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --code) CODE="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --with) WITH="$2"; shift 2 ;;
    --llm-model) LLM_MODEL="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
has() { case ",$WITH," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${CS_WORKER_DIR:-$HOME/.local/share/content-studio-worker}"
TOOLS="$DATA/tools"
mkdir -p "$DATA"
# Pinned: a stable-diffusion.cpp build from 2026-09-27 and an Ollama release (override at your own risk).
SD_TAG="${CS_SD_TAG:-master-929-3f8527a}"
OLLAMA_VERSION="${CS_OLLAMA_VERSION:-0.40.6}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 isn't installed: $2"; exit 1; }; }
need node "install Node 22 or newer"
need python3 "install Python 3 (with venv)"
need ffmpeg "install FFmpeg"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "Node 22 or newer is needed."; exit 1; }
if has image || has video; then
  need git "install git"; need cmake "install cmake"; need c++ "install a C++ compiler (build-essential)"
fi
if has llm; then need zstd "install zstd (Ollama's download is compressed with it)"; fi

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
  # cu126 still includes the Pascal cards (GTX 10 series, compute capability 6.1); newer CUDA builds drop them.
  export CS_TORCH_INDEX="https://download.pytorch.org/whl/cu126" CS_GPU=1
else
  echo "No NVIDIA GPU found: the tools will run on the CPU."
fi

echo "Installing the tools (a few GB, several minutes)…"
bash "$REPO/server/scripts/setup-tools.sh" "$TOOLS"

# Downloads one model file once (to a .part file first, so a cut download is never taken for a whole one).
fetch() {
  local url="$1" to="$2"
  if [ ! -s "$to" ]; then
    echo "  $(basename "$to")…"
    mkdir -p "$(dirname "$to")"
    curl -fL --retry 3 --retry-delay 5 -C - -o "$to.part" "$url"
    mv "$to.part" "$to"
  fi
}
HF="https://huggingface.co"

# ---------- the text/vision model (Ollama) ----------
LLM_ENV=""
if has llm; then
  echo "Installing Ollama $OLLAMA_VERSION (in $DATA/ollama, no root)…"
  OLLAMA="$DATA/ollama"
  if [ ! -x "$OLLAMA/bin/ollama" ] || ! "$OLLAMA/bin/ollama" --version 2>/dev/null | grep -q "$OLLAMA_VERSION"; then
    rm -rf "$OLLAMA" && mkdir -p "$OLLAMA"
    curl -fL --retry 3 "https://ollama.com/download/ollama-linux-amd64.tar.zst?version=$OLLAMA_VERSION" | zstd -d | tar -xf - -C "$OLLAMA"
  fi
  # Only reachable over Tailscale (the model server has no password of its own); without Tailscale, on the home network.
  BIND="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  if [ -z "$BIND" ]; then
    echo "Tailscale isn't running here: the model server listens on the home network (any device on it can use it)."
    BIND="0.0.0.0" REACH="$(hostname -I | awk '{print $1}')"
  else
    REACH="$BIND"
  fi
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/content-studio-ollama.service" <<UNIT
[Unit]
Description=Content Studio text model (Ollama)
After=network-online.target

[Service]
Environment=OLLAMA_HOST=$BIND:11434
Environment=OLLAMA_MODELS=$DATA/ollama-models
Environment=OLLAMA_KEEP_ALIVE=30m
Environment=OLLAMA_NUM_PARALLEL=1
Environment=OLLAMA_MAX_LOADED_MODELS=1
ExecStart=$OLLAMA/bin/ollama serve
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now content-studio-ollama.service
  systemctl --user restart content-studio-ollama.service
  for _ in $(seq 1 30); do curl -fs "http://$REACH:11434/api/version" >/dev/null && break; sleep 1; done
  echo "Downloading $LLM_MODEL (about 20 GB, one time)…"
  OLLAMA_HOST="$REACH:11434" "$OLLAMA/bin/ollama" pull "$LLM_MODEL"
  LLM_ENV="Environment=CS_LLM_URL=http://$REACH:11434
Environment=CS_LLM_LOCAL=http://$REACH:11434"
fi

# ---------- pictures and clips (stable-diffusion.cpp) ----------
if has image || has video; then
  SD="$TOOLS/sd"
  if [ ! -x "$SD/bin/sd-cli" ] || [ "$(cat "$SD/.tag" 2>/dev/null)" != "$SD_TAG" ]; then
    echo "Building stable-diffusion.cpp $SD_TAG (a few minutes)…"
    SRC="$DATA/src/stable-diffusion.cpp"
    rm -rf "$SRC" && mkdir -p "$(dirname "$SRC")"
    git clone --quiet --depth 1 --branch "$SD_TAG" --recurse-submodules --shallow-submodules https://github.com/leejet/stable-diffusion.cpp "$SRC"
    BACKEND=()
    if command -v nvcc >/dev/null 2>&1; then
      # Pascal is compute capability 6.1; ggml computes in fp32 there (its half precision is slow).
      BACKEND=(-DSD_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=61)
    elif command -v glslc >/dev/null 2>&1; then
      BACKEND=(-DSD_VULKAN=ON)
    else
      echo "Neither the CUDA toolkit (nvcc) nor Vulkan (glslc) is installed: building for the CPU, which is far too slow for clips."
      echo "Install the CUDA toolkit (e.g. sudo apt install nvidia-cuda-toolkit) and run this again."
    fi
    cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DSD_WEBP=OFF -DSD_WEBM=OFF "${BACKEND[@]}" >/dev/null
    cmake --build "$SRC/build" --config Release -j "$(nproc)" --target sd-cli >/dev/null
    mkdir -p "$SD/bin" && cp "$SRC/build/bin/sd-cli" "$SD/bin/sd-cli" && echo "$SD_TAG" > "$SD/.tag"
  fi
  GEN="$TOOLS/models/gen"
  if has image; then
    echo "Downloading FLUX.1-schnell (Apache 2.0, about 12 GB, one time)…"
    fetch "$HF/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q4_K_S.gguf" "$GEN/flux/flux1-schnell-q4_k.gguf"
    fetch "$HF/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors" "$GEN/flux/ae.safetensors"
    fetch "$HF/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors" "$GEN/flux/clip_l.safetensors"
    fetch "$HF/city96/t5-v1_1-xxl-encoder-gguf/resolve/main/t5-v1_1-xxl-encoder-Q8_0.gguf" "$GEN/flux/t5xxl-q8_0.gguf"
    touch "$GEN/.image-ready"
  fi
  if has video; then
    echo "Downloading Wan 2.1 T2V 1.3B (Apache 2.0, about 10 GB, one time)…"
    fetch "$HF/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors" "$GEN/wan/wan2.1_t2v_1.3B_fp16.safetensors"
    fetch "$HF/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors" "$GEN/wan/wan_2.1_vae.safetensors"
    fetch "$HF/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q8_0.gguf" "$GEN/wan/umt5-xxl-encoder-q8_0.gguf"
    touch "$GEN/.video-ready"
  fi
fi

# ---------- the cloned voice (Chatterbox) ----------
if has voice; then
  echo "Installing Chatterbox (its own Python environment: it pins PyTorch 2.6)…"
  VOICE="$TOOLS/voice"
  [ -x "$VOICE/bin/python" ] || python3 -m venv "$VOICE"
  vpip() { "$VOICE/bin/python" -m pip install --disable-pip-version-check --quiet "$@"; }
  vpip --upgrade "pip==26.0.1"
  vpip --index-url "${CS_TORCH_INDEX:-https://download.pytorch.org/whl/cpu}" "torch==2.6.0" "torchaudio==2.6.0"
  vpip --uploaded-prior-to 2026-10-01T00:00:00Z "chatterbox-tts==0.1.7" "kokoro-onnx==0.6.1" "soundfile==0.13.1"
  echo "Downloading the voice model (one time)…"
  HF_HOME="$TOOLS/hf" "$VOICE/bin/python" -c "from chatterbox.tts import REPO_ID; from huggingface_hub import hf_hub_download as d; [d(REPO_ID, f) for f in ['ve.safetensors', 't3_cfg.safetensors', 's3gen.safetensors', 'tokenizer.json', 'conds.pt']]"
  touch "$VOICE/.ready"
fi

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
# A run without --with llm keeps the model server set up by an earlier one.
if [ -z "$LLM_ENV" ] && [ -f "$UNIT_DIR/content-studio-ollama.service" ]; then
  ADDR="$(sed -n 's/^Environment=OLLAMA_HOST=\(.*\):11434$/\1/p' "$UNIT_DIR/content-studio-ollama.service")"
  [ "$ADDR" = "0.0.0.0" ] && ADDR="$(hostname -I | awk '{print $1}')"
  LLM_ENV="Environment=CS_LLM_URL=http://$ADDR:11434
Environment=CS_LLM_LOCAL=http://$ADDR:11434"
fi
cat > "$UNIT_DIR/content-studio-worker.service" <<UNIT
[Unit]
Description=Content Studio compute worker
After=network-online.target

[Service]
Environment=CS_WORKER_DIR=$DATA
Environment=CS_WORKER_SCRIPTS=$DATA/bin/scripts
Environment=LD_LIBRARY_PATH=${LIBS%:}
Environment=HF_HOME=$TOOLS/hf
$LLM_ENV
ExecStart=$(command -v node) $DATA/bin/worker.mjs run
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now content-studio-worker.service
systemctl --user restart content-studio-worker.service
loginctl enable-linger "$USER" 2>/dev/null || echo "Tip: run 'sudo loginctl enable-linger $USER' so it starts at boot without a login."
echo "The worker is running. Logs: journalctl --user -u content-studio-worker -f"
