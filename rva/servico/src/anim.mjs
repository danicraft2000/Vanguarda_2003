// Timing helpers built on Motion's animation generators.
//
// Motion (motion.dev) exposes its keyframe/spring solvers as pure generators:
// gen.next(ms).value. We sample them at exact frame times, so every frame is
// deterministic and can be rendered in any order / in parallel workers.
import { keyframes, spring, cubicBezier } from 'motion';

export { cubicBezier };

// Named curves (Motion accepts easing functions or names)
export const EASE = {
  glide: cubicBezier(0.45, 0.0, 0.2, 1.0),     // smooth cinematic in/out
  launch: cubicBezier(0.6, 0.0, 0.9, 0.55),    // accelerating
  settle: cubicBezier(0.12, 0.75, 0.25, 1.0),  // fast start, soft landing
  crane: cubicBezier(0.55, 0.05, 0.3, 1.0),
  swing: cubicBezier(0.5, 0.0, 0.15, 1.0),
  flash: cubicBezier(0.05, 0.9, 0.3, 1.0),
};

/** Keyframe track between t0 and t1 (seconds). values: numbers. */
export function track(t0, t1, values, { ease = 'easeInOut', times } = {}) {
  const gen = keyframes({ keyframes: values, times, ease, duration: (t1 - t0) * 1000 });
  const first = values[0], last = values[values.length - 1];
  return (t) => (t <= t0 ? first : t >= t1 ? last : gen.next((t - t0) * 1000).value);
}

/** Vector keyframe track: values are arrays of equal length. */
export function trackN(t0, t1, values, opts = {}) {
  const dims = values[0].length;
  const tr = [];
  for (let d = 0; d < dims; d++) tr.push(track(t0, t1, values.map((v) => v[d]), opts));
  return (t) => tr.map((f) => f(t));
}

/** Physical spring from `from` to `to`, triggered at t0 (seconds). */
export function springAt(t0, from, to, { stiffness = 120, damping = 14, mass = 1, velocity = 0 } = {}) {
  const gen = spring({ keyframes: [from, to], stiffness, damping, mass, velocity });
  return (t) => (t <= t0 ? from : gen.next((t - t0) * 1000).value);
}

/** Sequence of tracks: list of [t0, t1, values, opts] glued together. */
export function chain(...parts) {
  const fs = parts.map(([t0, t1, v, o]) => ({ t0, t1, f: track(t0, t1, v, o) }));
  return (t) => {
    for (let i = fs.length - 1; i >= 0; i--) if (t >= fs[i].t0) return fs[i].f(t);
    return fs[0].f(t);
  };
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// deterministic PRNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
