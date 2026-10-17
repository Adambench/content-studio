"""Speech for story, chat and character videos, with Kokoro (82M, Apache-2.0) on this computer, and the creator's own
voice cloned with Chatterbox (MIT) from their recording, on a home PC.

Usage: tts.py JOB.json --models DIR --out OUT.wav [--clone REFERENCE.wav]
JOB.json: {"segments": [{"text": "...", "voice": "am_michael", "speed": 1.0, "pause": 0.3}, ...]}
A segment with "voice": "clone" is spoken in the reference's voice (needs --clone and the chatterbox-tts package; the
Python of setup-worker.sh --with voice has both). Chatterbox has no speed setting: those lines keep their own pace.
Writes one WAV (24 kHz mono) with the segments one after another (each followed by its pause) and prints JSON: the
total duration, each segment's start and end, and "mouth": how open a talking mouth is, 15 times a second, as digits
0-4 (from the loudness of the speech, scaled per segment so a quiet voice still moves its mouth).
"""
import argparse
import json

import re

import numpy as np
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("job")
parser.add_argument("--models", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--clone", default="")
args = parser.parse_args()

with open(args.job, encoding="utf-8") as f:
    job = json.load(f)

RATE = 24000
FPS = 15
WINDOW = RATE // FPS
CLONE = "clone"

_kokoro = None
_clone = None


def kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro

        _kokoro = Kokoro(f"{args.models}/kokoro-v1.0.int8.onnx", f"{args.models}/voices-v1.0.bin")
    return _kokoro


def cloned(text):
    """The reference's voice, sentence by sentence (Chatterbox makes about 40 s at most in one go)."""
    global _clone
    if _clone is None:
        if not args.clone:
            raise SystemExit("A line asks for the cloned voice but no recording was given (--clone).")
        import torch
        from chatterbox.tts import ChatterboxTTS

        model = ChatterboxTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")
        model.prepare_conditionals(args.clone)
        _clone = model

    pieces = []
    for sentence in [s for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]:
        wav = _clone.generate(sentence).squeeze(0).cpu().numpy().astype(np.float32)
        if _clone.sr != RATE:
            import librosa

            wav = librosa.resample(wav, orig_sr=_clone.sr, target_sr=RATE)
        pieces.append(wav)
        pieces.append(np.zeros(int(0.08 * RATE), dtype=np.float32))
    return np.concatenate(pieces[:-1]) if pieces else np.zeros(0, dtype=np.float32)

parts = []
segments = []
t = 0.0
for i, seg in enumerate(job["segments"]):
    text = (seg.get("text") or "").strip()
    pause = max(0.0, float(seg.get("pause", 0.3)))
    if text and seg.get("voice") == CLONE:
        samples = cloned(text)
    elif text:
        voice = seg.get("voice") if seg.get("voice") in set(kokoro().get_voices()) else "am_michael"
        samples, rate = kokoro().create(text, voice=voice, speed=float(seg.get("speed", 1.0)), lang=seg.get("lang", "en-us"))
        samples = np.asarray(samples, dtype=np.float32)
        if rate != RATE:
            raise SystemExit(f"unexpected sample rate {rate}")
    else:
        samples = np.zeros(0, dtype=np.float32)
    parts.append(samples)
    segments.append({"start": round(t, 3), "end": round(t + len(samples) / RATE, 3)})
    t += len(samples) / RATE
    gap = np.zeros(int(round(pause * RATE)), dtype=np.float32)
    parts.append(gap)
    t += len(gap) / RATE
    print(f"[tts] {i + 1}/{len(job['segments'])}", flush=True)

audio = np.concatenate(parts) if parts else np.zeros(RATE, dtype=np.float32)
sf.write(args.out, audio, RATE, subtype="PCM_16")

# The mouth, over the whole track so it never drifts from the sound: loudness per frame, scaled per segment, shut in
# the pauses.
n = int(np.ceil(len(audio) / WINDOW))
frames = np.pad(audio, (0, n * WINDOW - len(audio))).reshape(n, WINDOW)
db = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
mouth = np.zeros(n, dtype=int)
centres = (np.arange(n) + 0.5) / FPS
for seg in segments:
    inside = (centres >= seg["start"]) & (centres < seg["end"])
    if not inside.any():
        continue
    top = np.percentile(db[inside], 95)
    floor = max(-45.0, top - 30)
    mouth[inside] = np.clip(np.round((db[inside] - floor) / max(1e-6, top - floor) * 4), 0, 4).astype(int)
print(json.dumps({"duration": round(len(audio) / RATE, 3), "segments": segments, "fps": FPS, "mouth": "".join(str(v) for v in mouth)}))
