#!/usr/bin/env bash
# Pipeline completo: trilha -> render UHD em trechos -> concatenação -> mux -> QC.
# Retomável: trechos já renderizados são reaproveitados.
#
#   ./build.sh                 # UHD 3840x2160, 30 fps
#   W=1920 H=1080 ./build.sh   # prévia rápida
set -euo pipefail
cd "$(dirname "$0")"

W=${W:-3840}
H=${H:-2160}
SEG=${SEG:-50}
TOTAL=300
NAME=${NAME:-agenda_vanguarda_rva_${H}p30}
OUT=out
mkdir -p "$OUT/seg_${H}"

echo "== trilha"
python3 audio/compose.py "$OUT/agenda_trilha.wav"

echo "== render ${W}x${H}"
: > "$OUT/seg_${H}/list.txt"
for ((s = 0; s < TOTAL; s += SEG)); do
  e=$((s + SEG < TOTAL ? s + SEG : TOTAL))
  f=$(printf "seg_%03d_%03d.mp4" "$s" "$e")
  if [[ ! -s "$OUT/seg_${H}/$f" ]]; then
    node render.mjs --start "$s" --end "$e" --width "$W" --height "$H" --crf 16 --out "$OUT/seg_${H}/$f.tmp.mp4"
    mv "$OUT/seg_${H}/$f.tmp.mp4" "$OUT/seg_${H}/$f"
  fi
  echo "file '$f'" >> "$OUT/seg_${H}/list.txt"
done

echo "== mux"
ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$OUT/seg_${H}/list.txt" -i "$OUT/agenda_trilha.wav" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 320k -ar 48000 \
  -metadata title="Agenda Vanguarda — remake RVA" -metadata comment="RVA — Remaking Vintage Archives. Motion design por código (Three.js + Motion + FFmpeg)." \
  -movflags +faststart -shortest "$OUT/$NAME.mp4"

echo "== QC"
python3 qc.py "$OUT/$NAME.mp4"
