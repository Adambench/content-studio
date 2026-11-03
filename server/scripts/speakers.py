"""Who is on screen, and who is talking, through a video: for reframing that follows the speaker.

Usage: speakers.py VIDEO --model YUNET.onnx [--fps 8] [--start S] [--end E]
Prints JSON: the frame size, the step between samples, and the shots (split where the picture changes at once). Each
shot lists the faces seen in it, tracked by position: their median centre and height (0-1 of the frame), how many
samples they were in, and how much their mouth moved in each sample ("activity", from YuNet's mouth-corner and nose
landmarks: the mean change of a small grey crop of the mouth from the sample before). The one talking moves their
mouth most, most of the time.
"""
import argparse
import json
import statistics

import cv2
import numpy as np


def spread(values, q):
    """The q-th quantile of a few values (nearest rank)."""
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))]

parser = argparse.ArgumentParser()
parser.add_argument("video")
parser.add_argument("--model", required=True)
parser.add_argument("--fps", type=float, default=8)
parser.add_argument("--start", type=float, default=0)
parser.add_argument("--end", type=float, default=0)
args = parser.parse_args()

cap = cv2.VideoCapture(args.video)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS) or 30
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
every = max(1, round(fps / max(1, args.fps)))
step = every / fps

# Faces are found on a copy no wider than 640 px (talking shots have big faces; it's 10x faster).
scale = min(1.0, 640 / max(width, height, 1))
size = (max(1, int(width * scale)), max(1, int(height * scale)))
detector = cv2.FaceDetectorYN.create(args.model, "", size, score_threshold=0.75)

first = int(args.start * fps)
last = int(args.end * fps) if args.end > 0 else total
if first:
    cap.set(cv2.CAP_PROP_POS_FRAMES, first)

MATCH = 0.12  # how far (fraction of the width) a face can move between samples and stay the same track

# First pass: every sample's change from the one before (a small grey copy and a colour histogram) and its faces.
samples = []
prev_gray = None
prev_hist = None
index = first
last_t = args.start
while index < last:
    ok = cap.grab()
    if not ok:
        break
    # The frame's own timestamp: phone footage has a variable frame rate, so counting frames drifts from the times
    # FFmpeg and the player use.
    pos = cap.get(cv2.CAP_PROP_POS_MSEC)
    t = pos / 1000 if pos >= 0 else index / fps
    last_t = t
    if (index - first) % every:
        index += 1
        continue
    ok, frame = cap.retrieve()
    if not ok:
        break
    index += 1
    small = cv2.resize(frame, size) if scale < 1 else frame
    tiny = cv2.resize(small, (64, 36))
    g = cv2.cvtColor(tiny, cv2.COLOR_BGR2GRAY).astype(np.float32)
    hsv = cv2.cvtColor(tiny, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    diff = float(np.abs(g - prev_gray).mean()) if prev_gray is not None else 0.0
    hdist = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA) if prev_hist is not None else 0.0
    prev_gray, prev_hist = g, hist

    _, found = detector.detect(small)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    faces = []
    for f in found if found is not None else []:
        x, y, w, h = (float(v) for v in f[:4])
        nose = f[8:10]
        mouth_r, mouth_l = f[10:12], f[12:14]
        mw = abs(mouth_l[0] - mouth_r[0])
        top = int(nose[1])
        bottom = int(max(mouth_l[1], mouth_r[1]) + (max(mouth_l[1], mouth_r[1]) - nose[1]) * 1.1)
        left = int(min(mouth_l[0], mouth_r[0]) - mw * 0.35)
        right = int(max(mouth_l[0], mouth_r[0]) + mw * 0.35)
        crop = None
        if bottom - top > 3 and right - left > 3:
            region = gray[max(0, top):max(0, bottom), max(0, left):max(0, right)]
            if region.size:
                crop = cv2.resize(region, (24, 16)).astype(np.float32)
                crop = (crop - crop.mean()) / (crop.std() + 1e-3)
        faces.append({"x": (x + w / 2) / size[0], "y": (y + h / 2) / size[1], "h": h / size[1], "crop": crop})
    samples.append({"t": t, "diff": diff, "hist": hdist, "faces": faces})

end_time = last_t + 1 / fps

# Cuts: a sudden change far above this video's usual frame-to-frame change (motion within a shot stays well under).
usual = statistics.median([s["diff"] for s in samples[1:]]) if len(samples) > 2 else 0
threshold = max(18.0, usual * 5)
cuts = [i for i, s in enumerate(samples) if i > 0 and (s["diff"] >= threshold or s["hist"] >= 0.5)]
bounds = [0] + cuts + [len(samples)]
spans = [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1) if bounds[i + 1] > bounds[i]]
# Flashes and fast motion make runs of tiny "shots": fold anything under half a second into the one before.
merged = []
for a, b in spans:
    if merged and (samples[b - 1]["t"] - samples[a]["t"] < 0.5):
        merged[-1] = (merged[-1][0], b)
    else:
        merged.append((a, b))

out = []
for k, (a, b) in enumerate(merged):
    tracks = []
    for s in samples[a:b]:
        for f in s["faces"]:
            track = min(tracks, key=lambda tr: abs(tr["lx"] - f["x"]) + abs(tr["ly"] - f["y"]), default=None)
            if track is None or abs(track["lx"] - f["x"]) + abs(track["ly"] - f["y"]) > MATCH * 2:
                track = {"xs": [], "ys": [], "hs": [], "activity": [], "lx": f["x"], "ly": f["y"], "last": None, "lt": None}
                tracks.append(track)
            if f["crop"] is not None and track["last"] is not None and s["t"] - track["lt"] <= step * 1.6:
                track["activity"].append([round(s["t"], 3), round(float(np.abs(f["crop"] - track["last"]).mean()), 4)])
            track["xs"].append(f["x"])
            track["ys"].append(f["y"])
            track["hs"].append(f["h"])
            track["lx"], track["ly"], track["last"], track["lt"] = f["x"], f["y"], f["crop"], s["t"]
    out.append({
        "start": round(samples[a]["t"], 3) if k else round(args.start, 3),
        "end": round(samples[b]["t"], 3) if b < len(samples) else round(end_time, 3),
        "samples": b - a,
        "tracks": [
            {"x": round(statistics.median(tr["xs"]), 4), "y": round(statistics.median(tr["ys"]), 4), "h": round(statistics.median(tr["hs"]), 4), "n": len(tr["xs"]), "activity": tr["activity"],
             # How far the face moves sideways in the shot (a leaning speaker), a stray sample or two left out.
             "x0": round(spread(tr["xs"], 0.1), 4), "x1": round(spread(tr["xs"], 0.9), 4)}
            for tr in tracks
        ],
    })
print(json.dumps({"width": width, "height": height, "step": round(step, 4), "shots": out}))
