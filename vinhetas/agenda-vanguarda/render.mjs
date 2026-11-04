// Renderizador quadro a quadro: Three.js + Motion rodando no Chromium headless,
// pixels lidos do WebGL e enviados (RGBA cru) para o FFmpeg.
//
// Uso:
//   node render.mjs --still 240 --width 1920 --height 1080 --out out/still.png
//   node render.mjs --start 0 --end 300 --out out/seg.mp4      (UHD por padrão)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function args() {
  const a = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
      o[k] = v;
    }
  }
  return o;
}

const opt = args();
const W = Number(opt.width ?? 3840);
const H = Number(opt.height ?? 2160);
const FPS = 30;
const stills = opt.still ? String(opt.still).split(',').map(Number) : null;
const start = Number(opt.start ?? 0);
const end = Number(opt.end ?? 300); // exclusivo
const out = path.resolve(opt.out ?? (stills ? 'out/still.png' : 'out/segment.mp4'));
const samples = Number(opt.samples ?? 4);
const crf = String(opt.crf ?? 14);

await mkdir(path.dirname(out), { recursive: true });

// ---- bundle da cena ---------------------------------------------------------
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/scene.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(ROOT, 'build/scene.bundle.js'),
  logLevel: 'warning',
});

// ---- saída (ffmpeg) ---------------------------------------------------------
function spawnFfmpeg(target, isStill) {
  const common = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-'];
  const a = isStill
    ? [...common, '-vf', 'vflip', '-frames:v', '1', target]
    : [...common,
      '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-profile:v', 'high', '-level:v', '5.1',
      '-x264-params', 'keyint=30:min-keyint=30:scenecut=0',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', target];
  const p = spawn('ffmpeg', a, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
  return { p, done };
}

let video = stills || opt.boxes ? null : spawnFfmpeg(out, false);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url.startsWith('/frame')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length !== W * H * 4) throw new Error(`frame size ${buf.length}`);
      if (stills) {
        const fi = Number(new URL(req.url, 'http://x').searchParams.get('i'));
        const target = stills.length > 1 ? out.replace(/(\.\w+)$/, `_${String(fi).padStart(3, '0')}$1`) : out;
        const s = spawnFfmpeg(target, true);
        s.p.stdin.end(buf);
        await s.done;
      } else if (!video.p.stdin.write(buf)) {
        await new Promise((r) => video.p.stdin.once('drain', r));
      }
      res.end('ok');
      return;
    }
    const file = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
    const data = await readFile(path.join(ROOT, file));
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(data);
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--disable-gpu-driver-bug-workarounds', '--js-flags=--max-old-space-size=8192'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', (m) => {
  const t = m.text();
  if (!/GPU stall|Automatic fallback/.test(t)) console.log('[page]', t);
});
page.on('pageerror', (e) => console.error('[page error]', e));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.RVA && window.RVA.ready === true, null, { timeout: 120000 });
await page.evaluate(([w, h, s]) => window.RVA.init(w, h, s), [W, H, samples]);

if (opt.boxes) {
  // exporta as caixas projetadas das letras (QC de geometria) e sai
  const boxes = await page.evaluate((f) => window.RVA.projectBoxes(f), Number(opt.boxes));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(out, JSON.stringify({ frame: Number(opt.boxes), width: W, height: H, boxes }, null, 1));
  await browser.close();
  server.close();
  console.log('ok ->', out);
  process.exit(0);
}

const frames = stills ?? Array.from({ length: end - start }, (_, i) => start + i);
const t0 = Date.now();
for (const [k, f] of frames.entries()) {
  const t = Date.now();
  await page.evaluate((i) => window.RVA.frame(i), f);
  const el = (Date.now() - t0) / 1000;
  const eta = (el / (k + 1)) * (frames.length - k - 1);
  process.stdout.write(`frame ${f} (${k + 1}/${frames.length}) ${(Date.now() - t) / 1000}s  eta ${eta.toFixed(0)}s\n`);
}

await page.evaluate(() => window.RVA.flush());
await browser.close();
if (video) {
  video.p.stdin.end();
  await video.done;
}
server.close();
console.log('ok ->', out);
