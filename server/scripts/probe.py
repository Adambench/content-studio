"""What this machine can run for Content Studio, and how fast: printed as one line of JSON.

Usage: probe.py --matte-model U2NET.onnx --ffmpeg ffmpeg
Used by compute workers when they start and by Settings → Compute's self-test.
"""
import argparse
import json
import shutil
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("--matte-model", default="")
parser.add_argument("--ffmpeg", default="ffmpeg")
args = parser.parse_args()

out = {"gpu": "", "cuda": False, "whisper": False, "demucs": False, "matte": False, "speakers": False, "ffmpeg": bool(shutil.which(args.ffmpeg) or args.ffmpeg != "ffmpeg"), "matteMsPerFrame": None}

if shutil.which("nvidia-smi"):
    try:
        out["gpu"] = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True, timeout=20).stdout.strip().split("\n")[0]
    except Exception:
        pass

try:
    import faster_whisper  # noqa: F401

    out["whisper"] = True
except Exception:
    pass
try:
    import demucs  # noqa: F401
    import torch

    out["demucs"] = True
    out["cuda"] = bool(torch.cuda.is_available())
except Exception:
    pass
try:
    import cv2

    out["speakers"] = hasattr(cv2, "FaceDetectorYN")
except Exception:
    pass

try:
    import numpy as np
    import onnxruntime as ort

    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    out["cuda"] = out["cuda"] or "CUDAExecutionProvider" in providers
    if args.matte_model:
        session = ort.InferenceSession(args.matte_model, providers=providers)
        name = session.get_inputs()[0].name
        x = np.random.rand(1, 3, 320, 320).astype(np.float32)
        session.run(None, {name: x})
        t = time.time()
        for _ in range(5):
            session.run(None, {name: x})
        out["matte"] = True
        out["matteMsPerFrame"] = round((time.time() - t) / 5 * 1000)
except Exception:
    pass

print(json.dumps(out))
