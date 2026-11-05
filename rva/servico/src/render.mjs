// Frame renderer.
//
//   node src/render.mjs --preview 0,2.5,4.2 --out build/preview [--scale 0.5]
//       -> PNG/JPEG stills at the given times (seconds)
//   node src/render.mjs --start 0 --end 75 --segment build/seg0.mp4 --progress build/progress/w0.txt
//       -> renders real UHD frames [start, end) and streams raw RGBA into FFmpeg
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { createScene } from './scene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json'), 'utf8'));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);

const W = TL.width, H = TL.height, FPS = TL.fps;
const TOTAL = Math.round(TL.duration * FPS);
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const scene = createScene(TL);

async function preview() {
  const times = String(args.preview).split(',').map(Number);
  const out = args.out || path.join(ROOT, 'build', 'preview');
  const scale = Number(args.scale || 0.5);
  fs.mkdirSync(out, { recursive: true });
  const small = createCanvas(Math.round(W * scale), Math.round(H * scale));
  const sctx = small.getContext('2d');
  for (const t of times) {
    const t0 = performance.now();
    scene.render(ctx, t);
    const ms = performance.now() - t0;
    sctx.drawImage(canvas, 0, 0, small.width, small.height);
    const f = path.join(out, `t${t.toFixed(3).padStart(6, '0')}.jpg`);
    fs.writeFileSync(f, await small.encode('jpeg', 92));
    console.log(`preview t=${t}s  ${ms.toFixed(0)} ms  -> ${f}`);
  }
}

let pipeError = null;
function write(stream, buf) {
  if (pipeError) return Promise.reject(pipeError);
  return new Promise((resolve) => {
    if (stream.write(buf)) resolve();
    else stream.once('drain', resolve);
  });
}

async function segment() {
  const start = Number(args.start || 0);
  const end = Math.min(TOTAL, Number(args.end || TOTAL));
  const seg = args.segment;
  const prog = args.progress;
  fs.mkdirSync(path.dirname(seg), { recursive: true });
  if (prog) fs.mkdirSync(path.dirname(prog), { recursive: true });
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
    '-c:v', 'libx264', '-preset', args.preset || 'slow', '-crf', String(args.crf || 15),
    '-profile:v', 'high', '-level:v', '5.2', '-g', String(FPS), '-keyint_min', String(FPS), '-sc_threshold', '0',
    '-bf', '2', '-threads', String(args.threads || 2),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-x264-params', 'aq-mode=3:deblock=-1,-1',
    seg,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.stdin.on('error', (e) => { pipeError = e; });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)))));
  for (let f = start; f < end; f++) {
    const t = f / FPS;
    scene.render(ctx, t);
    const buf = canvas.data();
    await write(ff.stdin, buf);
    if (prog) fs.writeFileSync(prog, `${f - start + 1} ${end - start}\n`);
  }
  ff.stdin.end();
  await done;
  console.log(`segment ${seg}: frames ${start}..${end - 1} OK`);
}

if (args.preview) await preview();
else if (args.segment) await segment();
else {
  console.error('usage: --preview t1,t2 | --start a --end b --segment out.mp4');
  process.exit(1);
}
