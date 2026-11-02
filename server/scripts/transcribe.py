"""Transcribe an audio file with faster-whisper and write JSON with word timestamps.

Usage: transcribe.py AUDIO --out OUT.json [--model small] [--language en]
"""
import argparse
import json
import os
import wave

import numpy as np
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument("audio")
parser.add_argument("--out", required=True)
parser.add_argument("--model", default="small")
parser.add_argument("--language", default=None)
args = parser.parse_args()

def load():
    # A compute worker has a GPU: int8 on it (Pascal cards have no fast fp16). The laptop is CPU-only, where int8 keeps
    # memory around 1 GB for the small model.
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return WhisperModel(args.model, device="cuda", compute_type="int8")
    except Exception:
        pass
    return WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=max(1, (os.cpu_count() or 4) // 2))


model = load()
# The server hands us 16 kHz mono 16-bit WAV (made by ffmpeg). Decode it ourselves rather than
# through PyAV, whose API changes between releases.
with wave.open(args.audio, "rb") as w:
    pcm = w.readframes(w.getnframes())
audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
segments, info = model.transcribe(audio, word_timestamps=True, vad_filter=True, language=args.language)

result = {"language": info.language, "duration": round(info.duration, 2), "segments": []}
texts = []
for seg in segments:
    text = seg.text.strip()
    texts.append(text)
    result["segments"].append({
        "start": round(seg.start, 2),
        "end": round(seg.end, 2),
        "text": text,
        "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word} for w in (seg.words or [])],
    })
result["text"] = " ".join(texts)

with open(args.out, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
