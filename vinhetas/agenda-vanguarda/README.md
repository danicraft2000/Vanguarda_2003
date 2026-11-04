# AGENDA VANGUARDA — remake RVA

**RVA — Remaking Vintage Archives** · vinheta independente nº 1 · motion design programado por código.

| | |
|---|---|
| Arquivo final | `output/agenda_vanguarda_rva_2160p30.mp4` |
| Vídeo | H.264 High 5.1, 3840×2160 (UHD), 16:9, 30 fps, 300 quadros (10,0 s), BT.709 |
| Áudio | AAC 320 kb/s, 48 kHz, estéreo — trilha original sintetizada (`audio/compose.py`) |
| Ferramentas | JavaScript, [Three.js](https://threejs.org) (WebGL/Canvas), [Motion](https://motion.dev) (molas e curvas), SVG/Canvas, Python + NumPy/SciPy (trilha), FFmpeg (codificação e QC) |

Nada foi feito em Blender, After Effects ou Cinema 4D: cada quadro é calculado
pelo código no Chromium headless (WebGL), lido pixel a pixel e entregue ao FFmpeg.

## O que foi reaproveitado da vinheta histórica

**Somente a geometria da composição final da logo**: a pilha VAN / GUAR / DA em
prata, com A-G-E-N-D-A colorido sobreposto (o A amarelo no lugar do A de VAN,
em tamanho cheio; GEN e DA menores, à frente). As medidas foram tiradas do
último quadro da referência e estão em `src/layout.js` (centro, linha de base
e altura de cada letra). Os glifos foram redesenhados em código (`src/glyphs.js`)
respeitando as proporções medidas — inclusive o A e o V assimétricos, com uma
haste vertical e um traço diagonal. Escala sempre uniforme: nada esticado ou
comprimido.

A animação, os cenários, a câmera, a iluminação e a música são inteiramente
novos. A vinheta original usava faixas de luz coloridas varrendo uma logo
parada; aqui a ideia é outra: **um calendário**.

Verificação numérica (`qc_geometry.py`, quadro 270): erro médio de **0,54 %**
da altura da composição entre as caixas das letras renderizadas e as medidas
da referência (máx. 2,3 %); proporção largura/altura 1,165 vs 1,178; composição
centralizada (49,7 % / 50,1 %) ocupando 83 % da altura do quadro.

## Roteiro (30 fps · 120 BPM · 1 batida = 15 quadros)

| Quadros | Tempo | Ato | Imagem | Música |
|---|---|---|---|---|
| 0–60 | 0–2 s | **A grade** | Linhas de luz desenham um calendário 7×5 (com D S T Q Q S S) sobre um piso espelhado; os dias sobem do chão em onda diagonal, com mola. | Pad Emaj9, tique-taque de relógio, um ping de vidro por linha, uma nota de marimba por diagonal que pousa. |
| 60–120 | 2–4 s | **Os dias** | Seis dias saltam e viram no ritmo, revelando as cores e as letras A-G-E-N-D-A em pé sobre os ladrilhos; confete e luz da cor de cada dia. | Groove; um sino FM em cada virada (quadros 67,5 · 75 · 90 · 97,5 · 105 · 112,5). |
| 120–175 | 4–5,8 s | **Ascensão** | As letras decolam girando 360° e formam a palavra AGENDA; o calendário despenca na escuridão; reflexo corre pela palavra e uma ondulação a percorre. | Riser na decolagem, acorde de metais em "AGENDA" (5,0 s), arpejo na ondulação (5,5 s). |
| 175–240 | 5,8–8 s | **Vanguarda** | VAN chega pela esquerda (6,5 s), GUAR pela direita (7,0 s), DA de baixo (7,5 s); em cada batida o grupo colorido correspondente pousa no seu lugar (A gira, GEN dá uma cambalhota, DA balança). | vi–IV–V (C#m, A, B) com tons e sub nos pousos, rufo de caixa. |
| 240–300 | 8–10 s | **Assinatura** | Impacto final (8,0 s): varredura de luz, confete, contraluz; câmera continua um *push-in* lento e um segundo reflexo atravessa a marca até o último quadro. | I (E add9) com prato e sub; brilho no segundo reflexo (8,75 s); cauda até 10 s. |

Os pontos de sincronia ficam em um único arquivo, `src/cues.json`, lido pela
cena **e** pela trilha — a música e a imagem não podem sair de fase.

## Estrutura

```
src/cues.json     pontos de sincronia (quadros)
src/layout.js     composição final medida na referência
src/glyphs.js     glifos geométricos desenhados em código (Shape -> extrusão com bisel)
src/timeline.js   tempo, molas e easings do Motion, spline de câmera, ruído determinístico
src/scene.js      cena Three.js: calendário, letras, confete, luzes, câmera, pós-processamento
render.mjs        servidor local + Chromium headless + leitura de pixels -> FFmpeg
audio/compose.py  trilha original (síntese: osciladores, FM, ruído filtrado, reverb por convolução)
build.sh          pipeline completo (trilha -> render UHD em trechos -> mux -> QC)
qc.py             controle de qualidade do MP4
qc_geometry.py    comparação da composição final com a referência
```

Toda a animação é **função pura do número do quadro** (molas do Motion avaliadas
no tempo exato, partículas analíticas, aleatoriedade com semente), então o
render pode ser dividido em trechos e retomado sem diferenças.

## Como renderizar

```bash
npm install          # three, motion, esbuild (Playwright/Chromium já disponível no ambiente)
pip install numpy scipy
./build.sh                   # UHD final: out/agenda_vanguarda_rva_2160p30.mp4 (+ QC)
W=1920 H=1080 ./build.sh     # prévia rápida
node render.mjs --still 240 --width 1920 --height 1080 --out out/still.png   # um quadro
```

## Controle de qualidade

`qc.py` confere formato, resolução (UHD ≤ x ≤ 8K, 16:9), 30 fps, duração,
decodificação completa sem erros, ausência de tela preta (`blackdetect`) e de
quadros congelados (`freezedetect` + diferença quadro a quadro no encerramento),
sincronia da trilha nos cues e gera uma folha de contato. O relatório do render
final está em `output/QC.txt`.
