#!/usr/bin/env python3
"""Trilha original da vinheta AGENDA VANGUARDA (RVA — Remaking Vintage Archives).

Toda a música é sintetizada aqui, do zero (osciladores, FM, ruído filtrado,
reverb por convolução com resposta sintética). Nenhum áudio externo é usado.
Os acentos seguem src/cues.json — os mesmos quadros usados pela animação.

  E maior, 120 BPM (1 batida = 0,5 s = 15 quadros)
  c.1  (0–2 s)   pad Emaj9, tique-taque de relógio, marimba a cada diagonal de dias
  c.2  (2–4 s)   groove; um sino por dia que vira (A-G-E-N-D-A)
  c.3  (4–6 s)   C#m7 -> A: riser na decolagem, acorde de metais em "AGENDA" (5 s),
                 arpejo na ondulação (5,5 s)
  c.4  (6–8 s)   vi-IV-V nos pousos VAN (6,5) / GUAR (7,0) / DA (7,5), rufo de caixa
  c.5  (8–10 s)  I (E add9) no impacto final, brilho no 2º reflexo (8,75 s), cauda

Uso:  python3 audio/compose.py [saida.wav]
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR = 48000
ROOT = Path(__file__).resolve().parent.parent
CUES = json.loads((ROOT / "src" / "cues.json").read_text())
FPS = CUES["fps"]
BEAT = 60.0 / CUES["bpm"]
DUR = CUES["total"] / FPS
N = int(round(DUR * SR))
TAIL = int(2.5 * SR)  # margem para reverb (cortada no fim)
rng = np.random.default_rng(2003)


def fr(frames):
    return frames / FPS


# ---------------------------------------------------------------------------
# notas
# ---------------------------------------------------------------------------
NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(n):
    name, octave = n[:-1], int(n[-1])
    midi = 12 * (octave + 1) + NAMES[name]
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------------------------------------------------------------------------
# barramentos
# ---------------------------------------------------------------------------
dry = np.zeros((2, N + TAIL))
send = np.zeros((2, N + TAIL))


def place(sig, t, gain=1.0, pan=0.0, rev=0.2):
    """Coloca um sinal mono (ou estéreo 2xn) no tempo t (s)."""
    i = int(round(t * SR))
    if sig.ndim == 1:
        l = np.cos((pan + 1) * np.pi / 4)
        r = np.sin((pan + 1) * np.pi / 4)
        st = np.vstack([sig * l, sig * r]) * np.sqrt(2)
    else:
        st = sig
    n = min(st.shape[1], dry.shape[1] - i)
    if n <= 0:
        return
    dry[:, i:i + n] += st[:, :n] * gain
    send[:, i:i + n] += st[:, :n] * gain * rev


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def sos_lp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "low", fs=SR, output="sos"), x)


def sos_hp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "high", fs=SR, output="sos"), x)


def sos_bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1, hold=None):
    t = np.arange(n) / SR
    hold = (n / SR - r) if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return e * (1 - rel) * np.clip(1 - rel, 0, 1)


# ---- osciladores com tabela limitada em banda --------------------------------
_tables = {}


def _table(kind, nh, size=4096):
    k = (kind, nh)
    if k not in _tables:
        ph = np.arange(size) / size * 2 * np.pi
        w = np.zeros(size)
        for h in range(1, nh + 1):
            if kind == "saw":
                w += np.sin(h * ph) / h
            elif kind == "square" and h % 2:
                w += np.sin(h * ph) / h
        _tables[k] = w / np.max(np.abs(w))
    return _tables[k]


def osc(kind, f, n, detune_cents=0.0, phase=0.0, vib=0.0, vib_rate=5.5):
    f = f * 2 ** (detune_cents / 1200)
    t = np.arange(n) / SR
    inst = f * (1 + vib * np.sin(2 * np.pi * vib_rate * t))
    ph = (phase + np.cumsum(inst) / SR) % 1.0
    if kind == "sine":
        return np.sin(2 * np.pi * ph)
    nh = max(1, min(64, int(15000 / f)))
    tab = _table(kind, nh)
    x = ph * len(tab)
    i0 = x.astype(int) % len(tab)
    fr_ = x - np.floor(x)
    return tab[i0] * (1 - fr_) + tab[(i0 + 1) % len(tab)] * fr_


def noise(n):
    return rng.standard_normal(n)


# ---------------------------------------------------------------------------
# instrumentos
# ---------------------------------------------------------------------------
def kick(punch=1.0, dur=0.5):
    t = tt(dur)
    f = 44 + 120 * np.exp(-t * 30)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    click = sos_hp(noise(len(t)), 2500) * np.exp(-t * 700) * 0.25
    return np.tanh((body + click) * 1.6 * punch) * 0.9


def clap():
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    env = np.zeros(n)
    for k, d in enumerate([0.0, 0.011, 0.023]):
        env += np.where(t >= d, np.exp(-(t - d) * 160), 0) * (0.7 + 0.15 * k)
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) * 16), 0) * 0.5
    return sos_bp(noise(n), 900, 4200) * env * 0.8


def snare(v=1.0):
    t = tt(0.35)
    tone = (np.sin(2 * np.pi * 186 * t) + 0.5 * np.sin(2 * np.pi * 332 * t)) * np.exp(-t * 26)
    nz = sos_bp(noise(len(t)), 1200, 9000) * np.exp(-t * 18)
    return (0.45 * tone + 0.8 * nz) * v


def hat(open_=False, v=1.0):
    t = tt(0.35 if open_ else 0.08)
    return sos_hp(noise(len(t)), 7500, 3) * np.exp(-t * (9 if open_ else 70)) * 0.5 * v


def tick(v=1.0, hi=False):
    # tique de relógio: madeira curta e brilhante
    t = tt(0.06)
    f1, f2 = (2350, 4100) if hi else (1850, 3300)
    s = (np.sin(2 * np.pi * f1 * t) + 0.5 * np.sin(2 * np.pi * f2 * t)) * np.exp(-t * 140)
    s += sos_hp(noise(len(t)), 3000) * np.exp(-t * 600) * 0.3
    return s * 0.35 * v


def tom(f0=140, v=1.0):
    t = tt(0.7)
    f = f0 * (0.62 + 0.38 * np.exp(-t * 9))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.5)
    nz = sos_bp(noise(len(t)), 300, 2400) * np.exp(-t * 30) * 0.3
    return np.tanh((body + nz) * 1.3) * v


def sub_boom(f0=58, f1=30, dur=1.6, v=1.0):
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t * 3.2)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4) * (1 - np.exp(-t * 300))
    return np.tanh(s * 1.4) * v


def crash(dur=3.2, v=1.0, reverse=False):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for c in range(2):
        nz = sos_hp(noise(n), 3800, 2)
        metal = np.zeros(n)
        for k in range(14):
            fk = 3200 * (1.0 + 0.37 * k) * (1 + 0.013 * c) + rng.uniform(-90, 90)
            metal += np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) / (1 + 0.25 * k)
        s = (0.75 * nz + 0.06 * metal) * (np.exp(-t * 1.25) * 0.8 + 0.2 * np.exp(-t * 6))
        s *= 1 - np.exp(-t * 400)
        out[c] = s
    if reverse:
        out = out[:, ::-1] * np.linspace(0, 1, n) ** 2
    return out * v * 0.35


def marimba(f, v=1.0):
    t = tt(1.0)
    s = np.sin(2 * np.pi * f * t) * np.exp(-t * 5.5)
    s += 0.35 * np.sin(2 * np.pi * f * 3.98 * t) * np.exp(-t * 16)
    s += 0.12 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 40)
    s *= 1 - np.exp(-t * 2500)
    return s * 0.5 * v


def fm_bell(f, dur=2.2, v=1.0, ratio=3.5, index=2.6, decay=2.2):
    t = tt(dur)
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t * decay * 1.8)
    s = np.sin(2 * np.pi * f * t + mod) * 0.75 + 0.3 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 4)
    s *= np.exp(-t * decay) * (1 - np.exp(-t * 1500))
    return s * 0.45 * v


def glass(f, v=1.0):
    t = tt(1.6)
    s = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)
    s *= np.exp(-t * 3.2) * (1 - np.exp(-t * 3000))
    return s * 0.22 * v


def supersaw_chord(notes, dur, attack=0.6, release=0.6, cutoff=1900, v=1.0, bright=0.0):
    n = int(dur * SR)
    out = np.zeros((2, n))
    for k, nt in enumerate(notes):
        f = hz(nt) if isinstance(nt, str) else nt
        for c, dets in enumerate([(-11, 4), (-4, 12)]):
            for j, d in enumerate(dets):
                out[c] += osc("saw", f, n, d, phase=rng.uniform(0, 1), vib=0.0015, vib_rate=4.6 + 0.3 * j) * 0.5
    env = adsr(n, attack, 0.6, 0.85, release)
    for c in range(2):
        dark = sos_lp(out[c], cutoff, 2)
        if bright > 0:
            dark = dark * (1 - bright) + sos_lp(out[c], cutoff * 3, 2) * bright
        out[c] = dark * env
    return out * v / max(1, len(notes)) * 0.9


def brass_stab(notes, dur=0.42, v=1.0, sustain=0.35, release=0.18):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for nt in notes:
        f = hz(nt)
        for c, dets in enumerate([(-7, 9), (-12, 5)]):
            for d in dets:
                out[c] += osc("saw", f, n, d, phase=rng.uniform(0, 1), vib=0.002 * (t > 0.25)) * 0.5
    # envelope de filtro aproximada por mistura escuro/brilhante
    fenv = np.exp(-t * 7.5) * 0.85 + 0.15
    env = adsr(n, 0.008, 0.12, sustain, release)
    for c in range(2):
        dark = sos_lp(out[c], 900, 2)
        bright = sos_lp(out[c], 5200, 2)
        out[c] = (dark * (1 - fenv) + bright * fenv) * env
    return np.tanh(out * 0.9) * v / max(1, len(notes)) * 1.2


def bass_note(f, dur=0.22, v=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = osc("saw", f, n) * 0.6 + osc("square", f / 2, n) * 0.0 + osc("sine", f, n) * 0.7
    fenv = np.exp(-t * 14)
    s = sos_lp(s, 420, 2) * (1 - fenv) + sos_lp(s, 1600, 2) * fenv
    return np.tanh(s * adsr(n, 0.004, 0.09, 0.65, 0.05) * 1.6) * 0.55 * v


def whoosh(dur, rise=True, v=1.0, lo=250, hi=7000):
    """Ruído com banda que varre (cruzamento entre bandas fixas)."""
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    nz = noise(n)
    edges = np.geomspace(lo, hi, 9)
    bands = [sos_bp(nz, edges[i], edges[i + 1]) for i in range(8)]
    pos = (t if rise else 1 - t) * 7
    out = np.zeros(n)
    for i, b in enumerate(bands):
        w = np.clip(1 - np.abs(pos - i), 0, 1)
        out += b * w
    amp = (np.sin(np.pi * t) ** 1.5) if not rise else t ** 2 * (1 - np.exp(-(1 - t) * 40))
    return out * amp * v * 0.6


# ---------------------------------------------------------------------------
# arranjo
# ---------------------------------------------------------------------------
B = BEAT
S16 = B / 4

# --- pads (harmonia) ----------------------------------------------------------
place(supersaw_chord(["E3", "B3", "D#4", "F#4", "G#4"], 2.25, attack=1.1, release=0.5, cutoff=1500, v=0.9), 0.0, 0.55, rev=0.5)
place(supersaw_chord(["E3", "B3", "E4", "G#4"], 1.1, attack=0.08, release=0.3, cutoff=1900, v=0.9), 2.0, 0.42, rev=0.4)
place(supersaw_chord(["D#3", "F#3", "B3", "F#4"], 1.1, attack=0.08, release=0.3, cutoff=1900, v=0.9), 3.0, 0.42, rev=0.4)
place(supersaw_chord(["C#3", "G#3", "B3", "E4"], 1.1, attack=0.1, release=0.35, cutoff=1700, v=0.9), 4.0, 0.42, rev=0.45)
place(supersaw_chord(["A2", "E3", "B3", "C#4", "E4"], 1.1, attack=0.05, release=0.3, cutoff=2300, v=0.9), 5.0, 0.45, rev=0.45)
place(supersaw_chord(["B2", "F#3", "B3", "D#4"], 0.6, attack=0.05, release=0.25, cutoff=2000, v=0.9), 6.0, 0.36, rev=0.4)
place(supersaw_chord(["C#3", "G#3", "C#4", "E4"], 0.55, attack=0.02, release=0.2, cutoff=2400, v=0.9), 6.5, 0.4, rev=0.4)
place(supersaw_chord(["A2", "E3", "A3", "C#4", "E4"], 0.55, attack=0.02, release=0.2, cutoff=2600, v=0.9), 7.0, 0.42, rev=0.4)
place(supersaw_chord(["B2", "F#3", "B3", "D#4", "F#4"], 0.55, attack=0.02, release=0.15, cutoff=2900, v=0.9, bright=0.3), 7.5, 0.45, rev=0.4)
place(supersaw_chord(["E2", "B2", "E3", "G#3", "B3", "F#4", "G#4"], 2.2, attack=0.01, release=1.4, cutoff=2600, v=1.0, bright=0.25), 8.0, 0.62, rev=0.55)

# --- relógio (tique-taque) nos compassos 1–2 ------------------------------------
for k in range(16):
    t0 = k * (B / 2)
    v = 0.55 + 0.25 * (k % 2 == 0)
    place(tick(v, hi=(k % 2 == 1)), t0, 0.7 * min(1, 0.35 + t0 / 1.2), pan=-0.35 if k % 2 else 0.35, rev=0.15)

# --- brilhos de vidro: linhas de luz que começam a ser desenhadas ------------------
line_starts = sorted({j * 4 - 8 for j in range(6)} | {i * 3 - 3 for i in range(8)})
glass_notes = ["E6", "B5", "G#6", "F#6", "B6", "E6", "C#6", "G#6", "B6", "E7"]
for k, f0 in enumerate([x for x in line_starts if x >= 0]):
    place(glass(hz(glass_notes[k % len(glass_notes)]), 0.6), fr(f0), 0.6, pan=np.sin(k * 1.7) * 0.6, rev=0.6)

# --- marimba: uma nota por diagonal de dias que pousa ------------------------------
penta = ["E4", "F#4", "G#4", "B4", "C#5", "E5", "F#5", "G#5", "B5", "C#6", "E6"]
tw = CUES["tileWave"]
for k in range(tw["count"]):
    t0 = fr(tw["start"] + k * tw["step"])
    place(marimba(hz(penta[k]), 0.7 + 0.03 * k), t0, 0.75, pan=-0.6 + 1.2 * k / (tw["count"] - 1), rev=0.3)
place(whoosh(1.35, rise=True, v=0.45, lo=200, hi=4500), 0.55, 0.5, rev=0.3)

# --- abertura: pancada suave -------------------------------------------------------
place(sub_boom(52, 32, 1.8, 0.6), 0.0, 0.7, rev=0.2)
place(crash(2.2, 0.35), 0.0, 0.35, rev=0.5)

# --- bateria do groove (c.2, c.3) ---------------------------------------------------
def bar_groove(t0, kicks=(0, 6, 8, 11), claps=(4, 12), hats=True, v=1.0):
    for s in kicks:
        place(kick(1.0), t0 + s * S16, 0.95 * v, rev=0.05)
    for s in claps:
        place(clap(), t0 + s * S16, 0.6 * v, pan=0.05, rev=0.3)
        place(snare(0.5), t0 + s * S16, 0.35 * v, rev=0.25)
    if hats:
        for s in range(16):
            acc = 1.0 if s % 2 == 0 else 0.45
            place(hat(open_=(s == 14), v=acc), t0 + s * S16, 0.42 * v, pan=0.25, rev=0.1)


bar_groove(2.0)
# c.3: decolagem (meio compasso respirando) e retomada em "AGENDA"
place(kick(1.0), 4.0, 0.95, rev=0.05)
for s in range(8):
    place(hat(v=0.4 + 0.08 * s), 4.0 + s * 2 * S16, 0.4, pan=0.25, rev=0.1)
bar_groove(5.0, kicks=(0, 6), claps=(4,), hats=True, v=1.0)

# --- baixo -------------------------------------------------------------------------
def bass_line(t0, notes):
    for k, nt in enumerate(notes):
        if nt:
            place(bass_note(hz(nt), 0.2), t0 + k * (B / 2), 0.8, rev=0.03)


bass_line(2.0, ["E2", "E2", "E3", "E2", "D#2", "D#2", "D#3", "F#2"])
bass_line(4.0, ["C#2", None, "C#3", "C#2", "A1", "A1", "A2", "B1"])
for t0, nt in [(6.0, "B1"), (6.5, "C#2"), (7.0, "A1"), (7.5, "B1")]:
    place(bass_note(hz(nt), 0.42, 1.1), t0, 0.85, rev=0.03)
place(bass_note(hz("E1"), 1.6, 1.2), 8.0, 0.9, rev=0.05)

# --- sinos: um por dia que vira ----------------------------------------------------
bell_notes = ["E5", "G#5", "B5", "F#5", "B5", "D#6"]
for k, p in enumerate(CUES["pops"]):
    place(fm_bell(hz(bell_notes[k]), 1.8, 0.95), fr(p), 0.8, pan=-0.55 + 0.22 * k, rev=0.45)
    place(glass(hz(bell_notes[k]) * 2, 0.4), fr(p), 0.5, pan=0.55 - 0.22 * k, rev=0.5)

# --- decolagem: riser ----------------------------------------------------------------
t_lift = fr(CUES["liftStart"])
t_agenda = fr(CUES["agenda"])
place(whoosh(t_agenda - t_lift + 0.05, rise=True, v=0.9, lo=300, hi=9000), t_lift, 0.55, rev=0.35)
rt = tt(t_agenda - t_lift)
riser = np.sin(2 * np.pi * np.cumsum(300 * 2 ** (rt / (t_agenda - t_lift) * 2.0)) / SR) * (rt / rt[-1]) ** 2 * 0.12
place(sos_lp(riser, 3000), t_lift, 0.5, rev=0.5)

# --- "AGENDA": acorde de metais + prato -------------------------------------------
place(brass_stab(["A3", "C#4", "E4", "B4"], 0.6, 1.0, sustain=0.4, release=0.25), t_agenda, 0.75, rev=0.35)
place(crash(2.4, 0.5), t_agenda, 0.45, rev=0.4)
place(sub_boom(60, 38, 0.9, 0.5), t_agenda, 0.55, rev=0.1)

# --- ondulação: arpejo de sinos ------------------------------------------------------
rip = CUES["ripple"]
for k, nt in enumerate(["C#5", "E5", "F#5", "A5", "B5", "C#6"]):
    place(fm_bell(hz(nt), 1.2, 0.7, index=1.8), fr(rip["start"] + k * rip["step"]), 0.55, pan=-0.6 + 0.24 * k, rev=0.5)

# --- c.4: pousos VAN / GUAR / DA ------------------------------------------------------
# virada de tons levando ao primeiro pouso
for k, f0 in enumerate([210, 180, 150, 120]):
    place(tom(f0, 0.75), 6.0 + k * S16, 0.6, pan=0.4 - 0.27 * k, rev=0.25)
place(kick(1.0), 6.0, 0.9)
stabs = {"VAN": ["C#4", "E4", "G#4", "B4"], "GUAR": ["A3", "C#4", "E4", "B4"], "DA": ["B3", "D#4", "F#4", "A4"]}
for k, (row, frame) in enumerate(CUES["rowImpact"].items()):
    t0 = fr(frame)
    place(whoosh(0.5, rise=True, v=0.7, lo=400, hi=8000), t0 - 0.5, 0.45, pan=[-0.5, 0.5, 0.0][k], rev=0.25)
    place(brass_stab(stabs[row], 0.45, 1.0), t0, 0.72, rev=0.3)
    place(tom([95, 110, 125][k], 1.0), t0, 0.6, rev=0.3)
    place(kick(1.1), t0, 0.95, rev=0.05)
    place(sub_boom(55, 34, 0.8, 0.55), t0, 0.5, rev=0.05)
    for s in (2, 3):
        place(hat(v=0.8), t0 + s * S16, 0.38, pan=0.25, rev=0.1)
# rufo de caixa em crescendo até o impacto
t_hit = fr(CUES["hit"])
roll_t = 7.5 + 0.0
k = 0
while roll_t < t_hit - 1e-6:
    prog = (roll_t - 7.5) / (t_hit - 7.5)
    place(snare(0.35 + 0.65 * prog), roll_t, 0.55, pan=0.1, rev=0.35)
    roll_t += S16 if prog < 0.5 else S16 / 2
    k += 1
place(crash(1.0, 0.8, reverse=True), t_hit - 1.0, 0.6, rev=0.3)

# --- impacto final -------------------------------------------------------------------
place(brass_stab(["E3", "B3", "E4", "G#4", "B4", "F#5"], 1.9, 1.15, sustain=0.55, release=0.8), t_hit, 0.82, rev=0.45)
place(kick(1.3, 0.8), t_hit, 1.0, rev=0.08)
place(sub_boom(62, 30, 2.0, 1.0), t_hit, 0.85, rev=0.1)
place(crash(3.4, 1.0), t_hit, 0.75, rev=0.5)
place(clap(), t_hit, 0.6, rev=0.4)
for k, nt in enumerate(["E6", "B5", "G#6", "E7"]):
    place(fm_bell(hz(nt), 2.4, 0.6, index=1.4, decay=1.5), t_hit + k * S16 * 0.5, 0.45, pan=[-0.5, 0.5, -0.2, 0.2][k], rev=0.6)
# segundo reflexo: brilho suave
t_s2 = fr(CUES["sweep2"])
place(glass(hz("E6"), 0.9), t_s2, 0.6, pan=0.4, rev=0.7)
place(glass(hz("B6"), 0.7), t_s2 + S16, 0.5, pan=-0.4, rev=0.7)
place(fm_bell(hz("G#5"), 2.0, 0.45, index=1.0, decay=1.6), t_s2 + 2 * S16, 0.4, rev=0.7)

# ---------------------------------------------------------------------------
# reverb por convolução (resposta sintética, estéreo descorrelacionado)
# ---------------------------------------------------------------------------
def make_ir(rt60=1.9, length=2.6, predelay=0.022):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    for c in range(2):
        nz = rng.standard_normal(n)
        lo = sos_lp(nz, 900) * np.exp(-t * 6.91 / (rt60 * 1.15))
        mid = sos_bp(nz, 900, 5000) * np.exp(-t * 6.91 / rt60)
        hi = sos_hp(nz, 5000) * np.exp(-t * 6.91 / (rt60 * 0.45))
        ir[c] = lo + mid + 0.6 * hi
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((2, pd)), ir], axis=1)
    # primeiras reflexões
    for k, (d, g) in enumerate([(0.011, 0.5), (0.017, 0.38), (0.029, 0.3), (0.041, 0.22)]):
        i = int(d * SR)
        ir[k % 2, i] += g
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


ir = make_ir()
wet = np.vstack([signal.fftconvolve(send[c], ir[c])[: dry.shape[1]] for c in range(2)])
mix = dry + wet * 0.32

# ---------------------------------------------------------------------------
# master: corte em 10 s com fade, compressão de barramento, limitador
# ---------------------------------------------------------------------------
mix = mix[:, :N]
mix = np.vstack([sos_hp(mix[c], 28, 2) for c in range(2)])
t = np.arange(N) / SR
fade = np.clip((DUR - t) / 0.45, 0, 1) ** 1.6  # cauda termina em silêncio no último quadro
mix *= fade


def compress(x, thr_db=-16, ratio=2.5, att=0.004, rel=0.12):
    lvl = np.sqrt(np.mean(x ** 2, axis=0))
    # seguidor de envelope (média móvel exponencial assimétrica via lfilter por blocos)
    env = np.zeros_like(lvl)
    a_att = np.exp(-1 / (att * SR))
    a_rel = np.exp(-1 / (rel * SR))
    e = 0.0
    blk = 64
    for i in range(0, len(lvl), blk):
        v = lvl[i:i + blk].max()
        a = a_att if v > e else a_rel
        e = a ** blk * e + (1 - a ** blk) * v
        env[i:i + blk] = e
    db = 20 * np.log10(np.maximum(env, 1e-9))
    over = np.maximum(db - thr_db, 0)
    gain_db = -over * (1 - 1 / ratio)
    gain = 10 ** (gain_db / 20)
    gain = signal.sosfiltfilt(signal.butter(1, 30, "low", fs=SR, output="sos"), gain)
    return x * gain


mix = compress(mix)
peak = np.max(np.abs(mix))
mix = mix / peak * 0.97
mix = np.tanh(mix * 1.25) / np.tanh(1.25)  # saturação suave
mix = mix / np.max(np.abs(mix)) * 10 ** (-1.0 / 20)  # pico em -1 dBFS

out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "out" / "agenda_trilha.wav"
out.parent.mkdir(parents=True, exist_ok=True)
pcm = (np.clip(mix.T, -1, 1) * 32767).astype("<i2")
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"ok -> {out}  ({DUR:.2f} s, {SR} Hz)")
