#!/usr/bin/env bash
# The clip tools: a Python environment with Demucs (splits a clip's voice from the rest, to strip background music),
# OpenCV's YuNet face detector (where the speaker is, to reframe on them) and gdown (Google Drive folders), plus their
# models. About 1 GB, all on this computer.
# Usage: setup-tools.sh TOOLS_DIR   (the app runs this from Settings → Clip tools)
set -euo pipefail
DIR="${1:?usage: setup-tools.sh TOOLS_DIR}"
PY="$DIR/bin/python"
# Only releases at least two weeks older than this script, so a just-published (or hijacked) version never comes in.
PIN=(--uploaded-prior-to 2026-10-01T00:00:00Z)
pip() { "$PY" -m pip install --disable-pip-version-check --quiet "$@"; }

if [ ! -x "$PY" ]; then
  echo "Creating Python environment…"
  python3 -m venv "$DIR"
fi
pip --upgrade "pip==26.0.1"
echo "Installing PyTorch, CPU only (about 200 MB)…"
# The CPU build from PyTorch's own index: PyPI's default build brings 3 GB of CUDA libraries.
pip --index-url https://download.pytorch.org/whl/cpu "torch==2.14.0"
echo "Installing Demucs, OpenCV and gdown…"
# Demucs 4.1 needs no compiler (diffq is only its "quantized" extra); torch is already satisfied by the CPU build.
pip "${PIN[@]}" "demucs==4.1.0" "opencv-python-headless==4.13.0.92" "gdown==6.3.0" "numpy>=2,<2.5"

mkdir -p "$DIR/models" "$DIR/hf"
echo "Downloading the voice separation model (htdemucs, one time)…"
HF_HOME="$DIR/hf" "$PY" -c "from demucs.pretrained import get_model; get_model('htdemucs')"
echo "Downloading the face detection model (YuNet, one time)…"
YUNET="$DIR/models/face_detection_yunet_2023mar.onnx"
if [ ! -s "$YUNET" ]; then
  curl -fsSL --retry 3 -o "$YUNET.part" https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
  mv "$YUNET.part" "$YUNET"
fi
"$PY" -c "import cv2; cv2.FaceDetectorYN.create('$YUNET', '', (320, 320))"
echo 1 > "$DIR/.ready"
echo "The clip tools are ready."
