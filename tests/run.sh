#!/bin/bash
# Testseiten headless in Firefox laden und Ergebnis als Screenshot speichern.
# Aufruf: ./tests/run.sh tests/engine.html [hash] [height]
set -e
PAGE="${1:?Testseite angeben}"
HASH="${2:-}"
H="${3:-1400}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${TMPDIR:-/tmp/opencode}"
NAME="$(basename "$PAGE" .html)"
OUT="$BASE/test-$NAME.png"
PROFILE="$BASE/ff-$$"
mkdir -p "$PROFILE"
rm -f "$OUT"
firefox --headless --profile "$PROFILE" --screenshot "$OUT" \
  --window-size "1100,$H" "file://$DIR/$PAGE$HASH" >/dev/null 2>&1
rm -rf "$PROFILE"
echo "$OUT"
