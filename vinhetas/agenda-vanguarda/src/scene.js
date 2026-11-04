// AGENDA VANGUARDA — remake RVA (motion design por código)
//
// Roteiro (30 fps, 120 BPM, 1 batida = 15 quadros):
//   0–60    "A grade"     linhas de luz desenham um calendário 7x5 sobre um piso
//                         espelhado; os dias sobem do chão em onda.
//   60–120  "Os dias"     seis dias viram no ritmo, revelando as cores e as letras
//                         A-G-E-N-D-A em pé sobre os ladrilhos.
//   120–175 "Ascensão"    as letras decolam girando e formam a palavra AGENDA;
//                         o calendário despenca na escuridão.
//   175–240 "Vanguarda"   as linhas prata VAN / GUAR / DA chegam (batidas 195,
//                         210, 225) e cada grupo colorido pousa no seu lugar.
//   240–300 "Assinatura"  impacto final, varredura de luz, confete e câmera viva.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { LAYOUT, PALETTE, AGENDA_ORDER } from './layout.js';
import CUES from './cues.json';
import { glyphGeometry, glyphWidth } from './glyphs.js';
import {
  FPS, TOTAL, tween, springP, springCross, timeSpline, ease, mix, clamp, rand, noise1, pulse,
} from './timeline.js';

const RVA = { ready: false };
window.RVA = RVA;

// ---------------------------------------------------------------------------
// constantes do cenário
// ---------------------------------------------------------------------------
const FLOOR_Y = -5.5;
const COLS = 7, ROWS = 5;
const CELL = 1.9, TILE = 1.62, TILE_H = 0.3;
const GRID_Z0 = 1.3; // borda do fundo do calendário
const TILE_CAP = 1.25; // letra em pé sobre o ladrilho
const LINE_CAP = 1.97; // palavra AGENDA em linha (= tamanho final da camada colorida)
const LINE_Y = -0.45, LINE_Z = 3.2;
const FRONT_Z = 0.78; // profundidade da camada colorida na assinatura
const FINAL_CAM_D = 23.4;

// dias especiais (coluna, linha) na ordem A-G-E-N-D-A; cada dia vira de modo
// que a cor e a letra apareçam exatamente na nota do sino (cues.pops)
const SPECIAL = [
  [0, 1], [1, 3], [2, 2], [3, 4], [4, 1], [5, 3],
].map(([col, row], i) => ({ col, row, flip: CUES.pops[i] - CUES.popDelay }));
const LIFT_START = CUES.liftStart;
// pousos: A amarelo com VAN, GEN com GUAR, DA com DA (uma batida cada)
const ROW_IMPACT = CUES.rowImpact;
const HIT = CUES.hit;
const TILE_SPRING = { stiffness: 210, damping: 15 };

let W, H, renderer, composer, scene, camera, bloomPass, finishPass, gl;
const S = {}; // objetos da cena

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp3 = (a, b, t) => a.clone().lerp(b, t);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function radialTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    r.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
}

function prepGeometry(geo) {
  // normais suaves no bisel (laterais), faces frontais/traseiras perfeitamente planas
  const g = geo.clone();
  const capNormals = g.attributes.normal.array.slice();
  toCreasedNormals(g, THREE.MathUtils.degToRad(35));
  const caps = g.groups.find((gr) => gr.materialIndex === 0);
  if (caps) {
    const n = g.attributes.normal.array;
    for (let i = caps.start * 3; i < (caps.start + caps.count) * 3; i++) n[i] = capNormals[i];
    g.attributes.normal.needsUpdate = true;
  }
  return g;
}

// ---------------------------------------------------------------------------
// ambiente (reflexos do metal): estúdio com softboxes e faixas coloridas
// ---------------------------------------------------------------------------
function buildEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 60),
    new THREE.MeshBasicMaterial({ color: 0x07080c, side: THREE.BackSide }),
  ));
  const panel = (w, h, color, k, pos, look = [0, 0, 0]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  panel(26, 7, 0xffffff, 2.6, [0, 14, 8]); //          softbox superior
  panel(4, 22, 0xffffff, 2.4, [-26, 3, 6]); //        faixa esquerda
  panel(4, 22, 0xe4ecff, 1.8, [26, 2, 0]); //         faixa direita
  // gradiente frontal suave (o que as faces frontais refletem): claro embaixo
  // à esquerda, escuro em cima à direita, com uma linha de horizonte cromada
  const grad = canvasTexture(512, 512, (g, w, h) => {
    const lg = g.createLinearGradient(0, h, w * 0.7, 0);
    lg.addColorStop(0, '#b4bccb');
    lg.addColorStop(0.4, '#7a8293');
    lg.addColorStop(0.5, '#e2e8f4');
    lg.addColorStop(0.54, '#555d6c');
    lg.addColorStop(1, '#262b36');
    g.fillStyle = lg;
    g.fillRect(0, 0, w, h);
  });
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 34),
    new THREE.MeshBasicMaterial({ map: grad, color: new THREE.Color(2.3, 2.3, 2.3), side: THREE.DoubleSide }),
  );
  front.position.set(0, 0, 29);
  front.lookAt(0, 0, 0);
  env.add(front);
  panel(12, 10, 0x8fb0ff, 0.9, [0, 6, -28]); //       contraluz frio
  const accents = [0xf4b62e, 0xe24a8d, 0x2c8fd6, 0xf2741f, 0x45b84a, 0x9a55d6];
  accents.forEach((c, i) => {
    const a = (i / accents.length) * Math.PI * 2 + 0.4;
    panel(5, 1.6, c, 1.6, [Math.cos(a) * 27, -3 + (i % 2) * 2, Math.sin(a) * 27]);
  });
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.025).texture;
  pm.dispose();
  return tex;
}

// ---------------------------------------------------------------------------
// fundo: cúpula em gradiente + brilho + bokeh + grade de parede
// ---------------------------------------------------------------------------
function buildBackground() {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(300, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uGlow: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uGlow; uniform float uTime;
        void main(){
          float h = vDir.y;
          vec3 zen = vec3(0.0012, 0.0014, 0.0032);
          vec3 hor = vec3(0.0060, 0.0078, 0.0190);
          vec3 gnd = vec3(0.0008, 0.0008, 0.0018);
          vec3 c = h > 0.0 ? mix(hor, zen, smoothstep(0.0, 0.55, h)) : mix(hor, gnd, smoothstep(0.0, -0.25, h));
          // brilho atrás da marca (direção -z)
          float g = max(dot(vDir, normalize(vec3(0.0, 0.03, -1.0))), 0.0);
          c += vec3(0.006, 0.008, 0.022) * pow(g, 10.0) * uGlow;
          c += vec3(0.004, 0.002, 0.007) * pow(g, 3.0) * uGlow;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);
  S.dome = dome;

  // halo atrás da composição
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 40),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uK: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uK;
        void main(){
          vec2 d = (vUv - 0.5) * vec2(1.4, 1.0);
          float r = length(d);
          vec3 c = vec3(0.007, 0.010, 0.030) * exp(-r * r * 9.0) + vec3(0.004, 0.002, 0.007) * exp(-r * r * 3.0);
          gl_FragColor = vec4(c * uK, 1.0);
        }`,
    }),
  );
  halo.position.set(0, 0, -7);
  scene.add(halo);
  S.halo = halo;

  // grade de calendário na parede do fundo (motivo sutil para preencher o 16:9)
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uK: { value: 0 }, uShift: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uK; uniform float uShift;
        void main(){
          vec2 p = (vUv - 0.5) * vec2(120.0, 64.0);
          vec2 q = p + vec2(uShift, 0.0);
          vec2 cell = abs(fract(q / 3.4 + 0.5) - 0.5) * 3.4;
          float line = 1.0 - smoothstep(0.015, 0.05, min(cell.x, cell.y));
          vec2 id = floor(q / 3.4 + 0.5);
          float tw = fract(sin(dot(id, vec2(41.3, 289.1))) * 43758.5);
          float dot_ = (1.0 - smoothstep(0.08, 0.16, length(cell - vec2(0.55, 0.55)))) * step(0.82, tw);
          float edge = smoothstep(5.0, 22.0, abs(p.x)) * (1.0 - smoothstep(18.0, 30.0, length(p * vec2(0.6, 1.0))));
          float fadeY = 1.0 - smoothstep(10.0, 24.0, abs(p.y));
          vec3 c = vec3(0.30, 0.36, 0.75) * line * 0.022 + vec3(0.9, 0.7, 1.0) * dot_ * 0.05;
          gl_FragColor = vec4(c * edge * fadeY * uK, 1.0);
        }`,
    }),
  );
  wall.position.set(0, 0, -16);
  scene.add(wall);
  S.wall = wall;

  // bokeh distante nas cores da AGENDA
  const tex = radialTexture();
  S.bokeh = [];
  const cols = AGENDA_ORDER.map((k) => PALETTE[k]).concat([0x8aa4ff, 0xffffff]);
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      color: new THREE.Color(cols[i % cols.length]),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    const side = i % 2 ? 1 : -1;
    m.userData = {
      base: v3(side * rand(i * 3.1, 14, 48), rand(i * 5.7, -20, 20), rand(i * 7.9, -60, -32)),
      size: rand(i * 2.3, 3, 9),
      k: rand(i * 9.1, 0.05, 0.16),
      ph: rand(i * 4.4, 0, 6.28),
    };
    scene.add(m);
    S.bokeh.push(m);
  }
}

// ---------------------------------------------------------------------------
// piso espelhado + calendário
// ---------------------------------------------------------------------------
function cellCenter(c, r) {
  return v3(-((COLS - 1) / 2) * CELL + c * CELL, 0, GRID_Z0 + CELL / 2 + r * CELL);
}

function numberTexture(text, dim) {
  return canvasTexture(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.font = '700 74px Inter, "DejaVu Sans", sans-serif';
    g.textBaseline = 'top';
    g.fillStyle = dim ? 'rgba(150,160,190,0.55)' : 'rgba(236,240,255,0.95)';
    g.fillText(text, 26, 22);
    // pequena barra de "evento" (detalhe gráfico)
    g.fillStyle = dim ? 'rgba(150,160,190,0.18)' : 'rgba(236,240,255,0.22)';
    g.fillRect(26, 200, 120, 10);
    g.fillRect(26, 220, 70, 10);
  });
}

function buildFloorAndCalendar() {
  const floor = new THREE.Group();
  floor.position.y = FLOOR_Y;
  scene.add(floor);
  S.floor = floor;

  // poça de luz suave sob o calendário (o palco já existe no primeiro quadro)
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 26),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uK: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uK;
        void main(){
          vec2 d = (vUv - 0.5) * vec2(1.0, 1.25);
          float r = length(d);
          vec3 c = vec3(0.020, 0.028, 0.070) * exp(-r * r * 7.0) + vec3(0.010, 0.006, 0.018) * exp(-r * r * 2.0);
          gl_FragColor = vec4(c * uK, 1.0);
        }`,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.008, GRID_Z0 + (ROWS * CELL) / 2);
  floor.add(pool);
  S.pool = pool;

  const mirror = new Reflector(new THREE.PlaneGeometry(220, 220), {
    textureWidth: Math.round(W / 2),
    textureHeight: Math.round(H / 2),
    color: 0x9aa0ad,
    clipBias: 0.002,
  });
  mirror.rotation.x = -Math.PI / 2;
  floor.add(mirror);
  S.mirror = mirror;

  const dimMat = new THREE.MeshBasicMaterial({
    color: 0x05060a, transparent: true, opacity: 0.8,
  });
  const dimPlane = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), dimMat);
  dimPlane.rotation.x = -Math.PI / 2;
  dimPlane.position.y = 0.003;
  floor.add(dimPlane);
  S.dimMat = dimMat;

  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.55 }));
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.006;
  shadowPlane.receiveShadow = true;
  floor.add(shadowPlane);

  // --- linhas de luz da grade -------------------------------------------
  const lineMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.55, 0.68, 1.0).multiplyScalar(2.4),
    transparent: true,
    depthWrite: false,
  });
  S.lineMat = lineMat;
  const lineGeo = new THREE.BoxGeometry(1, 0.012, 0.035);
  const tipTex = radialTexture();
  S.lines = [];
  const x0 = -(COLS / 2) * CELL, z0 = GRID_Z0;
  const lenX = COLS * CELL, lenZ = ROWS * CELL;
  for (let j = 0; j <= ROWS; j++) {
    S.lines.push({ axis: 'x', start: v3(x0, 0.012, z0 + j * CELL), len: lenX, t0: j * 4 - 8, dir: j % 2 ? -1 : 1 });
  }
  for (let i = 0; i <= COLS; i++) {
    S.lines.push({ axis: 'z', start: v3(x0 + i * CELL, 0.012, z0), len: lenZ, t0: i * 3 - 3, dir: i % 2 ? -1 : 1 });
  }
  for (const L of S.lines) {
    L.mesh = new THREE.Mesh(lineGeo, lineMat);
    L.tip = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tipTex, color: 0xcfe0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    floor.add(L.mesh, L.tip);
  }

  // --- ladrilhos (dias) ---------------------------------------------------
  const graphite = new THREE.MeshPhysicalMaterial({
    color: 0x2a2e38, roughness: 0.42, metalness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.24, envMapIntensity: 0.3,
  });
  const tileGeo = new RoundedBoxGeometry(TILE, TILE_H, TILE, 4, 0.07);
  const halfGeo = new RoundedBoxGeometry(TILE, TILE_H / 2, TILE, 4, 0.06);
  const numGeo = new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94);
  S.tiles = [];
  const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = r * COLS + c;
      let label, dim = false;
      if (cell < 2) { label = String(30 + cell); dim = true; } else if (cell <= 32) label = String(cell - 1);
      else { label = String(cell - 32); dim = true; }
      const sp = SPECIAL.findIndex((s) => s.col === c && s.row === r);
      const g = new THREE.Group();
      const base = cellCenter(c, r);
      g.position.copy(base);
      let colorMat = null;
      if (sp >= 0) {
        const top = new THREE.Mesh(halfGeo, graphite);
        top.position.y = TILE_H / 4;
        const color = PALETTE[AGENDA_ORDER[sp]];
        colorMat = new THREE.MeshPhysicalMaterial({
          color, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08,
          emissive: new THREE.Color(color), emissiveIntensity: 0,
        });
        const bottom = new THREE.Mesh(halfGeo, colorMat);
        bottom.position.y = -TILE_H / 4;
        for (const m of [top, bottom]) { m.castShadow = true; m.receiveShadow = true; }
        g.add(top, bottom);
      } else {
        const m = new THREE.Mesh(tileGeo, graphite);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      const num = new THREE.Mesh(numGeo, new THREE.MeshBasicMaterial({
        map: numberTexture(label, dim), transparent: true, depthWrite: false,
      }));
      num.rotation.x = -Math.PI / 2;
      num.position.y = TILE_H / 2 + 0.004;
      g.add(num);
      floor.add(g);
      S.tiles.push({ g, c, r, base, sp, colorMat, seed: cell + 1 });
    }
  }
  // cabeçalho com os dias da semana
  S.weekdays = [];
  weekdays.forEach((d, c) => {
    const tex = canvasTexture(128, 128, (g, w) => {
      g.font = '700 70px Inter, "DejaVu Sans", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = c === 0 ? 'rgba(255,170,190,1)' : 'rgba(205,220,255,1)';
      g.fillText(d, w / 2, w / 2 + 4);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.4, 1.4, 1.4),
    }));
    m.rotation.x = -Math.PI / 2;
    const p = cellCenter(c, 0);
    m.position.set(p.x, 0.01, GRID_Z0 - 0.55);
    floor.add(m);
    S.weekdays.push(m);
  });
}

// ---------------------------------------------------------------------------
// letras
// ---------------------------------------------------------------------------
// "shine": faixa de luz diagonal que percorre as letras, calculada no próprio
// shader do material (mais forte nos biséis), sem estourar as faces
const SHINE = {
  uShine: { value: -100 },
  uShineK: { value: 0 },
  uShineW: { value: 1.25 },
  uShineDir: { value: new THREE.Vector2(0.92, 0.39) },
  uShineColor: { value: new THREE.Color(1.0, 0.96, 0.9) },
};
function addShine(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SHINE);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShineW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvShineW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vShineW;
        uniform float uShine, uShineK, uShineW; uniform vec2 uShineDir; uniform vec3 uShineColor;`)
      .replace('#include <opaque_fragment>', `{
          float sd = dot(vShineW.xy, uShineDir) - uShine;
          float band = exp(-sd * sd / (uShineW * uShineW));
          float edge = 1.0 - abs(normalize(normal).z);
          outgoingLight += uShineColor * band * uShineK * (0.22 + 1.3 * edge);
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

function buildLetters() {
  const silverFace = addShine(new THREE.MeshPhysicalMaterial({
    color: 0xc2c8d2, metalness: 1, roughness: 0.24, envMapIntensity: 1.0,
  }));
  const silverSide = addShine(new THREE.MeshPhysicalMaterial({
    color: 0x7d8592, metalness: 1, roughness: 0.32, envMapIntensity: 0.95,
  }));
  S.silverFace = silverFace;
  S.silver = [];
  S.colored = [];

  const finalK = (FINAL_CAM_D - FRONT_Z) / FINAL_CAM_D; // compensação de perspectiva

  for (const L of LAYOUT) {
    if (L.layer === 'silver') {
      const { geometry } = glyphGeometry(L.ch, { cap: L.cap, depth: 0.62, bevel: 0.07 });
      const mesh = new THREE.Mesh(prepGeometry(geometry), [silverFace, silverSide]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const row = L.y > 2 ? 'VAN' : L.y > -2.2 ? 'GUAR' : 'DA';
      mesh.userData = { L, row, final: v3(L.x, L.y, 0) };
      scene.add(mesh);
      S.silver.push(mesh);
    } else {
      const color = new THREE.Color(PALETTE[L.color]);
      const face = addShine(new THREE.MeshPhysicalMaterial({
        color, metalness: 0.05, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.85,
        emissive: color.clone(), emissiveIntensity: 0,
      }));
      const side = addShine(new THREE.MeshPhysicalMaterial({
        color: color.clone().multiplyScalar(0.62), metalness: 0.1, roughness: 0.32, clearcoat: 0.6,
        envMapIntensity: 0.7,
      }));
      // geometria em unidade (altura 1), escalada conforme a fase
      const { geometry } = glyphGeometry(L.ch, { cap: 1, depth: 0.16, bevel: 0.03 });
      const mesh = new THREE.Mesh(prepGeometry(geometry), [face, side]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const idx = AGENDA_ORDER.indexOf(L.color);
      const isBigA = L.color === 'yellow';
      const z = isBigA ? 0.0 : FRONT_Z;
      const k = isBigA ? 1 : finalK;
      mesh.userData = {
        L, idx, face,
        group: isBigA ? 'VAN' : L.y > -0.6 ? 'GUAR' : 'DA',
        final: v3(L.x * k, L.y * k, z),
        finalCap: L.cap * k,
      };
      scene.add(mesh);
      S.colored[idx] = mesh;
    }
  }

  // posições da palavra AGENDA em linha
  const widths = S.colored.map((m) => glyphWidth(m.userData.L.ch) * LINE_CAP);
  const gap = 0.2;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  let x = -total / 2;
  const kern = S.colored.map((m, i) => (i > 0 && m.userData.L.ch === 'A' ? -0.3 * LINE_CAP : 0));
  x -= kern.reduce((a, b) => a + b, 0) / 2;
  S.colored.forEach((m, i) => {
    x += kern[i];
    m.userData.line = v3(x + widths[i] / 2, LINE_Y, LINE_Z);
    x += widths[i] + gap;
    const sp = SPECIAL[i];
    const c = cellCenter(sp.col, sp.row);
    m.userData.tile = v3(c.x, FLOOR_Y + TILE_H + TILE_CAP / 2 + 0.02, c.z);
  });
}

// ---------------------------------------------------------------------------
// confete (partículas analíticas, determinísticas)
// ---------------------------------------------------------------------------
function buildConfetti() {
  const N = 250;
  const geo = new THREE.PlaneGeometry(1, 0.62);
  const mat = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide, roughness: 0.35, metalness: 0.25, envMapIntensity: 1.2,
    emissive: 0xffffff, emissiveIntensity: 0.18,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const P = [];
  const col = new THREE.Color();
  // rajadas nas viradas dos dias
  SPECIAL.forEach((sp, i) => {
    const c = cellCenter(sp.col, sp.row);
    for (let k = 0; k < 22; k++) {
      const s = i * 100 + k;
      const a = rand(s * 1.7, 0, Math.PI * 2);
      const sp_ = rand(s * 2.3, 1.2, 3.4);
      P.push({
        t0: sp.flip + 7 + rand(s * 3.1, 0, 3),
        life: rand(s * 5.3, 30, 48),
        p0: v3(c.x, FLOOR_Y + TILE_H + 0.1, c.z),
        v0: v3(Math.cos(a) * sp_, rand(s * 7.7, 4.5, 8), Math.sin(a) * sp_),
        g: -11, drag: 1.4, size: rand(s * 4.1, 0.08, 0.16),
        color: PALETTE[AGENDA_ORDER[i]], spin: v3(rand(s, -9, 9), rand(s * 1.1, -9, 9), rand(s * 1.3, -9, 9)),
      });
    }
  });
  // rajada final atrás da marca
  const hitCount = N - P.length;
  for (let k = 0; k < hitCount; k++) {
    const s = 9000 + k;
    const a = rand(s * 1.9, 0, Math.PI * 2);
    const r = rand(s * 2.9, 3.5, 6.5);
    const p0 = v3(Math.cos(a) * r * 1.15, Math.sin(a) * r * 0.85, rand(s * 3.3, -1.5, 0.5));
    const out = p0.clone().setZ(0).normalize();
    const speed = rand(s * 4.7, 2.5, 7.5);
    P.push({
      t0: HIT - 1 + rand(s * 5.9, 0, 4),
      life: rand(s * 6.1, 70, 110),
      p0,
      v0: v3(out.x * speed, out.y * speed + 1.2, rand(s * 7.1, 1.5, 5.5)),
      g: -1.1, drag: 1.25, size: rand(s * 8.3, 0.07, 0.15),
      color: PALETTE[AGENDA_ORDER[k % 6]], spin: v3(rand(s, -6, 6), rand(s * 1.1, -6, 6), rand(s * 1.3, -6, 6)),
    });
  }
  P.forEach((p, i) => mesh.setColorAt(i, col.set(p.color)));
  S.confetti = { mesh, P };
}

function updateConfetti(f) {
  const { mesh, P } = S.confetti;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = v3();
  const sc = v3();
  P.forEach((p, i) => {
    const t = (f - p.t0) / FPS;
    if (t < 0 || f - p.t0 > p.life) {
      m.makeScale(0, 0, 0);
      mesh.setMatrixAt(i, m);
      return;
    }
    const k = p.drag;
    const ek = (1 - Math.exp(-k * t)) / k;
    pos.copy(p.p0).addScaledVector(p.v0, ek);
    pos.y += p.g * (t / k - ek / k);
    // leve flutuação
    pos.x += noise1(t * 1.3, i) * 0.15 * t;
    e.set(p.spin.x * t, p.spin.y * t, p.spin.z * t);
    q.setFromEuler(e);
    const lifeK = (f - p.t0) / p.life;
    const s = p.size * Math.min(1, (f - p.t0) / 3) * (1 - Math.pow(lifeK, 3));
    sc.set(s, s, s);
    m.compose(pos, q, sc);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// luzes
// ---------------------------------------------------------------------------
function buildLights() {
  const key = new THREE.DirectionalLight(0xfff0e2, 2.4);
  key.position.set(-7, 13, 15);
  key.target.position.set(0, -2, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  const sc = key.shadow.camera;
  sc.left = -15; sc.right = 15; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 60;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  S.key = key;

  const rim = new THREE.DirectionalLight(0x9fc0ff, 2.2);
  rim.position.set(9, 7, -12);
  scene.add(rim);
  S.rim = rim;

  const fill = new THREE.DirectionalLight(0xc8d4ff, 0.5);
  fill.position.set(10, -3, 14);
  scene.add(fill);
  S.fill = fill;

  const warmRim = new THREE.DirectionalLight(0xff9ec8, 0);
  warmRim.position.set(-12, 2, -9);
  scene.add(warmRim);
  S.warmRim = warmRim;

  scene.add(new THREE.HemisphereLight(0x5a6890, 0x05060a, 0.25));

  const sweep = new THREE.PointLight(0xffffff, 0, 16, 1.6);
  scene.add(sweep);
  S.sweep = sweep;

  const flash = new THREE.PointLight(0xffffff, 0, 9, 1.8);
  scene.add(flash);
  S.flash = flash;
}

// ---------------------------------------------------------------------------
// câmera
// ---------------------------------------------------------------------------
function buildCamera() {
  camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 600);
  const p8 = [0.9, -0.4, FINAL_CAM_D];
  const p9 = [0.7, -0.3, 22.75];
  const t8 = [0.12, 0, 0];
  const t9 = [0.09, 0, 0];
  const dv = (a, b, n) => a.map((v, i) => (b[i] - v) / n);
  S.camPos = timeSpline([
    [0, [-10.8, 4.6, 19.4], [0.09, -0.06, -0.035]],
    [45, [-6.6, 1.1, 17.6]],
    [80, [-4.4, 0.3, 20.0]],
    [108, [2.2, -1.5, 18.0]],
    [132, [2.4, -1.9, 18.2]],
    [152, [0.6, -0.65, 18.4]],
    [176, [0.15, -0.25, 21.0]],
    [202, [-1.7, 0.8, 25.6]],
    [HIT, p8, dv(p8, p9, 60)],
    [TOTAL, p9, dv(p8, p9, 60)],
  ]);
  S.camTgt = timeSpline([
    [0, [-0.6, -5.5, 5.6]],
    [45, [0.0, -5.5, 6.0]],
    [80, [-0.9, -5.3, 5.6]],
    [108, [-0.1, -4.9, 5.4]],
    [132, [0.3, -2.9, 3.7]],
    [152, [0.0, -0.5, 3.0]],
    [176, [0.0, -0.3, 1.6]],
    [202, [0.0, 0.1, 0.0]],
    [HIT, t8, dv(t8, t9, 60)],
    [TOTAL, t9, dv(t8, t9, 60)],
  ]);
  S.camFov = timeSpline([
    [0, 40], [60, 37], [110, 36], [150, 32], [200, 30], [HIT, 28], [TOTAL, 28],
  ]);
  S.camRoll = timeSpline([[0, -0.05], [60, 0.0], [108, 0.035], [150, 0], [200, -0.01], [HIT, 0], [TOTAL, 0]]);
}

function updateCamera(f) {
  const p = S.camPos(f), t = S.camTgt(f);
  // micro-flutuação orgânica (handheld muito sutil), menor no fim
  const amp = mix(0.05, 0.012, tween(f, 170, 240));
  camera.position.set(
    p[0] + noise1(f / 40, 1) * amp,
    p[1] + noise1(f / 45, 2) * amp,
    p[2],
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(t[0] + noise1(f / 50, 3) * amp * 0.5, t[1] + noise1(f / 55, 4) * amp * 0.5, t[2]);
  camera.rotateZ(S.camRoll(f)[0]);
  camera.fov = S.camFov(f)[0];
  camera.updateProjectionMatrix();
  S.dome.position.copy(camera.position);
}

// ---------------------------------------------------------------------------
// pós-processamento
// ---------------------------------------------------------------------------
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVig: { value: 0.42 },
    uGrain: { value: 0.008 },
    uCA: { value: 0.0012 },
    uFlash: { value: 0 },
    uFade: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uCA, uFlash, uFade; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uCA * r2 * 4.0;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float v = smoothstep(0.92, 0.25, length(d * vec2(1.0, 0.78)));
      c *= mix(1.0 - uVig, 1.0, v);
      c += uFlash * vec3(0.95, 0.97, 1.0) * (0.35 + 0.65 * v);
      float g = hash(vUv * uRes + fract(uTime * 0.6180339) * 331.0) - 0.5;
      c += g * uGrain;
      gl_FragColor = vec4(c * uFade, 1.0);
    }`,
};

// remove valores não finitos (NaN/Inf) e limita o HDR antes do bloom:
// um único pixel inválido seria espalhado pelo bloom e escureceria o quadro
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 40 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = any(isnan(c.rgb)) || any(isinf(c.rgb)) || !(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b);
      vec3 rgb = bad ? vec3(0.0) : clamp(c.rgb, vec3(0.0), vec3(uMax));
      gl_FragColor = vec4(rgb, 1.0);
    }`,
};

function buildComposer(samples) {
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SanitizeShader));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.55, 0.86);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  finishPass = new ShaderPass(FinishShader);
  finishPass.uniforms.uRes.value.set(W, H);
  composer.addPass(finishPass);
}

// ---------------------------------------------------------------------------
// atualização por quadro
// ---------------------------------------------------------------------------
function updateCalendar(f) {
  // linhas de luz
  const lineFade = 1 - tween(f, 118, 150, ease.inOut);
  S.lineMat.opacity = lineFade;
  for (const L of S.lines) {
    const p = tween(f, L.t0, L.t0 + 28, ease.expoOut);
    const len = Math.max(0.0001, L.len * p);
    const m = L.mesh;
    const along = L.dir > 0 ? len / 2 : L.len - len / 2;
    const tipAlong = L.dir > 0 ? len : L.len - len;
    if (L.axis === 'x') {
      m.scale.set(len, 1, 1);
      m.position.set(L.start.x + along, L.start.y, L.start.z);
      L.tip.position.set(L.start.x + tipAlong, 0.05, L.start.z);
    } else {
      m.scale.set(1, 1, 1);
      m.rotation.y = Math.PI / 2;
      m.scale.x = len;
      m.position.set(L.start.x, L.start.y, L.start.z + along);
      L.tip.position.set(L.start.x, 0.05, L.start.z + tipAlong);
    }
    m.visible = p > 0.0005 && lineFade > 0.001;
    const tipK = p > 0 ? (1 - tween(f, L.t0 + 14, L.t0 + 30)) : 0;
    L.tip.material.opacity = tipK;
    L.tip.scale.setScalar(0.9 + 0.4 * tipK);
    L.tip.visible = tipK > 0.01;
  }
  for (const [i, m] of S.weekdays.entries()) {
    m.material.opacity = tween(f, 26 + i * 2, 40 + i * 2) * lineFade;
  }

  // ladrilhos
  for (const T of S.tiles) {
    const { g, c, r, base, sp } = T;
    // cada diagonal pousa numa semicolcheia (marimba da trilha)
    const wave = c + (ROWS - 1 - r);
    const t0 = CUES.tileWave.start + wave * CUES.tileWave.step - springCross(TILE_SPRING);
    const p = springP(f, t0, TILE_SPRING);
    let y = -TILE_H / 2 - 0.06 + p * (TILE_H + 0.06);
    let rx = 0, rz = (1 - Math.min(p, 1)) * 0.25 * (c % 2 ? 1 : -1);
    if (sp >= 0) {
      const { flip } = SPECIAL[sp];
      const fp = springP(f, flip, { stiffness: 120, damping: 12 });
      const jp = clamp(0, 1, (f - flip) / 16);
      y += 4 * jp * (1 - jp) * 1.15;
      rx = Math.PI * fp;
      const k = pulse(f, flip + 9, 10, 1.2);
      T.colorMat.emissiveIntensity = 2.6 * k + 0.12 * tween(f, flip + 8, flip + 14);
    }
    // queda do calendário
    const fall = tween(f, 128 + rand(T.seed * 3.3, 0, 18), 190 + rand(T.seed * 1.7, 0, 12), ease.cubicIn);
    y -= fall * 26;
    rx += fall * rand(T.seed * 4.1, -2.5, 2.5);
    rz += fall * rand(T.seed * 5.7, -2.5, 2.5);
    g.position.set(base.x, y, base.z + fall * rand(T.seed * 6.1, -3, 3));
    g.rotation.set(rx, 0, rz);
    g.visible = p > 0.0001 && fall < 0.999;
  }
  // piso some para baixo (fica escondido pelo fog/escuridão)
  const drop = tween(f, 134, 188, ease.cubicIn);
  S.floor.position.y = FLOOR_Y - drop * 30;
  S.floor.visible = drop < 0.999;
  S.dimMat.opacity = 0.8 + drop * 0.2;
}

function updateLetters(f) {
  // ---- AGENDA colorida ---------------------------------------------------
  S.colored.forEach((m, i) => {
    const u = m.userData;
    const sp = SPECIAL[i];
    const pop = springP(f, sp.flip + 9, { stiffness: 260, damping: 14 });
    let pos, cap, rotY = 0, rotX = 0, rotZ = 0;
    // fase 1: em pé sobre o ladrilho
    const tilePos = u.tile.clone();
    tilePos.y += (pop - 1) * (TILE_CAP / 2);
    cap = TILE_CAP * Math.max(0, pop);
    rotY = -0.35 * (1 - Math.min(pop, 1)) + noise1(f / 30, 10 + i) * 0.08;
    pos = tilePos;

    // fase 2: decolagem até a linha AGENDA
    const liftF = LIFT_START + i * 3;
    const q = springP(f, liftF, { stiffness: 58, damping: 11.5 });
    if (f > liftF) {
      const qc = Math.min(q, 1);
      pos = lerp3(u.tile, u.line, q);
      pos.y += Math.sin(Math.PI * qc) * 1.1;
      pos.z += Math.sin(Math.PI * qc) * 1.6;
      cap = mix(TILE_CAP, LINE_CAP, q);
      rotY = Math.PI * 2 * q + noise1(f / 30, 10 + i) * 0.08 * (1 - qc);
    }
    // ondulação na batida 165 (acento musical que percorre a palavra)
    const rip = pulse(f, CUES.ripple.start + i * CUES.ripple.step - 2, 5, 1.2);
    cap *= 1 + 0.1 * rip;
    pos.y += 0.22 * rip;
    // flutuação na linha
    const bob = tween(f, 150, 162);
    pos.y += Math.sin((f - 150) * 0.16 + i * 0.95) * 0.07 * bob;
    rotZ += Math.sin((f - 150) * 0.11 + i * 1.3) * 0.025 * bob;

    // fase 3: pouso na assinatura, junto da linha prata correspondente
    const impact = ROW_IMPACT[u.group];
    const landParams = { stiffness: 95, damping: 13 };
    const cross = springCross(landParams);
    const stagger = u.group === 'GUAR' ? (i - 1) * 2 : u.group === 'DA' ? (i - 4) * 2 : 0;
    const landF = impact - cross + stagger;
    const r = springP(f, landF, landParams);
    if (f > landF) {
      const rc = Math.min(r, 1);
      const from = pos.clone();
      pos = lerp3(from, u.final, r);
      pos.z += Math.sin(Math.PI * rc) * (u.group === 'VAN' ? 2.2 : 1.4);
      cap = mix(cap, u.finalCap, r);
      if (u.group === 'VAN') rotY += Math.PI * 2 * rc; //               A amarelo gira
      else if (u.group === 'GUAR') rotX += -Math.PI * 2 * rc; //       GEN cambalhota
      else rotZ += Math.sin(Math.PI * rc) * 0.5 * (i === 4 ? -1 : 1); // DA balança
      rotZ *= 1 - rc;
    }
    m.position.copy(pos);
    m.scale.setScalar(Math.max(cap, 0.0001));
    m.rotation.set(rotX, rotY, rotZ);
    m.visible = cap > 0.002;
    // brilho ao pousar
    u.face.emissiveIntensity = 0.9 * pulse(f, impact + stagger, 9, 1) + 0.6 * pulse(f, HIT, 14, 1.5);
  });

  // ---- VANGUARDA prata -----------------------------------------------------
  const rows = {
    VAN: { params: { stiffness: 70, damping: 13.5 }, off: v3(-24, 9, -10), rot: [0.15, -1.25, 0.25] },
    GUAR: { params: { stiffness: 70, damping: 13.5 }, off: v3(26, -3, -12), rot: [0.35, 1.3, -0.1] },
    DA: { params: { stiffness: 80, damping: 14 }, off: v3(2, -16, -4), rot: [-1.45, 0.25, 0] },
  };
  for (const [j, m] of S.silver.entries()) {
    const u = m.userData;
    const R = rows[u.row];
    const cross = springCross(R.params);
    const k = u.row === 'VAN' ? (j === 0 ? 0 : 3) : u.row === 'GUAR' ? (j - 3) * 2 : (j - 7) * 3;
    const startF = ROW_IMPACT[u.row] - cross + k;
    const p = springP(f, startF, R.params);
    const pc = Math.min(p, 1);
    const pos = u.final.clone().addScaledVector(R.off, 1 - p);
    pos.z += Math.sin(Math.PI * pc) * 0.0;
    m.position.copy(pos);
    m.rotation.set(R.rot[0] * (1 - p), R.rot[1] * (1 - p), R.rot[2] * (1 - p));
    m.visible = f > startF;
  }
}

function updateLightsAndLook(f) {
  // fog: denso sobre o piso, some antes da assinatura
  scene.fog.density = mix(0.03, 0.0, tween(f, 120, 185));
  // contraluz quente aparece na assinatura
  S.warmRim.intensity = 1.4 * tween(f, 175, 230);
  S.rim.intensity = mix(0.55, 2.6, tween(f, 120, 220));
  S.key.intensity = mix(2.4, 2.1, tween(f, 150, 240));
  // flash colorido nas viradas
  let best = null;
  SPECIAL.forEach((sp, i) => {
    if (f >= sp.flip + 7) best = i;
  });
  if (best !== null && f < 125) {
    const sp = SPECIAL[best];
    const c = cellCenter(sp.col, sp.row);
    S.flash.color.set(PALETTE[AGENDA_ORDER[best]]);
    S.flash.position.set(c.x, FLOOR_Y + 1.2, c.z);
    S.flash.intensity = 40 * pulse(f, sp.flip + 8, 9, 1.2);
  } else {
    S.flash.intensity = 0;
  }
  // shine: na palavra AGENDA, no impacto final e um segundo, lento, até o fim
  const sweeps = [
    { f0: CUES.agenda - 2, f1: CUES.agenda + 22, a: -10, b: 10, k: 1.1, w: 1.1 },
    { f0: HIT - 2, f1: HIT + 24, a: -9.5, b: 9.5, k: 1.35, w: 1.35 },
    { f0: CUES.sweep2, f1: TOTAL + 10, a: 9.5, b: -9.5, k: 0.7, w: 1.6 },
  ];
  SHINE.uShineK.value = 0;
  SHINE.uShine.value = -100;
  for (const sw of sweeps) {
    if (f >= sw.f0 && f <= sw.f1) {
      const q = tween(f, sw.f0, sw.f1, ease.sineInOut);
      SHINE.uShine.value = mix(sw.a, sw.b, q);
      SHINE.uShineK.value = sw.k * Math.sin(Math.PI * clamp(0, 1, (f - sw.f0) / (sw.f1 - sw.f0)));
      SHINE.uShineW.value = sw.w;
    }
  }
  S.sweep.intensity = 0;
  // fundo
  const glow = tween(f, 150, 230) + 0.35 * pulse(f, HIT, 20, 2);
  S.dome.material.uniforms.uGlow.value = glow;
  S.halo.material.uniforms.uK.value = tween(f, 165, 235) * (1 + 0.15 * Math.sin(f * 0.07)) + 0.4 * pulse(f, HIT, 16, 2);
  S.wall.material.uniforms.uK.value = tween(f, 170, 240);
  S.wall.material.uniforms.uShift.value = f * 0.012;
  for (const b of S.bokeh) {
    const u = b.userData;
    b.position.set(u.base.x + Math.sin(f * 0.01 + u.ph) * 1.5, u.base.y + Math.cos(f * 0.013 + u.ph) * 1.0 + f * 0.01, u.base.z);
    b.scale.setScalar(u.size);
    b.material.opacity = u.k * (0.25 + 0.75 * tween(f, 120, 220)) * (0.85 + 0.15 * Math.sin(f * 0.05 + u.ph));
  }
  // pós
  bloomPass.strength = 0.5 + 0.35 * pulse(f, HIT, 10, 1.2);
  finishPass.uniforms.uFlash.value = 0.07 * pulse(f, HIT, 6, 0.8);
  finishPass.uniforms.uTime.value = f;
  // entrada suave nos 6 primeiros quadros (sem tela preta: a cena já existe no quadro 0)
  finishPass.uniforms.uFade.value = mix(0.55, 1, tween(f, 0, 6, ease.out));
}

function update(f) {
  updateCamera(f);
  updateCalendar(f);
  updateLetters(f);
  updateConfetti(f);
  updateLightsAndLook(f);
  if (S.flashOff) S.flash.intensity = 0;
  for (const l of [S.flash, S.sweep, S.warmRim]) l.visible = l.intensity > 0.001;
}

// ---------------------------------------------------------------------------
// API usada pelo render.mjs
// ---------------------------------------------------------------------------
RVA.init = async (w, h, samples = 4) => {
  W = w;
  H = h;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  gl = renderer.getContext();

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070a16, 0.03);
  scene.environment = buildEnvironment();
  buildCamera();
  buildBackground();
  buildLights();
  buildFloorAndCalendar();
  buildLetters();
  buildConfetti();
  buildComposer(samples);
  // aquece shaders
  update(0);
  composer.render();
  return { w: W, h: H, max: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
};

const PX = [];
let inflight = Promise.resolve();
let nframe = 0;
RVA.frame = async (f) => {
  const t0 = performance.now();
  update(f);
  composer.render();
  const k = nframe++ % 2;
  if (!PX[k]) PX[k] = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, PX[k]);
  const t1 = performance.now();
  await inflight; // garante a ordem dos quadros
  const t2 = performance.now();
  inflight = fetch(`/frame?i=${f}`, { method: 'POST', body: PX[k] });
  return { render: t1 - t0, wait: t2 - t1 };
};
RVA.inspect = (f) => {
  update(f);
  const bad = [];
  scene.traverse((o) => {
    const e = o.matrixWorld.elements;
    o.updateMatrixWorld();
    if (o.matrixWorld.elements.some((v) => !Number.isFinite(v))) bad.push(o.type + ':' + (o.name || o.id));
    if (o.isLight && !Number.isFinite(o.intensity)) bad.push('light ' + o.type);
    if (o.material && !Array.isArray(o.material) && o.material.emissiveIntensity !== undefined && !Number.isFinite(o.material.emissiveIntensity)) bad.push('emi ' + o.id);
  });
  return { cam: camera.position.toArray(), fov: camera.fov, bad: bad.slice(0, 20), nbad: bad.length };
};
// caixas (em pixels) de cada letra da assinatura, para conferir as proporções
RVA.projectBoxes = (f) => {
  update(f);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const out = [];
  const meshes = [...S.silver, ...S.colored];
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.z < -1e-4 * m.scale.x) continue; // só a face frontal (e o bisel da frente)
      v.applyMatrix4(m.matrixWorld).project(camera);
      const px = (v.x * 0.5 + 0.5) * W, py = (1 - (v.y * 0.5 + 0.5)) * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const L = m.userData.L;
    out.push({ ch: L.ch, layer: L.layer, color: L.color, id: L.id, box: [x0, y0, x1, y1] });
  }
  return out;
};
RVA.flush = async () => {
  await inflight;
  return true;
};

// variações para medir custo
RVA.debug = (o) => {
  if ('shadow' in o) renderer.shadowMap.enabled = o.shadow;
  if ('bloom' in o) bloomPass.enabled = o.bloom;
  if ('mirror' in o) S.mirror.visible = o.mirror;
  if ('confetti' in o) S.confetti.mesh.visible = o.confetti;
  if ('flash' in o) S.flashOff = !o.flash;
  if ('tiles' in o) S.tiles.forEach((t) => (t.g.visible = o.tiles));
  if ('letters' in o) S.colored.forEach((m) => (m.visible = o.letters));
  if ('measure' in o) {
    if (o.update !== false) update(o.measure);
    for (const [k, v] of Object.entries(o.after || {})) RVA.debug({ [k]: v });
    composer.render();
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    return sum / (W * H * 3);
  }
  if ('shadowSize' in o) { S.key.shadow.mapSize.set(o.shadowSize, o.shadowSize); S.key.shadow.map?.dispose(); S.key.shadow.map = null; }
};

RVA.ready = true;
