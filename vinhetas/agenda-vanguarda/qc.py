#!/usr/bin/env python3
"""Controle de qualidade do MP4 final.

Verifica: formato/resolução/fps/duração, decodificação completa sem erros,
tela preta inesperada (blackdetect), quadros congelados (freezedetect e
diferença quadro a quadro no encerramento), sincronia trilha x cues e
gera uma folha de contato.

Uso: python3 qc.py out/arquivo.mp4
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
CUES = json.loads((ROOT / "src" / "cues.json").read_text())
FPS = CUES["fps"]


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def main(path):
    p = Path(path)
    ok = True
    report = []

    def check(name, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        report.append(f"[{'OK' if cond else 'FALHA'}] {name}{(' — ' + detail) if detail else ''}")

    info = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-count_frames",
                           "-of", "json", str(p)]).stdout)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    w, h = int(v["width"]), int(v["height"])
    fps = eval(v["r_frame_rate"])
    nframes = int(v["nb_read_frames"])
    vdur = nframes / fps
    adur = float(a["duration"]) if a else 0
    check("container MP4", "mp4" in info["format"]["format_name"], info["format"]["format_name"])
    check("resolução >= UHD e <= 8K, 16:9", 3840 <= w <= 7680 and abs(w / h - 16 / 9) < 1e-3, f"{w}x{h}")
    check("30 fps", abs(fps - 30) < 1e-6, f"{fps:g} fps, {nframes} quadros")
    check("duração do vídeo", abs(vdur - CUES["total"] / FPS) < 1e-6, f"{vdur:.3f} s")
    check("áudio presente", a is not None, f"{a['codec_name']} {a.get('sample_rate')} Hz {a.get('channels')} ch" if a else "")
    check("áudio e vídeo com a mesma duração", a is not None and abs(adur - vdur) < 0.05, f"áudio {adur:.3f} s")

    # decodificação completa
    dec = run(["ffmpeg", "-v", "error", "-i", str(p), "-f", "null", "-"])
    check("decodifica do início ao fim sem erros", dec.returncode == 0 and not dec.stderr.strip(), dec.stderr.strip()[:200])

    # tela preta e congelamento
    bd = run(["ffmpeg", "-hide_banner", "-i", str(p), "-vf", "blackdetect=d=0.1:pix_th=0.06:pic_th=0.98",
              "-an", "-f", "null", "-"]).stderr
    blacks = re.findall(r"black_start:(\S+) black_end:(\S+)", bd)
    check("sem tela preta (blackdetect)", not blacks, str(blacks))
    fd = run(["ffmpeg", "-hide_banner", "-i", str(p), "-vf", "freezedetect=n=-60dB:d=0.3", "-an", "-f", "null", "-"]).stderr
    freezes = re.findall(r"freeze_start: (\S+)", fd)
    check("sem quadros congelados (freezedetect)", not freezes, str(freezes))

    # movimento real no encerramento: diferença média entre quadros consecutivos
    # (em escala de cinza reduzida, desconsiderando o grão de filme via blur)
    sw, sh = 480, 270
    frames = np.frombuffer(subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{CUES['hit'] / FPS:.3f}", "-i", str(p),
         "-vf", f"scale={sw}:{sh},gblur=sigma=1.5,format=gray", "-f", "rawvideo", "-"],
        capture_output=True).stdout, dtype=np.uint8).reshape(-1, sh, sw).astype(np.float32)
    diffs = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    check("encerramento vivo (nenhum par de quadros idêntico)", diffs.min() > 0.02,
          f"diferença média mín {diffs.min():.3f} / máx {diffs.max():.3f} (0–255), {len(frames)} quadros")

    # sincronia: energia da trilha logo após cada cue x logo antes
    pcm = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "1", "-ar", "48000",
                                        "-f", "s16le", "-"], capture_output=True).stdout, dtype="<i2").astype(np.float32) / 32768
    def onset(frame):
        i = int(frame / FPS * 48000)
        pre = pcm[max(0, i - 2400):i]
        post = pcm[i:i + 2400]
        return 20 * np.log10((np.sqrt(np.mean(post ** 2)) + 1e-9) / (np.sqrt(np.mean(pre ** 2)) + 1e-9))
    cues = [("pouso VAN", CUES["rowImpact"]["VAN"]), ("pouso GUAR", CUES["rowImpact"]["GUAR"]),
            ("pouso DA", CUES["rowImpact"]["DA"]), ("impacto final", CUES["hit"]), ("AGENDA", CUES["agenda"])]
    cues += [(f"sino {i + 1}", f0) for i, f0 in enumerate(CUES["pops"])]
    lines = []
    for name, f0 in cues:
        lines.append(f"{name} q{f0:g} ({f0 / FPS:.3f} s): {onset(f0):+.1f} dB")
    hit_gain = onset(CUES["hit"])
    check("impacto final sincronizado na trilha", hit_gain > 3, f"{hit_gain:+.1f} dB no quadro {CUES['hit']}")

    # folha de contato
    sheet = p.with_name(p.stem + "_contato.jpg")
    run(["ffmpeg", "-v", "error", "-y", "-i", str(p), "-vf",
         "select='not(mod(n\\,15))',scale=640:-1,tile=4x5:padding=4", "-frames:v", "1", "-q:v", "3", str(sheet)])

    print(f"QC: {p.name}  ({p.stat().st_size / 1e6:.1f} MB)")
    print("\n".join(report))
    print("sincronia (ganho de energia nos 50 ms após o cue):")
    print("  " + "\n  ".join(lines))
    print(f"folha de contato: {sheet}")
    print("RESULTADO:", "APROVADO" if ok else "REPROVADO")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
