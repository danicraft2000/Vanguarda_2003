// Núcleo de renderização — Grafismo Rede Vanguarda (redesign 2004)
import * as THREE from 'three';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export { THREE };

// Glifos alternativos da ITC Avant Garde (fornecidos pelo autor do projeto)
export const V = ''; // V.alt02 — V inclinado
export const A = ''; // A.alt01 — A inclinado
/** Troca todo V e A por seus glifos alternativos. */
export const alt = (s) => s.replace(/V/g, V).replace(/A/g, A);

export const fonts = {};
export async function loadFonts() {
  const load = (url) =>
    new Promise((res, rej) => new TTFLoader().load(url, (json) => res(new Font(json)), undefined, rej));
  fonts.bold = await load('./fonts/AvantGardeBold.ttf');
  fonts.demi = await load('./fonts/AvantGardeDemi.ttf');
  for (const f of Object.values(fonts)) {
    const g = f.generateShapes('H', 1)[0].getPoints();
    let lo = 1e9, hi = -1e9;
    for (const p of g) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
    f.capPerSize = hi - lo; // altura de versal para size = 1
  }
}

// ---------------------------------------------------------------- geometria
/** Separa grupos de ExtrudeGeometry em: 0 = faces, 1 = chanfro, 2 = laterais. */
function splitGroups(g) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const buckets = [[], [], []];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const grp of g.groups) {
    for (let t = grp.start; t < grp.start + grp.count; t += 3) {
      let k = 0;
      if (grp.materialIndex === 1) {
        a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        k = Math.abs(n.z) > 0.04 ? 1 : 2;
      }
      buckets[k].push(t);
    }
  }
  const P = [], N = [], U = [];
  const out = new THREE.BufferGeometry();
  let start = 0;
  buckets.forEach((list, mi) => {
    for (const t of list) for (let j = 0; j < 3; j++) {
      P.push(pos.getX(t + j), pos.getY(t + j), pos.getZ(t + j));
      N.push(nor.getX(t + j), nor.getY(t + j), nor.getZ(t + j));
      U.push(uv.getX(t + j), uv.getY(t + j));
    }
    out.addGroup(start, list.length * 3, mi);
    start += list.length * 3;
  });
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return out;
}

const geoCache = new Map();
/**
 * Geometria extrudada de um caractere. Face visível em z = 0, profundidade para -z.
 * cap = altura de versal desejada (unidades de cena).
 */
export function charGeo(ch, { font = fonts.bold, cap = 1, depth = 0.38, bevel = 0.035, curveSeg = 14, bevelSeg = 5 } = {}) {
  const key = [ch, font === fonts.bold ? 'b' : 'd', cap, depth, bevel, curveSeg, bevelSeg].join('|');
  if (geoCache.has(key)) return geoCache.get(key);
  const size = cap / font.capPerSize;
  const shapes = font.generateShapes(ch, size);
  let g;
  if (!shapes.length) g = new THREE.BufferGeometry();
  else {
    g = new THREE.ExtrudeGeometry(shapes, {
      depth, curveSegments: curveSeg, bevelEnabled: bevel > 0,
      bevelThickness: bevel, bevelSize: bevel * 0.85, bevelOffset: -bevel * 0.85, bevelSegments: bevelSeg,
    });
    g.translate(0, 0, -(depth + bevel));
    g = splitGroups(g);
  }
  g.userData.advance = (font.data.glyphs[ch]?.ha ?? 0) * (size / font.data.resolution);
  geoCache.set(key, g);
  return g;
}

/** Palavra extrudada, uma malha por letra. Origem = linha de base, à esquerda. */
export function word(str, opts = {}) {
  const { mats = chromeMats({ cap: opts.cap ?? 1 }), track = -0.02, scales = {}, matsAt = {} } = opts;
  const group = new THREE.Group();
  const letters = [];
  let x = 0;
  [...str].forEach((ch, i) => {
    const s = scales[i] ?? 1;
    const g = charGeo(ch, { ...opts, cap: (opts.cap ?? 1) * s });
    const m = new THREE.Mesh(g, matsAt[i] ?? mats);
    const off = opts.offs?.[i] ?? [0, 0, 0];
    const cp = opts.cap ?? 1;
    m.position.set(x + off[0] * cp, off[1] * cp, off[2] * cp);
    m.userData.ch = ch;
    group.add(m);
    letters.push(m);
    x += g.userData.advance + track * (opts.cap ?? 1);
  });
  group.userData.width = x - track * (opts.cap ?? 1);
  group.userData.letters = letters;
  return group;
}

/** Contorno de uma palavra em tubos (letreiro neon / vazado). */
export function outlineWord(str, { font = fonts.bold, cap = 1, radius = 0.035, track = -0.02, mat } = {}) {
  const size = cap / font.capPerSize;
  const group = new THREE.Group();
  let x = 0;
  const letters = [];
  for (const ch of str) {
    const lg = new THREE.Group();
    for (const shape of font.generateShapes(ch, size)) {
      for (const path of [shape, ...shape.holes]) {
        const pts = path.getPoints(10);
        const cp = new THREE.CurvePath();
        for (let i = 0; i < pts.length - 1; i++) {
          if (pts[i].distanceTo(pts[i + 1]) < 1e-5) continue;
          cp.add(new THREE.LineCurve3(new THREE.Vector3(pts[i].x, pts[i].y, 0), new THREE.Vector3(pts[i + 1].x, pts[i + 1].y, 0)));
        }
        const segs = Math.max(40, cp.curves.length * 3);
        lg.add(new THREE.Mesh(new THREE.TubeGeometry(cp, segs, radius, 10, false), mat));
      }
    }
    lg.position.x = x;
    group.add(lg);
    letters.push(lg);
    x += (font.data.glyphs[ch]?.ha ?? 0) * (size / font.data.resolution) + track * cap;
  }
  group.userData.width = x - track * cap;
  group.userData.letters = letters;
  return group;
}

/** Logotipo empilhado VAN / GUAR / DA com os glifos alternativos. */
export function wordmark(opts = {}) {
  const cap = opts.cap ?? 1;
  const lead = opts.lead ?? 1.06;
  const root = new THREE.Group();
  const [l1, l2, l3] = opts.lines ?? ['VAN', 'GUAR', 'DA'];
  opts = { ...opts, mats: opts.mats ?? chromeMats({ cap }) };
  const VAN = word(alt(l1), opts);
  const GUAR = word(alt(l2), opts);
  const DA = word(alt(l3), opts);
  VAN.position.set((opts.vanX ?? 0.36) * cap, 0, 0);
  GUAR.position.set(0, -cap * lead, 0);
  DA.position.set(GUAR.userData.width - DA.userData.width + (opts.daX ?? 0) * cap, -2 * cap * lead, 0);
  root.add(VAN, GUAR, DA);
  // centraliza
  const w = Math.max(VAN.position.x + VAN.userData.width, GUAR.userData.width, DA.position.x + DA.userData.width);
  const h = cap * (2 * lead + 1);
  for (const c of root.children) { c.position.x -= w / 2; c.position.y += h / 2 - cap; }
  root.userData = { VAN, GUAR, DA, width: w, height: h, cap };
  return root;
}

// ---------------------------------------------------------------- materiais
const _grad = new Map();
/** Degradê vertical para as faces cromadas (topo claro, base escura, linha de horizonte). */
function chromeGrad(cap) {
  const key = cap.toFixed(3);
  if (_grad.has(key)) return _grad.get(key);
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#ffffff');
  g.addColorStop(0.38, '#eef1f5');
  g.addColorStop(0.475, '#ffffff');
  g.addColorStop(0.5, '#b4bbc3');
  g.addColorStop(0.78, '#cdd2d8');
  g.addColorStop(1.0, '#959ca5');
  x.fillStyle = g; x.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1, 1 / cap);
  _grad.set(key, t);
  return t;
}

export function chromeMats({ face = 0xffffff, bevel = 0xffffff, side = 0x9aa1aa, rough = 0.1, sideRough = 0.16, env = 1, cap = 1.6, grad = true } = {}) {
  return [
    new THREE.MeshStandardMaterial({ color: face, metalness: 1, roughness: rough, envMapIntensity: env * 1.55, map: grad ? chromeGrad(cap) : null }),
    new THREE.MeshStandardMaterial({ color: bevel, metalness: 1, roughness: rough * 0.6, envMapIntensity: env * 1.15 }),
    new THREE.MeshStandardMaterial({ color: side, metalness: 1, roughness: sideRough, envMapIntensity: env }),
  ];
}

/** Plástico laqueado "candy" com verniz — padrão das vinhetas de 2004. */
export function candyMats(color, { side, emissive = 0, metal = 0.25, rough = 0.28, bevelColor } = {}) {
  const c = new THREE.Color(color);
  const sc = side !== undefined ? new THREE.Color(side) : c.clone().multiplyScalar(0.55);
  const em = c.clone().multiplyScalar(emissive);
  const mk = (col, r, e) => new THREE.MeshPhysicalMaterial({
    color: col, metalness: metal, roughness: r, clearcoat: 1, clearcoatRoughness: 0.04,
    emissive: e, envMapIntensity: 1.1,
  });
  return [mk(c, rough, em), mk(bevelColor !== undefined ? new THREE.Color(bevelColor) : c.clone().lerp(new THREE.Color(0xffffff), 0.15), rough * 0.6, em), mk(sc, rough + 0.1, em.clone().multiplyScalar(0.6))];
}

export function metalMats(color, { side, rough = 0.18 } = {}) {
  const c = new THREE.Color(color);
  const sc = side !== undefined ? new THREE.Color(side) : c.clone().multiplyScalar(0.55);
  return [
    new THREE.MeshStandardMaterial({ color: c, metalness: 1, roughness: rough }),
    new THREE.MeshStandardMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.25), metalness: 1, roughness: rough * 0.6 }),
    new THREE.MeshStandardMaterial({ color: sc, metalness: 1, roughness: rough + 0.1 }),
  ];
}

export function setMats(group, mats) {
  group.traverse((o) => { if (o.isMesh) o.material = mats; });
}

// ---------------------------------------------------------------- ambiente HDR
/**
 * Mapa de ambiente equiretangular procedural (HDR, float) — "estúdio de cromo".
 * cores em [r,g,b] lineares.
 */
export function studioEnv(renderer, o = {}) {
  const W = 1024, H = 512;
  const zen = o.zenith ?? [0.3, 0.32, 0.36];
  const sky = o.sky ?? [0.85, 0.9, 0.98];
  const gnd = o.ground ?? [0.006, 0.006, 0.008];
  const nad = o.nadir ?? [0.10, 0.095, 0.09];
  const bands = o.bands ?? [
    { v: 0.455, h: 0.012, i: 4.0, c: [1, 1, 1] },
    { v: 0.30, h: 0.02, i: 1.2, c: [0.9, 0.95, 1] },
    { v: 0.62, h: 0.03, i: 0.35, c: [1, 0.95, 0.9] },
  ];
  const boxes = o.boxes ?? [
    { u: 0.25, v: 0.25, w: 0.08, h: 0.12, i: 9, c: [1, 1, 1] },
    { u: 0.62, v: 0.18, w: 0.14, h: 0.05, i: 6, c: [1, 1, 1] },
    { u: 0.88, v: 0.36, w: 0.05, h: 0.14, i: 5, c: [1, 0.97, 0.92] },
    { u: 0.05, v: 0.40, w: 0.04, h: 0.10, i: 4, c: [0.85, 0.92, 1] },
  ];
  const data = new Float32Array(W * H * 4);
  const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const hzV = o.horizon ?? 0.5;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    let col;
    if (v < hzV) col = lerp(zen, sky, Math.pow(v / hzV, o.skyPow ?? 2.2));
    else col = lerp(gnd, nad, Math.pow((v - hzV) / (1 - hzV), 1.4));
    col = col.slice();
    for (const b of bands) {
      const m = Math.exp(-Math.pow((v - b.v) / b.h, 2)) * b.i;
      col[0] += m * b.c[0]; col[1] += m * b.c[1]; col[2] += m * b.c[2];
    }
    const hz = Math.exp(-Math.pow((v - hzV + 0.004) / 0.005, 2)) * (o.horizonGlow ?? 2.5);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      let r = col[0] + hz, g = col[1] + hz, b = col[2] + hz;
      for (const bx of boxes) {
        let du = Math.abs(u - bx.u); du = Math.min(du, 1 - du);
        const m = smooth(bx.w / 2, bx.w / 2 - 0.012, du) * smooth(bx.h / 2, bx.h / 2 - 0.012, Math.abs(v - bx.v));
        r += m * bx.i * bx.c[0]; g += m * bx.i * bx.c[1]; b += m * bx.i * bx.c[2];
      }
      if (o.tint) { r *= o.tint[0]; g *= o.tint[1]; b *= o.tint[2]; }
      if (o.fn) { const q = o.fn(u, v, [r, g, b]); r = q[0]; g = q[1]; b = q[2]; }
      const k = (y * W + x) * 4;
      data[k] = r; data[k + 1] = g; data[k + 2] = b; data[k + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.flipY = true; // linha 0 = zênite
  tex.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(tex);
  pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- 2D helpers
export function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function bgTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _radial;
export function radialTex() {
  if (_radial) return _radial;
  const [c, x] = canvas2d(256, 256);
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  _radial = new THREE.CanvasTexture(c);
  return _radial;
}

export function glow(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.set(size, size, 1);
  return s;
}

/** Raios de luz radiais (fundo). */
export function drawRays(x, cx, cy, { n = 48, len = 2000, colors = ['#fff'], alpha = [0.05, 0.4], seed = 1, width = [0.01, 0.06] } = {}) {
  const rnd = mulberry(seed);
  x.save();
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const w = width[0] + rnd() * (width[1] - width[0]);
    const col = colors[Math.floor(rnd() * colors.length)];
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, len * (0.6 + rnd() * 0.4));
    const al = alpha[0] + rnd() * (alpha[1] - alpha[0]);
    g.addColorStop(0, rgba(col, al));
    g.addColorStop(0.5, rgba(col, al * 0.5));
    g.addColorStop(1, rgba(col, 0));
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(cx, cy);
    x.lineTo(cx + Math.cos(a - w) * len, cy + Math.sin(a - w) * len);
    x.lineTo(cx + Math.cos(a + w) * len, cy + Math.sin(a + w) * len);
    x.closePath();
    x.fill();
  }
  x.restore();
}

export function rgba(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lens flare estilo 2004 desenhado sobre a imagem final. */
export function lensFlare(x, fx, fy, { scale = 1, cx, cy, tint = '#ffffff', streak = true } = {}) {
  const W = x.canvas.width, H = x.canvas.height;
  cx = cx ?? W / 2; cy = cy ?? H / 2;
  const S = (W / 1600) * scale;
  x.save();
  x.globalCompositeOperation = 'lighter';
  const spot = (px, py, r, col, a, ring = false) => {
    const g = x.createRadialGradient(px, py, ring ? r * 0.8 : 0, px, py, r);
    if (ring) { g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(col, a)); g.addColorStop(1, rgba(col, 0)); }
    else { g.addColorStop(0, rgba(col, a)); g.addColorStop(0.4, rgba(col, a * 0.45)); g.addColorStop(1, rgba(col, 0)); }
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  };
  spot(fx, fy, 260 * S, tint, 0.55);
  spot(fx, fy, 60 * S, '#ffffff', 1);
  if (streak) {
    for (const [len, th, a] of [[1100, 5, 0.55], [500, 2, 0.8]]) {
      const g = x.createLinearGradient(fx - len * S, fy, fx + len * S, fy);
      g.addColorStop(0, rgba(tint, 0)); g.addColorStop(0.5, rgba('#ffffff', a)); g.addColorStop(1, rgba(tint, 0));
      x.fillStyle = g; x.fillRect(fx - len * S, fy - th * S, 2 * len * S, 2 * th * S);
    }
  }
  const dx = cx - fx, dy = cy - fy;
  const ghosts = [[0.35, 26, '#7fd0ff', 0.25], [0.6, 14, '#ffd27f', 0.35], [0.9, 50, '#b48cff', 0.12], [1.25, 90, '#7fffb4', 0.10, true], [1.6, 36, '#ff9a6a', 0.18], [1.9, 140, '#8ab4ff', 0.08, true]];
  for (const [t, r, c, a, ring] of ghosts) spot(fx + dx * t, fy + dy * t, r * S, c, a, ring);
  x.restore();
}

// ---------------------------------------------------------------- render
export function makeRenderer(W, H) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);
  return renderer;
}

export function renderComposite(renderer, scene, camera, { bloom = [0.45, 0.4, 0.92] } = {}) {
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), bloom[0], bloom[1], bloom[2]));
  composer.addPass(new OutputPass());
  composer.render();
}

export function keyLights(scene, { key = 0.9, fill = 0.35, rim = 0.8 } = {}) {
  const k = new THREE.DirectionalLight(0xffffff, key); k.position.set(-6, 9, 4);
  const f = new THREE.DirectionalLight(0xbfd4ff, fill); f.position.set(6, -2, 6);
  const r = new THREE.DirectionalLight(0xffffff, rim); r.position.set(2, 5, -6);
  scene.add(k, f, r, new THREE.AmbientLight(0xffffff, 0.15));
}

// ---------------------------------------------------------------- ruído
export function makeNoise(seed = 7) {
  const rnd = mulberry(seed);
  const P = new Uint8Array(512), G = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; G[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const v = (x, y) => G[P[(P[x & 255] + y) & 511]];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  const fbm = (x, y, oct = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); };
  return { noise, fbm };
}

/** Gera um canvas pixel a pixel: fn(u, v) -> [r,g,b,a] (0..255). */
export function pixelCanvas(w, h, fn) {
  const [c, x] = canvas2d(w, h);
  const img = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = fn(i / (w - 1), j / (h - 1));
    const k = (j * w + i) * 4;
    img.data[k] = p[0]; img.data[k + 1] = p[1]; img.data[k + 2] = p[2]; img.data[k + 3] = p[3] ?? 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** Cores de vértice num geometry clonado: fn(x,y,z) -> THREE.Color. */
export function vertexColors(geo, fn) {
  const g = geo.clone();
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData = { ...geo.userData };
  return g;
}

/** Brilho/estrela de 4 pontas (glint) no canvas. */
export function glint(x, px, py, r, col = '#ffffff', a = 1) {
  x.save();
  x.globalCompositeOperation = 'lighter';
  const g = x.createRadialGradient(px, py, 0, px, py, r * 0.35);
  g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
  x.fillStyle = g; x.beginPath(); x.arc(px, py, r * 0.35, 0, 7); x.fill();
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const lg = x.createLinearGradient(px - dx * r, py - dy * r, px + dx * r, py + dy * r);
    lg.addColorStop(0, rgba(col, 0)); lg.addColorStop(0.5, rgba(col, a)); lg.addColorStop(1, rgba(col, 0));
    x.fillStyle = lg;
    const t = Math.max(1, r * 0.03);
    if (dx) x.fillRect(px - r, py - t, 2 * r, 2 * t); else x.fillRect(px - t, py - r, 2 * t, 2 * r);
  }
  x.restore();
}
