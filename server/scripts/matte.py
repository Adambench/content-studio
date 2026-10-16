"""A person matte for a video: white where a person is, black elsewhere, as a grey video the size of the source.

Usage: matte.py VIDEO --model U2NET_HUMAN_SEG.onnx --out MASK.mp4 --ffmpeg /path/to/ffmpeg [--fps 15]
Runs on this computer only (onnxruntime, CPU). The mask is made at --fps (the picture is matted every few frames and
the mask held between them), lightly smoothed over time so its edge doesn't flicker. Prints progress as "progress 0.42".
"""
import argparse
import subprocess
import sys

import cv2
import numpy as np
import onnxruntime as ort

parser = argparse.ArgumentParser()
parser.add_argument("video")
parser.add_argument("--model", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--ffmpeg", default="ffmpeg")
parser.add_argument("--fps", type=float, default=15)
args = parser.parse_args()

cap = cv2.VideoCapture(args.video)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS) or 30
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
every = max(1, round(fps / max(1.0, args.fps)))
out_fps = fps / every

session = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
input_name = session.get_inputs()[0].name
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def matte(frame_bgr):
    rgb = cv2.cvtColor(cv2.resize(frame_bgr, (320, 320), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    x = ((rgb - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    pred = session.run(None, {input_name: x})[0][0, 0]
    lo, hi = float(pred.min()), float(pred.max())
    # Nobody in the picture: the network still stretches noise to the full range, so a weak peak means an empty mask.
    if hi < 0.35:
        return np.zeros((height, width), dtype=np.uint8)
    pred = (pred - lo) / max(hi - lo, 1e-6)
    return cv2.resize((pred * 255).astype(np.uint8), (width, height), interpolation=cv2.INTER_LINEAR)


encoder = subprocess.Popen(
    [args.ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{width}x{height}", "-r", f"{out_fps:.4f}", "-i", "-",
     "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.out],
    stdin=subprocess.PIPE,
)
previous = None
index = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    if index % every == 0:
        mask = matte(frame)
        if previous is not None:
            mask = cv2.addWeighted(mask, 0.65, previous, 0.35, 0)
        previous = mask
        encoder.stdin.write(mask.tobytes())
        if (index // every) % 20 == 0:
            print(f"progress {index / total:.2f}", flush=True)
    index += 1
encoder.stdin.close()
if encoder.wait() != 0:
    sys.exit("ffmpeg could not write the mask")
print("progress 1.00", flush=True)
