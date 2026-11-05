// VANGUARDA SERVIÇO — original scene.
//
// Concept: "a rede que chega a cada ponto" (the service network that reaches
// every point). A luminous map floor; coral pulses travel its streets on the
// beat, light beams rise, the routes converge on a hub where the letters are
// traced in light and stand up into the composition. Energy climbs into the V,
// which ignites red, and SERVIÇO grows outward from it. Final hold with a
// light sweep and a slow, never-frozen camera drift.
import { createCanvas } from '@napi-rs/canvas';
import { Camera, add, sub, mul, norm, dot, mm, rotX, rotY, rotZ, deg, lerp3 } from './math3d.mjs';
import { buildLogo } from './logo.mjs';
import { EASE, track, trackN, springAt, clamp01, lerp, smooth, mulberry32 } from './anim.mjs';
import { MATERIALS, mixMat, prepGlyph, drawSolid, projSeg, makeSprite, makeBokeh, rgb } from './render3d.mjs';

const YF = -3.3; // floor height

// ---------------------------------------------------------------- camera path
// Hermite spline through timed keys (C1 continuous in time). `v` overrides the
// tangent (world units / s); otherwise Catmull-Rom style tangents are used.
function hermitePath(keys, field) {
  const n = keys.length;
  const P = keys.map((k) => k[field]);
  const Tm = keys.map((k) => k.t);
  const V = keys.map((k, i) => {
    if (k.v && k.v[field] !== undefined) return k.v[field];
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    return P[a].map((_, d) => (P[b][d] - P[a][d]) / (Tm[b] - Tm[a]));
  });
  return (t) => {
    if (t <= Tm[0]) return P[0].map((p, d) => p + V[0][d] * (t - Tm[0]));
    if (t >= Tm[n - 1]) return P[n - 1].map((p, d) => p + V[n - 1][d] * (t - Tm[n - 1]));
    let i = 0;
    while (t > Tm[i + 1]) i++;
    const h = Tm[i + 1] - Tm[i];
    const s = (t - Tm[i]) / h;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    return P[i].map((p, d) => h00 * p + h10 * h * V[i][d] + h01 * P[i + 1][d] + h11 * h * V[i + 1][d]);
  };
}

const ZERO = [0, 0, 0];
const CAM_KEYS = [
  { t: 0.0, pos: [-1.8, YF + 0.8, 33.0], tgt: [0.6, YF + 0.55, -8], fr: [44, -5] },
  { t: 1.0, pos: [-0.7, YF + 0.95, 27.2], tgt: [0.4, YF + 0.4, -6], fr: [43, -3] },
  { t: 2.0, pos: [0.8, YF + 1.5, 20.6], tgt: [0.0, YF + 0.2, -2.5], fr: [41, 1.5] },
  { t: 3.0, pos: [2.1, YF + 6.2, 11.0], tgt: [0.0, YF, -0.4], fr: [38, 3] },
  { t: 4.0, pos: [0.5, YF + 15.2, 2.7], tgt: [0.0, YF, 0.0], fr: [34, 0] },
  { t: 4.9, pos: [1.7, YF + 10.6, 9.6], tgt: [0.0, YF + 2.1, 0.0], fr: [32, -2] },
  { t: 5.85, pos: [0.12, 0.30, 11.4], tgt: [0.0, 0.0, 0.0], fr: [30, 0], v: { pos: ZERO, tgt: ZERO, fr: [0, 0] } },
  { t: 10.0, pos: [-0.55, 0.08, 10.65], tgt: [0.05, -0.02, 0.0], fr: [29.4, 0], v: { pos: [-0.11, -0.02, -0.15], tgt: [0.008, -0.004, 0], fr: [-0.08, 0] } },
];

export function createScene(TL) {
  const W = TL.width, H = TL.height;
  const C = TL.cues;
  const cam = new Camera(W, H);
  const camPos = hermitePath(CAM_KEYS, 'pos');
  const camTgt = hermitePath(CAM_KEYS, 'tgt');
  const camFR = hermitePath(CAM_KEYS, 'fr');

  // ------------------------------------------------------------- logo solids
  const logo = buildLogo();
  const tilt = logo.tilt;
  const Rt = rotZ(deg(tilt));
  const letters = logo.letters.map((L) => {
    const zOff = L.group === 'servico' ? 0.34 : 0;
    const depth = L.group === 'servico' ? 0.15 : 0.30;
    const c = [L.cx, L.cy, 0];
    const fin = [Rt[0] * c[0] + Rt[1] * c[1], Rt[3] * c[0] + Rt[4] * c[1], zOff];
    const b = L.shape.bounds;
    return {
      ...L, geo: prepGlyph(L), depth, fin,
      capH: ((b.maxY - b.minY) * L.scale) * 0.55,
      flat: [fin[0], YF + depth + 0.01, -fin[1] + 0.2],
    };
  });
  {
    // centre the *tilted* composition on its true ink bounding box
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const l of letters) {
      const R = mm(Rt, rotZ(deg(l.rot)));
      for (const c of l.geo) for (let i = 0; i < c.n; i++) {
        const x = R[0] * c.xs[i] + R[1] * c.ys[i] + l.fin[0], y = R[3] * c.xs[i] + R[4] * c.ys[i] + l.fin[1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const l of letters) {
      l.fin = [l.fin[0] - cx, l.fin[1] - cy, l.fin[2]];
      l.flat = [l.fin[0], YF + l.depth + 0.01, -l.fin[1] + 0.2];
    }
    logo.info.tiltedBox = [x0 - cx, y0 - cy, x1 - cx, y1 - cy];
  }
  const Vl = letters.find((l) => l.group === 'v');

  // rows rise from the floor on the beat (spring physics from Motion)
  const rowStart = { VAN: C.rowVAN, GUAR: C.rowGUAR, DA: C.rowDA };
  for (const l of letters) {
    if (l.group === 'servico') continue;
    const t0 = rowStart[l.row] + l.idx * 0.07;
    l.t0 = t0;
    l.rise = springAt(t0, 0, 1, { stiffness: 64, damping: 11.5, mass: 1 });
    l.tip = springAt(t0 + 0.04, 0, 1, { stiffness: 80, damping: 8.8, mass: 1 });
    l.trace = track(C.hub - 0.85 + (l.row === 'VAN' ? 0 : l.row === 'GUAR' ? 0.12 : 0.24) + l.idx * 0.05, C.hub - 0.05 + (l.row === 'DA' ? 0.15 : 0), [0, 1], { ease: EASE.glide });
  }
  // SERVIÇO grows out of the V: R+I, then E+Ç, then S+O
  const spreadT = { SER2: C.spreadR_I, ICO0: C.spreadR_I, SER1: C.spreadE_C, ICO1: C.spreadE_C, SER0: C.spreadS_O, ICO2: C.spreadS_O };
  for (const l of letters) {
    if (l.group !== 'servico') continue;
    const t0 = spreadT[l.id];
    l.t0 = t0;
    l.side = l.row === 'SER' ? -1 : 1;
    l.fly = springAt(t0, 0, 1, { stiffness: 150, damping: 17 });
    l.flip = springAt(t0, 0, 1, { stiffness: 130, damping: 10 });
    l.pop = track(t0, t0 + 0.9, [0, 1, 0], { times: [0, 0.12, 1], ease: ['easeOut', 'easeIn'] });
  }
  // V ignition
  const vMix = track(C.ignite - 0.06, C.ignite + 0.12, [0, 1], { ease: 'easeOut' });
  const vGlow = track(C.ignite - 0.06, C.ignite + 1.6, [0, 1.6, 0.42], { times: [0, 0.05, 1], ease: ['easeOut', EASE.settle] });
  const vPunch = springAt(C.ignite, 0, 0, { stiffness: 260, damping: 9, velocity: 2.6 });
  const bounce = track(C.ignite - 0.1, C.ignite + 0.8, [0.1, 0.5], { ease: EASE.settle });

  // --------------------------------------------------------------- routes
  const rnd = mulberry32(2003);
  const routes = [];
  const camZ = (t) => camPos(Math.max(0, t))[2];
  const specs = [];
  for (const lt of [-0.9, -0.45]) for (let j = 0; j < 2; j++) specs.push({ launch: lt, arrive: C.hub - 0.75, ripple: false });
  for (let k = 0; k < 14; k++) specs.push({ launch: C.pulses[Math.floor(k / 2)], arrive: C.hub - 0.75 + Math.floor(k / 2) * 0.125, ripple: true });
  for (let k = 0; k < 12; k++) specs.push({ launch: 6.0 + Math.floor(k / 2) * 0.5, arrive: 6.0 + Math.floor(k / 2) * 0.5 + 2.6, ripple: true, amb: true });
  specs.forEach((sp, k) => {
    const side = k % 2 ? 1 : -1;
    const { launch, arrive } = sp;
    let sx, sz;
    if (sp.amb) {
      sx = Math.round(side * (7 + rnd() * 10)); sz = Math.round(-4 - rnd() * 12);
    } else {
      // start ahead of the camera, inside the frame, so every pulse is seen leaving on its beat
      const ahead = 5 + rnd() * 9;
      sz = Math.max(5, Math.round(Math.min(26, camZ(launch) - ahead)));
      sx = Math.round(side * (1.5 + rnd() * (4 + sz * 0.35)));
    }
    const z1 = Math.round(sz * (0.35 + rnd() * 0.3));
    const x2 = Math.round(sx * (0.2 + rnd() * 0.3));
    const raw = [[sx, sz], [sx, z1], [x2, z1], [x2, 0], [0, 0]];
    const pts = [];
    for (const p of raw) {
      const q = pts[pts.length - 1];
      if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p);
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    routes.push({ pts, cum, L, launch, arrive, s: track(launch, arrive, [0, L], { ease: sp.amb ? EASE.glide : EASE.launch }), ripple: sp.ripple, amb: !!sp.amb });
  });
  const routePoint = (r, s) => {
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i] < s) i++;
    const a = r.pts[i - 1], b = r.pts[i];
    const u = clamp01((s - r.cum[i - 1]) / Math.max(1e-6, r.cum[i] - r.cum[i - 1]));
    return [a[0] + (b[0] - a[0]) * u, YF + 0.02, a[1] + (b[1] - a[1]) * u];
  };

  // ---------------------------------------------------------------- beams
  const beams = [];
  C.beams.forEach((t0, i) => {
    for (let j = 0; j < 2; j++) {
      const a = rnd() * Math.PI * 2, r = 2.5 + rnd() * 6;
      beams.push({
        t0: t0 + j * 0.02,
        x: Math.round(r * Math.cos(a)), z: Math.round(r * Math.sin(a) * 0.8),
        h: 1.3 + rnd() * 2.0,
        grow: track(t0, t0 + 0.32, [0, 1], { ease: EASE.settle }),
        fade: track(t0 + 0.35, t0 + 1.5, [1, 0], { ease: 'easeIn' }),
      });
    }
  });

  // ------------------------------------------------------------- particles
  const parts = [];
  for (let i = 0; i < 520; i++) {
    parts.push({
      x: -17 + rnd() * 34, y: YF + rnd() * 10.5, z: -26 + rnd() * 60,
      r: 0.010 + rnd() * 0.022, vy: 0.04 + rnd() * 0.12, ph: rnd() * 6.28, warm: rnd(),
    });
  }

  // --------------------------------------------------------------- sprites
  const spr = {
    coral: makeSprite('255,104,60'),
    amber: makeSprite('255,184,108'),
    white: makeSprite('255,244,232', 256, 0.18),
    red: makeSprite('255,40,40'),
    bokehWarm: makeBokeh('255,196,150'),
    bokehCoral: makeBokeh('255,110,70'),
  };
  // film grain tile
  const grain = createCanvas(512, 512);
  {
    const g = grain.getContext('2d');
    const im = g.createImageData(512, 512);
    const gr = mulberry32(77);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = 128 + (gr() + gr() + gr() - 1.5) * 70;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  // ----------------------------------------------------------------- tracks
  const exposure = track(0, 0.6, [0.72, 1], { ease: 'easeOut' });
  const hubFlash = track(C.hub - 0.02, C.hub + 0.6, [0, 1, 0], { times: [0, 0.06, 1], ease: ['easeOut', EASE.settle] });
  const hubRing = track(C.hub, C.hub + 1.4, [0, 1], { ease: EASE.settle });
  const igniteFlash = track(C.ignite - 0.02, C.ignite + 0.7, [0, 1, 0], { times: [0, 0.05, 1], ease: ['easeOut', EASE.settle] });
  const shock = track(C.ignite, C.ignite + 1.1, [0, 1], { ease: EASE.settle });
  const beamUp = track(C.riser2[0] + 0.3, C.ignite, [0, 1], { ease: EASE.launch });
  const finalRing = track(C.final, C.final + 1.9, [0, 1], { ease: EASE.settle });
  const sweep = track(C.sweep[0], C.sweep[1], [0, 1], { ease: EASE.glide });
  const finalPop = track(C.final - 0.02, C.final + 1.2, [0, 1, 0], { times: [0, 0.04, 1], ease: ['easeOut', EASE.settle] });
  const atmo = track(C.ignite - 0.2, C.ignite + 1.2, [0.35, 1], { ease: 'easeOut' });
  const floorFade = track(5.0, 6.4, [1, 0.42], { ease: 'easeInOut' });
  const routeFade = track(C.hub + 0.1, C.hub + 1.2, [1, 0], { ease: 'easeIn' });

  // --------------------------------------------------------------- drawing
  const glow = createCanvas(W / 4, H / 4);
  const gctx = glow.getContext('2d');
  const blurA = createCanvas(W / 4, H / 4), bA = blurA.getContext('2d');
  const blurB = createCanvas(W / 8, H / 8), bB = blurB.getContext('2d');

  function env(t) {
    const b = bounce(t);
    return {
      lights: [
        { dir: norm([-0.5, 0.62, 0.62]), col: [1.0, 0.95, 0.88], int: 1.0 },   // key (upper-left front)
        { dir: norm([0.75, 0.05, 0.55]), col: [0.62, 0.7, 0.86], int: 0.32 },  // cool fill
        { dir: norm([0.35, 0.45, -0.85]), col: [1.0, 0.55, 0.38], int: 0.75 }, // warm back rim
        { dir: norm([0.0, -1.0, 0.25]), col: [1.0, 0.36, 0.2], int: b },        // coral floor bounce
      ],
      rim: [0.55 + 0.45 * b, 0.32 + 0.1 * b, 0.26],
    };
  }

  function drawBackground(ctx, t) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#04050a');
    sky.addColorStop(0.55, '#0a0910');
    sky.addColorStop(1, '#120b10');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // horizon glow (where the floor meets the fog)
    const hz = projSeg(cam, [-200, YF, -160], [200, YF, -160]);
    if (hz) {
      const [a, b] = hz;
      const my = (a[1] + b[1]) / 2;
      if (my > -H * 0.3 && my < H * 1.3) {
        ctx.save();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        ctx.translate(W / 2, my);
        ctx.rotate(ang);
        const hg = ctx.createLinearGradient(0, -H * 0.28, 0, H * 0.22);
        hg.addColorStop(0, 'rgba(70,28,30,0)');
        hg.addColorStop(0.55, `rgba(92,38,36,${0.45 * floorFade(t) + 0.12})`);
        hg.addColorStop(0.62, `rgba(150,70,52,${0.22 * floorFade(t) + 0.05})`);
        hg.addColorStop(1, 'rgba(20,10,12,0)');
        ctx.fillStyle = hg;
        ctx.fillRect(-W * 1.5, -H * 0.28, W * 3, H * 0.5);
        ctx.restore();
      }
    }
    // atmosphere glow behind the composition
    const o = cam.project([0, 0, -1.5]);
    if (o[2] > 0.5) {
      const r = H * 0.95;
      const a = 0.16 * atmo(t) * (t > 4 ? smooth(4.2, 5.8, t) : 0);
      if (a > 0.002) {
        const g = ctx.createRadialGradient(o[0], o[1], 0, o[0], o[1], r);
        g.addColorStop(0, `rgba(255,92,52,${a})`);
        g.addColorStop(0.4, `rgba(160,40,40,${a * 0.45})`);
        g.addColorStop(1, 'rgba(40,10,14,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  function heads(t) {
    const hs = [];
    for (const r of routes) {
      if (t < r.launch || t > r.arrive + 0.05) continue;
      hs.push(routePoint(r, r.s(t)));
    }
    return hs;
  }

  function drawFloor(ctx, t) {
    const fade = floorFade(t);
    const hs = heads(t);
    // grid lines (major, every 4 units), fogged per segment
    ctx.save();
    ctx.lineCap = 'round';
    const segs = [];
    for (let gx = -24; gx <= 24; gx += 4) for (let z = -60; z < 36; z += 4) segs.push([[gx, YF, z], [gx, YF, z + 4]]);
    for (let gz = -60; gz <= 36; gz += 4) for (let x = -24; x < 24; x += 4) segs.push([[x, YF, gz], [x + 4, YF, gz]]);
    const buckets = new Map();
    for (const [a, b] of segs) {
      const s = projSeg(cam, a, b);
      if (!s) continue;
      const m = lerp3(a, b, 0.5);
      const d = Math.hypot(m[0] - cam.pos[0], m[1] - cam.pos[1], m[2] - cam.pos[2]);
      const al = 0.2 * Math.exp(-d / 22) * fade;
      if (al < 0.004) continue;
      const k = Math.round(al * 200);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(s);
    }
    ctx.lineWidth = Math.max(1.2, H / 1100);
    for (const [k, list] of buckets) {
      ctx.strokeStyle = `rgba(255,170,140,${(k / 200).toFixed(4)})`;
      ctx.beginPath();
      for (const [p, q] of list) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      ctx.stroke();
    }
    // dots at every node; light up near passing pulses
    const dotB = new Map();
    const hot = [];
    for (let x = -26; x <= 26; x++) {
      for (let z = -60; z <= 36; z++) {
        const p = [x, YF, z];
        const v = cam.view(p);
        if (v[2] < 0.3) continue;
        const s = cam.proj(v);
        if (s[0] < -50 || s[0] > W + 50 || s[1] < -50 || s[1] > H + 50) continue;
        const d = Math.hypot(v[0], v[1], v[2]);
        let heat = 0;
        for (const h of hs) {
          const dd = (h[0] - x) ** 2 + (h[2] - z) ** 2;
          if (dd < 9) heat = Math.max(heat, 1 - Math.sqrt(dd) / 3);
        }
        const al = Math.min(0.9, (0.75 * Math.exp(-d / 19) + 0.025) * fade + heat * 0.9);
        if (al < 0.01) continue;
        const rad = Math.min(14, Math.max(1.3, 0.038 * cam.scaleAt(v[2])));
        if (heat > 0.05) { hot.push([s[0], s[1], rad, heat]); continue; }
        const k = Math.round(al * 60);
        if (!dotB.has(k)) dotB.set(k, []);
        dotB.get(k).push([s[0], s[1], rad]);
      }
    }
    for (const [k, list] of dotB) {
      ctx.fillStyle = `rgba(255,198,170,${(k / 60).toFixed(4)})`;
      ctx.beginPath();
      for (const [x, y, r] of list) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
      ctx.fill();
    }
    for (const [x, y, r, h] of hot) {
      ctx.fillStyle = `rgba(255,${Math.round(150 + 90 * h)},${Math.round(110 + 100 * h)},${Math.min(1, 0.4 + h).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, r * (1 + h * 0.8), 0, Math.PI * 2); ctx.fill();
      gctx.globalAlpha = h;
      const gr = Math.min(r * 5, H * 0.03); gctx.drawImage(spr.coral, x - gr, y - gr, gr * 2, gr * 2);
      gctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function ring3D(ctx, center, R, axisA, axisB, width, color, alpha, glowAmt = 1) {
    if (alpha <= 0.003 || R <= 0) return;
    const N = 96;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(add(center, add(mul(axisA, Math.cos(a) * R), mul(axisB, Math.sin(a) * R))));
    }
    const segs = [];
    for (let i = 0; i < N; i++) { const s = projSeg(cam, pts[i], pts[i + 1]); if (s) segs.push(s); }
    if (!segs.length) return;
    const vz = cam.view(center)[2];
    const lw = Math.max(1.5, width * cam.scaleAt(Math.max(vz, 1)));
    for (const [c2, w, a, gl] of [[ctx, lw, alpha, false], [gctx, lw * 2.5, alpha * glowAmt, true]]) {
      c2.save();
      c2.strokeStyle = `rgba(${color},${Math.min(1, a).toFixed(4)})`;
      c2.lineWidth = w;
      c2.beginPath();
      for (const [p, q] of segs) { c2.moveTo(p[0], p[1]); c2.lineTo(q[0], q[1]); }
      c2.stroke();
      c2.restore();
    }
  }

  function drawRoutes(ctx, t) {
    const rf = routeFade(t);
    ctx.save();
    ctx.lineCap = 'round';
    for (const r of routes) {
      if (t < r.launch) continue;
      const s = r.s(t);
      const vzh = cam.view(routePoint(r, s))[2];
      const ka = r.amb ? 0.6 : 1;
      const rfl = r.amb ? 0.7 * (1 - smooth(r.arrive - 0.2, r.arrive + 0.9, t)) : rf;
      // persistent trace of the route already travelled
      if (rfl > 0.01) {
        const step = 0.5;
        ctx.beginPath();
        let first = true;
        for (let u = 0; u <= s; u += step) {
          const p = cam.view(routePoint(r, u));
          if (p[2] < 0.3) { first = true; continue; }
          const q = cam.proj(p);
          if (first) { ctx.moveTo(q[0], q[1]); first = false; } else ctx.lineTo(q[0], q[1]);
        }
        ctx.strokeStyle = `rgba(255,120,80,${(0.42 * rfl).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.5, H / 900);
        ctx.stroke();
      }
      // comet
      if (t <= r.arrive + 0.02) {
        const len = 3.6;
        const n = 14;
        for (let i = 0; i < n; i++) {
          const u0 = s - len * (1 - i / n), u1 = s - len * (1 - (i + 1) / n);
          if (u1 < 0) continue;
          const sg = projSeg(cam, routePoint(r, Math.max(0, u0)), routePoint(r, u1));
          if (!sg) continue;
          const k = (i + 1) / n;
          const w = Math.max(1.5, 0.07 * k * cam.scaleAt(Math.max(1, sg[1][2])));
          ctx.strokeStyle = `rgba(255,${Math.round(110 + 120 * k)},${Math.round(70 + 150 * k)},${(k * k * ka).toFixed(3)})`;
          ctx.lineWidth = w;
          ctx.beginPath(); ctx.moveTo(sg[0][0], sg[0][1]); ctx.lineTo(sg[1][0], sg[1][1]); ctx.stroke();
          gctx.strokeStyle = `rgba(255,96,50,${(0.9 * k * ka).toFixed(3)})`;
          gctx.lineWidth = w * 3;
          gctx.beginPath(); gctx.moveTo(sg[0][0], sg[0][1]); gctx.lineTo(sg[1][0], sg[1][1]); gctx.stroke();
        }
        if (vzh > 0.4) {
          const hp = cam.project(routePoint(r, s));
          const sz = Math.min(H * 0.07, 0.42 * cam.scaleAt(vzh));
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(spr.white, hp[0] - sz / 2, hp[1] - sz / 2, sz, sz);
          ctx.globalCompositeOperation = 'source-over';
          gctx.drawImage(spr.coral, hp[0] - sz * 1.5, hp[1] - sz * 1.5, sz * 3, sz * 3);
        }
      }
      // ripple at launch (on the beat) and at arrival
      const st = routePoint(r, 0);
      const ageL = t - r.launch;
      if (r.ripple && ageL < 1.1) {
        const p = EASE.settle(clamp01(ageL / 1.1));
        ring3D(ctx, st, 0.2 + 2.2 * p, [1, 0, 0], [0, 0, 1], 0.05 * (1 - p) + 0.01, '255,150,100', (1 - p) * 0.9 * ka);
      }
      const ageA = t - r.arrive;
      if (!r.amb && ageA > 0 && ageA < 0.8) {
        const p = EASE.settle(clamp01(ageA / 0.8));
        ring3D(ctx, [0, YF + 0.02, 0], 0.3 + 3.2 * p, [1, 0, 0], [0, 0, 1], 0.06 * (1 - p) + 0.01, '255,170,120', (1 - p) * 0.8);
      }
    }
    ctx.restore();
  }

  // destination beacon: the hub glows on every beat while the routes converge
  const beaconFade = track(3.9, 4.35, [1, 0], { ease: 'easeIn' });
  function drawBeacon(ctx, t) {
    const f = beaconFade(t);
    if (f <= 0.003) return;
    const hp = cam.project([0, YF + 0.25, 0]);
    if (hp[2] < 0.5) return;
    const beat = Math.exp(-((t + 1e-6) % 0.5) * 7);
    const grow = 0.55 + 0.45 * smooth(0, 4, t);
    const sz = Math.min(H * 0.6, (1.6 + 1.2 * beat) * cam.scaleAt(hp[2]) * grow);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = f * (0.35 + 0.4 * beat);
    ctx.drawImage(spr.white, hp[0] - sz * 0.15, hp[1] - sz * 0.15, sz * 0.3, sz * 0.3);
    ctx.restore();
    gctx.save();
    gctx.globalAlpha = f * (0.5 + 0.5 * beat);
    gctx.drawImage(spr.coral, hp[0] - sz, hp[1] - sz, sz * 2, sz * 2);
    gctx.restore();
  }

  function drawBeams(ctx, t) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of beams) {
      if (t < b.t0) continue;
      const a = b.fade(t);
      if (a <= 0.003) continue;
      const g = b.grow(t);
      const p0 = [b.x, YF, b.z], p1 = [b.x, YF + b.h * g, b.z];
      const s = projSeg(cam, p0, p1);
      if (!s) continue;
      const vz = Math.max(1, (s[0][2] + s[1][2]) / 2);
      const w = Math.max(2, 0.055 * cam.scaleAt(vz));
      const lg = ctx.createLinearGradient(s[0][0], s[0][1], s[1][0], s[1][1]);
      lg.addColorStop(0, `rgba(255,220,180,${(0.95 * a).toFixed(3)})`);
      lg.addColorStop(0.7, `rgba(255,160,90,${(0.5 * a).toFixed(3)})`);
      lg.addColorStop(1, 'rgba(255,140,80,0)');
      ctx.strokeStyle = lg; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke();
      const gg = gctx.createLinearGradient(s[0][0], s[0][1], s[1][0], s[1][1]);
      gg.addColorStop(0, `rgba(255,140,70,${a.toFixed(3)})`);
      gg.addColorStop(1, 'rgba(255,120,60,0)');
      gctx.strokeStyle = gg; gctx.lineWidth = w * 4;
      gctx.beginPath(); gctx.moveTo(s[0][0], s[0][1]); gctx.lineTo(s[1][0], s[1][1]); gctx.stroke();
      // base flare
      const bp = cam.project(p0);
      if (bp[2] > 0.5) {
        const sz = Math.min(H * 0.2, 0.7 * cam.scaleAt(bp[2])) * (0.6 + 0.4 * a);
        gctx.globalAlpha = a; gctx.drawImage(spr.amber, bp[0] - sz, bp[1] - sz, sz * 2, sz * 2); gctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  function drawTraces(ctx, t) {
    // letter outlines drawn in light on the floor, before the rows stand up
    ctx.save();
    ctx.lineJoin = 'round';
    for (const l of letters) {
      if (l.group === 'servico' || !l.trace) continue;
      const tp = l.trace(t);
      if (tp <= 0) continue;
      const out = 1 - smooth(l.t0, l.t0 + 0.28, t);
      if (out <= 0.003) continue;
      const M = mm(rotX(deg(-90)), mm(Rt, rotZ(deg(l.rot))));
      const T = [l.flat[0], YF + 0.03, l.flat[2]];
      for (const c of l.geo) {
        const pts = [];
        for (let i = 0; i <= c.n; i++) {
          const k = i % c.n;
          const x = c.xs[k], y = c.ys[k];
          pts.push(cam.project([M[0] * x + M[1] * y + T[0], M[3] * x + M[4] * y + T[1], M[6] * x + M[7] * y + T[2]]));
        }
        let Ltot = 0;
        for (let i = 1; i < pts.length; i++) Ltot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const drawLen = Ltot * tp;
        const vz = cam.view(T)[2];
        const w = Math.max(1.5, 0.03 * cam.scaleAt(Math.max(1, vz)));
        for (const [c2, lw, col] of [[ctx, w, `rgba(255,214,180,${(0.95 * out).toFixed(3)})`], [gctx, w * 4, `rgba(255,100,55,${out.toFixed(3)})`]]) {
          c2.save();
          c2.strokeStyle = col; c2.lineWidth = lw; c2.lineCap = 'round';
          c2.beginPath();
          let acc = 0;
          c2.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length && acc < drawLen; i++) {
            const sl = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            if (acc + sl > drawLen) {
              const u = (drawLen - acc) / sl;
              c2.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u);
            } else c2.lineTo(pts[i][0], pts[i][1]);
            acc += sl;
          }
          c2.stroke();
          c2.restore();
        }
      }
    }
    ctx.restore();
  }

  function letterItems(t) {
    const items = [];
    const vm = vMix(t);
    const pearl = MATERIALS.pearl;
    for (const l of letters) {
      let M, T, alpha = 1, glowAmt = 0, mat = pearl, sweepGain = 1;
      if (l.group !== 'servico') {
        if (t < l.t0 - 0.001) continue;
        const p = l.rise(t), q = l.tip(t);
        const pc = clamp01(p);
        T = lerp3(l.flat, l.fin, p);
        T = add(T, [0, Math.sin(Math.PI * pc) * 0.9, Math.sin(Math.PI * pc) * 0.6]);
        M = mm(rotX(deg(-90 * (1 - q))), mm(Rt, rotZ(deg(l.rot))));
        alpha = smooth(l.t0, l.t0 + 0.12, t);
        if (l.group === 'v') {
          mat = mixMat(pearl, MATERIALS.red, vm);
          glowAmt = vGlow(t) * (0.75 + 0.06 * Math.sin(t * 5.1)) + 0.55 * finalPop(t);
          const pu = vPunch(t);
          T = add(T, [0, 0, pu * 0.35 + 0.06 * vm]);
          sweepGain = 0.8;
        }
      } else {
        if (t < l.t0 - 0.001) continue;
        const p = l.fly(t), q = l.flip(t);
        const start = add(Vl.fin, [0, 0, 0.5]);
        T = lerp3(start, l.fin, p);
        const sc = Math.max(0.05, 0.12 + 0.88 * p);
        const R = mm(Rt, mm(rotZ(deg(l.rot)), rotY(deg(l.side * 95 * (1 - q)))));
        M = R.map((v, i) => v * sc);
        alpha = smooth(l.t0, l.t0 + 0.08, t);
        mat = MATERIALS.coral;
        glowAmt = 0.3 + 0.9 * l.pop(t) + 0.04 * Math.sin(t * 4.3 + l.idx) + 0.45 * finalPop(t);
        sweepGain = 0.75;
      }
      items.push({ l, geo: l.geo, M, T, depth: l.depth, mat, alpha, glow: glowAmt, capH: l.capH, sweepGain, bevel: l.group === 'servico' ? 0.014 : 0.022 });
    }
    return items;
  }

  function drawParticles(ctx, t, layer, splitZ) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const zf = Math.max(4, cam.view([0, 0, 0])[2]);
    for (const p of parts) {
      const y = YF + ((p.y - YF + p.vy * t) % 10.5);
      const wp = [p.x + Math.sin(t * 0.35 + p.ph) * 0.25, y, p.z + Math.cos(t * 0.27 + p.ph) * 0.2];
      const v = cam.view(wp);
      if (v[2] < 0.35) continue;
      if (layer === 'back' ? v[2] < splitZ : v[2] >= splitZ) continue;
      const s = cam.proj(v);
      if (s[0] < -300 || s[0] > W + 300 || s[1] < -300 || s[1] > H + 300) continue;
      const core = Math.max(1.2, p.r * cam.scaleAt(v[2]));
      const coc = 0.045 * cam.focal * Math.abs(v[2] - zf) / (v[2] * zf);
      const size = Math.min(H * 0.12, core + coc);
      const fog = Math.exp(-v[2] / 30);
      const a = Math.min(0.85, (0.65 * fog) / (1 + (coc / 6) ** 2) * (0.5 + 0.5 * Math.sin(t * 1.7 + p.ph * 3) ** 2) + 0.02);
      const sp = coc > 6 ? (p.warm > 0.6 ? spr.bokehCoral : spr.bokehWarm) : (p.warm > 0.6 ? spr.coral : spr.amber);
      ctx.globalAlpha = a;
      const d = coc > 6 ? size * 2 : size * 4;
      ctx.drawImage(sp, s[0] - d / 2, s[1] - d / 2, d, d);
    }
    ctx.restore();
  }

  function drawIgnition(ctx, t) {
    const V = Vl.fin;
    // energy beam climbing from the floor into the V
    const bu = beamUp(t);
    if (bu > 0 && t < C.ignite + 0.25) {
      const fade = 1 - smooth(C.ignite, C.ignite + 0.25, t);
      const base = [V[0], YF, V[2] + 0.1];
      const head = [V[0], lerp(YF, V[1] - 0.3, bu), V[2] + 0.1];
      const s = projSeg(cam, base, head);
      if (s) {
        const w = Math.max(2, 0.05 * cam.scaleAt(Math.max(1, s[1][2])));
        const lg = ctx.createLinearGradient(s[0][0], s[0][1], s[1][0], s[1][1]);
        lg.addColorStop(0, 'rgba(255,90,50,0)');
        lg.addColorStop(0.8, `rgba(255,170,120,${(0.8 * fade).toFixed(3)})`);
        lg.addColorStop(1, `rgba(255,250,240,${fade.toFixed(3)})`);
        ctx.strokeStyle = lg; ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); ctx.stroke();
        gctx.strokeStyle = `rgba(255,80,40,${fade.toFixed(3)})`; gctx.lineWidth = w * 5;
        gctx.beginPath(); gctx.moveTo(s[0][0], s[0][1]); gctx.lineTo(s[1][0], s[1][1]); gctx.stroke();
        const hp = s[1];
        const sz = Math.min(H * 0.3, 1.1 * cam.scaleAt(Math.max(1, hp[2])));
        gctx.drawImage(spr.coral, hp[0] - sz, hp[1] - sz, sz * 2, sz * 2);
      }
    }
    // shockwave in the logo plane + on the floor
    const sh = shock(t);
    if (sh > 0 && sh < 1) {
      const ex = [Rt[0], Rt[3], 0], ey = [Rt[1], Rt[4], 0];
      ring3D(ctx, add(V, [0, 0, 0.2]), 0.3 + 7.5 * sh, ex, ey, 0.05 * (1 - sh) + 0.008, '255,120,80', (1 - sh) * 0.85, 1.2);
      ring3D(ctx, [V[0], YF + 0.02, V[2]], 0.5 + 11 * sh, [1, 0, 0], [0, 0, 1], 0.08 * (1 - sh) + 0.01, '255,140,90', (1 - sh) * 0.6);
    }
  }

  function drawFlashes(ctx, t) {
    const lens = (p, amt, color, scale) => {
      if (amt <= 0.003 || p[2] < 0.3) return;
      const r = H * 0.55 * scale;
      gctx.save();
      gctx.globalAlpha = Math.min(1, amt);
      gctx.drawImage(spr.white, p[0] - r * 0.12, p[1] - r * 0.12, r * 0.24, r * 0.24);
      gctx.globalAlpha = Math.min(1, amt * amt);
      gctx.drawImage(color, p[0] - r * 0.6, p[1] - r * 0.6, r * 1.2, r * 1.2);
      gctx.restore();
      // anamorphic streak
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const sg = ctx.createLinearGradient(p[0] - W * 0.6, 0, p[0] + W * 0.6, 0);
      sg.addColorStop(0, 'rgba(255,90,60,0)');
      sg.addColorStop(0.5, `rgba(255,200,170,${(0.55 * amt).toFixed(3)})`);
      sg.addColorStop(1, 'rgba(255,90,60,0)');
      ctx.fillStyle = sg;
      const th = Math.max(3, H * 0.004 * scale);
      ctx.fillRect(p[0] - W * 0.6, p[1] - th / 2, W * 1.2, th);
      ctx.restore();
      gctx.save();
      gctx.globalAlpha = Math.min(1, amt * 0.8);
      gctx.fillStyle = 'rgba(255,90,50,1)';
      gctx.fillRect(p[0] - W * 0.45, p[1] - th * 3, W * 0.9, th * 6);
      gctx.restore();
    };
    lens(cam.project([0, YF + 0.05, 0]), hubFlash(t), spr.coral, 1.0);
    lens(cam.project(add(Vl.fin, [0, 0, 0.3])), 0.8 * igniteFlash(t), spr.red, 1.15);
    // closing pulse on the floor (final chord)
    const fr = finalRing(t);
    if (fr > 0 && fr < 1) ring3D(ctx, [0, YF + 0.02, 0], 1 + 16 * fr, [1, 0, 0], [0, 0, 1], 0.06 * (1 - fr) + 0.01, '255,150,110', (1 - fr) * 0.55);
  }

  function post(ctx, t) {
    // bloom: two blur radii from the quarter-res emissive buffer
    bA.clearRect(0, 0, W / 4, H / 4);
    bA.filter = `blur(${(W / 4) * 0.006}px)`;
    bA.drawImage(gacc, 0, 0);
    bA.filter = 'none';
    bB.clearRect(0, 0, W / 8, H / 8);
    bB.filter = `blur(${(W / 8) * 0.02}px)`;
    bB.drawImage(gacc, 0, 0, W / 8, H / 8);
    bB.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.85; ctx.drawImage(blurA, 0, 0, W, H);
    ctx.globalAlpha = 0.9; ctx.drawImage(blurB, 0, 0, W, H);
    ctx.restore();
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.18);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    // grain (moves every frame)
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.07;
    const fr = Math.round(t * TL.fps);
    const gr = mulberry32(1000 + fr);
    const ox = Math.floor(gr() * 512), oy = Math.floor(gr() * 512);
    for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) ctx.drawImage(grain, x, y);
    ctx.restore();
    const ex = exposure(t);
    if (ex < 0.999) { ctx.fillStyle = `rgba(0,0,0,${(1 - ex).toFixed(4)})`; ctx.fillRect(0, 0, W, H); }
  }

  function setCam(t) {
    const pos = camPos(t), tgt = camTgt(t), fr = camFR(t);
    cam.set(pos, tgt, fr[0], fr[1]);
  }

  // screen-space speed probe: how many pixels things travel during the shutter
  const SHUTTER = 0.5 / TL.fps; // 180 degrees
  function probePoints(t) {
    setCam(t);
    const pts = [];
    const f = cam.f, r = cam.r, u = cam.u;
    for (const d of [3, 7, 14]) for (const [a, b] of [[0, 0], [0.5, 0.3], [-0.5, -0.3]]) {
      pts.push(add(cam.pos, add(mul(f, d), add(mul(r, a * d * 0.5), mul(u, b * d * 0.5)))));
    }
    return pts;
  }
  function samplesFor(t) {
    const P = probePoints(t);
    const t0 = t - SHUTTER / 2, t1 = t + SHUTTER / 2;
    let maxd = 0;
    // camera motion: fixed world points seen from the shutter's start and end
    setCam(t0);
    const a = P.map((p) => cam.project(p));
    setCam(t1);
    const b = P.map((p) => cam.project(p));
    for (let i = 0; i < a.length; i++) if (a[i][2] > 0.5 && b[i][2] > 0.5) maxd = Math.max(maxd, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
    // object motion: letter pivots
    const ia = letterItems(t0), ib = letterItems(t1);
    setCam(t);
    const mapB = new Map(ib.map((it) => [it.l.id, it]));
    for (const it of ia) {
      const jt = mapB.get(it.l.id);
      if (!jt) continue;
      const pa = cam.project(it.T), pb = cam.project(jt.T);
      if (pa[2] > 0.5 && pb[2] > 0.5) maxd = Math.max(maxd, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]));
    }
    return Math.max(1, Math.min(12, Math.ceil(maxd / 9)));
  }

  const layer = createCanvas(W, H), lctx = layer.getContext('2d');
  const acc = createCanvas(W, H), actx = acc.getContext('2d');
  const gacc = createCanvas(W / 4, H / 4), gactx = gacc.getContext('2d');
  let lastSamples = 1;

  function render(ctx, t) {
    const N = samplesFor(t);
    lastSamples = N;
    setCam(t);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawBackground(ctx, t);
    actx.setTransform(1, 0, 0, 1, 0, 0);
    actx.globalCompositeOperation = 'source-over';
    actx.globalAlpha = 1;
    actx.clearRect(0, 0, W, H);
    gactx.globalCompositeOperation = 'source-over';
    gactx.globalAlpha = 1;
    gactx.clearRect(0, 0, W / 4, H / 4);
    for (let i = 0; i < N; i++) {
      const ts = N === 1 ? t : t - SHUTTER / 2 + (SHUTTER * i) / (N - 1);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      lctx.globalAlpha = 1;
      lctx.clearRect(0, 0, W, H);
      drawContent(lctx, ts);
      actx.globalCompositeOperation = 'lighter';
      actx.globalAlpha = 1 / N;
      actx.drawImage(layer, 0, 0);
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gactx.globalCompositeOperation = 'lighter';
      gactx.globalAlpha = 1 / N;
      gactx.drawImage(glow, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(acc, 0, 0);
    setCam(t);
    post(ctx, t);
  }

  function drawContent(ctx, t) {
    setCam(t);
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = 'source-over';
    gctx.globalAlpha = 1;
    gctx.clearRect(0, 0, W / 4, H / 4);
    gctx.setTransform(0.25, 0, 0, 0.25, 0, 0);
    gctx.globalCompositeOperation = 'lighter';
    drawFloor(ctx, t);
    drawBeacon(ctx, t);
    drawRoutes(ctx, t);
    drawBeams(ctx, t);
    drawTraces(ctx, t);
    const splitZ = cam.view([0, 0, 0])[2];
    drawParticles(ctx, t, 'back', splitZ);
    drawIgnition(ctx, t);

    const E = env(t);
    const sw = sweep(t);
    const fx = {
      glowCtx: gctx,
      sweepAmt: sw > 0 && sw < 1 ? Math.sin(Math.PI * sw) : 0,
      sweepX: lerp(0.08 * W, 1.0 * W, sw),
      sweepW: W * 0.11,
      sweepAngle: deg(-12),
    };
    const items = letterItems(t);
    for (const it of items) it.vz = cam.view(it.T)[2];
    items.sort((a, b) => b.vz - a.vz);
    for (const it of items) drawSolid(ctx, cam, E, it, fx);

    drawParticles(ctx, t, 'front', splitZ);
    drawFlashes(ctx, t);
  }

  return { render, cam, letters, routes, logo, samplesFor, get lastSamples() { return lastSamples; } };
}
