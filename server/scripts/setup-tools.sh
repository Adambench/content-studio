#!/usr/bin/env bash
# The clip tools: a Python environment with Demucs (splits a clip's voice from the rest, to strip background music),
# OpenCV's YuNet face detector (where the speaker is, to reframe on them), gdown (Google Drive folders) and Kokoro
# (speech for story, chat and character videos), plus their models. About 1.4 GB, all on this computer. Running it
# again adds whatever an older install is missing.
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
echo "Installing Demucs, OpenCV, gdown and Kokoro…"
# Demucs 4.1 needs no compiler (diffq is only its "quantized" extra); torch is already satisfied by the CPU build.
# kokoro-onnx brings onnxruntime and its own espeak-ng library, so nothing else is needed on the system.
pip "${PIN[@]}" "demucs==4.1.0" "opencv-python-headless==4.13.0.92" "gdown==6.3.0" "numpy>=2,<2.5" "kokoro-onnx==0.6.1" "soundfile==0.13.1"

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
echo "Downloading the voices (Kokoro, about 120 MB, one time)…"
KOKORO="$DIR/models/kokoro"
mkdir -p "$KOKORO"
fetch() {
  local name="$1" sum="$2"
  if [ ! -s "$KOKORO/$name" ]; then
    curl -fsSL --retry 3 -o "$KOKORO/$name.part" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$name"
    echo "$sum  $KOKORO/$name.part" | sha256sum -c --quiet -
    mv "$KOKORO/$name.part" "$KOKORO/$name"
  fi
}
fetch kokoro-v1.0.int8.onnx 6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb
fetch voices-v1.0.bin bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
"$PY" -c "from kokoro_onnx import Kokoro; Kokoro('$KOKORO/kokoro-v1.0.int8.onnx', '$KOKORO/voices-v1.0.bin')"
echo 2 > "$DIR/.ready"
echo "The clip tools are ready."
