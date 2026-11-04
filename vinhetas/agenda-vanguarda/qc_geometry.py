#!/usr/bin/env python3
"""QC de geometria: compara as caixas das letras da assinatura renderizada com
as medidas da composição final da vinheta histórica (mesmas medidas de
src/layout.js), normalizando ambas pela caixa total da composição.

Uso: python3 qc_geometry.py out/boxes.json out/still.png out/qc_geometria.png
"""
import json
import sys

from PIL import Image, ImageDraw

# referência (recorte 1250x1080 do quadro final): x0, x1, topo, base
REF = {
    # prata
    0: ("V", 120, 405, 58, 362), 2: ("N", 590, 850, 58, 362),
    3: ("G", 40, 345, 380, 690), 4: ("U", 355, 560, 380, 690), 5: ("A", 575, 855, 380, 690), 6: ("R", 900, 1140, 380, 690),
    7: ("D", 650, 890, 695, 1000), 8: ("A", 860, 1150, 695, 1000),
    # cores
    1: ("A", 270, 548, 58, 362),
    9: ("G", 270, 470, 391, 588), 10: ("E", 480, 630, 391, 587), 11: ("N", 640, 815, 388, 585),
    12: ("D", 665, 840, 595, 792), 13: ("A", 815, 1000, 596, 793),
}


def norm(boxes):
    x0 = min(b[0] for b in boxes.values()); x1 = max(b[1] for b in boxes.values())
    y0 = min(b[2] for b in boxes.values()); y1 = max(b[3] for b in boxes.values())
    hgt = y1 - y0
    return {k: ((b[0] - x0) / hgt, (b[1] - x0) / hgt, (b[2] - y0) / hgt, (b[3] - y0) / hgt) for k, b in boxes.items()}, (x0, x1, y0, y1)


def main(bj, still, out):
    data = json.load(open(bj))
    ren = {b["id"]: (b["box"][0], b["box"][2], b["box"][1], b["box"][3]) for b in data["boxes"]}
    ref = {k: v[1:] for k, v in REF.items()}
    nr, rb = norm(ren)
    nf, fb = norm(ref)
    print(f"proporção L/A da composição: render {(rb[1]-rb[0])/(rb[3]-rb[2]):.3f}  referência {(fb[1]-fb[0])/(fb[3]-fb[2]):.3f}")
    print(f"altura da composição no quadro: {(rb[3]-rb[2])/data['height']*100:.1f}%  centro x {(rb[0]+rb[1])/2/data['width']*100:.1f}%  y {(rb[2]+rb[3])/2/data['height']*100:.1f}%")
    errs = []
    print("letra   Δx0    Δx1    Δtopo  Δbase   (% da altura da composição)")
    for k in sorted(ref):
        d = [(nr[k][i] - nf[k][i]) * 100 for i in range(4)]
        errs += [abs(x) for x in d]
        print(f"{REF[k][0]:>2} #{k:<3} " + " ".join(f"{x:+6.2f}" for x in d))
    print(f"erro médio {sum(errs)/len(errs):.2f}%  máximo {max(errs):.2f}%")

    # sobreposição: caixas de referência (amarelo) mapeadas sobre o render
    im = Image.open(still).convert("RGB")
    sx = im.width / data["width"]
    d = ImageDraw.Draw(im)
    hgt = (rb[3] - rb[2])
    for k, b in nf.items():
        x0 = (rb[0] + b[0] * hgt) * sx; x1 = (rb[0] + b[1] * hgt) * sx
        y0 = (rb[2] + b[2] * hgt) * sx; y1 = (rb[2] + b[3] * hgt) * sx
        d.rectangle([x0, y0, x1, y1], outline=(255, 230, 0), width=2)
    for k, b in ren.items():
        d.rectangle([b[0] * sx, b[2] * sx, b[1] * sx, b[3] * sx], outline=(0, 255, 200), width=1)
    im.save(out)
    print("sobreposição ->", out)


if __name__ == "__main__":
    main(*sys.argv[1:4])
