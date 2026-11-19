// Os 20 quadros do painel — mesma ordem da imagem original (linha a linha).
import {
  THREE, V, A, alt, fonts, word, wordmark, outlineWord, chromeMats, candyMats, metalMats, setMats, charGeo,
  studioEnv, canvas2d, bgTexture, glow, drawRays, rgba, mulberry, lensFlare, renderComposite, keyLights,
  makeNoise, pixelCanvas, vertexColors, glint,
} from './core.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

const ER = 1.0;

function setup(renderer, W, H, o = {}) {
  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer, o.env ?? {});
  scene.environmentRotation.set(o.er ?? ER, o.ery ?? 0, 0);
  const camera = new THREE.PerspectiveCamera(o.fov ?? 30, W / H, 0.1, 300);
  camera.position.set(...(o.cam ?? [0, 0, 16]));
  camera.lookAt(...(o.look ?? [0, 0, 0]));
  keyLights(scene, o.lights);
  return { scene, camera };
}

// ------------------------------------------------------------ fundos 2D
function bg(W, H, { base = '#000', glowAt = [0.55, 0.42], glowCol = '#1d2a40', glowR = 0.75, vignette = 0.85, top, bottom } = {}) {
  const [c, x] = canvas2d(W, H);
  if (top && bottom) {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    x.fillStyle = g;
  } else x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  if (glowCol) {
    const g = x.createRadialGradient(W * glowAt[0], H * glowAt[1], 0, W * glowAt[0], H * glowAt[1], W * glowR);
    g.addColorStop(0, glowCol); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.save(); x.globalCompositeOperation = 'lighter'; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
  }
  return [c, x, () => {
    const v = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${vignette})`);
    x.fillStyle = v; x.fillRect(0, 0, W, H);
  }];
}

/** Fachos de luz diagonais (estilo abertura 2004). */
function beams(x, W, H, { n = 6, col = '#6f8fc0', a = 0.12, ang = -0.5, seed = 3, blur = 18 } = {}) {
  const rnd = mulberry(seed);
  x.save();
  x.globalCompositeOperation = 'lighter';
  x.filter = `blur(${blur * W / 1600}px)`;
  for (let i = 0; i < n; i++) {
    const cx = W * (rnd() * 1.2 - 0.1), w = W * (0.01 + rnd() * 0.06);
    x.save();
    x.translate(cx, H / 2); x.rotate(ang + (rnd() - 0.5) * 0.15);
    const g = x.createLinearGradient(0, -H, 0, H);
    const al = a * (0.4 + rnd() * 0.8);
    g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.45, rgba(col, al)); g.addColorStop(1, rgba(col, 0));
    x.fillStyle = g; x.fillRect(-w / 2, -H * 1.2, w, H * 2.4);
    x.restore();
  }
  x.restore();
}

function sparkles(x, W, H, { n = 40, col = '#ffffff', seed = 9, max = 18, area = [0, 0, 1, 1] } = {}) {
  const rnd = mulberry(seed);
  for (let i = 0; i < n; i++) {
    const r = (2 + Math.pow(rnd(), 3) * max) * W / 1600;
    glint(x, W * (area[0] + rnd() * (area[2] - area[0])), H * (area[1] + rnd() * (area[3] - area[1])), r * 3, col, 0.35 + rnd() * 0.6);
  }
}

function raysBg(W, H, { cx = 0.5, cy = 0.5, base = '#000', core = '#fff', mid = '#888', colors = ['#fff'], n = 70, seed = 4, alpha = [0.05, 0.35] } = {}) {
  const [c, x] = canvas2d(W, H);
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  const g = x.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, W * 0.8);
  g.addColorStop(0, core); g.addColorStop(0.25, mid); g.addColorStop(1, base);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.filter = `blur(${6 * W / 1600}px)`;
  drawRays(x, W * cx, H * cy, { n, len: W * 1.3, colors, alpha, seed, width: [0.008, 0.05] });
  x.restore();
  drawRays(x, W * cx, H * cy, { n: Math.round(n / 3), len: W * 1.1, colors: ['#ffffff'], alpha: [0.03, 0.12], seed: seed + 1, width: [0.002, 0.01] });
  return [c, x];
}

// ------------------------------------------------------------ utilidades de layout
const letter = (wm, line, i) => wm.userData[line].userData.letters[i];
function lcenter(wm, line, i) {
  const Lg = wm.userData[line], m = Lg.userData.letters[i];
  return new THREE.Vector3(Lg.position.x + m.position.x + m.geometry.userData.advance / 2, Lg.position.y + m.position.y, 0);
}

/**
 * Nome de programa que "pega emprestada" uma letra do logotipo (ex.: ESPO-R-TE).
 * A letra compartilhada fica grande e as demais menores, girando em torno dela.
 */
function progWord(wm, line, idx, str, shared, o = {}) {
  const cap = wm.userData.cap;
  const capO = (o.small ?? 0.55) * cap;
  const big = o.big ?? 1.3;
  const w = word(str, {
    cap: capO, scales: { [shared]: (big * cap) / capO, ...(o.scales || {}) }, mats: o.mats, matsAt: o.matsAt,
    depth: o.depth ?? 0.3 * cap, bevel: o.bevel ?? 0.03 * cap, offs: o.offs, track: o.track ?? -0.01,
  });
  const sl = w.userData.letters[shared];
  const t = lcenter(wm, line, idx);
  const pivot = new THREE.Group();
  pivot.position.set(t.x + (o.dx ?? 0) * cap, t.y - ((big - 1) * cap) / 2 + (o.dy ?? 0) * cap, (o.z ?? 0.4) * cap);
  w.position.set(-(sl.position.x + sl.geometry.userData.advance / 2), -sl.position.y, 0);
  pivot.add(w);
  pivot.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  wm.add(pivot);
  if (o.hide !== false) letter(wm, line, idx).visible = false;
  return { pivot, w, letters: w.userData.letters };
}

/** Projeta um ponto do mundo para pixels da tela. */
function toScreen(v, camera, W, H) {
  const p = v.clone().project(camera);
  return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H];
}

const hsl = (h, s, l) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);

// ------------------------------------------------------------ quadros
export const TILES = {
  // 00 — Marca institucional: faixa de cromo curva com o "V" arco-íris
  0: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { cam: [0, 0.2, 16], look: [0, -0.25, 0], er: 0.75 });
    const [c, x, vig] = bg(W, H, { glowCol: '#26324a', glowAt: [0.5, 0.45], glowR: 0.6 });
    beams(x, W, H, { n: 5, col: '#8090b0', a: 0.08, ang: 0.35 });
    vig();
    scene.background = bgTexture(c);

    const hw = 3.35, hh = 1.45, na = 1.9, nb = -0.92;
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hh); shape.lineTo(hw, -hh); shape.lineTo(hw, hh); shape.lineTo(na, hh);
    shape.lineTo(0, nb); shape.lineTo(-na, hh); shape.lineTo(-hw, hh); shape.closePath();
    let g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelOffset: -0.06, bevelSegments: 4, curveSegments: 1 });
    g.translate(0, 0, -0.36);
    g = new TessellateModifier(0.1, 12).modify(g);
    // cores: arco-íris ao longo das bordas do V
    const TL = new THREE.Vector2(-na, hh), B = new THREE.Vector2(0, nb), TR = new THREE.Vector2(na, hh);
    const segDist = (p, a, b) => {
      const ab = b.clone().sub(a); const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
      return [p.distanceTo(a.clone().add(ab.multiplyScalar(t))), t];
    };
    const band = 0.62;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const p2 = new THREE.Vector2();
    for (let i = 0; i < pos.count; i++) {
      p2.set(pos.getX(i), pos.getY(i));
      const [dl, tl] = segDist(p2, TL, B), [dr, tr] = segDist(p2, B, TR);
      const d = Math.min(dl, dr), path = dl < dr ? tl * 0.5 : 0.5 + tr * 0.5;
      const k = Math.max(0, 1 - Math.pow(d / band, 3));
      const rb = hsl(0.84 - path * 0.86, 1, 0.5);
      const cc = new THREE.Color(0xeef1f5).lerp(rb, k);
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // curvar em cilindro (convexo para a câmera)
    const R = 3.9;
    for (let i = 0; i < pos.count; i++) {
      const X = pos.getX(i), Z = pos.getZ(i), th = X / R, r = R + Z;
      pos.setXYZ(i, r * Math.sin(th), pos.getY(i), r * Math.cos(th) - R);
      const nx = nor.getX(i), nz = nor.getZ(i);
      nor.setXYZ(i, nx * Math.cos(th) + nz * Math.sin(th), nor.getY(i), -nx * Math.sin(th) + nz * Math.cos(th));
    }
    const panel = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.8 }));
    panel.position.set(0, 0.75, 0);
    panel.rotation.set(0.12, -0.18, 0);
    scene.add(panel);
    const gl = glow(0xb070ff, 5.5, 0.35); gl.position.set(0, 1.0, -2); scene.add(gl);

    const txt = word(alt('VANGUARDA'), { cap: 0.78, depth: 0.16, bevel: 0.025, track: 0.0, mats: chromeMats({ cap: 0.78, env: 0.62, side: 0x50565e }) });
    txt.position.set(-txt.userData.width / 2, -2.25, 0.6);
    scene.add(txt);
    const bottom = toScreen(new THREE.Vector3(0, -2.25, 0.6), camera, W, H)[1];
    renderComposite(renderer, scene, camera, { bloom: [0.35, 0.4, 0.95] });
    return (x) => {
      // reflexo no piso
      const hgt = H * 0.16;
      x.save();
      x.translate(0, bottom * 2 + 4); x.scale(1, -1);
      x.globalAlpha = 0.28;
      x.drawImage(x.canvas, 0, bottom - hgt, W, hgt, 0, bottom - hgt, W, hgt);
      x.restore();
      const fg = x.createLinearGradient(0, bottom, 0, bottom + hgt);
      fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,1)');
      x.fillStyle = fg; x.fillRect(0, bottom + 2, W, hgt + 4);
      lensFlare(x, W * 0.78, H * 0.16, { scale: 0.4, tint: '#c8b8ff' });
    };
  },

  // 01 — Vanguarda (vinheta padrão)
  1: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#1d2c48' });
    beams(x, W, H, { n: 7, col: '#7d9ccc', a: 0.1, ang: -0.45 });
    sparkles(x, W, H, { n: 25, col: '#a8c4ff', max: 10, seed: 11 });
    vig();
    scene.background = bgTexture(c);
    const wm = wordmark({ cap: 1.72, depth: 0.62 });
    wm.rotation.set(-0.38, 0.34, -0.07);
    wm.position.set(0.25, -0.1, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => lensFlare(x, W * 0.86, H * 0.12, { scale: 0.45 });
  },

  // 02 — Bom Dia Vanguarda (paredão de vídeo)
  2: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { cam: [0, 0, 17], er: 0.6 });
    const [c, x, vig] = bg(W, H, { top: '#02040a', bottom: '#050a18', glowCol: '#14305a', glowAt: [0.5, 0.5], glowR: 0.6 });
    vig();
    scene.background = bgTexture(c);
    const geo = new RoundedBoxGeometry(1.0, 0.78, 0.28, 3, 0.08);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.7 });
    const cols = 25, rows = 15, R = 12.5, zc = 4.5;
    const inst = new THREE.InstancedMesh(geo, mat, cols * rows);
    const rnd = mulberry(21);
    const dummy = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const phi = (i - (cols - 1) / 2) * (1.07 / R);
      const yy = (j - (rows - 1) / 2) * 0.85;
      dummy.position.set(R * Math.sin(phi), yy, zc - R * Math.cos(phi));
      dummy.rotation.set(-yy * 0.035, -phi, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(k, dummy.matrix);
      const lum = 0.16 + rnd() * 0.16 + (rnd() < 0.07 ? 0.22 : 0);
      inst.setColorAt(k, hsl(0.6 + rnd() * 0.04, 0.45, lum));
      k++;
    }
    scene.add(inst);
    const back = glow(0x3a7aff, 16, 0.25); back.position.set(0, 0, -6); scene.add(back);

    const wm = wordmark({ cap: 1.35, depth: 0.5, lines: ['TVAN', 'GUAR', 'DA'], vanX: -0.35, daX: 0.15 });
    const pal = { VAN: [0xffffff, 0x14b4ff, 0xff7a00, 0x9b4dff], GUAR: [0xff2f9e, 0xffcf00, 0x22d36b, 0x2f6bff], DA: [0xff3b3b, 0xb54dff] };
    for (const [line, cols2] of Object.entries(pal)) cols2.forEach((cc, i) => { letter(wm, line, i).material = candyMats(cc, { metal: 0.15, emissive: 0.08 }); });
    letter(wm, 'VAN', 0).material = chromeMats();
    wm.rotation.set(-0.2, 0.25, 0.32);
    wm.position.set(-0.9, 0.2, 2.5);
    scene.add(wm);
    const bd = word('BOM DIA', { cap: 0.62, depth: 0.25, bevel: 0.025 });
    bd.position.set(1.0, -0.05, 0.55 * 1.35);
    const pv = new THREE.Group(); pv.add(bd); pv.rotation.z = 0.5; pv.position.set(0.2, -0.6, 0);
    wm.add(pv);
    renderComposite(renderer, scene, camera, { bloom: [0.4, 0.4, 0.9] });
    return (x) => { lensFlare(x, W * 0.2, H * 0.2, { scale: 0.45, tint: '#9fd0ff' }); };
  },

  // 03 — Vanguarda 1 Ano
  3: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { er: 0.9 });
    const [c, x, vig] = bg(W, H, { top: '#000005', bottom: '#0a2a9a', glowCol: '#1a48d0', glowAt: [0.5, 1.05], glowR: 0.7, vignette: 0.6 });
    x.save(); x.filter = `blur(${5 * W / 1600}px)`;
    drawRays(x, W * 0.5, H * 1.15, { n: 40, len: W * 1.3, colors: ['#4f7dff', '#9fb6ff', '#2a4bff'], alpha: [0.03, 0.18], seed: 8 });
    x.restore();
    sparkles(x, W, H, { n: 30, col: '#bcd0ff', seed: 5, max: 12 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.5;
    const wm = wordmark({ cap, depth: 0.55, vanX: 0.0 });
    const oneGeo = vertexColors(charGeo('1', { cap: cap * 3.1, depth: 0.75, bevel: 0.05 }), (px, py) => hsl((py / (cap * 3.1)) * 0.8, 1, 0.52));
    const sideRb = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.2, clearcoat: 1 });
    const cm = chromeMats();
    const one = new THREE.Mesh(oneGeo, [cm[0], cm[1], sideRb]);
    const right = wm.userData.width / 2;
    one.position.set(right + 0.05 * cap, -wm.userData.height / 2, 0.15);
    wm.add(one);
    const ano = word(alt('ANO'), { cap: cap * 0.62, depth: 0.3, bevel: 0.025 });
    const piv = new THREE.Group(); piv.add(ano); piv.rotation.z = -Math.PI / 2;
    piv.position.set(right + 0.05 * cap + oneGeo.userData.advance * 0.98, -wm.userData.height / 2 + ano.userData.width + 0.1 * cap, 0.15);
    wm.add(piv);
    wm.rotation.set(-0.22, 0.38, -0.02);
    wm.position.set(-0.9, 0.05, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => lensFlare(x, W * 0.84, H * 0.1, { scale: 0.5, tint: '#9fb6ff' });
  },

  // 04 — Vanguarda Especial
  4: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { er: 0.9, env: { tint: [1.3, 0.95, 0.65] } });
    const [c, x] = raysBg(W, H, { cx: 0.48, cy: 0.6, base: '#1a0200', core: '#ffc860', mid: '#c84a00', colors: ['#ff3010', '#ff9a00', '#ffd23a', '#ff2a6a', '#ffffff'], n: 90, seed: 12, alpha: [0.05, 0.4] });
    const v = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,0,0,0.85)');
    x.fillStyle = v; x.fillRect(0, 0, W, H);
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.55, mats: chromeMats({ face: 0xfff0dd, side: 0xa08060 }) });
    const gold = metalMats(0xffb21e, { side: 0x9a5200, rough: 0.14 });
    progWord(wm, 'DA', 1, alt('ESPECIAL'), 6, { big: 1.55, small: 0.48, mats: gold, z: 0.55, dy: -0.12, depth: 0.32 * cap });
    wm.rotation.set(-0.3, 0.3, -0.05);
    wm.position.set(0.1, 0.35, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera, { bloom: [0.4, 0.45, 0.94] });
    return (x) => { lensFlare(x, W * 0.86, H * 0.12, { scale: 0.5, tint: '#ffb060' }); sparkles(x, W, H, { n: 18, col: '#ffe0a0', seed: 31, max: 14 }); };
  },

  // 05 — Vanguarda News
  5: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#3a0508', glowAt: [0.62, 0.35], glowR: 0.6 });
    beams(x, W, H, { n: 6, col: '#c02030', a: 0.1, ang: 0.5, seed: 7 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const red = new THREE.MeshPhysicalMaterial({ color: 0xff1020, emissive: 0x7a0008, metalness: 0.3, roughness: 0.18, clearcoat: 1 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xff2030, emissive: 0x300004, metalness: 0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.28 });
    const t = lcenter(wm, 'VAN', 2);
    letter(wm, 'VAN', 2).visible = false;
    const piv = new THREE.Group();
    piv.position.set(t.x, t.y - 0.18 * cap, 0.45 * cap);
    const N = outlineWord('N', { cap: cap * 1.38, radius: 0.05 * cap, mat: red });
    const Nadv = N.userData.width;
    N.position.x = -Nadv / 2;
    const Nfill = word('N', { cap: cap * 1.38, depth: 0.08, bevel: 0.01, mats: glass }); Nfill.position.set(-Nadv / 2, 0, -0.06);
    const ews = outlineWord('EWS', { cap: cap * 0.62, radius: 0.04 * cap, mat: red });
    const ewsF = word('EWS', { cap: cap * 0.62, depth: 0.06, bevel: 0.01, mats: glass }); ewsF.position.z = -0.05;
    const eg = new THREE.Group(); eg.add(ews, ewsF);
    eg.position.set(Nadv / 2 - 0.05 * cap, cap * 0.62, 0); eg.rotation.z = 0.32;
    const echo = outlineWord('EWS', { cap: cap * 0.45, radius: 0.025 * cap, mat: new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0.45 }) });
    echo.position.set(Nadv / 2 + 0.2 * cap, cap * 0.05, -0.6 * cap); echo.rotation.z = 0.28;
    piv.add(N, Nfill, eg, echo);
    const g1 = glow(0xff2030, 6, 0.35); g1.position.set(0.6, 0.6, -0.5); piv.add(g1);
    wm.add(piv);
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(-0.3, -0.2, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera, { bloom: [0.6, 0.45, 0.85] });
    return (x) => lensFlare(x, W * 0.88, H * 0.1, { scale: 0.4, tint: '#ff8080' });
  },

  // 06 — Vanguarda Esporte
  6: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#06301a', glowAt: [0.45, 0.6], glowR: 0.65 });
    beams(x, W, H, { n: 6, col: '#30c060', a: 0.1, ang: -0.6, seed: 5 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const green = candyMats(0x1fe03c, { metal: 0.2, emissive: 0.12, side: 0x0a7a20 });
    const pw = progWord(wm, 'GUAR', 3, 'ESPORTE', 4, { big: 1.35, small: 0.56, rz: 0.36, mats: green, z: 0.5 });
    const R = pw.letters[4];
    const rg = glow(0xff1a10, 4.2, 0.9); rg.position.set(R.position.x + 0.55 * cap, 0.6 * cap, -0.4); pw.w.add(rg);
    const rg2 = glow(0xff4020, 2.2, 0.8); rg2.position.copy(rg.position); pw.w.add(rg2);
    wm.rotation.set(-0.38, 0.36, -0.08);
    wm.position.set(0.15, 0, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera, { bloom: [0.55, 0.45, 0.88] });
    return (x) => lensFlare(x, W * 0.14, H * 0.12, { scale: 0.4, tint: '#a0ffb0' });
  },

  // 07 — Vídeo Vanguarda
  7: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#062a2a', glowAt: [0.4, 0.35], glowR: 0.6 });
    x.save(); x.globalCompositeOperation = 'lighter';
    for (let y = 0; y < H; y += Math.round(6 * W / 1600)) { x.fillStyle = 'rgba(40,160,150,0.025)'; x.fillRect(0, y, W, 1); }
    x.restore();
    beams(x, W, H, { n: 5, col: '#40d0c0', a: 0.08, ang: 0.4, seed: 2 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const pw = progWord(wm, 'VAN', 0, V + 'IDEO', 0, {
      big: 1.3, small: 0.5, mats: candyMats(0x18c6b0, { metal: 0.25, emissive: 0.1 }), matsAt: { 0: candyMats(0x3be37a, { metal: 0.2, emissive: 0.12 }) },
      offs: { 1: [-0.35, 0.95, 0], 2: [-0.35, 0.95, 0], 3: [-0.35, 0.95, 0], 4: [-0.35, 0.95, 0] }, z: 0.45,
    });
    const g = glow(0x30ffb0, 3.5, 0.4); g.position.set(0.4, 0.6 * cap, -0.3); pw.w.add(g);
    wm.rotation.set(-0.36, 0.36, -0.07);
    wm.position.set(0.2, -0.1, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => sparkles(x, W, H, { n: 14, col: '#c0fff0', seed: 71, max: 10 });
  },

  // 08 — Vanguarda Mix
  8: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#22104a', glowAt: [0.5, 0.55], glowR: 0.7 });
    beams(x, W, H, { n: 7, col: '#a070ff', a: 0.1, ang: -0.5, seed: 13 });
    sparkles(x, W, H, { n: 20, col: '#e0c8ff', seed: 3, max: 10 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const purple = candyMats(0x7a3cff, { side: 0xff8a00, bevelColor: 0xffa020, metal: 0.25, emissive: 0.06 });
    const mix = word('MIX', { cap: cap * 1.55, depth: 0.7, bevel: 0.06, mats: purple, track: 0.02 });
    const piv = new THREE.Group(); piv.add(mix);
    mix.position.set(-mix.userData.width / 2, -cap * 0.75, 0);
    piv.position.set(0.1, -0.55 * cap, 1.0 * cap);
    piv.rotation.set(0.15, -0.35, 0.5);
    wm.add(piv);
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(0.1, 0.1, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => lensFlare(x, W * 0.82, H * 0.12, { scale: 0.45, tint: '#d0b0ff' });
  },

  // 09 — Espaço Vanguarda
  9: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { er: 0.8, env: { tint: [0.7, 1.15, 1.25] } });
    const [c] = raysBg(W, H, { cx: 0.58, cy: 0.45, base: '#03222c', core: '#e8ffff', mid: '#22b8c8', colors: ['#7ff6ff', '#2ad0e0', '#ffffff', '#1a8aff'], n: 90, seed: 6 });
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.55, mats: metalMats(0x5ad8e6, { side: 0x13707a, rough: 0.12 }) });
    progWord(wm, 'VAN', 1, alt('ESPAÇO'), 3, { big: 1.4, small: 0.55, rz: 0.45, mats: candyMats(0x1830ff, { metal: 0.3, emissive: 0.05, side: 0x0a147a }), z: 0.5 });
    wm.rotation.set(-0.36, 0.36, -0.06);
    wm.position.set(0.3, -0.1, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera, { bloom: [0.45, 0.5, 0.92] });
    return (x) => lensFlare(x, W * 0.86, H * 0.14, { scale: 0.4, tint: '#a0ffff' });
  },

  // 10 — Verão Vanguarda
  10: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { env: { tint: [0.75, 0.85, 1.25] } });
    const [c, x] = canvas2d(W, H);
    const sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#02031a'); sky.addColorStop(0.55, '#0c1660'); sky.addColorStop(0.76, '#5a2a9a'); sky.addColorStop(0.77, '#2a1a70'); sky.addColorStop(1, '#0a0830');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    const hz = x.createRadialGradient(W * 0.55, H * 0.765, 0, W * 0.55, H * 0.765, W * 0.55);
    hz.addColorStop(0, 'rgba(255,140,60,0.55)'); hz.addColorStop(0.3, 'rgba(200,60,140,0.25)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
    x.save(); x.globalCompositeOperation = 'lighter'; x.fillStyle = hz; x.fillRect(0, 0, W, H);
    const rnd = mulberry(4);
    for (let i = 0; i < 160; i++) {
      const y = H * (0.775 + Math.pow(rnd(), 1.5) * 0.22), w = W * (0.01 + rnd() * 0.08) * (1 + (y / H - 0.77) * 6);
      const xx = W * 0.55 + (rnd() - 0.5) * W * (0.2 + (y / H - 0.77) * 3);
      x.fillStyle = `rgba(255,${120 + rnd() * 100 | 0},${60 + rnd() * 120 | 0},${0.12 + rnd() * 0.3})`;
      x.fillRect(xx - w / 2, y, w, Math.max(1, 2 * W / 1600));
    }
    x.restore();
    sparkles(x, W, H, { n: 50, col: '#cfd8ff', seed: 17, max: 6, area: [0, 0, 1, 0.6] });
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const yel = candyMats(0xffe21a, { emissive: 0.32, metal: 0.1, side: 0xff7a00 });
    const org = candyMats(0xff8a10, { emissive: 0.32, metal: 0.1, side: 0xd03000 });
    const pw = progWord(wm, 'GUAR', 2, 'VER' + A + 'O', 3, { big: 1.4, small: 0.62, mats: yel, matsAt: { 3: org }, z: 0.55, rz: 0.04, dy: -0.25 });
    const Al = pw.letters[3];
    const til = word('˜', { cap: cap * 1.4, depth: 0.3 * cap, bevel: 0.03 * cap, mats: org });
    const bb = new THREE.Box3().setFromObject(til);
    til.position.set(Al.position.x + 0.12 * cap, Al.position.y + 1.4 * cap + 0.12 * cap - bb.min.y, 0);
    pw.w.add(til);
    for (const L of pw.letters) { const gg = glow(0xff8a00, 2.2, 0.42); gg.position.set(L.position.x + 0.3 * cap, 0.4 * cap, -0.35); pw.w.add(gg); }
    wm.rotation.set(-0.34, 0.34, -0.05);
    wm.position.set(0.2, 0.25, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera, { bloom: [0.6, 0.45, 0.86] });
    return null;
  },

  // 11 — Inverno Vanguarda
  11: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { env: { tint: [0.8, 0.95, 1.3] } });
    const [c, x] = canvas2d(W, H);
    const gb = x.createLinearGradient(0, 0, W * 0.3, H);
    gb.addColorStop(0, '#1a2470'); gb.addColorStop(0.5, '#3a56b0'); gb.addColorStop(1, '#16205a');
    x.fillStyle = gb; x.fillRect(0, 0, W, H);
    const rg = x.createRadialGradient(W * 0.6, H * 0.4, 0, W * 0.6, H * 0.4, W * 0.6);
    rg.addColorStop(0, 'rgba(160,200,255,0.45)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    const rnd = mulberry(23);
    const flake = (cx, cy, r, a, blur) => {
      x.save(); x.translate(cx, cy); x.rotate(rnd() * Math.PI);
      x.filter = blur ? `blur(${blur}px)` : 'none';
      x.strokeStyle = `rgba(225,240,255,${a})`; x.lineWidth = Math.max(1, r * 0.07); x.lineCap = 'round';
      for (let kk = 0; kk < 6; kk++) {
        x.rotate(Math.PI / 3);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(r, 0);
        for (const t of [0.4, 0.65]) { x.moveTo(r * t, 0); x.lineTo(r * t + r * 0.22, r * 0.2); x.moveTo(r * t, 0); x.lineTo(r * t + r * 0.22, -r * 0.2); }
        x.stroke();
      }
      x.restore();
    };
    for (let i = 0; i < 70; i++) {
      const d = rnd();
      flake(rnd() * W, rnd() * H, (8 + d * 55) * W / 1600, 0.25 + d * 0.6, d > 0.85 ? 6 * W / 1600 : 0);
    }
    sparkles(x, W, H, { n: 40, col: '#e8f4ff', seed: 41, max: 8 });
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6, mats: chromeMats({ face: 0xe2f0ff, side: 0x7d9cc0 }) });
    const ice = candyMats(0x8fd8ff, { metal: 0.35, emissive: 0.08, side: 0x2f78c8, bevelColor: 0xe8f8ff });
    progWord(wm, 'VAN', 0, 'IN' + V + 'ERNO', 2, {
      big: 1.35, small: 0.52, mats: ice, z: 0.5,
      offs: { 0: [0, -0.15, 0], 1: [0, -0.15, 0], 3: [-0.4, 0.95, 0], 4: [-0.4, 0.95, 0], 5: [-0.4, 0.95, 0], 6: [-0.4, 0.95, 0] },
    });
    const shardMat = new THREE.MeshPhysicalMaterial({ color: 0xe0f4ff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.6, ior: 1.31, clearcoat: 1, envMapIntensity: 1.4 });
    const r2 = mulberry(3);
    for (let i = 0; i < 11; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.3 + r2() * 0.35, 0), shardMat);
      s.scale.set(0.35, 1.5 + r2(), 0.35);
      s.position.set(-5.5 + r2() * 3.5, -3.6 + r2() * 1.2, 1 + r2() * 2);
      s.rotation.set(r2() * 3, r2() * 3, r2() * 3);
      scene.add(s);
    }
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(0.3, 0, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera, { bloom: [0.5, 0.45, 0.9] });
    return (x) => lensFlare(x, W * 0.72, H * 0.12, { scale: 0.45, tint: '#c0e0ff' });
  },

  // 12 — Vanguarda Motor
  12: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#1a0a02', glowAt: [0.6, 0.5], glowR: 0.7 });
    const { fbm } = makeNoise(5);
    const fw = Math.round(W / 2), fh = Math.round(H / 2);
    const ramp = (t) => {
      const st = [[0, [0, 0, 0]], [0.25, [90, 8, 0]], [0.45, [210, 50, 0]], [0.62, [255, 130, 10]], [0.8, [255, 210, 80]], [1, [255, 255, 230]]];
      for (let i = 1; i < st.length; i++) if (t <= st[i][0]) { const [t0, c0] = st[i - 1], [t1, c1] = st[i]; const kk = (t - t0) / (t1 - t0); return c0.map((v, j) => v + (c1[j] - v) * kk); }
      return st[st.length - 1][1];
    };
    const fire = pixelCanvas(fw, fh, (u, v) => {
      const dx = (u - 0.6) * 1.5, dy = (v - 0.5) * 1.15;
      const n = fbm(u * 6, v * 6 - 0.5, 6), n2 = fbm(u * 14 + 3, v * 14, 4);
      const r = Math.sqrt(dx * dx + dy * dy) * (0.9 + 0.5 * (n - 0.5)) - 0.12 * (n2 - 0.5);
      let t = Math.max(0, 1 - r / 0.52);
      t = Math.min(1, Math.pow(t, 0.9) * (0.55 + 0.75 * n));
      const cc = ramp(t);
      return [cc[0], cc[1], cc[2], 255];
    });
    x.save(); x.globalCompositeOperation = 'lighter'; x.drawImage(fire, 0, 0, W, H); x.restore();
    sparkles(x, W, H, { n: 60, col: '#ffb040', seed: 8, max: 5, area: [0.25, 0.15, 0.95, 0.85] });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6, mats: chromeMats({ face: 0xf4ece4, side: 0x8a7a70 }) });
    const blue = candyMats(0x2a3cff, { metal: 0.45, emissive: 0.05, side: 0x101860, bevelColor: 0x8a9aff });
    progWord(wm, 'GUAR', 3, 'MOTOR', 4, { big: 1.3, small: 0.62, mats: blue, matsAt: { 4: metalMats(0x3a4aff, { side: 0x101860 }) }, z: 0.5, dy: -0.12 });
    const fl = glow(0xff7a10, 7, 0.4); fl.position.set(1.5, -0.2, -1.5); scene.add(fl);
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(0.15, 0, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera, { bloom: [0.6, 0.5, 0.82] });
    return null;
  },

  // 13 — Aventura Vanguarda (rastros arco-íris)
  13: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#1a1a30', glowAt: [0.5, 0.3], glowR: 0.7 });
    beams(x, W, H, { n: 6, col: '#ffffff', a: 0.06, ang: 0.2, seed: 19 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.55 });
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(2.0, -0.45, -1.6);
    wm.scale.setScalar(0.82);
    scene.add(wm);
    const grp = new THREE.Group();
    const kY = 1.15, kX = 0.25, D = 6.5, capA = 1.0;
    const lines = [[alt('AVEN'), 0, 0], [alt('TURA'), 0.9, -1.12]];
    const all = [];
    for (const [s, ox, oy] of lines) {
      const w = word(s, { cap: capA, depth: 0.1, bevel: 0.03 });
      w.position.set(ox, oy, 0);
      grp.add(w);
      for (const m of w.userData.letters) all.push(m);
    }
    all.forEach((m, idx) => {
      let g = charGeo(m.userData.ch, { cap: capA, depth: D, bevel: 0.03 }).clone();
      const pos = g.attributes.position, nor = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        pos.setXYZ(i, pos.getX(i) - kX * z, pos.getY(i) + kY * z, z);
        const n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i) - kY * nor.getY(i) + kX * nor.getX(i)).normalize();
        nor.setXYZ(i, n.x, n.y, n.z);
      }
      const hue = 0.62 - (idx / (all.length - 1)) * 0.68;
      g = vertexColors(g, (px, py, pz) => hsl(hue - pz * 0.012, 1, 0.5 + Math.max(0, 0.12 + pz * 0.03)));
      const side = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.22, clearcoat: 1, emissive: hsl(hue, 1, 0.12) });
      const cm = chromeMats({ face: 0xffffff });
      m.geometry = g;
      m.material = [cm[0], cm[1], side];
    });
    grp.position.set(-3.75, 1.35, 2.2);
    grp.rotation.set(0.1, 0.25, -0.12);
    scene.add(grp);
    renderComposite(renderer, scene, camera, { bloom: [0.5, 0.45, 0.9] });
    return (x) => lensFlare(x, W * 0.12, H * 0.1, { scale: 0.45 });
  },

  // 14 — Agenda Vanguarda (VAN-GEN-DA)
  14: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#2a1a08', glowAt: [0.55, 0.45], glowR: 0.65 });
    beams(x, W, H, { n: 6, col: '#ffb060', a: 0.08, ang: -0.4, seed: 29 });
    sparkles(x, W, H, { n: 22, col: '#fff0c0', seed: 13, max: 9 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    letter(wm, 'VAN', 1).material = candyMats(0xffa000, { metal: 0.3, emissive: 0.08, bevelColor: 0xffe080 });
    const gen = word('GEN', { cap: cap * 0.9, depth: 0.3 * cap, bevel: 0.03 * cap, matsAt: { 0: candyMats(0xff3aa0), 1: candyMats(0x2ed65a), 2: candyMats(0x2a6aff) } });
    const g0 = lcenter(wm, 'GUAR', 0);
    gen.position.set(g0.x - 0.3 * cap, g0.y + 0.12 * cap, 0.45 * cap);
    wm.add(gen);
    const da = word('D' + A, { cap: cap * 0.75, depth: 0.28 * cap, bevel: 0.03 * cap, matsAt: { 0: candyMats(0x1fcf4a), 1: candyMats(0x9b3cff) } });
    da.position.set(gen.position.x + gen.userData.width + 0.02 * cap, g0.y - 0.42 * cap, 0.45 * cap);
    wm.add(da);
    wm.rotation.set(-0.34, 0.36, -0.06);
    wm.position.set(0.2, 0, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => lensFlare(x, W * 0.86, H * 0.86, { scale: 0.4, tint: '#ffd0a0' });
  },

  // 15 — Serviço Vanguarda
  15: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#061a3a', glowAt: [0.4, 0.5], glowR: 0.7 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const red = candyMats(0xff2a10, { metal: 0.25, emissive: 0.1, side: 0x9a0a00, bevelColor: 0xff9050 });
    progWord(wm, 'VAN', 0, 'SER' + V + 'IÇO', 3, { big: 1.35, small: 0.58, rz: 0.42, mats: red, z: 0.55 });
    const barMat = new THREE.MeshPhysicalMaterial({ color: 0x3aa0ff, emissive: 0x0a3a80, metalness: 0.1, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.62 });
    const bars = [[-1.8, 0.4, -1.2, -0.95, 0.75], [0.4, -0.6, -0.8, -0.95, 0.55], [-3.2, -2.2, 1.6, 0.62, 0.45], [2.6, 2.4, -2.0, 0.62, 0.6]];
    for (const [bx, by, bz, rot, wdt] of bars) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(16, wdt, 0.25, 2, 0.06), barMat);
      b.position.set(bx, by, bz); b.rotation.set(0.2, -0.3, rot);
      scene.add(b);
    }
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(0.3, -0.1, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => sparkles(x, W, H, { n: 16, col: '#a8d4ff', seed: 73, max: 10 });
  },

  // 16 — Vanguarda Comunidade
  16: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#2a1404', glowAt: [0.55, 0.65], glowR: 0.65 });
    beams(x, W, H, { n: 6, col: '#ff9a40', a: 0.08, ang: 0.5, seed: 33 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const orange = candyMats(0xff7a00, { metal: 0.3, emissive: 0.08, side: 0xa03a00, bevelColor: 0xffc060 });
    progWord(wm, 'DA', 0, 'D' + A + 'DE', 0, { big: 1.25, small: 0.5, scales: { 1: (1.25 * cap) / (0.5 * cap) }, mats: orange, z: 0.5, dy: 0.05 });
    letter(wm, 'DA', 1).visible = false;
    const com = word('COMUNI', { cap: cap * 0.56, depth: 0.28 * cap, bevel: 0.03 * cap, mats: orange });
    const piv = new THREE.Group(); piv.add(com);
    com.position.set(-com.userData.width - 0.05 * cap, 0, 0);
    const d0 = lcenter(wm, 'DA', 0);
    piv.position.set(d0.x - 0.55 * cap, d0.y + 0.15 * cap, 0.55 * cap);
    piv.rotation.z = 0.36;
    wm.add(piv);
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(0.55, 0.45, 0);
    wm.scale.setScalar(0.88);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => lensFlare(x, W * 0.16, H * 0.12, { scale: 0.4, tint: '#ffc080' });
  },

  // 17 — Vanguarda Gente
  17: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#2a0614', glowAt: [0.35, 0.6], glowR: 0.65 });
    beams(x, W, H, { n: 6, col: '#ff5080', a: 0.08, ang: -0.5, seed: 37 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const pink = candyMats(0xff3a7a, { metal: 0.25, emissive: 0.08, side: 0x9a0a3a });
    const redG = candyMats(0xff3410, { metal: 0.25, emissive: 0.1, side: 0x9a1000, bevelColor: 0xffa060 });
    progWord(wm, 'GUAR', 0, 'GENTE', 0, { big: 1.4, small: 0.52, mats: pink, matsAt: { 0: redG }, z: 0.5, offs: { 1: [-0.1, 0.12, 0], 2: [-0.1, 0.12, 0], 3: [-0.1, 0.12, 0], 4: [-0.1, 0.12, 0] } });
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(0.25, 0, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => sparkles(x, W, H, { n: 16, col: '#ffc8d8', seed: 79, max: 10 });
  },

  // 18 — Papo Vanguarda
  18: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H);
    const [c, x, vig] = bg(W, H, { glowCol: '#2a2004', glowAt: [0.5, 0.3], glowR: 0.65 });
    beams(x, W, H, { n: 6, col: '#ffd040', a: 0.08, ang: 0.45, seed: 43 });
    sparkles(x, W, H, { n: 18, col: '#fff0a0', seed: 47, max: 9 });
    vig();
    scene.background = bgTexture(c);
    const cap = 1.6;
    const wm = wordmark({ cap, depth: 0.6 });
    const yel = candyMats(0xffd000, { metal: 0.25, emissive: 0.1, side: 0xb07000, bevelColor: 0xfff0a0 });
    const org = candyMats(0xff7a00, { metal: 0.25, emissive: 0.1, side: 0xa03000, bevelColor: 0xffc080 });
    progWord(wm, 'VAN', 1, 'P' + A + 'PO', 1, { big: 1.4, small: 0.6, mats: yel, matsAt: { 1: org }, z: 0.5, dy: -0.2 });
    wm.rotation.set(-0.36, 0.34, -0.06);
    wm.position.set(0.25, -0.15, 0);
    scene.add(wm);
    renderComposite(renderer, scene, camera);
    return (x) => lensFlare(x, W * 0.16, H * 0.14, { scale: 0.4, tint: '#ffe0a0' });
  },

  // 19 — Viola Turbinada
  19: async (renderer, W, H) => {
    const { scene, camera } = setup(renderer, W, H, { er: 0.7 });
    const [c, x] = canvas2d(W, H);
    x.fillStyle = '#04030a'; x.fillRect(0, 0, W, H);
    { const rg = x.createRadialGradient(W * 0.38, H * 0.62, 0, W * 0.38, H * 0.62, W * 0.55); rg.addColorStop(0, '#2a1a4a'); rg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = rg; x.fillRect(0, 0, W, H); }
    const arcs = [['#39ff7a', 0.62, 0.58, 0.55, 0.32, -0.25, 70], ['#ff3ad0', 0.55, 0.62, 0.62, 0.38, -0.2, 50], ['#ffd23a', 0.6, 0.55, 0.48, 0.26, -0.3, 40], ['#3ad8ff', 0.5, 0.66, 0.7, 0.45, -0.15, 60], ['#9a5aff', 0.66, 0.5, 0.4, 0.2, -0.35, 35]];
    x.save(); x.globalCompositeOperation = 'lighter';
    for (const blur of [40, 10, 0]) {
      x.filter = blur ? `blur(${blur * W / 1600}px)` : 'none';
      for (const [col, cx, cy, rx, ry, rot, lw] of arcs) {
        x.strokeStyle = rgba(col, blur ? 0.55 : 0.5);
        x.lineWidth = (blur ? lw : lw * 0.12) * W / 1600;
        x.beginPath(); x.ellipse(W * cx, H * cy, W * rx, H * ry, rot, Math.PI * 0.95, Math.PI * 2.15); x.stroke();
      }
    }
    x.restore();
    scene.background = bgTexture(c);

    const s = new THREE.Shape();
    s.moveTo(0, -1.35);
    s.bezierCurveTo(0.95, -1.35, 1.4, -0.75, 1.4, 0.05); s.bezierCurveTo(1.4, 0.8, 0.82, 1.0, 0.82, 1.45);
    s.bezierCurveTo(0.82, 1.85, 1.12, 2.0, 1.12, 2.5); s.bezierCurveTo(1.12, 3.0, 0.6, 3.22, 0.24, 3.22);
    s.lineTo(0.24, 6.0); s.lineTo(0.38, 6.15); s.lineTo(0.38, 7.1);
    s.lineTo(-0.38, 7.1); s.lineTo(-0.38, 6.15); s.lineTo(-0.24, 6.0); s.lineTo(-0.24, 3.22);
    s.bezierCurveTo(-0.6, 3.22, -1.12, 3.0, -1.12, 2.5); s.bezierCurveTo(-1.12, 2.0, -0.82, 1.85, -0.82, 1.45);
    s.bezierCurveTo(-0.82, 1.0, -1.4, 0.8, -1.4, 0.05); s.bezierCurveTo(-1.4, -0.75, -0.95, -1.35, 0, -1.35);
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(s, { depth: 0.75, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 6, curveSegments: 48 }).translate(0, 0, -0.83),
      new THREE.MeshStandardMaterial({ color: 0x020203, metalness: 0, roughness: 0.07, envMapIntensity: 0.9 }),
    );
    const guitar = new THREE.Group();
    guitar.add(body);
    const pts = s.getPoints(80).map((p) => new THREE.Vector3(p.x, p.y, 0.005));
    const edge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 600, 0.025, 8, true), chromeMats()[1]);
    guitar.add(edge);
    const chrome = chromeMats()[0];
    for (let i = 0; i < 12; i++) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 6), chrome);
      f.rotation.z = Math.PI / 2; f.position.set(0, 3.35 + i * 0.22, 0.03); guitar.add(f);
    }
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 3.9, 6), chrome);
      st.position.set(-0.14 + i * 0.07, 5.1, 0.07); guitar.add(st);
    }
    for (let i = 0; i < 5; i++) { const pg = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), chrome); pg.position.set(i % 2 ? 0.3 : -0.3, 6.35 + i * 0.15, 0.08); guitar.add(pg); }
    const t1 = word(alt('TURBINADA'), { cap: 0.5, depth: 0.14, bevel: 0.02, track: -0.01 });
    const p1 = new THREE.Group(); p1.add(t1); p1.rotation.z = Math.PI / 2; p1.position.set(0.3, -1.02, 0.15);
    const t2 = word(alt('VIOLA'), { cap: 0.4, depth: 0.12, bevel: 0.018 });
    const p2 = new THREE.Group(); p2.add(t2); p2.rotation.z = Math.PI / 2; p2.position.set(-0.33, 0.7, 0.15);
    guitar.add(p1, p2);
    guitar.scale.setScalar(1.5);
    guitar.rotation.set(-0.85, 0.5, -0.98);
    const rim = new THREE.DirectionalLight(0x8a6aff, 2.5); rim.position.set(6, 4, -5); scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0x40ffa0, 1.5); rim2.position.set(-6, -3, -3); scene.add(rim2);
    guitar.position.set(-1.9, -1.7, 0);
    scene.add(guitar);
    renderComposite(renderer, scene, camera, { bloom: [0.5, 0.5, 0.88] });
    return (x) => sparkles(x, W, H, { n: 24, col: '#e0ffe8', seed: 83, max: 10 });
  },
};
