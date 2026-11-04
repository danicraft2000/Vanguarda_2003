// Tempo, ritmo e curvas de movimento.
// Toda a animação é função pura do número do quadro (render determinístico,
// pode ser dividido em trechos). As curvas vêm do Motion (spring física,
// easings, interpolate), avaliadas no tempo exato de cada quadro.
import { spring, clamp, mix, easeInOut, easeOut, easeIn, cubicBezier, circOut, backOut, interpolate } from 'motion';

export const FPS = 30;
export const BPM = 120;
export const BEAT = (60 / BPM) * FPS; // 15 quadros
export const BAR = BEAT * 4; //          60 quadros
export const TOTAL = 300; //             10 s

export { clamp, mix, interpolate };

export const ease = {
  inOut: easeInOut,
  out: easeOut,
  in: easeIn,
  circOut,
  backOut,
  expoOut: cubicBezier(0.16, 1, 0.3, 1),
  expoIn: cubicBezier(0.7, 0, 0.84, 0),
  expoInOut: cubicBezier(0.87, 0, 0.13, 1),
  quintOut: cubicBezier(0.22, 1, 0.36, 1),
  sineInOut: cubicBezier(0.37, 0, 0.63, 1),
  cubicIn: cubicBezier(0.32, 0, 0.67, 0),
  linear: (t) => t,
};

/** Progresso suavizado 0..1 entre os quadros f0 e f1. */
export function tween(f, f0, f1, e = ease.inOut) {
  return e(clamp(0, 1, (f - f0) / (f1 - f0)));
}

const springs = new Map();
function getSpring({ stiffness = 180, damping = 20, mass = 1 }) {
  const k = `${stiffness}|${damping}|${mass}`;
  let g = springs.get(k);
  if (!g) {
    g = spring({ keyframes: [0, 1], stiffness, damping, mass, restDelta: 0.0002, restSpeed: 0.0005 });
    springs.set(k, g);
  }
  return g;
}

/** Progresso de mola (Motion spring) iniciada no quadro f0; pode passar de 1. */
export function springP(f, f0, params = {}) {
  if (f <= f0) return 0;
  return getSpring(params).next(((f - f0) / FPS) * 1000).value;
}

/** Quadros até a mola cruzar 1 pela primeira vez (para alinhar impactos à batida). */
export function springCross(params = {}) {
  const g = getSpring(params);
  for (let i = 1; i < 400; i++) {
    if (g.next((i / FPS) * 1000).value >= 1) return i;
  }
  return 30;
}

/**
 * Spline de Hermite parametrizada pelo tempo (quadros): continuidade C1,
 * velocidade nas chaves calculada pelas vizinhas. Uma chave pode trazer a
 * tangente explícita (unidades por quadro) como terceiro elemento.
 */
export function timeSpline(keys) {
  const n = keys.length;
  const ts = keys.map((k) => k[0]);
  const vs = keys.map((k) => (Array.isArray(k[1]) ? k[1] : [k[1]]));
  const ms = keys.map((k, i) => {
    if (k[2] !== undefined) return Array.isArray(k[2]) ? k[2] : [k[2]];
    if (i === 0 || i === n - 1) return vs[i].map(() => 0);
    return vs[i].map((_, d) => (vs[i + 1][d] - vs[i - 1][d]) / (ts[i + 1] - ts[i - 1]));
  });
  return (f) => {
    if (f <= ts[0]) return vs[0].map((v, d) => v + ms[0][d] * (f - ts[0]));
    if (f >= ts[n - 1]) return vs[n - 1].map((v, d) => v + ms[n - 1][d] * (f - ts[n - 1]));
    let i = 0;
    while (f > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const t = (f - ts[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return vs[i].map((p0, d) => h00 * p0 + h10 * h * ms[i][d] + h01 * vs[i + 1][d] + h11 * h * ms[i + 1][d]);
  };
}

// ---- aleatoriedade determinística ------------------------------------------
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function rand(seed, a = 0, b = 1) {
  return a + (b - a) * hash(seed);
}
/** Ruído 1D suave (value noise com interpolação quíntica). */
export function noise1(x, seed = 0) {
  const i = Math.floor(x), fr = x - i;
  const u = fr * fr * fr * (fr * (fr * 6 - 15) + 10);
  return mix(hash(i + seed * 57.3), hash(i + 1 + seed * 57.3), u) * 2 - 1;
}
/** Pulso que sobe rápido e decai exponencialmente a partir de f0. */
export function pulse(f, f0, decay = 8, attack = 1.5) {
  if (f < f0) return 0;
  const t = f - f0;
  return (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
}
