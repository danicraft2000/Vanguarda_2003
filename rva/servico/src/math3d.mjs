// Minimal 3D math for the software camera (right-handed, y up, camera looks down -z).

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const deg = (d) => (d * Math.PI) / 180;

// 3x3 rotation matrices stored row-major as flat arrays
export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function mm(A, B) {
  const R = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  }
  return R;
}
export const mv = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];
export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Euler (degrees) applied in order Z (roll) -> X (pitch) -> Y (yaw) as world rotation
export function euler(rx = 0, ry = 0, rz = 0) {
  return mm(rotY(deg(ry)), mm(rotX(deg(rx)), rotZ(deg(rz))));
}

export class Camera {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.set([0, 0, 10], [0, 0, 0], 35, 0);
  }
  // fov: vertical field of view in degrees; roll in degrees
  set(pos, target, fov, roll = 0) {
    this.pos = pos;
    const f = norm(sub(target, pos));
    let r = norm(cross(f, [0, 1, 0]));
    if (!isFinite(r[0]) || len(cross(f, [0, 1, 0])) < 1e-6) r = [1, 0, 0];
    let u = cross(r, f);
    if (roll) {
      const c = Math.cos(deg(roll)), s = Math.sin(deg(roll));
      const r2 = add(mul(r, c), mul(u, s));
      const u2 = add(mul(u, c), mul(r, -s));
      r = r2; u = u2;
    }
    this.f = f; this.r = r; this.u = u;
    this.fov = fov;
    this.focal = (this.H / 2) / Math.tan(deg(fov) / 2);
    this.near = 0.05;
  }
  // world -> view (x right, y up, z forward distance)
  view(p) {
    const d = sub(p, this.pos);
    return [dot(d, this.r), dot(d, this.u), dot(d, this.f)];
  }
  // view -> screen. returns [sx, sy, depth]
  proj(v) {
    const z = Math.max(v[2], this.near);
    return [this.W / 2 + (v[0] * this.focal) / z, this.H / 2 - (v[1] * this.focal) / z, v[2]];
  }
  project(p) { return this.proj(this.view(p)); }
  // pixel size of a world-length l at view depth z
  scaleAt(z) { return this.focal / Math.max(z, this.near); }
}
