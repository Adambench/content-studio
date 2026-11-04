"""Who is on screen, and who is talking, through a video: for reframing that follows the speaker.

Usage: speakers.py VIDEO --model YUNET.onnx --ffmpeg FFMPEG [--fps 8] [--start S] [--end E] [--add-cuts T,T]
Prints JSON: the frame size and rate, the step between samples, every camera change (`cuts`: the time of the first frame
of the new shot, exact to the frame, as FFmpeg and the edit count time) and the shots between them. Each shot lists the
faces seen in it, tracked by position: their median centre and height (0-1 of the frame), how many samples they were
in, and how much their mouth moved in each sample ("activity", from YuNet's mouth-corner and nose landmarks: the mean
change of a small grey crop of the mouth from the sample before). The one talking moves their mouth most, most of the
time. `cutGrids`: for each camera change, how much each part of the picture changes (16 x 9 cells, row by row, the mean
change of 0-255), so a change in part of the picture (a box beside the speaker) can be told from one in the part a crop
shows. `--add-cuts`: camera changes found some other way (a check of the finished video) that count as well.
"""
import argparse
import bisect
import json
import os
import re
import statistics
import subprocess
import tempfile

import cv2
import numpy as np

# 2: camera changes from every frame (FFmpeg's scene score), exact to the frame. Scans without it are made again.
VERSION = 2


def spread(values, q):
    """The q-th quantile of a few values (nearest rank)."""
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))]

parser = argparse.ArgumentParser()
parser.add_argument("video")
parser.add_argument("--model", required=True)
parser.add_argument("--ffmpeg", default="ffmpeg")
parser.add_argument("--fps", type=float, default=8)
parser.add_argument("--start", type=float, default=0)
parser.add_argument("--end", type=float, default=0)
parser.add_argument("--add-cuts", default="")
args = parser.parse_args()


def frame_changes(video):
    """Every frame's time (seconds from the file's start, as FFmpeg seeks) and how much of the picture changed from the
    frame before (scdet's mean absolute difference, 0-100)."""
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(
            [args.ffmpeg, "-hide_banner", "-nostats", "-v", "error", "-i", os.path.abspath(video), "-map", "0:V:0",
             "-vf", "scdet=threshold=100,metadata=mode=print:file=scd.txt", "-f", "null", "-"],
            cwd=d, check=True, stdout=subprocess.DEVNULL)
        times, diffs = [], []
        with open(os.path.join(d, "scd.txt")) as f:
            for line in f:
                if line.startswith("frame:"):
                    m = re.search(r"pts_time:(-?[0-9.]+)", line)
                    times.append(float(m.group(1)) if m else None)
                    diffs.append(0.0)
                elif line.startswith("lavfi.scd.mafd=") and diffs:
                    diffs[-1] = float(line.split("=", 1)[1])
    return times, diffs


def camera_changes(diffs):
    """The frames where the picture changes at once: a cut to another camera. The change is big (4 or more of 100) and
    at least 8 times the motion around it (six frames either side), so a gesture, a pan or fast talk never counts, but
    a cut inside a framed layout (an ad's box, a split screen) does. A frame or two of something else (a flash) isn't a
    shot of its own: only the change after it counts."""
    cuts = []
    for i in range(1, len(diffs)):
        if diffs[i] < 4:
            continue
        around = [diffs[j] for j in range(max(1, i - 6), min(len(diffs), i + 7)) if j != i]
        if diffs[i] < 8 * max(statistics.median(around) if around else 0, 0.05):
            continue
        if cuts and i - cuts[-1] < 3:
            cuts[-1] = i
        else:
            cuts.append(i)
    return cuts


times, diffs = frame_changes(args.video)

cap = cv2.VideoCapture(args.video)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS) or 30
total = len(times) or int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
every = max(1, round(fps / max(1, args.fps)))
step = every / fps
# A frame FFmpeg gave no time: one frame on from the one before.
for i, t in enumerate(times):
    if t is None:
        times[i] = times[i - 1] + 1 / fps if i else 0.0


def time_of(index):
    return times[index] if 0 <= index < len(times) else (times[-1] + (index - len(times) + 1) / fps if times else index / fps)


def frame_at(t):
    """The first frame at or after a time (half a frame either way counts as on it)."""
    return bisect.bisect_left(times, t - 0.5 / fps)


first = frame_at(args.start) if args.start > 0 else 0
last = min(total, frame_at(args.end)) if args.end > 0 else total
cut_frames = set(camera_changes(diffs))
# A camera change found some other way is put on the frame nearby that changes most (its time can be a frame off), and
# counts only when the footage itself changes there (a check of a finished video also sees its graphics change).
for t in filter(None, args.add_cuts.split(",")):
    i = frame_at(float(t))
    near = [j for j in range(i - 2, i + 3) if 1 <= j < len(diffs)]
    if not near:
        continue
    j = max(near, key=lambda k: diffs[k])
    around = [diffs[k] for k in range(max(1, j - 6), min(len(diffs), j + 7)) if k != j]
    if diffs[j] >= 2 and diffs[j] >= 3 * max(statistics.median(around) if around else 0, 0.05):
        cut_frames.add(j)
bounds = [first] + sorted(c for c in cut_frames if first < c < last) + [last]
shots = [(bounds[k], bounds[k + 1]) for k in range(len(bounds) - 1) if bounds[k + 1] > bounds[k]]

# The frames either side of each camera change, to see which part of the picture changes.
around_cuts = {i for c in bounds[1:-1] for i in (c - 1, c)}
tiny = {}

# Faces every few frames, and at least twice in a short shot (its own framing needs its own faces).
wanted = {}
for k, (a, b) in enumerate(shots):
    n = b - a
    picks = list(range(a + min(1, n - 1), b, every))
    if len(picks) < 2 and n >= 2:
        picks = sorted(set(picks + [a + n // 2]))
    for i in picks:
        wanted[i] = k

# Faces are found on a copy no wider than 640 px (talking shots have big faces; it's 10x faster).
scale = min(1.0, 640 / max(width, height, 1))
size = (max(1, int(width * scale)), max(1, int(height * scale)))
detector = cv2.FaceDetectorYN.create(args.model, "", size, score_threshold=0.75)
if first:
    cap.set(cv2.CAP_PROP_POS_FRAMES, first)

MATCH = 0.12  # how far (fraction of the width) a face can move between samples and stay the same track

samples = [[] for _ in shots]
index = first
while index < last:
    ok = cap.grab()
    if not ok:
        break
    if index not in wanted and index not in around_cuts:
        index += 1
        continue
    ok, frame = cap.retrieve()
    if not ok:
        break
    if index in around_cuts:
        tiny[index] = cv2.cvtColor(cv2.resize(frame, (64, 36), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
    if index not in wanted:
        index += 1
        continue
    t = time_of(index)
    k = wanted[index]
    index += 1
    small = cv2.resize(frame, size) if scale < 1 else frame
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
    samples[k].append({"t": t, "faces": faces})

out = []
for k, (a, b) in enumerate(shots):
    tracks = []
    for s in samples[k]:
        # Each face to its nearest track, nearest pairs first and one face per track: two people sitting close together
        # keep a track each (sharing one, each mouth was compared with the other's and both looked like they talked).
        pairs = sorted(
            (abs(tr["lx"] - f["x"]) + abs(tr["ly"] - f["y"]), i, j) for i, f in enumerate(s["faces"]) for j, tr in enumerate(tracks)
        )
        owner, taken = {}, set()
        for d, i, j in pairs:
            if d <= MATCH * 2 and i not in owner and j not in taken:
                owner[i] = j
                taken.add(j)
        for i, f in enumerate(s["faces"]):
            if i in owner:
                track = tracks[owner[i]]
            else:
                track = {"xs": [], "ys": [], "hs": [], "activity": [], "lx": f["x"], "ly": f["y"], "last": None, "lt": None}
                tracks.append(track)
            if f["crop"] is not None and track["last"] is not None and s["t"] - track["lt"] <= step * 1.6:
                track["activity"].append([round(s["t"], 3), round(float(np.abs(f["crop"] - track["last"]).mean()), 4)])
            track["xs"].append(f["x"])
            track["ys"].append(f["y"])
            track["hs"].append(f["h"])
            track["lx"], track["ly"], track["last"], track["lt"] = f["x"], f["y"], f["crop"], s["t"]
    out.append({
        "start": round(time_of(a), 4),
        "end": round(time_of(b), 4),
        "samples": len(samples[k]),
        "tracks": [
            {"x": round(statistics.median(tr["xs"]), 4), "y": round(statistics.median(tr["ys"]), 4), "h": round(statistics.median(tr["hs"]), 4), "n": len(tr["xs"]), "activity": tr["activity"],
             # How far the face moves sideways in the shot (a leaning speaker), a stray sample or two left out.
             "x0": round(spread(tr["xs"], 0.1), 4), "x1": round(spread(tr["xs"], 0.9), 4)}
            for tr in tracks
        ],
    })


def grid(c):
    """How much each of 16 x 9 cells of the picture changes at a camera change (0-255)."""
    if c - 1 not in tiny or c not in tiny:
        return None
    d = np.abs(tiny[c] - tiny[c - 1]).reshape(9, 4, 16, 4).mean(axis=(1, 3))
    return [int(round(v)) for v in d.flatten()]


print(json.dumps({
    "version": VERSION, "width": width, "height": height, "fps": round(fps, 5), "step": round(step, 4),
    "cuts": [round(time_of(c), 4) for c in bounds[1:-1]], "cutGrids": [grid(c) for c in bounds[1:-1]], "shots": out,
}))
