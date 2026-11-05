// Draws the flat closing composition (2D, no tilt and with tilt) for geometry QA.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';
import { buildLogo } from '../src/logo.mjs';

const [, , out, refPath] = process.argv;
const logo = buildLogo();
console.log(JSON.stringify(logo.info));
const W = 2400, H = 900, S = 150;
const c = createCanvas(W, H); const ctx = c.getContext('2d');
ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, W, H);
function drawLogo(ox, oy, tilt) {
  ctx.save(); ctx.translate(ox, oy); ctx.rotate(-tilt * Math.PI / 180);
  for (const l of logo.letters) {
    ctx.save(); ctx.translate(l.cx * S, -l.cy * S); ctx.rotate(-l.rot * Math.PI / 180);
    ctx.scale(l.scale * S, -l.scale * S); ctx.translate(-l.pivot[0], -l.pivot[1]);
    ctx.beginPath();
    for (const ct of l.shape.contours) { ct.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
    ctx.fillStyle = l.group === 'v' ? '#d81e22' : l.group === 'servico' ? '#f2551f' : '#c9ccd3';
    ctx.globalAlpha = l.group === 'vanguarda' ? 0.9 : 1;
    ctx.fill('nonzero'); ctx.restore();
  }
  ctx.restore();
}
drawLogo(500, 450, 0);
drawLogo(1250, 450, logo.tilt);
if (refPath) {
  const im = await loadImage(fs.readFileSync(refPath));
  const h = 820, w = im.width * h / im.height;
  ctx.drawImage(im, W - w - 20, 40, w, h);
}
fs.writeFileSync(out, c.toBuffer('image/png'));
