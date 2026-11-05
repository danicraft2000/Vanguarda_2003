# RVA — Remaking Vintage Archives · **VANGUARDA SERVIÇO**

Remake da vinheta *Vanguarda Serviço* feito **inteiramente por código** (motion design
programado). Nenhuma cena, objeto, enquadramento ou áudio da vinheta histórica foi
reutilizado: da referência foi usada **somente a geometria da composição final da marca**.

| Entrega | |
|---|---|
| Arquivo | `output/VANGUARDA_SERVICO_RVA_UHD_30fps.mp4` |
| Vídeo | H.264 High, 3840×2160 (UHD), 16:9, 30 fps, yuv420p BT.709 |
| Áudio | AAC 320 kb/s, 48 kHz estéreo — trilha original sintetizada |
| Duração | 10,0 s (300 quadros reais renderizados) |
| QC | `output/qc_report.md` |

## Conceito — “a rede que chega a cada ponto”

Uma identidade visual nova, pensada para *serviço*: um mapa luminoso visto de perto.

| Tempo | Música (120 BPM) | Imagem |
|---|---|---|
| 0–2 s | pad Dmaj9 + arpejo | câmera rasante sobre um piso-mapa de pontos; pulsos coral partem **a cada tempo** pelas ruas, com ondas no ponto de partida; um farol pulsa no destino |
| 2–4 s | entra o groove, riser | grua sobe até a vista aérea; feixes de luz nascem do chão **em colcheias**; as rotas convergem para o hub e desenham as letras em luz |
| 4–6 s | 3 acordes de impacto, rufo | flash do hub; **VAN (4,0 s), GUAR (4,5 s), DA (5,0 s)** se levantam do mapa com física de mola enquanto a câmera gira para a vista frontal |
| 6–7 s | impacto + sinos | a energia sobe do chão até o V, que **acende em vermelho** (onda de choque); **SERVIÇO cresce a partir do V**: R+I (6,25), E+Ç (6,5), S+O (6,75) |
| 8–10 s | Dmaj9 final + brilho | pulso no acorde final, varredura de luz sobre as letras, câmera em lento *push-in* contínuo (sem quadro congelado) |

## Composição final (única referência usada)

Medida em dois quadros do encerramento histórico, desrotacionados (~18–20°), em unidades
da altura de maiúscula **H** e da largura de tinta da linha GUAR (**Wg**) — ver `src/logo.mjs`:

* linhas **VAN / GUAR / DA**, mesma altura, passo de linha 1,17 H;
* GUAR à esquerda; **VAN** centrado em 0,745 Wg; **DA** centrado em 0,805 Wg;
* o **V** de VAN é o V vermelho de SERVIÇO;
* letras menores com 0,63 H; “SER” termina 0,07 H à esquerda do V, base 0,21 H abaixo;
  “IÇO” começa 0,04 H à direita do V, base 0,03 H abaixo (linha de base ~4° mais íngreme);
* bloco inteiro inclinado +18°.

As letras nunca são esticadas ou comprimidas — só posicionadas, giradas e extrudadas.
Tipografia livre (SIL OFL 1.1): **League Spartan ExtraBold** (VANGUARDA) e **Jost SemiBold** (SERVIÇO).

## Como funciona

```
timeline.json        tempos/cues compartilhados por áudio e vídeo (sincronia por construção)
audio/compose.py     trilha original: síntese aditiva/FM, ruído filtrado, reverb por convolução
src/anim.mjs         animação com Motion (motion.dev): keyframes, molas físicas, curvas
src/logo.mjs         geometria da composição final
src/glyphs.mjs       contornos das fontes (opentype.js) -> polígonos
src/math3d.mjs       câmera perspectiva em software
src/render3d.mjs     sólidos extrudados, iluminação Blinn-Phong + fresnel, bisel, varredura
src/scene.mjs        a cena: mapa, rotas, feixes, letras, ignição, partículas, bloom, grão
src/render.mjs       renderiza quadros RGBA 4K reais e envia para o FFmpeg
scripts/build.sh     pipeline completo (paralelo) + montagem + QC
tools/qc.py          controle de qualidade automático
```

* **Motion** gera todos os movimentos: os geradores `spring()` e `keyframes()` são
  amostrados no tempo exato de cada quadro (determinístico, renderizável em paralelo).
* **Canvas/Skia** (`@napi-rs/canvas`) desenha cada quadro em 3840×2160: letras 3D
  extrudadas com ordenação por profundidade, *bloom* em duas escalas, vinheta e grão.
* **Motion blur real**: cada quadro acumula de 1 a 12 subquadros (obturador 180°),
  escolhidos automaticamente pela velocidade em tela da câmera e das letras.
* **FFmpeg** recebe os quadros brutos, codifica em H.264 e une com a trilha.

## Reproduzir

```bash
npm install
pip install numpy scipy
npm run build          # = bash scripts/build.sh  (JOBS=4 CHUNK=30 CRF=15)
# prévias:  node src/render.mjs --preview 2.5,6.1,9.0 --out build/preview --scale 0.5
```
