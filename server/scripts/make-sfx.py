"""
Builds the built-in sound effects in server/assets/sfx (development only; the files are committed).

No music and no instruments: whooshes, risers and sweeps, impacts, pops, clicks, dings and glitches. Some are
synthesised here (ours), the rest are trimmed from Kenney's CC0 packs (kenney.nl: Impact Sounds, Interface Sounds,
UI Audio). Needs numpy (the Whisper venv has it) and ffmpeg:

    ~/.local/share/content-studio/whisper/bin/python server/scripts/make-sfx.py

Then update the durations in shared/sfx.ts if they changed (the script prints them).
"""

import io
import os
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'sfx')
KENNEY = {
    'impact': 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
    'interface': 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
    'ui': 'https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip',
}
rng = np.random.default_rng(7)


# ---------- building blocks ----------

def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def noise(seconds):
    return rng.standard_normal(int(seconds * SR))


def biquad(x, freqs, q, kind):
    """A band-pass or low-pass filter whose frequency follows `freqs` (one value per sample)."""
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    b0 = b1 = b2 = a1 = a2 = 0.0
    for i in range(len(x)):
        if i % 32 == 0:
            w = 2 * np.pi * min(float(freqs[i]), SR * 0.45) / SR
            alpha = np.sin(w) / (2 * q)
            cw = np.cos(w)
            a0 = 1 + alpha
            if kind == 'bp':
                b0, b1, b2 = alpha / a0, 0.0, -alpha / a0
            else:
                b0, b1, b2 = (1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0
            a1, a2 = -2 * cw / a0, (1 - alpha) / a0
        xi = x[i]
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, xi, y1, yi
        y[i] = yi
    return y


def bell(n, peak, sharp=2.0):
    """0 → 1 → 0, peaking at `peak` (0–1 of the length)."""
    u = np.linspace(0, 1, n)
    rise = np.clip(u / peak, 0, 1) ** sharp
    fall = np.clip((1 - u) / (1 - peak), 0, 1) ** (sharp * 0.8)
    return np.where(u < peak, rise, fall)


def sweep(n, points):
    """Exponential glide through (position 0–1, frequency) points."""
    u = np.linspace(0, 1, n)
    xs, fs = zip(*points)
    return np.exp(np.interp(u, xs, np.log(fs)))


def fade(x, inn=0.003, out=0.01):
    x = x.copy()
    a, b = int(inn * SR), int(out * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def pan(x, start, end):
    """Mono → stereo, moving from `start` to `end` (-1 left … 1 right)."""
    p = (np.linspace(start, end, len(x)) + 1) * np.pi / 4
    return np.stack([x * np.cos(p), x * np.sin(p)], axis=1)


def stereo(x):
    return x if x.ndim == 2 else np.stack([x, x], axis=1)


def peak(x, db):
    m = np.max(np.abs(x)) or 1
    return x / m * 10 ** (db / 20)


def mix(n, *parts):
    out = np.zeros(n)
    for start, sig in parts:
        s = int(start * SR)
        end = min(n, s + len(sig))
        out[s:end] += sig[: end - s]
    return out


# ---------- synthesised ----------

def whoosh(seconds, lo, hi, end, at=0.5, q=1.0, air=0.35, pan_from=-0.5, pan_to=0.5, sharp=2.0):
    n = int(seconds * SR)
    src = noise(seconds)
    f = sweep(n, [(0, lo), (at, hi), (1, end)])
    body = biquad(src, f, q, 'bp')
    top = biquad(noise(seconds), f * 2.2, q * 1.3, 'bp') * air
    return pan(fade((body + top) * bell(n, at, sharp)), pan_from, pan_to)


def reverse_whoosh(seconds):
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    f = sweep(n, [(0, 180), (1, 4200)])
    body = biquad(noise(seconds), f, 0.9, 'bp') + biquad(noise(seconds), f * 2, 1.2, 'bp') * 0.3
    return pan(fade(body * u ** 3, out=0.012), 0.6, -0.1)


def riser(seconds, tonal=False):
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    f = sweep(n, [(0, 220), (1, 7000)])
    sig = biquad(noise(seconds), f, 2.2, 'bp') + biquad(noise(seconds), f * 0.5, 1.5, 'bp') * 0.5
    if tonal:
        # One continuous glide (a sweep, never notes), two slightly detuned voices.
        g = sweep(n, [(0, 110), (1, 880)])
        ph1 = 2 * np.pi * np.cumsum(g) / SR
        ph2 = 2 * np.pi * np.cumsum(g * 1.003) / SR
        tone = (np.sin(ph1) + 0.5 * np.sin(2 * ph1) + np.sin(ph2) + 0.5 * np.sin(2 * ph2)) / 3
        sig = sig / (np.max(np.abs(sig)) or 1) * 0.6 + tone * 0.5
    return stereo(fade(sig * u ** 2.2, inn=0.05, out=0.015))


def boom(seconds=1.8, f0=72, f1=36, decay=0.5):
    t = t_axis(seconds)
    f = f1 + (f0 - f1) * np.exp(-t / 0.09)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    hit = biquad(noise(seconds), np.full(len(t), 900), 0.7, 'lp') * np.exp(-t / 0.025)
    rumble = biquad(noise(seconds), np.full(len(t), 160), 0.7, 'lp') * np.exp(-t / 0.35) * 0.8
    return stereo(fade(np.tanh((sub * 1.4 + hit * 0.6 + rumble) * 1.6), inn=0.001, out=0.08))


def pop(seconds=0.12, f0=380, f1=1250):
    t = t_axis(seconds)
    f = f1 + (f0 - f1) * np.exp(-t / 0.012)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.028)
    click = biquad(noise(seconds), np.full(len(t), 3000), 0.8, 'lp') * np.exp(-t / 0.002) * 0.4
    return stereo(fade(body + click, inn=0.0005, out=0.01))


def shutter():
    seconds = 0.32
    t = t_axis(seconds)

    def clack(at, level):
        n = noise(0.05)
        tt = t_axis(0.05)
        return at, biquad(n, np.full(len(n), 2600), 1.1, 'bp') * np.exp(-tt / 0.006) * level

    whir = biquad(noise(0.08), np.full(int(0.08 * SR), 5200), 2.0, 'bp') * bell(int(0.08 * SR), 0.3) * 0.25
    return stereo(fade(mix(len(t), clack(0.0, 1.0), (0.012, whir), clack(0.085, 0.75))))


def ding(seconds=1.6, f=1320, partials=((1, 1, 0.9), (2.76, 0.5, 0.5), (5.4, 0.25, 0.3), (8.93, 0.12, 0.2))):
    """One struck tone with bell-like (inharmonic) overtones: a single ding, not a note sequence."""
    t = t_axis(seconds)
    sig = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d) for r, a, d in partials)
    return stereo(fade(sig, inn=0.001, out=0.05))


def buzzer(seconds=0.5):
    t = t_axis(seconds)
    sq = np.sign(np.sin(2 * np.pi * 118 * t))
    sig = biquad(sq, np.full(len(t), 1800), 0.7, 'lp')
    return stereo(fade(sig, inn=0.005, out=0.04))


def static(seconds=0.6):
    n = int(seconds * SR)
    sig = biquad(noise(seconds), np.full(n, 3500), 0.6, 'bp')
    flicker = np.repeat(rng.uniform(0.25, 1.0, n // 480 + 1), 480)[:n]
    return stereo(fade(sig * flicker * bell(n, 0.1, 0.6), inn=0.002, out=0.06))


def glitch(seconds=0.35):
    n = int(seconds * SR)
    out = np.zeros(n)
    pos = 0
    while pos < n:
        length = int(rng.uniform(0.012, 0.045) * SR)
        kind = rng.integers(3)
        tt = np.arange(length) / SR
        if kind == 0:
            seg = np.sign(np.sin(2 * np.pi * rng.uniform(200, 2400) * tt))
        elif kind == 1:
            seg = biquad(rng.standard_normal(length), np.full(length, rng.uniform(800, 6000)), 3, 'bp') * 3
        else:
            seg = np.zeros(length)
        seg = np.round(seg * 6) / 6  # bit-crush
        end = min(n, pos + length)
        out[pos:end] = seg[: end - pos] * rng.uniform(0.4, 1.0)
        pos = end
    return pan(fade(out, inn=0.001, out=0.01), -0.3, 0.3)


# ---------- from Kenney (CC0) ----------

def kenney_dir():
    cache = os.path.join(tempfile.gettempdir(), 'cs-kenney')
    for key, url in KENNEY.items():
        target = os.path.join(cache, key)
        if not os.path.isdir(target):
            print('Downloading', url)
            with urllib.request.urlopen(url) as r:
                zipfile.ZipFile(io.BytesIO(r.read())).extractall(target)
    return cache


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def kenney(cache, pack, name):
    for root, _, files in os.walk(os.path.join(cache, pack)):
        if name in files:
            return load(os.path.join(root, name))
    raise FileNotFoundError(name)


def typing(cache):
    keys = [kenney(cache, 'ui', f'switch{i}.ogg') for i in (1, 2, 3, 5, 7, 9, 11)]
    n = int(1.1 * SR)
    out = np.zeros((n, 2))
    at = 0.02
    for i in range(9):
        k = keys[i % len(keys)][: int(0.09 * SR)] * rng.uniform(0.6, 1.0)
        s = int(at * SR)
        e = min(n, s + len(k))
        out[s:e] += k[: e - s]
        at += rng.uniform(0.07, 0.13)
    return out


# ---------- out ----------

def write(name, x, db):
    x = stereo(np.asarray(x, dtype=np.float64))
    x = peak(x, db)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.ogg')
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'libvorbis', '-q:a', '6', path],
        input=pcm,
        check=True,
    )
    print(f'{name:16s} {len(x) / SR:.2f}s')


def main():
    cache = kenney_dir()
    sounds = {
        # transitions
        'whoosh-fast': (whoosh(0.42, 380, 3800, 900, at=0.45, q=1.1), -5),
        'whoosh-soft': (whoosh(0.85, 240, 1700, 420, at=0.5, q=0.8, air=0.2, sharp=1.6), -7),
        'whoosh-heavy': (whoosh(1.0, 110, 1300, 180, at=0.42, q=0.7, air=0.25), -4),
        'swish': (whoosh(0.24, 1500, 6500, 3000, at=0.4, q=1.4, pan_from=-0.2, pan_to=0.6), -7),
        'whoosh-reverse': (reverse_whoosh(0.9), -5),
        # build-ups
        'riser-short': (riser(1.2), -7),
        'riser-long': (riser(2.6), -7),
        'riser-tonal': (riser(1.8, tonal=True), -8),
        # impacts
        'boom': (boom(), -5),
        'boom-short': (boom(0.9, 95, 48, 0.22), -5),
        'hit': (kenney(cache, 'impact', 'impactPunch_heavy_000.ogg'), -3),
        'thud': (kenney(cache, 'impact', 'impactSoft_heavy_000.ogg'), -3),
        'knock': (kenney(cache, 'impact', 'impactWood_medium_000.ogg'), -4),
        'slam': (kenney(cache, 'impact', 'impactPlate_heavy_000.ogg'), -5),
        # pops
        'pop': (pop(), -4),
        'pop-high': (pop(0.09, 700, 2300), -6),
        'bloop': (kenney(cache, 'interface', 'drop_002.ogg'), -6),
        # clicks
        'click': (kenney(cache, 'interface', 'click_001.ogg'), -6),
        'click-soft': (kenney(cache, 'ui', 'click1.ogg'), -8),
        'mouse-click': (kenney(cache, 'ui', 'mouseclick1.ogg'), -6),
        'tick': (kenney(cache, 'interface', 'tick_001.ogg'), -8),
        'toggle': (kenney(cache, 'interface', 'toggle_001.ogg'), -7),
        'typing': (typing(cache), -8),
        'shutter': (shutter(), -5),
        'scroll': (kenney(cache, 'interface', 'scroll_001.ogg'), -9),
        # dings
        'ding': (ding(), -9),
        'ping': (ding(0.7, 2100, ((1, 1, 0.25), (2.0, 0.2, 0.12))), -10),
        'ding-glass': (kenney(cache, 'interface', 'glass_001.ogg'), -8),
        # glitches
        'glitch': (glitch(), -9),
        'static': (static(), -12),
        'buzzer': (buzzer(), -12),
    }
    only = set(sys.argv[1:])
    for name, (sig, db) in sounds.items():
        if not only or name in only:
            write(name, sig, db)


if __name__ == '__main__':
    main()
