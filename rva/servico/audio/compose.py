#!/usr/bin/env python3
"""
RVA — VANGUARDA SERVIÇO :: trilha sonora original sintetizada por código.

Nenhum áudio da vinheta histórica é usado. Toda a música é gerada aqui
(síntese aditiva, FM, ruído filtrado e reverberação por convolução) a partir
da mesma linha do tempo (timeline.json) que conduz a animação, de modo que
cada acento musical cai exatamente no quadro correspondente.

Progressão (Ré maior, 120 BPM):
  c.1 (0-2s)   Dmaj9  — pad + arpejo "pulsos de rota"
  c.2 (2-4s)   Bm9 -> Gmaj9 — entra baixo, bumbo e chimbal; riser 3-4s
  c.3 (4-6s)   Em9 / F#m7 / Gmaj7 — 3 acordes de impacto (VAN, GUAR, DA); caixa em rufo
  c.4 (6-8s)   Gmaj9 (ignição do V) -> sinos S-E-R / I-Ç-O -> A7sus4
  final (8s+)  Dmaj9 — resolução, brilho na varredura de luz, decaimento natural
"""
import json
import os
import sys
import wave

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TL = json.load(open(os.path.join(ROOT, "timeline.json"), encoding="utf-8"))
SR = TL["sampleRate"]
DUR = TL["duration"]
BPM = TL["bpm"]
BEAT = 60.0 / BPM
N = int(round(DUR * SR))
C = TL["cues"]
rng = np.random.default_rng(2003)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def n2m(name):
    """'F#3' -> midi"""
    if name[1] == "#":
        p, o = name[:2], int(name[2:])
    else:
        p, o = name[:1], int(name[1:])
    return 12 * (o + 1) + NOTE[p]


def t2i(t):
    return int(round(t * SR))


def stereo(x, pan=0.0):
    """pan -1..1 (equal power)"""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def place(bus, sig, t):
    """mix a (2, n) signal into bus at time t (seconds), clipping to bounds"""
    i0 = t2i(t)
    if i0 >= bus.shape[1]:
        return
    if i0 < 0:
        sig = sig[:, -i0:]
        i0 = 0
    n = min(sig.shape[1], bus.shape[1] - i0)
    bus[:, i0:i0 + n] += sig[:, :n]


def adsr(n, a, d, s, r, sustain_len=None):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    if sustain_len is None:
        sustain_len = max(0, n - a_n - d_n - r_n)
    s_n = int(sustain_len)
    e = np.concatenate([
        np.linspace(0, 1, max(a_n, 1), endpoint=False) ** 1.5,
        1 - (1 - s) * (1 - np.exp(-5 * np.linspace(0, 1, max(d_n, 1)))) / (1 - np.exp(-5)),
        np.full(s_n, s),
        s * np.exp(-6 * np.linspace(0, 1, max(r_n, 1))),
    ])
    if len(e) < n:
        e = np.concatenate([e, np.zeros(n - len(e))])
    return e[:n]


def bl_saw(freq, n, phase=0.0, max_h=60):
    """band-limited sawtooth via additive synthesis"""
    t = np.arange(n) / SR
    out = np.zeros(n)
    h_max = int(min(max_h, (SR * 0.45) // freq))
    for h in range(1, h_max + 1):
        out += np.sin(2 * np.pi * freq * h * t + phase * h) / h
    return out * (2 / np.pi)


def lp(x, fc, order=2, kind="low"):
    fc = np.clip(fc, 20, SR * 0.45)
    sos = signal.butter(order, fc, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def sweep_filter(x, f_start, f_end, kind="low", q_order=2, block=256, curve=2.0):
    """time-varying butterworth (block-wise, with state carry)"""
    out = np.zeros_like(x)
    nb = int(np.ceil(len(x) / block))
    zi = None
    for b in range(nb):
        p = (b / max(nb - 1, 1)) ** curve
        fc = f_start * (f_end / f_start) ** p
        fc = float(np.clip(fc, 20, SR * 0.45))
        if kind == "band":
            sos = signal.butter(q_order, [fc / 1.25, fc * 1.25], btype="band", fs=SR, output="sos")
        else:
            sos = signal.butter(q_order, fc, btype=kind, fs=SR, output="sos")
        seg = x[b * block:(b + 1) * block]
        if zi is None or zi.shape[0] != sos.shape[0]:
            zi = signal.sosfilt_zi(sos) * 0.0
        y, zi = signal.sosfilt(sos, seg, zi=zi)
        out[b * block:(b + 1) * block] = y
    return out


# --------------------------------------------------------------- instruments
def pad(notes, t0, t1, amp=0.11, cutoff=(900, 2400), attack=0.6, release=0.9, spread=0.7):
    n = t2i(t1 - t0 + release)
    L = np.zeros(n)
    R = np.zeros(n)
    for k, name in enumerate(notes):
        f = mtof(n2m(name))
        for d, pan in ((-0.09, -spread), (0.0, 0.0), (0.085, spread)):
            ff = f * 2 ** (d / 12)
            v = bl_saw(ff, n, phase=rng.uniform(0, 2 * np.pi), max_h=40)
            a = (pan + 1) * np.pi / 4
            L += v * np.cos(a)
            R += v * np.sin(a)
    sus = t2i(t1 - t0) - int((attack + 0.2) * SR)
    env = adsr(n, attack, 0.2, 0.85, release, sustain_len=max(sus, 0))
    L = sweep_filter(L * env, cutoff[0], cutoff[1], curve=1.0)
    R = sweep_filter(R * env, cutoff[0], cutoff[1], curve=1.0)
    s = np.stack([L, R]) * amp / max(len(notes), 1) ** 0.5
    return s


def pluck(freq, dur=0.9, amp=0.25, bright=4200, pan=0.0):
    """Karplus-Strong-like pluck via filtered noise burst + decaying partials"""
    n = t2i(dur)
    t = np.arange(n) / SR
    tone = np.zeros(n)
    for h, g in ((1, 1.0), (2, 0.45), (3, 0.22), (4, 0.12), (5, 0.06)):
        tone += g * np.sin(2 * np.pi * freq * h * t) * np.exp(-t * (3.5 + 2.2 * h))
    click = lp(rng.standard_normal(n) * np.exp(-t * 90), bright)
    x = (tone + 0.25 * click) * amp
    x *= np.minimum(1, t / 0.002)
    return stereo(x, pan)


def fm_bell(freq, dur=2.5, amp=0.2, ratio=3.5, index=2.2, decay=2.2, pan=0.0):
    n = t2i(dur)
    t = np.arange(n) / SR
    idx = index * np.exp(-t * 3.0)
    mod = np.sin(2 * np.pi * freq * ratio * t) * idx
    x = np.sin(2 * np.pi * freq * t + mod) * np.exp(-t * decay)
    x += 0.3 * np.sin(2 * np.pi * freq * 2.0 * t) * np.exp(-t * decay * 1.8)
    x *= np.minimum(1, t / 0.003) * amp
    return stereo(x, pan)


def kick(amp=0.9, dur=0.55, f0=125, f1=42):
    n = t2i(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t * 7.5)
    x += 0.35 * lp(rng.standard_normal(n), 3500) * np.exp(-t * 160)
    return stereo(np.tanh(1.6 * x) * amp)


def hat(amp=0.08, dur=0.07, pan=0.0):
    n = t2i(dur)
    t = np.arange(n) / SR
    x = lp(rng.standard_normal(n), 7500, kind="high") * np.exp(-t * 70)
    return stereo(x * amp, pan)


def snare(amp=0.3, dur=0.25, pan=0.0):
    n = t2i(dur)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    noise = lp(lp(rng.standard_normal(n), 1200, kind="high"), 9000) * np.exp(-t * 22)
    return stereo((0.5 * body + noise) * amp, pan)


def bass(note, dur, amp=0.32):
    n = t2i(dur + 0.05)
    t = np.arange(n) / SR
    f = mtof(n2m(note))
    x = np.sin(2 * np.pi * f * t) + 0.35 * bl_saw(f, n, max_h=12)
    x = lp(x, 520)
    env = np.minimum(1, t / 0.006) * np.exp(-t * 3.0)
    env[t2i(dur):] *= np.exp(-np.arange(n - t2i(dur)) / (0.01 * SR))
    return stereo(x * env * amp)


def stab(notes, amp=0.2, dur=0.9):
    n = t2i(dur)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)
    for k, name in enumerate(notes):
        f = mtof(n2m(name))
        for d, pan in ((-0.07, -0.6), (0.07, 0.6)):
            v = bl_saw(f * 2 ** (d / 12), n, phase=rng.uniform(0, 6.28), max_h=50)
            a = (pan + 1) * np.pi / 4
            L += v * np.cos(a)
            R += v * np.sin(a)
    env = np.minimum(1, t / 0.004) * np.exp(-t * 3.4)
    # filter envelope: bright attack closing quickly ("brass" bite)
    Lf = sweep_filter(L * env, 5200, 700, curve=0.5)
    Rf = sweep_filter(R * env, 5200, 700, curve=0.5)
    return np.stack([Lf, Rf]) * amp / len(notes) ** 0.5


def riser(t0, t1, amp=0.16, f0=300, f1=7000, tail=0.03):
    n = t2i(t1 - t0 + tail)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = sweep_filter(x, f0, f1, kind="band", curve=1.6)
    env = (t / (t1 - t0)) ** 2.2
    env[t2i(t1 - t0):] = np.exp(-np.arange(n - t2i(t1 - t0)) / (0.004 * SR))
    xl = x * env * amp
    xr = np.roll(xl, 37)
    return np.stack([xl, xr])


def impact(amp=0.8, dur=2.5, sub=48):
    n = t2i(dur)
    t = np.arange(n) / SR
    f = sub + 60 * np.exp(-t * 18)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4)
    crack = lp(rng.standard_normal(n), 6000) * np.exp(-t * 12)
    shimmer = lp(rng.standard_normal(n), 5000, kind="high") * np.exp(-t * 3.5) * 0.25
    x = np.tanh(1.3 * (0.9 * boom + 0.45 * crack + shimmer))
    L = x
    R = 0.9 * x + 0.1 * np.roll(crack * np.exp(-t * 12), 61)
    return np.stack([L, R]) * amp


def reverse_swell(t_end, length=1.0, amp=0.18):
    n = t2i(length)
    t = np.arange(n) / SR
    x = lp(rng.standard_normal(n), 2500, kind="high") * np.exp(-t * 4.0)
    x = x[::-1]
    return np.stack([x, np.roll(x, 53)]) * amp, t_end - length


def make_ir(seconds=2.6, decay=2.4, predelay=0.018):
    n = t2i(seconds)
    t = np.arange(n) / SR
    irs = []
    for ch in range(2):
        noise = rng.standard_normal(n)
        noise = lp(noise, 7000)
        env = np.exp(-t * decay) * np.minimum(1, t / 0.01)
        ir = noise * env
        # high-frequency damping over time
        ir = 0.6 * ir + 0.4 * lp(ir, 2500)
        ir = np.concatenate([np.zeros(t2i(predelay)), ir])
        irs.append(ir / np.sqrt(np.sum(ir ** 2)))
    return irs


def reverb(bus, irs, wet=0.25):
    out = np.zeros((2, bus.shape[1]))
    for ch in range(2):
        y = signal.fftconvolve(bus[ch], irs[ch])[: bus.shape[1]]
        out[ch] = y
    return out * wet


def pingpong(sig, delay=0.375, fb=0.38, repeats=5, lp_fc=3500):
    out = np.zeros((2, sig.shape[1] + t2i(delay * repeats)))
    out[:, : sig.shape[1]] += sig
    cur = sig.copy()
    for r in range(1, repeats + 1):
        cur = np.stack([lp(cur[0], lp_fc), lp(cur[1], lp_fc)]) * fb
        side = r % 2  # alternate L/R
        mono = (cur[0] + cur[1]) * 0.5
        i0 = t2i(delay * r)
        out[side, i0:i0 + len(mono)] += mono
    return out


# ------------------------------------------------------------------ compose
def compose():
    dry = np.zeros((2, N + SR))
    send = np.zeros((2, N + SR))  # reverb send

    def add(sig, t, rev=0.0, gain=1.0):
        place(dry, sig * gain, t)
        if rev > 0:
            place(send, sig * gain * rev, t)

    # ---- bar 1-2: pads
    add(pad(["D3", "A3", "C#4", "E4", "F#4"], 0.0, 2.0, amp=0.13, cutoff=(500, 1800), attack=0.35), 0.0, rev=0.6)
    add(pad(["B2", "F#3", "A3", "C#4", "D4"], 2.0, 3.0, amp=0.12, cutoff=(1200, 2000), attack=0.08, release=0.4), 2.0, rev=0.5)
    add(pad(["G2", "D3", "F#3", "A3", "B3"], 3.0, 4.0, amp=0.12, cutoff=(1300, 3200), attack=0.08, release=0.3), 3.0, rev=0.5)

    # ---- route pulses: arpeggio (8ths) with accent on each beat
    arp_bar1 = ["D5", "A5", "F#5", "E5", "A5", "C#6", "F#5", "E5"] * 2
    arp_bar2 = ["B4", "F#5", "D5", "C#5", "G4", "D5", "B4", "A5"]
    for i, nm in enumerate(arp_bar1[:8]):
        t = i * 0.25
        acc = 1.0 if i % 2 == 0 else 0.55
        sig = pluck(mtof(n2m(nm)), dur=0.8, amp=0.30 * acc, pan=(-0.35 if i % 2 else 0.35))
        add(pingpong(sig, delay=0.375, fb=0.32, repeats=3), t, rev=0.35)
    for i, nm in enumerate(arp_bar2 * 2):
        t = 2.0 + i * 0.125
        if t >= 4.0:
            break
        acc = 1.0 if i % 4 == 0 else 0.5
        add(pluck(mtof(n2m(nm)) * (2 if i >= 8 else 1), dur=0.45, amp=0.12 * acc, pan=(-0.4 if i % 2 else 0.4)), t, rev=0.3)

    # ---- bar 2: groove
    for b in range(4):
        add(kick(amp=0.75), 2.0 + b * BEAT)
    for i in range(16):
        t = 2.0 + i * 0.125
        add(hat(amp=0.05 if i % 2 else 0.035, pan=0.25), t)
    for i, nm in enumerate(["B1"] * 4 + ["G1"] * 4):
        add(bass(nm, 0.2, amp=0.30), 2.0 + i * 0.25)
    add(riser(C["riser1"][0], C["riser1"][1], amp=0.2), C["riser1"][0], rev=0.3)
    sw, ts = reverse_swell(C["hub"], 0.9, amp=0.12)
    add(sw, ts, rev=0.4)

    # ---- bar 3: three row impacts (VAN, GUAR, DA)
    chords = [
        (C["rowVAN"], ["E3", "B3", "D4", "F#4", "G4"], "E1"),
        (C["rowGUAR"], ["F#3", "C#4", "E4", "A4"], "F#1"),
        (C["rowDA"], ["G3", "D4", "F#4", "A4", "B4"], "G1"),
    ]
    for i, (t, notes, bn) in enumerate(chords):
        add(stab(notes, amp=0.22, dur=0.95), t, rev=0.45)
        add(kick(amp=0.85, f0=140), t)
        add(bass(bn, 0.45, amp=0.36), t)
        add(fm_bell(mtof(n2m(notes[-1])) * 2, dur=1.2, amp=0.05, pan=(-0.5, 0, 0.5)[i]), t, rev=0.5)
    add(impact(amp=0.6, dur=1.8), C["hub"], rev=0.35)
    # tension pad under the build
    add(pad(["A2", "E3", "G3", "B3", "D4"], 5.0, 6.0, amp=0.09, cutoff=(600, 5200), attack=0.7, release=0.2), 5.0, rev=0.4)
    # snare roll 5.0 -> 6.0 (8ths -> 16ths -> 32nds), crescendo
    t = 5.0
    while t < 6.0 - 1e-6:
        p = (t - 5.0)
        step = 0.25 if p < 0.25 else (0.125 if p < 0.625 else 0.0625)
        add(snare(amp=0.10 + 0.40 * p ** 1.5, pan=rng.uniform(-0.2, 0.2)), t, rev=0.25)
        t += step
    add(riser(C["riser2"][0], C["riser2"][1], amp=0.26, f0=400, f1=9000), C["riser2"][0], rev=0.3)
    sw, ts = reverse_swell(C["ignite"], 1.2, amp=0.2)
    add(sw, ts, rev=0.5)

    # ---- bar 4: ignition of the V
    ig = C["ignite"]
    add(impact(amp=0.75, dur=3.0, sub=44), ig, rev=0.5)
    add(kick(amp=1.0, f0=150, f1=38, dur=0.8), ig)
    add(stab(["G3", "D4", "F#4", "A4", "B4", "D5"], amp=0.26, dur=1.4), ig, rev=0.6)
    add(pad(["G2", "D3", "A3", "B3", "F#4"], ig, 7.0, amp=0.12, cutoff=(3000, 1500), attack=0.02, release=0.5), ig, rev=0.6)
    add(bass("G1", 0.95, amp=0.4), ig)
    # SERVIÇO grows out of the V: R+I, E+Ç, S+O -> bell dyads climbing
    for t, (a, b) in ((C["spreadR_I"], ("B5", "D6")), (C["spreadE_C"], ("D6", "F#6")), (C["spreadS_O"], ("F#6", "A6"))):
        add(fm_bell(mtof(n2m(a)), dur=1.6, amp=0.10, pan=-0.45), t, rev=0.6)
        add(fm_bell(mtof(n2m(b)), dur=1.6, amp=0.09, pan=0.45), t, rev=0.6)
        add(hat(amp=0.06, pan=0.0), t)
    # pickup into the final chord
    add(pad(["A2", "E3", "G3", "C#4", "D4"], 7.0, 8.0, amp=0.11, cutoff=(900, 3600), attack=0.25, release=0.2), 7.0, rev=0.5)
    for i, nm in enumerate(["A1", "A1", "A1", "A1"]):
        add(bass(nm, 0.2, amp=0.28), 7.0 + i * 0.25)
    for i, nm in enumerate(["A4", "C#5", "E5", "G5", "A5", "C#6", "E6", "G6"]):
        add(pluck(mtof(n2m(nm)), dur=0.5, amp=0.06 + 0.012 * i, pan=(-0.5 + i / 7)), 7.0 + i * 0.125, rev=0.4)
    add(riser(7.25, 8.0, amp=0.08, f0=1500, f1=11000), 7.25, rev=0.3)

    # ---- final: Dmaj9 resolution with light sweep shimmer
    fn = C["final"]
    add(impact(amp=0.5, dur=2.0, sub=46), fn, rev=0.55)
    add(kick(amp=0.85, f0=135, f1=40, dur=0.9), fn)
    add(pad(["D2", "A2", "F#3", "A3", "C#4", "E4", "F#4"], fn, DUR - 0.25, amp=0.17, cutoff=(4200, 900), attack=0.01, release=0.9), fn, rev=0.7)
    add(bass("D1", 1.8, amp=0.42), fn)
    add(stab(["D4", "F#4", "A4", "C#5", "E5"], amp=0.16, dur=1.6), fn, rev=0.7)
    for k, nm in enumerate(["D6", "A5", "F#6"]):
        add(fm_bell(mtof(n2m(nm)), dur=1.9, amp=0.08, decay=1.6, pan=(-0.4, 0.4, 0.0)[k]), fn + 0.02 * k, rev=0.7)
    # shimmer arpeggio synchronized with the light sweep
    s0, s1 = C["sweep"]
    sh = ["D6", "E6", "F#6", "A6", "C#7", "D7", "E7", "F#7", "A7"]
    for i, nm in enumerate(sh):
        t = s0 + (s1 - s0) * i / (len(sh) - 1)
        add(fm_bell(mtof(n2m(nm)), dur=1.2, amp=0.035 * (1 - i / 14), ratio=2.0, index=1.0, decay=3.0, pan=(-0.7 + 1.4 * i / 8)), t, rev=0.8)

    irs = make_ir()
    wet = reverb(send, irs, wet=0.55)
    mix = dry + wet
    mix = mix[:, :N]

    # ---- master: HPF, glue compression, soft limiter, fades
    mix = np.stack([lp(mix[0], 28, kind="high"), lp(mix[1], 28, kind="high")])
    env = np.sqrt(signal.sosfilt(signal.butter(1, 8, fs=SR, output="sos"), (mix ** 2).mean(axis=0)) + 1e-9)
    thr = 0.18
    gain = np.where(env > thr, (thr / env) ** 0.45, 1.0)
    mix = mix * gain
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 1.25
    mix = np.tanh(mix) / np.tanh(1.25)
    fade_in = np.minimum(1, np.arange(N) / (0.015 * SR))
    tail = np.ones(N)
    k0 = t2i(DUR - 0.45)
    tail[k0:] = np.cos(np.linspace(0, np.pi / 2, N - k0)) ** 2
    mix = mix * fade_in * tail
    mix *= 10 ** (-1.0 / 20) / (np.max(np.abs(mix)) + 1e-9)
    return mix


def write_wav(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(x.T, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "trilha_servico.wav")
    mix = compose()
    write_wav(out, mix)
    print(f"audio: {out}  {mix.shape[1] / SR:.3f}s  peak={np.max(np.abs(mix)):.3f}")
