#!/usr/bin/env bash
# Generates the two branded Maintain Roofing videos with Higgsfield Seedance
# and stitches them with the designed end cards.
#
# Usage:   bash generate-and-stitch.sh
# Env:     MODEL=seedance_2_0 (default) | seedance_2_0_mini | seedance1_5
#          RES=1080p (default) | 720p | 4k
#
# Requires: higgsfield CLI (authed, workspace with Seedance access), ffmpeg, curl.
# Cost note: seedance_2_0 @1080p/15s = 135 credits per segment, 3 segments total.
set -euo pipefail
cd "$(dirname "$0")"

MODEL="${MODEL:-seedance_2_0}"
RES="${RES:-1080p}"
REF="tradie-reference-branded.png"
mkdir -p out

gen() { # name prompt-file duration
  local name=$1 prompt_file=$2 dur=$3
  if [ -s "out/$name.mp4" ]; then echo "== $name already exists, skipping"; return; fi
  echo "== generating $name ($MODEL, $RES, ${dur}s)"
  higgsfield generate create "$MODEL" \
    --prompt "$(cat "prompts/$prompt_file")" \
    --start-image "$REF" \
    --duration "$dur" --aspect_ratio 16:9 --resolution "$RES" --mode std \
    --wait --wait-timeout 45m --json > "out/$name.json"
  local url
  url=$(grep -o '"result_url": *"[^"]*"' "out/$name.json" | head -1 | sed 's/.*: *"//; s/"$//')
  [ -n "$url" ] || { echo "!! no result_url for $name — see out/$name.json"; exit 1; }
  curl -sL -o "out/$name.mp4" "$url"
}

gen video1-segA video1-segA.txt 15
gen video1-segB video1-segB.txt 15
gen video2-take video2-thankyou.txt 15

card() { # png-in mp4-out
  ffmpeg -y -loop 1 -t 4 -i "$1" -f lavfi -t 4 -i anullsrc=r=48000:cl=stereo \
    -vf "scale=1920:1080,fade=t=in:st=0:d=0.4" -c:v libx264 -pix_fmt yuv420p \
    -c:a aac -shortest "$2"
}
card endcards/endcard-why-choose-me.png out/card1.mp4
card endcards/endcard-thank-you.png out/card2.mp4

stitch() { # out-file inputs...
  local outf=$1; shift
  local inputs=() fc="" maps="" n=0
  for f in "$@"; do
    inputs+=(-i "$f")
    fc+="[$n:v]scale=1920:1080,fps=25,format=yuv420p[v$n];[$n:a]aresample=48000[a$n];"
    maps+="[v$n][a$n]"
    n=$((n+1))
  done
  ffmpeg -y "${inputs[@]}" -filter_complex "$fc${maps}concat=n=$n:v=1:a=1[v][a]" \
    -map "[v]" -map "[a]" -c:v libx264 -crf 18 -c:a aac -b:a 192k "$outf"
}
stitch video1-why-choose-me.mp4 out/video1-segA.mp4 out/video1-segB.mp4 out/card1.mp4
stitch video2-thank-you.mp4    out/video2-take.mp4  out/card2.mp4

echo "Done:"
echo "  video1-why-choose-me.mp4 (~34s: two 15s takes + 4s end card)"
echo "  video2-thank-you.mp4     (~19s: 15s take + 4s end card)"
