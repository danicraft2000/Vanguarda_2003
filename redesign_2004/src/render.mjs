// Renderiza os quadros no Chromium headless (WebGL via SwiftShader).
// Uso: node render.mjs [ids...]   (sem ids = os 20 quadros)
// Variáveis: W, H (resolução de cada quadro; padrão 1600x1200), OUT (pasta; padrão out)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (p.startsWith('..')) throw new Error('fora da raiz');
    const body = await readFile(join(root, p || 'index.html'));
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

const W = process.env.W || 1600, H = process.env.H || 1200, OUT = process.env.OUT || 'out';
await mkdir(join(root, OUT), { recursive: true });
const ids = process.argv.slice(2).map(Number);
const all = ids.length ? ids : [...Array(20).keys()];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
for (const id of all) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${id}]`, m.text()); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html?tile=${id}&w=${W}&h=${H}`);
  await page.waitForFunction(() => window.__done || window.__error, null, { timeout: 600000, polling: 500 });
  const err = await page.evaluate(() => window.__error);
  if (err) { console.log(`quadro ${id} ERRO:`, err); failed++; await page.close(); continue; }
  const url = await page.evaluate(() => window.__result);
  await writeFile(join(root, OUT, `tile_${String(id).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`quadro ${id} ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
