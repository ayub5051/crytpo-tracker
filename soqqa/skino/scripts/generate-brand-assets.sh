#!/usr/bin/env bash
#
# BLAZZER — brand asset generator
# Rasterises the SVG sources into the PNG files referenced by index.html and
# manifest.webmanifest:
#
#   assets/icons/favicon.svg            -> favicon-16.png, favicon-32.png,
#                                          icon-192.png, icon-512.png
#   assets/icons/apple-touch-icon.svg   -> apple-touch-icon.png (180x180)
#   assets/og/blazzer-og.svg            -> assets/og/blazzer-og.png (1200x630)
#
# Requires ONE of: librsvg (`rsvg-convert`) or ImageMagick (`magick`/`convert`).
# Install on macOS with `brew install librsvg`, or on Debian/Ubuntu with
# `sudo apt-get install librsvg2-bin`.
#
# For a pixel-perfect OG image using the real Inter webfont, screenshot
# assets/og/og-template.html at exactly 1200x630 instead of rasterising the SVG.
#
set -euo pipefail

# Always run from the project root (this script lives in scripts/).
cd "$(dirname "$0")/.."

render() { # <src-svg> <out-png> <width> <height>
  local src="$1" out="$2" w="$3" h="$4"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$w" -h "$h" "$src" -o "$out"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none -density 384 "$src" -resize "${w}x${h}" "$out"
  elif command -v convert >/dev/null 2>&1; then
    convert -background none -density 384 "$src" -resize "${w}x${h}" "$out"
  else
    echo "error: no SVG rasteriser found (install librsvg or ImageMagick)." >&2
    exit 1
  fi
  echo "  wrote $out"
}

echo "Generating BLAZZER brand assets…"
render assets/icons/favicon.svg          assets/icons/favicon-16.png       16   16
render assets/icons/favicon.svg          assets/icons/favicon-32.png       32   32
render assets/icons/apple-touch-icon.svg assets/icons/apple-touch-icon.png 180  180
render assets/icons/favicon.svg          assets/icons/icon-192.png         192  192
render assets/icons/favicon.svg          assets/icons/icon-512.png         512  512
render assets/og/blazzer-og.svg          assets/og/blazzer-og.png          1200 630
echo "Done."
