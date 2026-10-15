#!/usr/bin/env bash
# Creates a Python environment with faster-whisper and downloads the speech model.
# Usage: setup-whisper.sh VENV_DIR [MODEL]   (the app runs this from Settings)
set -euo pipefail
VENV="${1:?usage: setup-whisper.sh VENV_DIR [MODEL]}"
MODEL="${2:-small}"
if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating Python environment…"
  python3 -m venv "$VENV"
fi
echo "Installing faster-whisper…"
"$VENV/bin/pip" install --disable-pip-version-check --quiet --upgrade pip
"$VENV/bin/pip" install --disable-pip-version-check --quiet "faster-whisper>=1.1"
echo "Downloading the '$MODEL' speech model (one time)…"
"$VENV/bin/python" -c "from faster_whisper import WhisperModel; WhisperModel('$MODEL', device='cpu', compute_type='int8')"
echo "Whisper is ready."
