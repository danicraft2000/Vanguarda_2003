#!/usr/bin/env bash
# prints "<frames rendered> <total>" summed over all render workers
cd "$(dirname "$0")/.."
TOTAL=$(node -e "const t=require('./timeline.json');console.log(Math.round(t.duration*t.fps))")
done=$(cat build/progress/p_*.txt 2>/dev/null | awk '{s+=$1} END {print s+0}')
echo "$done $TOTAL"
