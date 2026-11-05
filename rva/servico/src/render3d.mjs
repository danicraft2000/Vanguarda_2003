// Software 3D for Canvas 2D: extruded glyph solids with per-face lighting,
// painter's ordering, bevel highlight, light sweep and emissive bloom feed.
import { Path2D, createCanvas } from '@napi-rs/canvas';
import { add, sub, mul, dot, norm, mv } from './math3d.mjs';

// ------------------------------------------------------------------ materials
export const MATERIALS = {
  // satin pearl-titanium for VANGUARDA
  pearl: { base: [0.88, 0.86, 0.83], side: 0.78, amb: [0.07, 0.07, 0.09], spec: 0.55, gloss: 36, fresnel: 0.45, emissive: [0, 0, 0] },
  // glossy coral for SERVIÇO
  coral: { base: [1.0, 0.33, 0.14], side: 0.62, amb: [0.10, 0.025, 0.015], spec: 0.75, gloss: 70, fresnel: 0.35, emissive: [1.0, 0.32, 0.12] },
  // signal red for the V
  red: { base: [0.93, 0.08, 0.12], side: 0.6, amb: [0.09, 0.01, 0.02], spec: 0.85, gloss: 80, fresnel: 0.35, emissive: [1.0, 0.12, 0.10] },
};

export function mixMat(a, b, t) {
  const m = (x, y) => x + (y - x) * t;
  const m3 = (x, y) => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  return {
    base: m3(a.base, b.base), side: m(a.side, b.side), amb: m3(a.amb, b.amb), spec: m(a.spec, b.spec),
    gloss: m(a.gloss, b.gloss), fresnel: m(a.fresnel, b.fresnel), emissive: m3(a.emissive, b.emissive),
  };
}

const tone = (c) => (c < 0.82 ? c : 0.82 + 0.18 * (1 - Math.exp(-(c - 0.82) / 0.18)));
const to255 = (c) => Math.max(0, Math.min(255, Math.round(tone(c) * 255)));
export const rgb = (c, a = 1) => (a >= 1 ? `rgb(${to255(c[0])},${to255(c[1])},${to255(c[2])})` : `rgba(${to255(c[0])},${to255(c[1])},${to255(c[2])},${a.toFixed(4)})`);

/** Blinn-Phong + fresnel rim, lights in world space. returns linear-ish rgb 0..1+ */
export function shade(mat, n, p, env, camPos, k = 1) {
  const v = norm(sub(camPos, p));
  let r = mat.amb[0], g = mat.amb[1], b = mat.amb[2];
  for (const L of env.lights) {
    const ndl = dot(n, L.dir);
    if (ndl <= 0) continue;
    const h = norm(add(L.dir, v));
    const s = Math.pow(Math.max(0, dot(n, h)), mat.gloss) * mat.spec;
    const I = L.int;
    r += L.col[0] * I * (mat.base[0] * ndl * k + s);
    g += L.col[1] * I * (mat.base[1] * ndl * k + s);
    b += L.col[2] * I * (mat.base[2] * ndl * k + s);
  }
  const fr = Math.pow(1 - Math.max(0, dot(n, v)), 3) * mat.fresnel;
  r += env.rim[0] * fr; g += env.rim[1] * fr; b += env.rim[2] * fr;
  return [r, g, b];
}

// ------------------------------------------------------------------ geometry
/** Pre-compute local (pivot-centred, scaled) contour arrays + segment normals. */
export function prepGlyph(letter) {
  const s = letter.scale;
  return letter.shape.contours.map((c) => {
    const n = c.pts.length;
    const xs = new Float64Array(n), ys = new Float64Array(n);
    const nx = new Float64Array(n), ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (c.pts[i][0] - letter.pivot[0]) * s;
      ys[i] = (c.pts[i][1] - letter.pivot[1]) * s;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
      const l = Math.hypot(dx, dy) || 1;
      nx[i] = (c.nSign * dy) / l;
      ny[i] = (-c.nSign * dx) / l;
    }
    return { n, xs, ys, nx, ny };
  });
}

/**
 * Transform a glyph solid. item = { geo, M (3x3), T (world pivot), depth }.
 * Returns screen/world arrays used by both the solid pass and the glow pass.
 */
export function transformSolid(cam, item) {
  const { geo, M, T, depth } = item;
  const bz = [-M[2] * depth, -M[5] * depth, -M[8] * depth];
  const out = [];
  for (const c of geo) {
    const n = c.n;
    const fw = new Float64Array(n * 3), bw = new Float64Array(n * 3);
    const fs = new Float64Array(n * 3), bs = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = c.xs[i], y = c.ys[i];
      const wx = M[0] * x + M[1] * y + T[0], wy = M[3] * x + M[4] * y + T[1], wz = M[6] * x + M[7] * y + T[2];
      fw[i * 3] = wx; fw[i * 3 + 1] = wy; fw[i * 3 + 2] = wz;
      bw[i * 3] = wx + bz[0]; bw[i * 3 + 1] = wy + bz[1]; bw[i * 3 + 2] = wz + bz[2];
      const pf = cam.project([wx, wy, wz]);
      const pb = cam.project([wx + bz[0], wy + bz[1], wz + bz[2]]);
      fs[i * 3] = pf[0]; fs[i * 3 + 1] = pf[1]; fs[i * 3 + 2] = pf[2];
      bs[i * 3] = pb[0]; bs[i * 3 + 1] = pb[1]; bs[i * 3 + 2] = pb[2];
    }
    out.push({ c, fw, bw, fs, bs });
  }
  return out;
}

function capPath(tr, back = false) {
  const p = new Path2D();
  for (const k of tr) {
    const s = back ? k.bs : k.fs;
    const n = k.c.n;
    p.moveTo(s[0], s[1]);
    for (let i = 1; i < n; i++) p.lineTo(s[i * 3], s[i * 3 + 1]);
    p.closePath();
  }
  return p;
}

/**
 * Draw one extruded letter.
 * item: { geo, M, T, depth, mat, alpha, glow, sweep, bevel, seam }
 * fx: { glowCtx, sweepX, sweepW, sweepAmt, sweepAngle }
 */
export function drawSolid(ctx, cam, env, item, fx) {
  if (item.alpha <= 0.001) return;
  const T = item.T;
  const vz = cam.view(T)[2];
  if (vz < 0.4) return;
  const tr = transformSolid(cam, item);
  const M = item.M;
  const nf = norm([M[2], M[5], M[8]]);
  const toCam = sub(cam.pos, T);
  const frontVis = dot(nf, toCam) > 0;
  const mat = item.mat;
  ctx.save();
  ctx.globalAlpha = item.alpha;
  ctx.lineJoin = 'round';
  const seam = item.seam ?? 1.6;
  // ---- side walls (visible ones, far -> near)
  const quads = [];
  for (const k of tr) {
    const c = k.c, n = c.n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const nl = [c.nx[i], c.ny[i], 0];
      const nw = norm(mv(M, nl));
      const mx = (k.fw[i * 3] + k.fw[j * 3] + k.bw[i * 3] + k.bw[j * 3]) / 4;
      const my = (k.fw[i * 3 + 1] + k.fw[j * 3 + 1] + k.bw[i * 3 + 1] + k.bw[j * 3 + 1]) / 4;
      const mz = (k.fw[i * 3 + 2] + k.fw[j * 3 + 2] + k.bw[i * 3 + 2] + k.bw[j * 3 + 2]) / 4;
      const vis = nw[0] * (cam.pos[0] - mx) + nw[1] * (cam.pos[1] - my) + nw[2] * (cam.pos[2] - mz);
      if (vis <= 0) continue;
      const d = (k.fs[i * 3 + 2] + k.fs[j * 3 + 2] + k.bs[i * 3 + 2] + k.bs[j * 3 + 2]) / 4;
      quads.push({ k, i, j, nw, mid: [mx, my, mz], d });
    }
  }
  quads.sort((a, b) => b.d - a.d);
  for (const q of quads) {
    const col = shade(mat, q.nw, q.mid, env, cam.pos, mat.side);
    const s = rgb(col);
    const { fs, bs } = q.k;
    const i = q.i * 3, j = q.j * 3;
    ctx.beginPath();
    ctx.moveTo(fs[i], fs[i + 1]);
    ctx.lineTo(fs[j], fs[j + 1]);
    ctx.lineTo(bs[j], bs[j + 1]);
    ctx.lineTo(bs[i], bs[i + 1]);
    ctx.closePath();
    ctx.fillStyle = s;
    ctx.fill();
    ctx.strokeStyle = s;
    ctx.lineWidth = seam;
    ctx.stroke();
  }
  // ---- visible cap
  const back = !frontVis;
  const path = capPath(tr, back);
  const n = back ? mul(nf, -1) : nf;
  const up = norm([M[1], M[4], M[7]]);
  const capP = back ? add(T, [-M[2] * item.depth, -M[5] * item.depth, -M[8] * item.depth]) : T;
  const h = item.capH || 0.55;
  const cTop = shade(mat, norm(add(n, mul(up, 0.42))), capP, env, cam.pos);
  const cMid = shade(mat, n, capP, env, cam.pos);
  const cBot = shade(mat, norm(add(n, mul(up, -0.5))), capP, env, cam.pos);
  const pa = cam.project(add(capP, mul(up, h)));
  const pb = cam.project(add(capP, mul(up, -h)));
  const g = ctx.createLinearGradient(pa[0], pa[1], pb[0], pb[1]);
  g.addColorStop(0, rgb(cTop));
  g.addColorStop(0.5, rgb(cMid));
  g.addColorStop(1, rgb(cBot));
  ctx.fillStyle = g;
  ctx.fill(path, 'nonzero');
  // bevel highlight (inner rim catching the key light)
  const pxScale = cam.scaleAt(vz);
  const bevelPx = (item.bevel ?? 0.022) * pxScale;
  if (bevelPx > 0.6) {
    ctx.save();
    ctx.clip(path, 'nonzero');
    const key = env.lights[0].dir;
    // screen-space direction of the key light, for a lit/dark rim gradient
    const ps = cam.project(capP), pk = cam.project(add(capP, mul(key, 0.6)));
    const rg = ctx.createLinearGradient(pk[0], pk[1], ps[0] - (pk[0] - ps[0]), ps[1] - (pk[1] - ps[1]));
    const hi = shade(mat, norm(add(n, mul(key, 0.9))), capP, env, cam.pos);
    rg.addColorStop(0, rgb([hi[0] * 1.25 + 0.08, hi[1] * 1.25 + 0.08, hi[2] * 1.25 + 0.08], 0.95));
    rg.addColorStop(0.5, rgb(cMid, 0.35));
    rg.addColorStop(1, rgb([cBot[0] * 0.55, cBot[1] * 0.55, cBot[2] * 0.55], 0.9));
    ctx.strokeStyle = rg;
    ctx.lineWidth = bevelPx * 2;
    ctx.stroke(path);
    ctx.restore();
  }
  // light sweep across the face
  if (fx && fx.sweepAmt > 0.001) {
    ctx.save();
    ctx.clip(path, 'nonzero');
    ctx.globalCompositeOperation = 'lighter';
    const a = fx.sweepAngle, cx = fx.sweepX;
    const dx = Math.cos(a) * fx.sweepW, dy = Math.sin(a) * fx.sweepW;
    const cy = ctx.canvas.height / 2;
    const sg = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    const amt = fx.sweepAmt * (item.sweepGain ?? 1);
    sg.addColorStop(0, 'rgba(255,240,225,0)');
    sg.addColorStop(0.4, `rgba(255,236,215,${(0.3 * amt).toFixed(3)})`);
    sg.addColorStop(0.5, `rgba(255,252,246,${(0.95 * amt).toFixed(3)})`);
    sg.addColorStop(0.6, `rgba(255,236,215,${(0.3 * amt).toFixed(3)})`);
    sg.addColorStop(1, 'rgba(255,240,225,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    if (fx.glowCtx) {
      // feed the sweep to the bloom so the light visibly travels across the letters
      const g2 = fx.glowCtx;
      g2.save();
      g2.clip(path, 'nonzero');
      const gg = g2.createLinearGradient(cx - dx * 0.6, cy - dy * 0.6, cx + dx * 0.6, cy + dy * 0.6);
      gg.addColorStop(0, 'rgba(255,200,160,0)');
      gg.addColorStop(0.5, `rgba(255,214,180,${(0.85 * amt).toFixed(3)})`);
      gg.addColorStop(1, 'rgba(255,200,160,0)');
      g2.fillStyle = gg;
      g2.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      g2.restore();
    }
  }
  ctx.restore();
  // ---- emissive feed for bloom
  if (fx && fx.glowCtx && item.glow > 0.001) {
    const e = mat.emissive;
    const gctx = fx.glowCtx;
    gctx.save();
    gctx.globalAlpha = Math.min(1, item.alpha);
    gctx.fillStyle = rgb([e[0] * item.glow, e[1] * item.glow, e[2] * item.glow]);
    gctx.fill(path, 'nonzero');
    gctx.restore();
  }
  return { path, frontVis, vz };
}

// ------------------------------------------------------------------ helpers
/** Clip a 3D segment (world) to the camera near plane and project it. */
export function projSeg(cam, a, b, near = 0.15) {
  let va = cam.view(a), vb = cam.view(b);
  if (va[2] < near && vb[2] < near) return null;
  if (va[2] < near) { const t = (near - va[2]) / (vb[2] - va[2]); va = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, near]; }
  if (vb[2] < near) { const t = (near - vb[2]) / (va[2] - vb[2]); vb = [vb[0] + (va[0] - vb[0]) * t, vb[1] + (va[1] - vb[1]) * t, near]; }
  return [cam.proj(va), cam.proj(vb)];
}

/** Soft round sprite (pre-rendered radial falloff) tinted to a colour. */
export function makeSprite(rgbStr, size = 256, hardness = 0.0) {
  const c = createCanvas(size, size);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // smooth profile: sharp core + gaussian halo, no visible edge after bloom
  for (let i = 0; i <= 24; i++) {
    const r = i / 24;
    const a = Math.min(1, 0.85 * Math.exp(-((r / 0.11) ** 2)) * (1 + hardness * 2) + 0.42 * Math.exp(-((r / 0.38) ** 2))) * (1 - r ** 6);
    g.addColorStop(r, `rgba(${rgbStr},${a.toFixed(4)})`);
  }
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

/** Bokeh disc sprite: flat disc with soft rim (for out-of-focus particles). */
export function makeBokeh(rgbStr, size = 256) {
  const c = createCanvas(size, size);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgbStr},0.55)`);
  g.addColorStop(0.78, `rgba(${rgbStr},0.62)`);
  g.addColorStop(0.9, `rgba(${rgbStr},0.8)`);
  g.addColorStop(1, `rgba(${rgbStr},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}
