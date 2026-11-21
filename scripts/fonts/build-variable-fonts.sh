#!/usr/bin/env bash
# Rebuilds the bundled Fraunces and Recursive woff2 files in public/fonts/.
# Needs fonttools with brotli: python3 -m pip install 'fonttools[woff]'
# The web service worker caches fonts by URL: bump CACHE_VERSION in public/sw.js
# when a rebuild changes these files.
set -euo pipefail
# Fixed head.modified timestamp so a rebuild is byte-identical.
export SOURCE_DATE_EPOCH=1767225600

FONTS_COMMIT=06bfe0d62a98375cb09c942fa18e68bd32cff057
BASE="https://raw.githubusercontent.com/google/fonts/${FONTS_COMMIT}/ofl"
# Same Latin range as the Inter and JetBrains Mono @font-face rules.
UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"

repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="$repo/public/fonts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { curl -fsSL "$BASE/$1" -o "$work/$2"; }
fetch 'fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf' fraunces.ttf
fetch 'fraunces/Fraunces-Italic%5BSOFT,WONK,opsz,wght%5D.ttf' fraunces-italic.ttf
fetch 'recursive/Recursive%5BCASL,CRSV,MONO,slnt,wght%5D.ttf' recursive.ttf
fetch 'fraunces/OFL.txt' Fraunces-OFL.txt
fetch 'recursive/OFL.txt' Recursive-OFL.txt

instance_and_subset() {
  local src="$1" dest="$2" features="$3"; shift 3
  fonttools varLib.instancer "$work/$src" "$@" -o "$work/instanced-$src"
  pyftsubset "$work/instanced-$src" --unicodes="$UNICODES" --no-hinting \
    --layout-features+="$features" --flavor=woff2 --output-file="$out/$dest"
}

for style in '' -italic; do
  instance_and_subset "fraunces$style.ttf" "fraunces-latin-variable$style.woff2" case \
    opsz=144 wght=340:520 SOFT=40:100 WONK=0:1
done
instance_and_subset recursive.ttf recursive-latin-variable.woff2 case,zero,pnum \
  MONO=0:1 CASL=0:1 wght=420:720 slnt=-15:0 CRSV=0:1

cp "$work/Fraunces-OFL.txt" "$work/Recursive-OFL.txt" "$out/"
