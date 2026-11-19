import { loadFonts, makeRenderer, canvas2d } from './core.js';
import { TILES } from './tiles.js';

const q = new URLSearchParams(location.search);
const id = +q.get('tile');
const W = +(q.get('w') || 1600), H = +(q.get('h') || 1200);
try {
  await loadFonts();
  const renderer = makeRenderer(W, H);
  const post = await TILES[id](renderer, W, H);
  // composição 2D final (overlays: lens flare etc.)
  const [c, x] = canvas2d(W, H);
  x.drawImage(renderer.domElement, 0, 0);
  if (post) post(x, W, H);
  window.__result = c.toDataURL('image/png');
  window.__done = true;
} catch (e) {
  window.__error = String(e && e.stack || e);
}
