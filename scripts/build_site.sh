#!/usr/bin/env bash
# Assembles the GitHub Pages site (usage guide + playground) into _site/ (or the given directory).
#
#   site/                       -> pages, styles and playground script
#   packages/typescript/dist    -> lib/ts/   (TypeScript engine, ES modules)
#   packages/rust (wasm)        -> lib/wasm/ (WebAssembly engine; skipped when wasm-bindgen is missing)
#   test-cases/*.json           -> examples/ (playground presets)
#   docs/example-*.svg          -> images/
#
# Requirements: Node.js with `npm ci` done in packages/typescript. For the WebAssembly engine:
# the Rust wasm32-unknown-unknown target and the wasm-bindgen CLI matching Cargo.lock
# (set WASM_BINDGEN=/path/to/wasm-bindgen to use a specific binary).
#
# Preview locally:
#   scripts/build_site.sh && python3 -m http.server -d _site 8000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/_site}"
WASM_BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"

rm -rf "$OUT"
mkdir -p "$OUT/lib/ts" "$OUT/examples" "$OUT/images"
OUT="$(cd "$OUT" && pwd)" # Absolute, since some steps below run in other directories
cp -R "$ROOT/site/." "$OUT/"

echo "Building the TypeScript engine..."
(cd "$ROOT/packages/typescript" && npm run build >/dev/null)
(cd "$ROOT/packages/typescript/dist/src" && find . -name '*.js' | while read -r file; do
  mkdir -p "$OUT/lib/ts/$(dirname "$file")"
  cp "$file" "$OUT/lib/ts/$file"
done)

if command -v "$WASM_BINDGEN" >/dev/null 2>&1; then
  echo "Building the WebAssembly engine..."
  (cd "$ROOT/packages/rust" && cargo build --release --lib --target wasm32-unknown-unknown --features wasm)
  "$WASM_BINDGEN" "$ROOT/packages/rust/target/wasm32-unknown-unknown/release/wood_cutting_optimizer.wasm" \
    --out-dir "$OUT/lib/wasm" --target web
else
  echo "wasm-bindgen not found: the playground will offer the TypeScript engine only." >&2
fi

cp "$ROOT"/test-cases/*.json "$OUT/examples/"
cp "$ROOT"/docs/example-*.svg "$OUT/images/"
touch "$OUT/.nojekyll"

echo "Site written to $OUT"
