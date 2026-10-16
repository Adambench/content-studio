"""Where the speaker is in a clip, with OpenCV's YuNet face detector: the focus point for reframing.

Usage: faces.py VIDEO --model YUNET.onnx [--samples 12]
Prints JSON: the frame size, how many sampled frames had a face, each frame's biggest face (centre and size, 0-1 of
the frame) and `focus`, the median centre of those faces (null when none was found).
"""
import argparse
import json
import statistics

import cv2

parser = argparse.ArgumentParser()
parser.add_argument("video")
parser.add_argument("--model", required=True)
parser.add_argument("--samples", type=int, default=12)
args = parser.parse_args()

cap = cv2.VideoCapture(args.video)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS) or 30
frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
# Detect on a copy no wider than 640 px: faces in a talking shot are big, and it's 10x faster.
scale = min(1.0, 640 / max(width, height, 1))
size = (max(1, int(width * scale)), max(1, int(height * scale)))
detector = cv2.FaceDetectorYN.create(args.model, "", size, score_threshold=0.7)

faces = []
n = max(1, args.samples)
for i in range(n):
    # Spread across the clip, skipping the very first and last frames.
    index = int(frames * (i + 0.5) / n)
    cap.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, frame = cap.read()
    if not ok:
        continue
    small = cv2.resize(frame, size) if scale < 1 else frame
    _, found = detector.detect(small)
    if found is None or len(found) == 0:
        continue
    # The biggest confident face is the one talking, most of the time.
    x, y, w, h = max(found, key=lambda f: f[2] * f[3] * f[14])[:4]
    faces.append({
        "t": round(index / fps, 2),
        "x": round(float(x + w / 2) / size[0], 4),
        "y": round(float(y + h / 2) / size[1], 4),
        "w": round(float(w) / size[0], 4),
        "h": round(float(h) / size[1], 4),
        "count": int(len(found)),
    })

focus = None
if faces:
    focus = {"x": statistics.median(f["x"] for f in faces), "y": statistics.median(f["y"] for f in faces), "h": statistics.median(f["h"] for f in faces)}
print(json.dumps({"width": width, "height": height, "sampled": n, "found": len(faces), "faces": faces, "focus": focus}))
