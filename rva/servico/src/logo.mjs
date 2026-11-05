// Final logo composition (geometry only).
//
// Proportions measured on the closing composition of the historical ident
// (frame de-rotated ~18-20 deg; averaged over two frames), expressed in units of
// the VANGUARDA cap height H = 1 and of the ink width of the row "GUAR" (Wg):
//
//   rows ............ VAN / GUAR / DA, equal cap height, baseline pitch 1.17 H
//   row "GUAR" ...... leftmost row, reference for the others
//   row "VAN" ....... ink spans 0.41 Wg -> 1.08 Wg   (centre 0.745 Wg)
//   row "DA" ........ ink spans 0.59 Wg -> 1.02 Wg   (centre 0.805 Wg)
//   "SERVIÇO" ....... the V of VAN becomes the (red) V of SERVIÇO
//                     small letters: cap height 0.63 H
//                     "SER" ink ends 0.07 H left of the V (top corner), baseline 0.21 H below VAN baseline
//                     "IÇO" ink starts 0.04 H right of the V, baseline 0.03 H below VAN baseline
//                     -> SERVIÇO baseline climbs ~5 deg more steeply than the rows
//   whole block ..... rotated +18 deg (rows climb to the right)
//
// Nothing else from the original is used: typefaces, materials, lighting,
// scenery and motion are all new.
import { glyphShape, kern } from './glyphs.mjs';

export const GEOM = {
  rowPitch: 1.17,
  vanCenter: 0.745,
  daCenter: 0.805,
  smallCap: 0.63,
  serGap: 0.07,
  serDrop: 0.21,
  icoGap: 0.04,
  icoDrop: 0.03,
  tilt: 18,
  trackBig: -0.045,   // tight setting, letters nearly touching like the reference
  trackSmall: -0.075,
};

function setRow(fontKey, str, track, scale = 1) {
  const letters = [];
  let x = 0;
  for (let i = 0; i < str.length; i++) {
    const shape = glyphShape(fontKey, str[i]);
    letters.push({ ch: str[i], shape, x: x * scale });
    x += shape.advance + track + (i < str.length - 1 ? kern(fontKey, str[i], str[i + 1]) : 0);
  }
  let minX = Infinity, maxX = -Infinity;
  for (const l of letters) {
    minX = Math.min(minX, l.x + l.shape.bounds.minX * scale);
    maxX = Math.max(maxX, l.x + l.shape.bounds.maxX * scale);
  }
  return { letters, minX, maxX, width: maxX - minX };
}

/**
 * Returns the letters of the closing composition with their rest pose in the
 * logo plane (before the global tilt): centre (cx, cy), in-plane rotation (deg),
 * glyph scale, and the pivot (ink centre) in glyph units.
 */
export function buildLogo(G = GEOM) {
  const out = [];
  const big = 'spartan800';
  const small = 'jost600';

  const guar = setRow(big, 'GUAR', G.trackBig);
  const van = setRow(big, 'VAN', G.trackBig);
  const da = setRow(big, 'DA', G.trackBig);
  const Wg = guar.width;
  const rows = [
    { row: 'VAN', r: van, base: 2 * G.rowPitch, centre: G.vanCenter * Wg },
    { row: 'GUAR', r: guar, base: G.rowPitch, centre: 0.5 * Wg },
    { row: 'DA', r: da, base: 0, centre: G.daCenter * Wg },
  ];
  for (const { row, r, base, centre } of rows) {
    const shift = centre - (r.minX + r.width / 2) - guar.minX;
    r.letters.forEach((l, i) => {
      const b = l.shape.bounds;
      const px = (b.minX + b.maxX) / 2, py = (b.minY + b.maxY) / 2;
      out.push({
        id: `${row}${i}`, row, idx: i, ch: l.ch, shape: l.shape, scale: 1,
        cx: l.x + shift + px, cy: base + py, rot: 0, pivot: [px, py],
        group: 'vanguarda',
      });
    });
  }

  // ---- SERVIÇO
  const V = out.find((l) => l.row === 'VAN' && l.ch === 'V');
  V.group = 'v';
  const vb = V.shape.bounds;
  const vLeft = V.cx - (vb.maxX - vb.minX) / 2;
  const vRight = V.cx + (vb.maxX - vb.minX) / 2;
  const vanBase = 2 * G.rowPitch;
  const h = G.smallCap;
  const ser = setRow(small, 'SER', G.trackSmall, h);
  const ico = setRow(small, 'IÇO', G.trackSmall, h);
  // centres of the two small-letter groups on their baselines
  const serRight = vLeft - G.serGap;
  const serLeft = serRight - ser.width;
  const icoLeft = vRight + G.icoGap;
  const serMid = [(serLeft + serRight) / 2, vanBase - G.serDrop];
  const icoMid = [icoLeft + ico.width / 2, vanBase - G.icoDrop];
  const ang = Math.atan2(icoMid[1] - serMid[1], icoMid[0] - serMid[0]);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const place = (grp, x0, baseMid, midX, tag) => {
    grp.letters.forEach((l, i) => {
      const b = l.shape.bounds;
      const px = (b.minX + b.maxX) / 2, py = (b.minY + b.maxY) / 2;
      // position along the baseline (unrotated), then rotate around the group mid point
      const ux = x0 + (l.x - grp.minX) + px * h - midX;
      const uy = py * h;
      out.push({
        id: `${tag}${i}`, row: tag, idx: i, ch: l.ch, shape: l.shape, scale: h,
        cx: baseMid[0] + ux * ca - uy * sa,
        cy: baseMid[1] + ux * sa + uy * ca,
        rot: (ang * 180) / Math.PI, pivot: [px, py],
        group: 'servico',
      });
    });
  };
  place(ser, serLeft, serMid, serMid[0], 'SER');
  place(ico, icoLeft, icoMid, icoMid[0], 'ICO');

  // centre the whole composition (ink bbox, pre-tilt) on the origin
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of out) {
    const b = l.shape.bounds;
    const hw = ((b.maxX - b.minX) / 2) * l.scale, hh = ((b.maxY - b.minY) / 2) * l.scale;
    minX = Math.min(minX, l.cx - hw); maxX = Math.max(maxX, l.cx + hw);
    minY = Math.min(minY, l.cy - hh); maxY = Math.max(maxY, l.cy + hh);
  }
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  for (const l of out) { l.cx -= ox; l.cy -= oy; }
  return {
    letters: out,
    tilt: G.tilt,
    info: { Wg, serAngle: (ang * 180) / Math.PI, bbox: [minX - ox, minY - oy, maxX - ox, maxY - oy] },
  };
}
