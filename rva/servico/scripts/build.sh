#!/usr/bin/env bash
# RVA — VANGUARDA SERVIÇO: full build (soundtrack -> UHD frames -> MP4 -> QC)
set -euo pipefail
cd "$(dirname "$0")/.."

JOBS="${JOBS:-4}"            # parallel render workers
CHUNK="${CHUNK:-30}"         # frames per worker job (contiguous)
CRF="${CRF:-15}"
OUT="${OUT:-output/VANGUARDA_SERVICO_RVA_UHD_30fps.mp4}"
FPS=$(node -e "console.log(require('./timeline.json').fps)")
TOTAL=$(node -e "const t=require('./timeline.json');console.log(Math.round(t.duration*t.fps))")

mkdir -p build/segments build/progress "$(dirname "$OUT")"
rm -f build/segments/seg_*.mp4 build/progress/p_*.txt

echo "[1/4] trilha original -> build/trilha_servico.wav"
python3 audio/compose.py build/trilha_servico.wav

echo "[2/4] render UHD: $TOTAL quadros @ ${FPS}fps, $JOBS workers"
seq 0 "$CHUNK" $((TOTAL - 1)) | xargs -P "$JOBS" -I{} bash -c '
  s={}; e=$((s + '"$CHUNK"')); id=$(printf %04d "$s")
  node src/render.mjs --start "$s" --end "$e" --crf '"$CRF"' --threads 2 \
    --segment "build/segments/seg_$id.mp4" --progress "build/progress/p_$id.txt"
'

echo "[3/4] montagem + audio -> $OUT"
ls build/segments/seg_*.mp4 | sort | sed "s|^|file '$(pwd)/|; s|$|'|" > build/segments/list.txt
ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i build/segments/list.txt -i build/trilha_servico.wav \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 320k -ar 48000 \
  -metadata title="VANGUARDA SERVIÇO — RVA remake" -metadata comment="Motion design programado (Node + Motion + Skia Canvas + FFmpeg)" \
  -movflags +faststart -t "$(node -e "console.log(require('./timeline.json').duration)")" "$OUT"

echo "[4/4] controle de qualidade"
python3 tools/qc.py "$OUT"
