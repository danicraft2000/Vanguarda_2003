// Glifos geométricos desenhados em código para a marca VANGUARDA / AGENDA.
// Todos os glifos usam altura de caixa-alta = 1 (origem na linha de base, à esquerda).
// As proporções (largura, espessura de haste, aberturas) foram medidas na
// composição final da vinheta histórica: A e V assimétricos (uma haste vertical
// e um traço diagonal), G circular com barra, R e D geométricos.
import * as THREE from 'three';

export const STEM = 0.245; // espessura das hastes verticais

const ARC_STEPS = 72; // segmentos por meia-volta

function arc(cx, cy, r, a0, a1, steps = ARC_STEPS) {
  // ângulos em graus; percorre de a0 até a1 (sentido pelo sinal)
  const pts = [];
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / 180) * steps));
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / n);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function toShape(outer, holes = []) {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) {
    shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  return shape;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5) out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5) out.pop();
  return out;
}

const S = STEM;

const GLYPHS = {
  V() {
    const w = 0.93;
    return {
      width: w,
      shapes: [toShape([[0, 0], [0.39, 0], [w, 1], [0.652, 1], [S, 0.246], [S, 1], [0, 1]])],
    };
  },
  A() {
    const w = 0.91;
    // diagonal esquerda: x = 0.61*y (externa) e x = 0.287 + 0.61*y (interna)
    const inner = (y) => 0.287 + 0.61 * y;
    const st = w - S; // face interna da haste vertical direita
    return {
      width: w,
      shapes: [
        toShape(
          [[0, 0], [0.287, 0], [inner(0.21), 0.21], [st, 0.21], [st, 0], [w, 0], [w, 1], [0.61, 1]],
          [[[inner(0.36), 0.36], [st, 0.36], [st, (st - 0.287) / 0.61]]],
        ),
      ],
    };
  },
  N() {
    const w = 0.85;
    return {
      width: w,
      shapes: [
        toShape([
          [0, 0], [S, 0], [S, 0.58], [w - S, 0], [w, 0], [w, 1],
          [w - S, 1], [w - S, 0.42], [S, 1], [0, 1],
        ]),
      ],
    };
  },
  G() {
    const c = 0.5, R = 0.5, r = 0.255;
    const yt = 0.49, yb = 0.3, xl = 0.44, term = 38;
    const aTop = THREE.MathUtils.radToDeg(Math.asin((yt - c) / R)) + 360; // ~358.8
    const dyb = yb - c;
    const xbi = c + Math.sqrt(r * r - dyb * dyb);
    const aIn = THREE.MathUtils.radToDeg(Math.atan2(dyb, xbi - c)) + 360; // ~308
    const pts = [
      ...arc(c, c, R, term, aTop),
      [xl, yt],
      [xl, yb],
      ...arc(c, c, r, aIn, term),
    ];
    return { width: 1.0, shapes: [toShape(dedupe(pts))] };
  },
  U() {
    const w = 0.67, R = w / 2, r = R - S;
    const pts = [
      [0, 1],
      ...arc(R, R, R, 180, 360),
      [w, 1],
      [w - S, 1],
      ...arc(R, R, r, 0, -180),
      [S, 1],
    ];
    return { width: w, shapes: [toShape(dedupe(pts))] };
  },
  R() {
    const w = 0.79;
    const cx = 0.435, cy = 0.685, Rb = 0.315;
    // perna: borda externa parte de (w,0) na direção (-0.32, 0.37)
    const d = new THREE.Vector2(-0.32, 0.37).normalize();
    // interseção da reta com o círculo externo do bojo
    const px = w - cx, py = 0 - cy;
    const b = px * d.x + py * d.y;
    const cc = px * px + py * py - Rb * Rb;
    const t = -b - Math.sqrt(b * b - cc);
    const ix = w + d.x * t, iy = 0 + d.y * t;
    const ai = THREE.MathUtils.radToDeg(Math.atan2(iy - cy, ix - cx));
    const outer = [
      [0, 0], [S, 0], [S, 0.318], [0.52, 0], [w, 0],
      ...arc(cx, cy, Rb, ai, 90),
      [0, 1],
    ];
    const ci = 0.36, rc = 0.145;
    const hole = [[S, cy - rc], ...arc(ci, cy, rc, -90, 90), [S, cy + rc]];
    return { width: w, shapes: [toShape(dedupe(outer), [dedupe(hole)])] };
  },
  D() {
    const w = 0.79;
    const outer = [[0, 0], ...arc(0.29, 0.5, 0.5, -90, 90), [0, 1]];
    const hole = [[S, 0.2], ...arc(0.295, 0.5, 0.3, -90, 90), [S, 0.8]];
    return { width: w, shapes: [toShape(dedupe(outer), [dedupe(hole)])] };
  },
  E() {
    const w = 0.77;
    return {
      width: w,
      shapes: [
        toShape([
          [0, 0], [w, 0], [w, 0.2], [S, 0.2], [S, 0.4], [w - 0.07, 0.4],
          [w - 0.07, 0.59], [S, 0.59], [S, 0.8], [w, 0.8], [w, 1], [0, 1],
        ]),
      ],
    };
  },
};

const cache = new Map();

/**
 * Geometria extrudada de um glifo, com altura de caixa-alta `cap`.
 * A geometria é centralizada no meio do glifo (x e y) para facilitar rotações;
 * `width` e `cap` são devolvidos para o posicionamento.
 */
export function glyphGeometry(ch, { cap = 1, depth = 0.2, bevel = 0.02 } = {}) {
  const key = `${ch}|${cap}|${depth}|${bevel}`;
  if (cache.has(key)) return cache.get(key);
  const g = GLYPHS[ch]();
  // a geometria é construída em unidade 1 e escalada depois, para o bevel
  // ficar proporcional ao tamanho da letra
  const geo = new THREE.ExtrudeGeometry(g.shapes, {
    depth: depth / cap,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel / cap,
    bevelSize: (bevel / cap) * 0.8,
    bevelOffset: -(bevel / cap) * 0.8, // mantém o contorno externo exato
    bevelSegments: 5,
    curveSegments: 12,
  });
  geo.translate(-g.width / 2, -0.5, -depth / cap); // face frontal em z = 0
  geo.scale(cap, cap, cap);
  geo.computeVertexNormals();
  const out = { geometry: geo, width: g.width * cap, cap };
  cache.set(key, out);
  return out;
}

export function glyphWidth(ch) {
  return GLYPHS[ch]().width;
}
