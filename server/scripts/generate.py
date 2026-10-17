"""A picture or a short video clip with stable-diffusion.cpp, on a compute worker's GPU.

Usage:
  generate.py image --sd SD_CLI --models DIR --prompt=TEXT --width W --height H --seed S --out OUT.png
  generate.py video --sd SD_CLI --models DIR --ffmpeg FFMPEG --prompt=TEXT --negative=TEXT --width W --height H
                    --seed S --frames N --out OUT.mp4
Pictures: FLUX.1-schnell (4 steps, no guidance). Clips: Wan 2.1 T2V 1.3B at 16 fps; the text model on this machine is
unloaded first so the card is free. sd-cli places the weights between the GPU and RAM by itself (--auto-fit).
Progress goes to stderr as "[gen] step 3/20"; stdout gets one line of JSON: {"seconds": …, "seed": …}.
Model files (DIR, put there by scripts/setup-worker.sh):
  flux/flux1-schnell-q4_k.gguf, flux/ae.safetensors, flux/clip_l.safetensors, flux/t5xxl-q8_0.gguf
  wan/wan2.1_t2v_1.3B_fp16.safetensors, wan/wan_2.1_vae.safetensors, wan/umt5-xxl-encoder-q8_0.gguf
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("kind", choices=["image", "video"])
parser.add_argument("--sd", required=True)
parser.add_argument("--models", required=True)
parser.add_argument("--ffmpeg", default="ffmpeg")
parser.add_argument("--prompt", required=True)
parser.add_argument("--negative", default="")
parser.add_argument("--width", type=int, default=768)
parser.add_argument("--height", type=int, default=1344)
parser.add_argument("--seed", type=int, default=1)
parser.add_argument("--frames", type=int, default=81)
parser.add_argument("--out", required=True)
args = parser.parse_args()


def model(*parts):
    path = os.path.join(args.models, *parts)
    if not os.path.isfile(path):
        sys.exit(f"Missing model file {path}: run scripts/setup-worker.sh --with {args.kind} again.")
    return path


def unload_text_model():
    """Ollama keeps the text model in the card's memory for a while: ask it to let go before a clip."""
    base = os.environ.get("CS_LLM_LOCAL", "http://127.0.0.1:11434").rstrip("/")
    try:
        with urllib.request.urlopen(f"{base}/api/ps", timeout=5) as r:
            running = json.load(r).get("models", [])
        for m in running:
            body = json.dumps({"model": m["name"], "keep_alive": 0}).encode()
            urllib.request.urlopen(urllib.request.Request(f"{base}/api/generate", data=body, headers={"content-type": "application/json"}), timeout=60).read()
            print(f"[gen] unloaded {m['name']}", file=sys.stderr, flush=True)
    except Exception:
        pass  # no model server here, or nothing loaded


def run_sd(cmd):
    """sd-cli prints its progress bar with carriage returns: pass on one line per step."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = []
    last = ""
    buf = b""
    while True:
        chunk = proc.stdout.read(256)
        if not chunk:
            break
        buf += chunk
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for raw in parts:
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            tail = (tail + [line])[-30:]
            m = re.search(r"\|\s*(\d+)/(\d+)", line)
            step = f"{m.group(1)}/{m.group(2)}" if m else ""
            if step and step != last:
                last = step
                print(f"[gen] step {step}", file=sys.stderr, flush=True)
    code = proc.wait()
    if code != 0:
        print("\n".join(tail), file=sys.stderr)
        sys.exit(f"sd-cli stopped (exit {code}): {tail[-1] if tail else ''}")


started = time.time()
# The prompts go through files: sd-cli has no --prompt=… form, and a prompt could start with a dash.
work = tempfile.mkdtemp(prefix="cs-gen-")
prompt_file = os.path.join(work, "prompt.txt")
negative_file = os.path.join(work, "negative.txt")
with open(prompt_file, "w", encoding="utf-8") as f:
    f.write(args.prompt)
with open(negative_file, "w", encoding="utf-8") as f:
    f.write(args.negative)
common = ["--seed", str(args.seed), "-W", str(args.width), "-H", str(args.height), "--vae-tiling", "--prompt-file", prompt_file]

try:
    if args.kind == "image":
        run_sd([
            args.sd,
            "--diffusion-model", model("flux", "flux1-schnell-q4_k.gguf"),
            "--vae", model("flux", "ae.safetensors"),
            "--clip_l", model("flux", "clip_l.safetensors"),
            "--t5xxl", model("flux", "t5xxl-q8_0.gguf"),
            "--cfg-scale", "1.0", "--sampling-method", "euler", "--steps", "4",
            *common, "-o", args.out,
        ])
    else:
        unload_text_model()
        avi = os.path.join(work, "clip.avi")
        run_sd([
            args.sd, "-M", "vid_gen",
            "--diffusion-model", model("wan", "wan2.1_t2v_1.3B_fp16.safetensors"),
            "--vae", model("wan", "wan_2.1_vae.safetensors"),
            "--t5xxl", model("wan", "umt5-xxl-encoder-q8_0.gguf"),
            "--cfg-scale", "6.0", "--sampling-method", "euler", "--steps", "20", "--flow-shift", "3.0",
            "--video-frames", str(args.frames), "--fps", "16", "--negative-prompt-file", negative_file,
            *common, "-o", avi,
        ])
        # H.264 at the clip's own 16 fps; the editor scales it into the frame.
        subprocess.run([args.ffmpeg, "-hide_banner", "-nostdin", "-y", "-v", "error", "-i", avi, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "16", "-an", "-movflags", "+faststart", args.out], check=True)
finally:
    shutil.rmtree(work, ignore_errors=True)

if not os.path.isfile(args.out) or os.path.getsize(args.out) == 0:
    sys.exit("sd-cli finished without writing the file.")
print(json.dumps({"seconds": round(time.time() - started, 1), "seed": args.seed}))
