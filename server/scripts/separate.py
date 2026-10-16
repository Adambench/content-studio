"""Split a clip's sound into the voice and everything else with Demucs (htdemucs, two stems), for the music check.

Usage: separate.py IN.wav --vocals VOICE.wav --rest REST.wav
IN.wav is 44.1 kHz 16-bit PCM (the server makes it with ffmpeg); both outputs are written the same way, in stereo.
The model comes from the clip tools' own cache (HF_HOME, set by the server).
"""
import argparse
import os
import wave

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

parser = argparse.ArgumentParser()
parser.add_argument("audio")
parser.add_argument("--vocals", required=True)
parser.add_argument("--rest", required=True)
args = parser.parse_args()

# Half the cores: renders and Whisper share this laptop. A compute worker's GPU does it when torch can use it.
torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
device = "cuda" if torch.cuda.is_available() else "cpu"
model = get_model("htdemucs")
model.eval()

# Decode the WAV ourselves rather than through torchaudio, which isn't installed.
with wave.open(args.audio, "rb") as w:
    rate = w.getframerate()
    channels = w.getnchannels()
    pcm = w.readframes(w.getnframes())
if rate != model.samplerate:
    raise SystemExit(f"expected {model.samplerate} Hz audio, got {rate}")
audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32).reshape(-1, channels).T / 32768.0
if channels == 1:
    audio = np.repeat(audio, 2, axis=0)
wav = torch.from_numpy(np.ascontiguousarray(audio[:2]))

# Normalised the way Demucs' own command line does it.
ref = wav.mean(0)
mean, std = ref.mean(), ref.std() + 1e-8
with torch.no_grad():
    stems = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
stems = stems.cpu() * std + mean
voice = stems[model.sources.index("vocals")]
rest = stems.sum(0) - voice


def write(path, x):
    data = (np.clip(x.numpy().T, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())


write(args.vocals, voice)
write(args.rest, rest)
