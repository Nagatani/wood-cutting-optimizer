#!/usr/bin/env node
// Minimal CLI over the WebAssembly build (pkg-node), used by scripts/check_parity.py to compare
// the WASM output with the other implementations. Build it first:
//   cargo build --release --lib --target wasm32-unknown-unknown --features wasm
//   wasm-bindgen target/wasm32-unknown-unknown/release/wood_cutting_optimizer.wasm --out-dir pkg-node --target nodejs
//
// Usage: node scripts/wasm-cli.cjs <input.json> [--svg <output.svg>]

const fs = require('node:fs');
const path = require('node:path');
const wasm = require(path.join(__dirname, '..', 'pkg-node', 'wood_cutting_optimizer.js'));

const args = process.argv.slice(2);
const svgIndex = args.indexOf('--svg');
const svgPath = svgIndex >= 0 ? args[svgIndex + 1] : undefined;
const inputPath = args.find((arg, i) => !arg.startsWith('-') && i !== svgIndex + 1);

try {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const result = wasm.optimize(input);
  if (svgPath) {
    fs.writeFileSync(svgPath, wasm.renderSvg(result, input), 'utf-8');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Optimization failed: ${err.message}`);
  process.exit(1);
}
