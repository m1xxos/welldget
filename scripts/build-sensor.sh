#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$DIR/electron/bin"

echo "Compiling desk-sensor for macOS..."
clang -O2 \
  -framework Foundation \
  -framework IOKit \
  "$DIR/electron/native/desk-sensor.m" \
  -o "$DIR/electron/bin/desk-sensor"

chmod +x "$DIR/electron/bin/desk-sensor"
echo "desk-sensor successfully built at $DIR/electron/bin/desk-sensor"
