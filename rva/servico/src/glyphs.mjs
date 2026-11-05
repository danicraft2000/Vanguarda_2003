// Glyph outlines -> flattened 2D contours (cap height normalised to 1, y up).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(HERE, '..', 'node_modules', '@expo-google-fonts');

export const FONTS = {
  // VANGUARDA: geometric, wide, heavy (SIL OFL 1.1)
  spartan800: path.join(NM, 'league-spartan', '800ExtraBold', 'LeagueSpartan_800ExtraBold.ttf'),
  // SERVIÇO: geometric with circular bowls (SIL OFL 1.1)
  jost600: path.join(NM, 'jost', '600SemiBold', 'Jost_600SemiBold.ttf'),
  jost700: path.join(NM, 'jost', '700Bold', 'Jost_700Bold.ttf'),
};

const cache = new Map();
export function loadFont(key) {
  if (!cache.has(key)) {
    const buf = fs.readFileSync(FONTS[key]);
    cache.set(key, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return cache.get(key);
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Flatten an opentype path into contours of [x,y] with y up and cap height = 1.
function flatten(cmds, scale, steps) {
  const contours = [];
  let cur = null, px = 0, py = 0;
  const P = (x, y) => [x * scale, -y * scale];
  for (const c of cmds) {
    if (c.type === 'M') { cur = [P(c.x, c.y)]; contours.push(cur); px = c.x; py = c.y; }
    else if (c.type === 'L') { cur.push(P(c.x, c.y)); px = c.x; py = c.y; }
    else if (c.type === 'Q') {
      const L = Math.hypot(c.x - px, c.y - py) * scale;
      const n = Math.max(3, Math.ceil(L * steps));
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        cur.push(P(mt * mt * px + 2 * mt * t * c.x1 + t * t * c.x, mt * mt * py + 2 * mt * t * c.y1 + t * t * c.y));
      }
      px = c.x; py = c.y;
    } else if (c.type === 'C') {
      const L = Math.hypot(c.x - px, c.y - py) * scale;
      const n = Math.max(4, Math.ceil(L * steps * 1.3));
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        const a = mt * mt * mt, b = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
        cur.push(P(a * px + b * c.x1 + d * c.x2 + e * c.x, a * py + b * c.y1 + d * c.y2 + e * c.y));
      }
      px = c.x; py = c.y;
    } else if (c.type === 'Z') { cur = null; }
  }
  // drop duplicate closing points and degenerate contours
  return contours
    .map((pts) => {
      const out = [];
      for (const p of pts) {
        const q = out[out.length - 1];
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5) out.push(p);
      }
      const f = out[0], l = out[out.length - 1];
      if (out.length > 2 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-5) out.pop();
      return out;
    })
    .filter((c) => c.length >= 3);
}

/**
 * Build a glyph shape: contours (cap height = 1), ink bounds, advance width.
 * Every contour gets an `outwardSign` so side walls can be lit with outward normals.
 */
export function glyphShape(fontKey, ch, steps = 28) {
  const font = loadFont(fontKey);
  const capH = font.tables.os2.sCapHeight;
  const scale = 1 / capH;
  const g = font.charToGlyph(ch);
  const p = g.getPath(0, 0, font.unitsPerEm);
  // opentype getPath uses fontSize -> units: scale = fontSize/unitsPerEm = 1, y flipped
  const contours = flatten(p.commands, scale, steps).map((pts) => ({ pts, area: signedArea(pts) }));
  // The winding of the largest contour defines "solid on the right" vs "solid on the left".
  let big = contours[0];
  for (const c of contours) if (Math.abs(c.area) > Math.abs(big.area)) big = c;
  const outerSign = Math.sign(big.area) || 1;
  for (const c of contours) {
    // A contour with the same winding as the outer one is solid-inside; opposite winding = hole.
    c.hole = Math.sign(c.area) !== outerSign;
    // Fonts keep the solid on the same side of every contour (outer and holes wind opposite),
    // so one sign works for all: outward normal of edge d=(dx,dy) is outerSign*(dy,-dx).
    c.nSign = outerSign;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of contours) for (const [x, y] of c.pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return {
    ch, fontKey, contours,
    bounds: { minX, maxX, minY, maxY },
    advance: g.advanceWidth * scale,
    font,
  };
}

export function kern(fontKey, a, b) {
  const font = loadFont(fontKey);
  const capH = font.tables.os2.sCapHeight;
  return font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)) / capH;
}
