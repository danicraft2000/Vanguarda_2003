#!/usr/bin/env python3
"""
Controle de qualidade automático do MP4 final.

  1. Formato: codec, resolução (>= UHD), 16:9, 30 fps, duração, contagem real de quadros
  2. Tela preta inesperada: luminância média de todos os quadros
  3. Quadros congelados: diferença entre quadros consecutivos (com desfoque p/ ignorar grão)
  4. Sincronia: picos de ataque do áudio x acentos visuais x cues da timeline.json
  5. Reprodução: decodificação completa sem erros

Gera output/qc_report.md e imprime o resumo.
"""
import json
import os
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TL = json.load(open(os.path.join(ROOT, "timeline.json"), encoding="utf-8"))


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def probe(path):
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]).stdout
    return json.loads(out)


def count_frames(path):
    out = run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
               "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path]).stdout
    return int(out.decode().strip().split(",")[0])


def luma_frames(path, w=192, h=108):
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={w}:{h}:flags=area,gblur=sigma=1.2,format=gray",
           "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    raw = run(cmd).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)


def decode_errors(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"], capture_output=True)
    return p.returncode, p.stderr.decode().strip()


def audio_mono(path, sr=48000):
    raw = run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]).stdout
    return np.frombuffer(raw, np.float32), sr


def onset_env(x, sr, hop=240, n=2048):
    win = np.hanning(n)
    frames = []
    for i in range(0, len(x) - n, hop):
        frames.append(np.abs(np.fft.rfft(x[i:i + n] * win)))
    S = np.log1p(np.array(frames) * 10)
    flux = np.maximum(0, np.diff(S, axis=0)).sum(axis=1)
    t = (np.arange(len(flux)) + 1) * hop / sr + n / (2 * sr)
    return t, flux


def nearest_peak(t, env, target, win=0.12):
    m = (t > target - win) & (t < target + win)
    if not m.any():
        return None, 0
    i = np.argmax(env[m])
    return float(t[m][i]), float(env[m][i])


def main(path):
    rep = []
    ok = True
    info = probe(path)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    W, H = int(v["width"]), int(v["height"])
    num, den = map(int, v["r_frame_rate"].split("/"))
    fps = num / den
    dur = float(info["format"]["duration"])
    nframes = count_frames(path)
    size_mb = os.path.getsize(path) / 1e6
    exp_frames = round(TL["duration"] * TL["fps"])

    def check(name, cond, detail):
        nonlocal ok
        ok = ok and cond
        rep.append(f"| {'OK' if cond else 'FALHA'} | {name} | {detail} |")

    rep.append(f"# QC — {os.path.basename(path)}\n")
    rep.append("| Status | Item | Detalhe |\n|---|---|---|")
    check("Formato", info["format"]["format_name"].startswith("mov,mp4"), f"{info['format']['format_name']}, {size_mb:.1f} MB")
    check("Codec de vídeo", v["codec_name"] == "h264", f"{v['codec_name']} {v.get('profile','')} {v.get('pix_fmt','')} bt709={v.get('color_space','?')}")
    check("Resolução >= UHD", W >= 3840 and H >= 2160 and W <= 7680, f"{W}x{H}")
    check("Proporção 16:9", abs(W / H - 16 / 9) < 1e-3, f"{W / H:.4f}")
    check("30 fps", abs(fps - 30) < 1e-6, f"{v['r_frame_rate']}")
    check("Quadros renderizados", nframes == exp_frames, f"{nframes} decodificados / {exp_frames} esperados")
    check("Duração", abs(dur - TL["duration"]) < 0.05, f"{dur:.3f} s")
    check("Áudio", a is not None and a["codec_name"] == "aac", f"{a['codec_name']} {a['sample_rate']} Hz {a['channels']} ch" if a else "ausente")
    if a is not None:
        adur = float(a.get("duration", dur))
        check("Duração áudio = vídeo", abs(adur - dur) < 0.05, f"áudio {adur:.3f} s")

    rc, err = decode_errors(path)
    check("Decodificação completa", rc == 0 and not err, "sem erros" if rc == 0 and not err else err[:200])

    L = luma_frames(path)
    mean = L.mean(axis=(1, 2))
    darkest = int(np.argmin(mean))
    black = np.where(mean < 6.0)[0]
    check("Sem tela preta", len(black) == 0, f"luma média mín. {mean.min():.1f}/255 (quadro {darkest}); quadros pretos: {len(black)}")
    diff = np.abs(np.diff(L, axis=0)).mean(axis=(1, 2))
    tail = diff[-int(2.0 * TL["fps"]):]
    frozen = np.where(diff < 0.02)[0]
    check("Sem quadros congelados", len(frozen) == 0, f"dif. mín. entre quadros {diff.min():.3f}; últimos 2 s: mín {tail.min():.3f}, méd {tail.mean():.3f}")
    # repeated scenes: no two distant moments should look identical (besides the logo hold)
    small = L[:, ::4, ::4].reshape(len(L), -1)
    rep_pairs = 0
    for i in range(0, len(small), 10):
        for j in range(i + 45, len(small), 10):
            if j > len(small) - 75:
                break
            if np.abs(small[i] - small[j]).mean() < 0.6:
                rep_pairs += 1
    check("Sem cenas repetidas", rep_pairs == 0, f"pares quase idênticos fora do encerramento: {rep_pairs}")

    # ---- sync
    x, sr = audio_mono(path)
    ta, ea = onset_env(x, sr)
    ea = ea / ea.max()
    C = TL["cues"]
    cues = [("hub / VAN", C["rowVAN"]), ("GUAR", C["rowGUAR"]), ("DA", C["rowDA"]), ("ignição do V", C["ignite"]),
            ("R+I", C["spreadR_I"]), ("E+Ç", C["spreadE_C"]), ("S+O", C["spreadS_O"]), ("acorde final", C["final"])]
    rep.append("\n## Sincronia áudio x cues\n\n| Evento | Cue (s) | Pico de áudio (s) | Erro (ms) |\n|---|---|---|---|")
    worst = 0
    for name, c in cues:
        tp, val = nearest_peak(ta, ea, c)
        if tp is None:
            rep.append(f"| {name} | {c:.3f} | — | — |")
            continue
        err_ms = (tp - c) * 1000
        worst = max(worst, abs(err_ms))
        rep.append(f"| {name} | {c:.3f} | {tp:.3f} | {err_ms:+.0f} |")
    fdur = 1000 / TL["fps"]
    check("Sincronia musical", worst <= fdur * 1.5, f"maior erro de ataque {worst:.0f} ms (1 quadro = {fdur:.1f} ms)")
    # visual accents: luminance jumps at the hub flash and at the ignition
    vt = np.arange(len(mean)) / TL["fps"]
    dl = np.diff(mean, prepend=mean[0])
    vis = []
    for name, c in (("flash do hub", C["hub"]), ("ignição do V", C["ignite"]), ("acorde final", C["final"])):
        m = (vt >= c - 0.2) & (vt <= c + 0.2)
        i = np.argmax(dl[m])
        tv = vt[m][i]
        vis.append((name, c, tv))
    rep.append("\n## Acentos visuais (salto de luminância)\n\n| Evento | Cue (s) | Quadro de pico (s) | Erro (quadros) |\n|---|---|---|---|")
    vworst = 0
    for name, c, tv in vis:
        e = round((tv - c) * TL["fps"])
        vworst = max(vworst, abs(e))
        rep.append(f"| {name} | {c:.3f} | {tv:.3f} | {e:+d} |")
    check("Acentos visuais no tempo", vworst <= 1, f"maior desvio {vworst} quadro(s)")

    rep.insert(2, f"**Resultado geral: {'APROVADO' if ok else 'REPROVADO'}**\n")
    text = "\n".join(rep) + "\n"
    out = os.path.join(os.path.dirname(os.path.abspath(path)), "qc_report.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print(text)
    print(f"relatório: {out}")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
