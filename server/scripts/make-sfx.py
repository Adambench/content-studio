"""
Builds the built-in sound effects in server/assets/sfx (development only; the files are committed).

No music and no instruments: whooshes, risers and sweeps, impacts, pops, clicks, dings, glitches, interface sounds,
foley, nature and tech one-shots. Some are synthesised here (ours), the rest are trimmed from Kenney's CC0 packs
(kenney.nl: Impact Sounds, Interface Sounds, UI Audio). Every sound is a single non-melodic event: no note sequences,
no beats, no held tones. Needs numpy (the Whisper venv has it) and ffmpeg:

    ~/.local/share/content-studio/whisper/bin/python server/scripts/make-sfx.py            # everything
    ~/.local/share/content-studio/whisper/bin/python server/scripts/make-sfx.py --new      # only the synthesised set
    ~/.local/share/content-studio/whisper/bin/python server/scripts/make-sfx.py punch zap  # just these

The first set (`classic`) shares one random stream, so it is always computed whole (and needs the Kenney packs); the
sounds added later (`NEW`) each seed their own stream from their name, so any of them can be rebuilt alone without
touching the others. Then update the durations in shared/sfx.ts if they changed (the script prints them).
"""

import io
import os
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
import zlib

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


# ---------- more building blocks (for the sounds in NEW) ----------

def norm(x):
    m = np.max(np.abs(x))
    return x / m if m else x


def taper(x, inn=0.003, out=0.01):
    """`fade` for mono or stereo."""
    x = np.array(x, dtype=np.float64)
    a, b = int(inn * SR), int(out * SR)
    shape = (-1, 1) if x.ndim == 2 else (-1,)
    if a:
        x[:a] *= np.linspace(0, 1, a).reshape(shape)
    if b:
        x[-b:] *= np.linspace(1, 0, b).reshape(shape)
    return x


def spectral(x, lo=None, hi=None, order=2):
    """Zero-phase band limit done in the frequency domain: high-pass at `lo`, low-pass at `hi` (Butterworth slopes)."""
    n = len(x)
    m = 1 << int(np.ceil(np.log2(2 * n)))
    f = np.fft.rfftfreq(m, 1 / SR)
    g = np.ones_like(f)
    if lo:
        g /= np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    if hi:
        g /= np.sqrt(1 + (f / hi) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x, m) * g, m)[:n]


def band(seconds, lo=None, hi=None, order=2):
    """Band-limited noise at unit RMS."""
    x = spectral(noise(seconds), lo, hi, order)
    return x / (np.sqrt(np.mean(x ** 2)) or 1)


def decay(seconds, tau, attack=0.0005):
    t = t_axis(seconds)
    env = np.exp(-np.maximum(t - attack, 0) / tau)
    return env * np.clip(t / attack, 0, 1) if attack else env


def burst(seconds, tau, lo=None, hi=None, attack=0.0005, order=2):
    """A noise hit: band-limited noise, a fast attack and an exponential decay. Peak 1."""
    return norm(band(seconds, lo, hi, order) * decay(seconds, tau, attack))


def chirp(seconds, f, tau, attack=0.0005):
    """A damped sine whose frequency is `f(t)`: always gliding, so never a held note. Peak 1."""
    t = t_axis(seconds)
    return norm(np.sin(2 * np.pi * np.cumsum(f(t)) / SR) * decay(seconds, tau, attack))


def shard(seconds, f, tau):
    """A tiny damped ring (a few milliseconds): a glass or metal fleck, too short to hear as a pitch."""
    t = t_axis(seconds)
    return np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / tau) * np.clip(t / 0.0003, 0, 1)


def wobble(n, rate, lo=0.0, hi=1.0):
    """A smooth random wander between `lo` and `hi`, about `rate` new targets a second."""
    k = max(2, int(n / SR * rate) + 2)
    pts = rng.uniform(lo, hi, k)
    x = np.linspace(0, k - 1, n)
    i = np.minimum(np.floor(x).astype(int), k - 2)
    s = x - i
    s = s * s * (3 - 2 * s)
    return pts[i] * (1 - s) + pts[i + 1] * s


def spread(x, pos):
    if x.ndim == 2:
        return x
    p = (pos + 1) * np.pi / 4
    return np.stack([x * np.cos(p), x * np.sin(p)], axis=1)


def scene(seconds, *events):
    """Stereo mix of (start, signal, pan) events; stereo signals ignore the pan."""
    n = int(seconds * SR)
    out = np.zeros((n, 2))
    for at, sig, pos in events:
        s = spread(np.asarray(sig, dtype=np.float64), pos)
        i = int(at * SR)
        if i >= n:
            continue
        e = min(n, i + len(s))
        out[i:e] += s[: e - i]
    return out


def room(x, tail=0.25, wet=0.3, hi=5000, pre=0.008):
    """A synthetic room: the dry sound plus a different decaying-noise reverb on each side."""
    x = stereo(np.asarray(x, dtype=np.float64))
    n = len(x)
    length = int(tail * 6 * SR)
    t = np.arange(length) / SR
    m = 1 << int(np.ceil(np.log2(n + length)))
    dry = np.fft.rfft(x.mean(axis=1), m)
    out = x.copy()
    for c in range(2):
        ir = spectral(rng.standard_normal(length), 120, hi) * np.exp(-t / tail)
        ir[: int(pre * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2)) or 1
        out[:, c] += wet * np.fft.irfft(dry * np.fft.rfft(ir, m), m)[:n]
    return out


def grains(seconds, times, make):
    """Many small events: `make(at)` returns (signal, pan) for each start time."""
    return scene(seconds, *[(at, *make(at)) for at in times if at < seconds])


def crush(x, bits, hold=1):
    """Bit-crush: fewer amplitude steps, and each sample held `hold` times (sample-rate reduction)."""
    y = np.repeat(x[::hold], hold)[: len(x)] if hold > 1 else x
    steps = 2 ** (bits - 1)
    return np.round(y * steps) / steps


# ---------- synthesised, second set (NEW) ----------

# transitions

def whip():
    x = norm(whoosh(0.34, 450, 5200, 1400, at=0.55, q=1.2, air=0.5, pan_from=-0.7, pan_to=0.7, sharp=3.2))
    return x + scene(0.34, (0.34 * 0.55 - 0.004, burst(0.04, 0.004, 1500, 9000) * 0.4, 0.2))


def fly_by(seconds=1.3):
    """Something passing close: the pitch of the air drops as it goes by and it crosses the stereo field."""
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    body = norm(biquad(noise(seconds), sweep(n, [(0, 2600), (0.42, 2200), (0.58, 800), (1, 600)]), 0.8, 'bp'))
    low = norm(spectral(noise(seconds), 40, 260))
    sig = fade((body + 0.6 * low) * bell(n, 0.5, 3.0), 0.01, 0.02)
    ang = (np.tanh((u - 0.5) * 6) + 1) * np.pi / 4
    return np.stack([sig * np.cos(ang), sig * np.sin(ang)], axis=1)


def downlifter(seconds=2.0):
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    f = sweep(n, [(0, 7000), (1, 140)])
    sides = [norm(biquad(noise(seconds), f, 1.6, 'bp') + 0.5 * biquad(noise(seconds), f * 0.5, 1.2, 'bp')) for _ in range(2)]
    env = np.clip(u / 0.02, 0, 1) * (1 - u) ** 1.8
    rumble = norm(band(seconds, 30, 120, 3)) * (1 - u) ** 2 * 0.35
    return taper(np.stack(sides, axis=1) * env[:, None] + stereo(rumble), 0.002, 0.05)


# build-ups

def riser_huge(seconds=4.0):
    """Three layers rising together (body, hiss, sub rumble) and opening out from the centre to full width."""
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    f = sweep(n, [(0, 150), (1, 8000)])
    lr = [norm(biquad(noise(seconds), f, 1.8, 'bp') + 0.5 * biquad(noise(seconds), f * 0.5, 1.2, 'bp')) for _ in range(2)]
    mid, side = (lr[0] + lr[1]) / 2, (lr[0] - lr[1]) / 2
    left, right = mid + side * u, mid - side * u
    hiss = [norm(band(seconds, 5000)) * u ** 4 * 0.12 for _ in range(2)]
    sub = norm(band(seconds, 25, 90, 4)) * u ** 1.5 * 0.5
    out = np.stack([left + hiss[0] + sub, right + hiss[1] + sub], axis=1) * (u ** 2.4)[:, None]
    return taper(out, 0.05, 0.015)


def riser_tension(seconds=3.0):
    """A narrow noise band creeping up while a random flutter gets faster and a low rumble builds."""
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    body = norm(biquad(noise(seconds), sweep(n, [(0, 300), (1, 2600)]), 3.0, 'bp'))
    air = norm(biquad(noise(seconds), sweep(n, [(0, 1200), (1, 7000)]), 1.2, 'bp')) * 0.35
    flutter = np.ones(n)
    pos = 0
    while pos < n:
        hold = int(np.interp(pos / n, [0, 1], [0.035, 0.007]) * SR * rng.uniform(0.7, 1.3))
        flutter[pos : pos + hold] = rng.uniform(0.45, 1.0)
        pos += hold
    flutter = np.convolve(flutter, np.ones(144) / 144, mode='same')
    rumble = norm(band(seconds, 25, 110, 4)) * u ** 2 * 0.45
    sig = (body + air) * flutter * u ** 1.6 + rumble
    return taper(pan(sig, -0.15, 0.15), 0.05, 0.015)


def deep_impact(seconds=2.2):
    """A cinematic hit made of noise: a crack, a low body, a short sub knock and a long rumble on each side."""
    t = t_axis(seconds)
    crack = burst(seconds, 0.006, 800, 9000) * 0.6
    mid = burst(seconds, 0.07, 80, 700, attack=0.001) * 0.8
    body = burst(seconds, 0.3, 25, 160, attack=0.002, order=4)
    knock = chirp(seconds, lambda t: 34 + 56 * np.exp(-t / 0.05), 0.07, 0.001) * 0.7
    mono = np.tanh((crack + mid + body + knock) * 1.6)
    tails = np.stack([norm(band(seconds, 20, 90, 4)) * np.exp(-t / 0.7) * 0.45 for _ in range(2)], axis=1)
    return taper(room(stereo(mono) + tails, 0.6, 0.25, hi=2500), 0.0005, 0.12)


def reverse_boom():
    """A deep impact played backwards: swells up and stops dead on the cut."""
    x = deep_impact(1.6)[::-1]
    return taper(x, 0.08, 0.004)


# impacts

def punch(seconds=0.45):
    body = chirp(seconds, lambda t: 65 + 130 * np.exp(-t / 0.02), 0.045)
    thump = burst(seconds, 0.03, None, 900)
    smack = burst(seconds, 0.008, 1200, 6000)
    x = np.tanh((body + thump * 0.7 + smack * 0.5) * 1.8)
    return taper(room(x, 0.12, 0.18), 0.0005, 0.03)


def slap(seconds=0.32):
    x = burst(seconds, 0.006, 900, 7000, attack=0.0003) + burst(seconds, 0.02, 250, 1400) * 0.6
    return taper(room(x, 0.1, 0.22, hi=7000), 0.0003, 0.02)


def thump(seconds, tau, hi, f0):
    """A soft heavy landing: low noise plus a short sliding low knock."""
    return burst(seconds, tau, 30, hi, attack=0.002, order=3) + chirp(seconds, lambda t: f0 * (0.6 + 0.4 * np.exp(-t / 0.03)), tau * 0.8, 0.002) * 0.6


def body_fall(seconds=0.95):
    cloth = band(0.3, 1200, 6000) * bell(int(0.3 * SR), 0.7, 1.5) * 0.12
    x = scene(
        seconds,
        (0.0, cloth, -0.2),
        (0.25, thump(0.6, 0.06, 300, 95), 0),
        (0.25, burst(0.1, 0.01, 400, 3000) * 0.25, 0),
        (0.39, thump(0.4, 0.04, 400, 110) * 0.45, 0.15),
    )
    return taper(room(np.tanh(x * 1.5), 0.15, 0.2), 0.002, 0.05)


def sub_drop(seconds=1.6):
    """One continuous low glide down (110 Hz → 26 Hz), never settling on a pitch, with a rumble and a soft click."""
    t = t_axis(seconds)
    u = t / seconds
    sub = np.sin(2 * np.pi * np.cumsum(110 * (26 / 110) ** u) / SR) * np.clip(t / 0.004, 0, 1) * (1 - u) ** 1.4
    rumble = norm(band(seconds, 25, 90, 4)) * np.exp(-t / 0.4) * 0.25
    click = burst(seconds, 0.003, None, 2500) * 0.15
    return stereo(taper(np.tanh((sub + rumble + click) * 1.3), 0.0005, 0.05))


def door_slam(seconds=1.0):
    x = scene(
        seconds,
        (0.0, burst(0.5, 0.045, 40, 500, attack=0.001, order=3), 0),
        (0.0, burst(0.4, 0.09, 120, 320, order=4) * 0.5, 0),
        (0.004, burst(0.03, 0.002, 2000, 8000) * 0.35, 0.3),
        (0.06, burst(0.2, 0.03, 900, 3000) * 0.15, 0.2),
    )
    return taper(room(np.tanh(x * 1.4), 0.22, 0.35, hi=3500), 0.0005, 0.08)


def wood_crack(seconds=0.7):
    events = [(0.0, burst(0.3, 0.035, 300, 2500) * 0.7, 0), (0.0, burst(0.2, 0.02, 60, 300) * 0.4, 0)]
    at = 0.0
    for _ in range(10):  # the break itself: a cluster of tiny cracks inside ~25 ms
        events.append((at, burst(0.02, rng.uniform(0.0008, 0.003), 800, 7000) * rng.uniform(0.4, 1), rng.uniform(-0.3, 0.3)))
        at += rng.uniform(0.001, 0.004)
    for _ in range(25):  # splinters
        at = 0.02 + rng.exponential(0.08)
        if at < seconds - 0.05:
            events.append((at, burst(0.01, rng.uniform(0.0005, 0.0015), 2000, 9000) * rng.uniform(0.05, 0.3) * np.exp(-at / 0.2), rng.uniform(-0.6, 0.6)))
    return taper(room(scene(seconds, *events), 0.12, 0.15), 0.0003, 0.05)


def glass_break(seconds=1.5):
    t = t_axis(seconds)
    events = [(0.0, burst(0.3, 0.02, 1500, 12000) * 0.8, 0), (0.0, burst(0.3, 0.03, 60, 500) * 0.5, 0)]
    for _ in range(320):  # flecks: most in the first instant, the rest falling and landing
        at = rng.exponential(0.06) if rng.random() < 0.7 else rng.uniform(0.05, 1.1)
        if at > seconds - 0.12:
            continue
        f = np.exp(rng.uniform(np.log(2500), np.log(11000)))
        level = rng.uniform(0.05, 0.35) * (1 if at < 0.1 else 0.6)
        events.append((at, shard(0.12, f, rng.uniform(0.003, 0.02)) * level, rng.uniform(-0.8, 0.8)))
    hiss = norm(band(seconds, 4000)) * np.exp(-t / 0.12) * 0.15
    return taper(room(scene(seconds, *events) + stereo(hiss), 0.2, 0.2, hi=9000), 0.0003, 0.08)


def clank(seconds=0.7):
    """A metal hit with dozens of short, unrelated partials: clangy but with no pitch to it."""
    t = t_axis(seconds)
    modes = sum(
        rng.uniform(0.2, 1) * np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / rng.uniform(0.015, 0.06))
        for f in np.exp(rng.uniform(np.log(350), np.log(7000), 45))
    )
    x = norm(modes) * 0.7 + burst(seconds, 0.004, 800, 8000) * 0.8 + burst(seconds, 0.03, 50, 400) * 0.5
    return taper(room(x, 0.18, 0.3, hi=6000), 0.0003, 0.05)


def explosion(seconds=3.0):
    t = t_axis(seconds)
    crack = burst(seconds, 0.008, 300, 10000)
    blast = norm(band(seconds, 40, 1200, 3)) * decay(seconds, 0.22, 0.008)
    body = norm(band(seconds, 20, 220, 4)) * decay(seconds, 0.6, 0.01)
    mono = np.tanh((crack * 0.6 + blast * 0.9 + body) * 2.0)
    rumble = np.stack([norm(band(seconds, 20, 70, 4)) * decay(seconds, 1.1, 0.05) * 0.6 for _ in range(2)], axis=1)
    debris = grains(
        seconds,
        0.05 + rng.exponential(0.35, 60),
        lambda at: (burst(0.02, rng.uniform(0.001, 0.004), 800, 7000) * rng.uniform(0.2, 1) * np.exp(-at / 0.5) * 0.25, rng.uniform(-0.8, 0.8)),
    )
    return taper(room(stereo(mono) + rumble + debris, 0.5, 0.25, hi=2000), 0.0005, 0.15)


# pops

def bubble(seconds=0.15):
    return stereo(taper(chirp(seconds, lambda t: 520 * (1 + 28 * t), 0.022, 0.001), 0.001, 0.01))


def water_drop(seconds=0.4):
    x = scene(seconds, (0.0, burst(0.02, 0.0008, 1000, 8000) * 0.15, 0), (0.002, chirp(0.12, lambda t: 1100 * (1 + 60 * t), 0.016, 0.0008), 0))
    return taper(room(x, 0.15, 0.25, hi=7000), 0.0005, 0.04)


def cork(seconds=0.4):
    x = scene(
        seconds,
        (0.0, burst(0.05, 0.003, 500, 5000), 0),
        (0.0, chirp(0.15, lambda t: 300 + 400 * np.exp(-t / 0.012), 0.025) * 0.7, 0),
        (0.004, burst(0.15, 0.03, 2000, 9000) * 0.12, 0.1),
    )
    return taper(room(x, 0.12, 0.2), 0.0003, 0.04)


def balloon_pop(seconds=0.7):
    x = scene(
        seconds,
        (0.0, burst(0.1, 0.005, 150, 14000, attack=0.0002), 0),
        (0.0, burst(0.1, 0.015, 60, 600) * 0.5, 0),
        (0.003, burst(0.08, 0.01, 2500, 9000) * 0.2, 0.3),
    )
    return taper(room(x, 0.2, 0.45, hi=6000), 0.0002, 0.06)


def suction_pop(seconds=0.4):
    n = int(0.26 * SR)
    u = np.linspace(0, 1, n)
    pull = norm(biquad(noise(0.26), sweep(n, [(0, 250), (1, 1600)]), 3.5, 'bp') * u ** 2.5) * 0.5
    return scene(seconds, (0.0, pull, 0), (0.25, norm(pop(0.12, 260, 900)), 0))


# interface

def tap(seconds=0.1):
    x = burst(seconds, 0.005, 150, 2500, attack=0.0008) * 0.8 + chirp(seconds, lambda t: 140 + 120 * np.exp(-t / 0.006), 0.012, 0.001) * 0.5
    return stereo(taper(x, 0.0005, 0.01))


def key(seconds=0.16, low=1.0, rel=0.075, thock_hi=1800):
    """One mechanical key: the click down, the bottom-out thock, the lighter click back up."""
    n = int(seconds * SR)
    return mix(
        n,
        (0.0, burst(0.02, 0.0015, 2500, 9000) * 0.6),
        (0.003, burst(0.06, 0.009, 250, thock_hi) * low),
        (rel, burst(0.02, 0.0012, 3000, 9000) * 0.3),
    )


def keyboard(seconds=1.8):
    events = []
    at = 0.03
    while at < seconds - 0.2:
        if rng.random() < 0.12:  # space bar: lower and longer
            k = key(0.2, low=1.5, rel=0.1, thock_hi=900) * 0.9
        else:
            k = key(0.14, low=rng.uniform(0.7, 1.2), rel=rng.uniform(0.05, 0.08), thock_hi=rng.uniform(1400, 2400)) * rng.uniform(0.55, 1.0)
        events.append((at, k, rng.uniform(-0.35, 0.35)))
        at += rng.uniform(0.055, 0.12) + (rng.uniform(0.12, 0.25) if rng.random() < 0.1 else 0)
    return taper(scene(seconds, *events), 0.001, 0.02)


def denied(seconds=0.32):
    """Two quick dull thunks, like a locked handle."""

    def thunk():
        n = int(0.2 * SR)
        return mix(n, (0.0, burst(0.2, 0.03, 50, 450, attack=0.001, order=3)), (0.0, chirp(0.2, lambda t: 95 + 70 * np.exp(-t / 0.01), 0.035, 0.001) * 0.6), (0.0, burst(0.02, 0.001, 1500, 6000) * 0.12))

    return taper(scene(seconds, (0.0, thunk(), 0), (0.075, thunk() * 0.8, 0)), 0.0005, 0.03)


def focus(seconds=0.45):
    """A lens hunting for focus (a short motor whirr) and locking on with a tiny click."""
    n = int(0.22 * SR)
    whirr = band(0.22, 2500, 7000) * (0.6 + 0.4 * wobble(n, 60)) * bell(n, 0.5, 1.2) * 0.25
    tick = burst(0.02, 0.0008, 2000, 9000)
    return taper(scene(seconds, (0.0, tick * 0.4, 0), (0.01, whirr, 0), (0.25, tick * 0.7, 0), (0.262, tick * 0.35, 0)), 0.0005, 0.02)


def swipe():
    return whoosh(0.22, 1800, 5500, 3500, at=0.45, q=0.9, air=0.6, pan_from=0.4, pan_to=-0.4, sharp=1.6)


# foley

def crinkle(seconds, count, lo=1500, hi=10000):
    return grains(seconds, rng.uniform(0, seconds - 0.01, count), lambda at: (burst(0.008, rng.uniform(0.0003, 0.0015), lo, hi) * rng.uniform(0.2, 1), rng.uniform(-0.4, 0.4)))


def page_turn(seconds=0.8):
    n = int(seconds * SR)
    swish = norm(biquad(noise(seconds), sweep(n, [(0, 1800), (0.6, 4500), (1, 2500)]), 0.9, 'bp')) * bell(n, 0.6, 1.6)
    crk = crinkle(seconds, 240) * bell(n, 0.55, 1.2)[:, None] * 0.6
    x = pan(swish * 0.7, -0.4, 0.4) + crk + scene(seconds, (0.58, burst(0.15, 0.02, 200, 2500) * 0.5, 0.3))
    return taper(x, 0.01, 0.03)


def paper_rustle(seconds=1.2):
    n = int(seconds * SR)
    env = wobble(n, 8, 0.1, 1.0) * bell(n, 0.4, 0.8)
    bed = np.stack([band(seconds, 2000, 9000) * env for _ in range(2)], axis=1) * 0.12
    crk = crinkle(seconds, 700) * env[:, None]
    return taper(bed + crk, 0.02, 0.06)


def strokes(seconds, plan):
    """Pen strokes on paper: (start, length, level) each, high friction noise with a little grain."""
    events = []
    for at, dur, level in plan:
        nn = int(dur * SR)
        grit = 0.55 + 0.45 * wobble(nn, 150)
        s = (band(dur, 2500, 10000) + band(dur, 600, 2500) * 0.3) * grit * bell(nn, rng.uniform(0.2, 0.8), 1.2)
        events.append((at, s * level, rng.uniform(-0.15, 0.15)))
    return scene(seconds, *events)


def pen_scribble(seconds=1.4):
    plan = []
    at = 0.03
    while at < seconds - 0.1:
        dur = min(rng.uniform(0.07, 0.2), seconds - at - 0.02)
        plan.append((at, dur, rng.uniform(0.5, 1.0)))
        at += dur + rng.uniform(0.01, 0.06)
    return taper(strokes(seconds, plan), 0.002, 0.02)


def pen_tick(seconds=0.3):
    return taper(strokes(seconds, [(0.01, 0.05, 0.6), (0.065, 0.13, 1.0)]), 0.002, 0.02)


def zipper(seconds=0.9):
    times = []
    at = 0.02
    while at < seconds - 0.05:
        times.append(at)
        rate = np.interp(at / seconds, [0, 0.2, 0.85, 1], [90, 320, 300, 120])
        at += rng.uniform(0.55, 1.45) / rate  # uneven teeth: a rattle, never a buzz
    n = int(seconds * SR)
    teeth = grains(seconds, times, lambda at: (burst(0.004, rng.uniform(0.0003, 0.0008), 1200, 9000) * rng.uniform(0.4, 1), (at / seconds) * 0.6 - 0.3))
    drag = norm(band(seconds, 2000, 8000)) * bell(n, 0.5, 0.6) * 0.12
    return taper(teeth + stereo(drag), 0.005, 0.03)


def metal_tick():
    """A small metal contact (a coin on coins): three short unrelated rings."""
    return norm(sum(shard(0.06, f, rng.uniform(0.004, 0.015)) for f in rng.uniform(3500, 8000, 3)))


def cash_drawer(seconds=1.0):
    n = int(0.18 * SR)
    slide = norm(biquad(noise(0.18), sweep(n, [(0, 400), (1, 1400)]), 0.8, 'bp')) * bell(n, 0.7, 1.4) * 0.4
    clunk = mix(int(0.3 * SR), (0.0, burst(0.3, 0.035, 60, 700, order=3)), (0.0, burst(0.02, 0.0015, 1500, 7000) * 0.4))
    coins = [(0.18 + rng.exponential(0.07), metal_tick() * rng.uniform(0.08, 0.25), rng.uniform(-0.5, 0.5)) for _ in range(14)]
    return taper(room(scene(seconds, (0.0, slide, -0.2), (0.17, clunk, 0), *coins), 0.15, 0.2), 0.002, 0.05)


def coin(seconds=0.7):
    """One coin dropped on a table: the same small metal ring on each bounce, bounces closing in."""
    freqs = np.exp(rng.uniform(np.log(3800), np.log(11000), 6))
    taus = rng.uniform(0.008, 0.02, 6)
    ring = norm(sum(shard(0.1, f, tau) for f, tau in zip(freqs, taus)))
    hits = [0.0, 0.15, 0.255, 0.33, 0.385, 0.425, 0.452, 0.47]
    events = [(at, (ring + burst(0.1, 0.002, 1500, 8000) * 0.3) * 0.75 ** i, 0.1) for i, at in enumerate(hits)]
    return taper(room(scene(seconds, *events), 0.1, 0.18, hi=8000), 0.0003, 0.05)


def stamp(seconds=0.4):
    x = scene(
        seconds,
        (0.0, burst(0.3, 0.03, 40, 450, attack=0.001, order=3), 0),
        (0.0, burst(0.05, 0.006, 600, 3500) * 0.5, 0),
        (0.002, burst(0.3, 0.05, 150, 700) * 0.35, 0),
    )
    return taper(room(x, 0.12, 0.2), 0.0005, 0.04)


def footsteps(seconds=2.2):
    def step():
        return mix(
            int(0.35 * SR),
            (0.0, burst(0.2, 0.018, 80, 1500, attack=0.001)),
            (0.0, burst(0.02, 0.002, 2000, 7000) * 0.25),
            (0.06, burst(0.12, 0.012, 150, 2000) * 0.45),
        )

    times = [0.05, 0.58, 1.08, 1.63]
    events = [(at + rng.uniform(-0.02, 0.02), step() * rng.uniform(0.8, 1.0), 0.12 if i % 2 else -0.12) for i, at in enumerate(times)]
    return taper(room(scene(seconds, *events), 0.25, 0.3, hi=4000), 0.002, 0.05)


def heartbeat(seconds=1.8):
    """Two heartbeats (lub-dub), low soft thumps only."""

    def beat():
        lub = burst(0.25, 0.045, 20, 110, attack=0.008, order=4) + chirp(0.25, lambda t: 55 + 20 * np.exp(-t / 0.02), 0.035, 0.006) * 0.5
        dub = burst(0.2, 0.035, 25, 150, attack=0.006, order=4) + chirp(0.2, lambda t: 62 + 20 * np.exp(-t / 0.02), 0.028, 0.005) * 0.5
        return mix(int(0.5 * SR), (0.0, lub), (0.26, dub * 0.7))

    return stereo(taper(mix(int(seconds * SR), (0.05, beat()), (0.9, beat() * 0.95)), 0.002, 0.05))


def clock_ticking(seconds=2.0):
    """A clock, four ticks half a second apart; the gap after the last one makes it loop evenly."""

    def tick(lo, hi, body_lo, body_hi):
        return mix(int(0.08 * SR), (0.0, burst(0.03, 0.0013, lo, hi)), (0.0, burst(0.06, 0.009, body_lo, body_hi) * 0.3))

    events = [(0.02 + 0.5 * i, tick(2500, 8000, 1200, 3000) if i % 2 == 0 else tick(1500, 5000, 700, 2000), 0) for i in range(4)]
    return room(scene(seconds, *events), 0.08, 0.15)


def applause(seconds=3.0):
    """About fifteen people clapping, each at their own speed: dense, never in time."""
    n = int(seconds * SR)
    events = []
    for _ in range(15):
        rate = rng.uniform(3.5, 5.5)
        fc = rng.uniform(900, 2400)
        pos = rng.uniform(-0.8, 0.8)
        level = rng.uniform(0.4, 1.0)
        at = rng.uniform(0.0, 0.3)
        stop = rng.uniform(1.6, 2.7)
        while at < stop:
            fade_out = np.clip((stop - at) / 0.6, 0.2, 1)
            clap = burst(0.06, rng.uniform(0.006, 0.014), fc / 1.8, fc * 1.8) + burst(0.06, 0.003, 2500, 8000) * 0.3
            events.append((at, clap * level * fade_out * rng.uniform(0.7, 1.0), pos))
            at += rng.uniform(0.85, 1.15) / rate
    density = np.interp(np.linspace(0, 1, n), [0, 0.1, 0.55, 0.9, 1], [0, 1, 0.85, 0.1, 0])
    bed = np.stack([band(seconds, 700, 6000) * density for _ in range(2)], axis=1) * 0.04
    return taper(room(scene(seconds, *events) + bed, 0.35, 0.3, hi=5000), 0.01, 0.1)


def snap(seconds=0.3):
    x = burst(0.2, 0.004, 1500, 5000, attack=0.0003) + burst(0.2, 0.012, 200, 1000) * 0.35
    return taper(room(scene(seconds, (0.0, x, 0)), 0.1, 0.2), 0.0003, 0.03)


# nature

def wind_gust(seconds=3.0):
    n = int(seconds * SR)
    centre = sweep(n, [(0, 250), (0.45, 800), (1, 300)]) * (1 + 0.25 * wobble(n, 3, -1, 1))
    sides = [norm(biquad(noise(seconds), centre * k, 0.7, 'bp')) for k in (1.0, 1.08)]
    low = norm(band(seconds, 30, 200)) * 0.4
    env = bell(n, 0.45, 1.3) * (0.75 + 0.25 * wobble(n, 4))
    return taper(np.stack([(s + low) * env for s in sides], axis=1), 0.05, 0.1)


def rain_burst(seconds=3.0):
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    env = np.clip(u / 0.12, 0, 1) * np.clip((1 - u) / 0.3, 0, 1)
    bed = np.stack([band(seconds, 600, 9000) for _ in range(2)], axis=1) * 0.1
    drops = grains(seconds, rng.uniform(0, seconds, 1800), lambda at: (burst(0.006, rng.uniform(0.0002, 0.0012), 2000, 10000) * rng.uniform(0.05, 1) ** 2, rng.uniform(-0.9, 0.9)))
    heavy = grains(seconds, rng.uniform(0, seconds, 120), lambda at: (burst(0.02, 0.003, 400, 3000) * rng.uniform(0.1, 0.5), rng.uniform(-0.9, 0.9)))
    return taper((bed + drops + heavy) * env[:, None], 0.01, 0.05)


def fire_crackle(seconds=3.0):
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    roar = norm(band(seconds, 40, 350)) * (0.6 + 0.4 * wobble(n, 2)) * 0.6
    hiss = np.stack([band(seconds, 2000, 7000) * wobble(n, 3, 0.3, 1) for _ in range(2)], axis=1) * 0.025

    def crack(at):
        size = rng.random() ** 3
        if size > 0.5:  # a bigger snap: a few cracks at once
            g = mix(int(0.03 * SR), *[(rng.uniform(0, 0.012), burst(0.015, rng.uniform(0.0004, 0.002), 700, 9000)) for _ in range(4)])
        else:
            g = burst(0.015, rng.uniform(0.0004, 0.003), 700, 9000)
        return g * (0.15 + size), rng.uniform(-0.6, 0.6)

    crackles = grains(seconds, rng.uniform(0, seconds - 0.03, 70), crack)
    env = np.clip(u / 0.05, 0, 1) * np.clip((1 - u) / 0.15, 0, 1)
    return taper((stereo(roar) + hiss + crackles) * env[:, None], 0.02, 0.05)


def water_splash(seconds=1.3):
    n = int(seconds * SR)
    plunge = burst(seconds, 0.025, 40, 600, attack=0.002) * 0.7
    splash = norm(band(seconds, 400, 7000) * decay(seconds, 0.12, 0.012) * (0.5 + 0.5 * wobble(n, 150)))
    spray = grains(seconds, 0.05 + rng.exponential(0.18, 200), lambda at: (burst(0.01, rng.uniform(0.0005, 0.002), 1500, 9000) * rng.uniform(0.05, 0.4) * np.exp(-at / 0.4), rng.uniform(-0.7, 0.7)))
    return taper(room(stereo(plunge + splash) + spray, 0.2, 0.2), 0.001, 0.08)


def thunder(seconds=4.5):
    t = t_axis(seconds)
    cracks = scene(seconds, *[(at, burst(0.3, rng.uniform(0.01, 0.03), 200, 9000) * lvl, rng.uniform(-0.4, 0.4)) for at, lvl in [(0.0, 1.0), (0.025, 0.7), (0.05, 0.8), (0.09, 0.5), (0.13, 0.4)]])

    def roll():
        bumps = sum(a * np.exp(-((t - c) / w) ** 2) for c, w, a in zip(rng.uniform(0.1, 2.5, 6), rng.uniform(0.2, 0.6, 6), np.linspace(1, 0.4, 6)))
        return norm(band(seconds, 25, 300, 3)) * (0.3 + bumps) * np.exp(-t / 1.5)

    rolls = np.stack([roll(), roll()], axis=1)
    sub = norm(band(seconds, 15, 70, 4)) * decay(seconds, 1.4, 0.15) * 0.6
    return taper(room(cracks * 0.8 + norm(rolls) + stereo(sub), 0.8, 0.2, hi=1500), 0.0005, 0.3)


# glitches

def data_burst(seconds=0.7):
    n = int(seconds * SR)
    events = []
    pos = 0
    while pos < n:
        length = int(rng.uniform(0.008, 0.03) * SR)
        kind = rng.integers(3)
        if kind == 0:  # sample-and-hold noise
            hold = int(rng.integers(2, 40))
            seg = np.repeat(rng.uniform(-1, 1, length // hold + 1), hold)[:length]
        elif kind == 1:  # a crushed noise band
            lo = rng.uniform(300, 4000)
            seg = crush(norm(spectral(rng.standard_normal(length), lo, lo * rng.uniform(1.5, 4))), 3)
        else:
            seg = np.zeros(length)
        events.append((pos / SR, taper(seg, 0.0005, 0.0005) * rng.uniform(0.4, 1.0), rng.uniform(-0.6, 0.6)))
        pos += length
    return taper(scene(seconds, *events) * bell(n, 0.15, 0.8)[:, None], 0.001, 0.02)


def stutter(seconds=0.55):
    """A hit chopped and repeated, more crushed each time, then let go. Repeats are ≥ 35 ms apart (a stutter, not a buzz)."""
    hit = norm(burst(0.12, 0.025, 200, 7000) + burst(0.12, 0.02, 40, 300) * 0.6)
    piece = taper(hit[: int(0.035 * SR)], 0.0005, 0.002)
    events = []
    at = 0.0
    for i, gap in enumerate([0.065, 0.06, 0.055, 0.05, 0.045, 0.04, 0.04, 0.035]):
        events.append((at, crush(piece, 8 - i * 0.6, 1 + i // 2), 0.25 if i % 2 else -0.25))
        at += gap
    events.append((at, hit, 0))
    return scene(seconds, *events)


# tech

def pulse_glide(seconds, rate_from, rate_to, cut_from, cut_to):
    """A click train whose rate glides the whole way (a spin-up or spin-down), never steady."""
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    phase = np.cumsum(rate_from * (rate_to / rate_from) ** u) / SR
    pulses = (np.diff(np.floor(phase), prepend=0) > 0).astype(float)
    return norm(biquad(pulses, sweep(n, [(0, cut_from), (1, cut_to)]), 0.7, 'lp'))


def power_down(seconds=1.5):
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    buzz = pulse_glide(seconds, 300, 12, 6000, 250)
    air = norm(biquad(noise(seconds), sweep(n, [(0, 3000), (1, 80)]), 2.0, 'bp')) * 0.3
    return stereo(taper((buzz + air) * (1 - u) ** 1.2, 0.005, 0.03))


def power_up(seconds=1.2):
    n = int(seconds * SR)
    u = np.linspace(0, 1, n)
    buzz = pulse_glide(seconds, 12, 520, 300, 7000)
    air = norm(biquad(noise(seconds), sweep(n, [(0, 100), (1, 4000)]), 2.0, 'bp')) * 0.3
    return stereo(taper((buzz + air) * u ** 0.8, 0.01, 0.025))


def zap(seconds=0.55):
    """An electric arc: chopped, held noise that never repeats, a crack at the start."""
    n = int(seconds * SR)
    arc = np.zeros(n)
    pos = 0
    while pos < n:
        length = int(rng.uniform(0.001, 0.006) * SR)
        if rng.random() < 0.75:
            hold = int(rng.integers(1, 7))
            arc[pos : pos + length] = np.repeat(rng.uniform(-1, 1, length // hold + 1), hold)[:length][: n - pos] * rng.uniform(0.3, 1)
        pos += length
    arc = norm(spectral(arc, 800, 12000)) * decay(seconds, 0.18, 0.002)
    crack = burst(seconds, 0.004, 500, 10000)
    return taper(pan(arc * 0.8 + crack * 0.6, -0.2, 0.2), 0.0005, 0.04)


def radio_tune(seconds=1.8):
    n = int(seconds * SR)
    static_ = band(seconds, 200, 6000)
    tuned = norm(biquad(static_, sweep(n, [(0, 500), (0.3, 2400), (0.55, 900), (0.8, 3200), (1, 1500)]), 2.5, 'bp'))
    flutter = 0.5 + 0.5 * wobble(n, 25)
    crackle = grains(seconds, rng.uniform(0, seconds - 0.02, 40), lambda at: (burst(0.01, rng.uniform(0.0005, 0.002), 1000, 8000) * rng.uniform(0.1, 0.5), rng.uniform(-0.3, 0.3)))
    sig = norm(static_) * 0.25 * flutter + tuned * 0.8
    return taper(stereo(sig) + crackle, 0.02, 0.06)


# dings

def sparkle(seconds=1.1):
    """Glitter: a couple of hundred millisecond-short high flecks, too short and too many to hear any pitch."""
    n = int(seconds * SR)
    flecks = grains(
        seconds,
        rng.beta(1.5, 3, 220) * 0.9,
        lambda at: (shard(0.04, np.exp(rng.uniform(np.log(4500), np.log(12500))), rng.uniform(0.002, 0.007)) * rng.uniform(0.1, 1), rng.uniform(-0.8, 0.8)),
    )
    air = np.stack([band(seconds, 6000) * bell(n, 0.25, 1.2) for _ in range(2)], axis=1) * 0.08
    return taper(flecks + air, 0.003, 0.05)


# name: (builder, peak dB). Each is built from its own random stream (see `seed`).
NEW = {
    # transitions
    'whoosh-up': (lambda: whoosh(0.7, 220, 2400, 5200, at=0.72, q=1.0, air=0.45, pan_from=-0.4, pan_to=0.5, sharp=2.4), -5),
    'whoosh-down': (lambda: whoosh(0.75, 4800, 1600, 150, at=0.28, q=0.9, air=0.3, pan_from=0.5, pan_to=-0.4, sharp=1.8), -4),
    'swoosh-long': (lambda: whoosh(1.6, 140, 1300, 240, at=0.55, q=0.7, air=0.25, pan_from=-0.8, pan_to=0.8, sharp=1.4), -7),
    'whoosh-whip': (whip, -4),
    'fly-by': (fly_by, -5),
    'downlifter': (downlifter, -7),
    # build-ups
    'riser-huge': (riser_huge, -5),
    'riser-tension': (riser_tension, -6),
    'reverse-boom': (reverse_boom, -5),
    # impacts
    'punch': (punch, -5),
    'slap': (slap, -3),
    'body-fall': (body_fall, -6),
    'sub-drop': (sub_drop, -9),
    'deep-impact': (deep_impact, -3),
    'door-slam': (door_slam, -6),
    'wood-crack': (wood_crack, -3),
    'glass-break': (glass_break, -7),
    'clank': (clank, -3),
    'explosion': (explosion, -3),
    # pops
    'bubble': (bubble, -4),
    'water-drop': (water_drop, -5),
    'cork': (cork, -3),
    'balloon-pop': (balloon_pop, -3),
    'suction-pop': (suction_pop, -4),
    # interface
    'tap': (tap, -6),
    'swipe': (swipe, -8),
    'key-press': (lambda: stereo(key()), -7),
    'keyboard-fast': (keyboard, -7),
    'denied': (denied, -6),
    'focus': (focus, -12),
    # foley
    'page-turn': (page_turn, -12),
    'paper-rustle': (paper_rustle, -10),
    'pen-scribble': (pen_scribble, -9),
    'pen-tick': (pen_tick, -9),
    'zipper': (zipper, -10),
    'cash-drawer': (cash_drawer, -3),
    'coin': (coin, -7),
    'stamp': (stamp, -3),
    'footsteps': (footsteps, -3),
    'heartbeat': (heartbeat, -4),
    'clock-ticking': (clock_ticking, -3),
    'applause': (applause, -6),
    'snap': (snap, -3),
    # nature
    'wind-gust': (wind_gust, -9),
    'rain-burst': (rain_burst, -6),
    'fire-crackle': (fire_crackle, -3),
    'water-splash': (water_splash, -5),
    'thunder': (thunder, -3),
    # glitches
    'data-burst': (data_burst, -11),
    'stutter': (stutter, -5),
    # tech
    'power-down': (power_down, -3),
    'power-up': (power_up, -4),
    'zap': (zap, -7),
    'radio-tune': (radio_tune, -13),
    # dings
    'sparkle': (sparkle, -11),
}


def seed(name):
    global rng
    rng = np.random.default_rng(zlib.crc32(name.encode()))


# ---------- out ----------

def write(name, x, db):
    x = stereo(np.asarray(x, dtype=np.float64))
    x = peak(x, db)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.ogg')
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(
        # bitexact: no random Ogg stream serial, so a rebuild of an unchanged sound gives the same bytes.
        ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'libvorbis', '-q:a', '6', '-fflags', '+bitexact', '-flags:a', '+bitexact', path],
        input=pcm,
        check=True,
    )
    print(f'{name:16s} {len(x) / SR:.2f}s')


def classic():
    """The first set. Computed whole and in this order: they share one random stream (seeded 7)."""
    global rng
    rng = np.random.default_rng(7)
    cache = kenney_dir()
    return {
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


def main():
    args = sys.argv[1:]
    new_only = '--new' in args
    only = {a for a in args if a != '--new'}
    unknown = only - set(NEW)
    if not new_only and (not only or unknown):
        sounds = classic()
        missing = unknown - set(sounds)
        if missing:
            sys.exit(f'Unknown sound(s): {", ".join(sorted(missing))}')
        for name, (sig, db) in sounds.items():
            if not only or name in only:
                write(name, sig, db)
    for name, (build, db) in NEW.items():
        if new_only or not only or name in only:
            seed(name)
            write(name, build(), db)


if __name__ == '__main__':
    main()
