#!/usr/bin/env python3
"""
Checks that every implementation produces identical results (JSON output and SVG cutting
diagrams) for every scenario in test-cases/: TypeScript (reference), Python, and — when
built — Rust (native CLI) and Rust/WebAssembly.

Prerequisites:
    (cd packages/typescript && npm run build)
    # optional, compared when present:
    (cd packages/rust && cargo build --release)                                   # Rust CLI
    (cd packages/rust && cargo build --release --lib --target wasm32-unknown-unknown --features wasm \\
        && wasm-bindgen target/wasm32-unknown-unknown/release/wood_cutting_optimizer.wasm \\
           --out-dir pkg-node --target nodejs)                                   # WebAssembly

Usage:
    python scripts/check_parity.py [--require-all] [input.json ...]

    --require-all   fail when the Rust or WebAssembly build is missing (used in CI)
    input.json      inputs to compare (defaults to test-cases/*.json)
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TS_CLI = ROOT / "packages" / "typescript" / "dist" / "bin" / "cli.js"
PY_DIR = ROOT / "packages" / "python"
RUST_CLI = ROOT / "packages" / "rust" / "target" / "release" / "wood-cutting-optimizer"
WASM_CLI = ROOT / "packages" / "rust" / "scripts" / "wasm-cli.cjs"
WASM_PKG = ROOT / "packages" / "rust" / "pkg-node" / "wood_cutting_optimizer.js"
TEST_CASES_DIR = ROOT / "test-cases"


def normalize(value):
    """Normalizes numbers so that 1 and 1.0 (and tiny float noise) compare equal."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 6)
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    return value


def run(cmd, cwd):
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        raise RuntimeError(f"{' '.join(map(str, cmd))} failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def implementations(require_all: bool):
    """Returns (name, command builder, cwd) for each available implementation."""
    impls = [
        ("TypeScript", lambda case, svg: ["node", str(TS_CLI), str(case), "--svg", str(svg)], ROOT),
        ("Python", lambda case, svg: [sys.executable, "-m", "wood_cutting_optimizer", str(case), "--svg", str(svg)], PY_DIR),
    ]
    optional = [
        ("Rust", RUST_CLI, lambda case, svg: [str(RUST_CLI), str(case), "--svg", str(svg)]),
        ("WebAssembly", WASM_PKG, lambda case, svg: ["node", str(WASM_CLI), str(case), "--svg", str(svg)]),
    ]
    missing = []
    for name, artifact, command in optional:
        if artifact.exists():
            impls.append((name, command, ROOT))
        else:
            missing.append(f"{name} (not built: {artifact.relative_to(ROOT)})")
    return impls, missing


def main() -> int:
    args = sys.argv[1:]
    require_all = "--require-all" in args
    inputs = [Path(a).resolve() for a in args if a != "--require-all"] or sorted(TEST_CASES_DIR.glob("*.json"))

    if not TS_CLI.exists():
        print(f"TypeScript CLI not found at {TS_CLI}. Run `npm run build` first.", file=sys.stderr)
        return 1
    impls, missing = implementations(require_all)
    for m in missing:
        print(f"SKIP  {m}", file=sys.stderr)
    if missing and require_all:
        return 1
    print(f"Comparing: {', '.join(name for name, _, _ in impls)}")

    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for case_file in inputs:
            outputs = []
            for i, (name, command, cwd) in enumerate(impls):
                svg_path = Path(tmp) / f"{i}.svg"
                outputs.append((name, run(command(case_file, svg_path), cwd), svg_path.read_bytes()))
            ref_name, ref_json, ref_svg = outputs[0]
            diffs = []
            for name, result, svg in outputs[1:]:
                if normalize(result) != normalize(ref_json):
                    diffs.append(f"{name} json")
                if svg != ref_svg:
                    diffs.append(f"{name} svg")
            if diffs:
                failures += 1
                print(f"DIFF  {case_file.name} (vs {ref_name}: {', '.join(diffs)})")
            else:
                print(f"OK    {case_file.name}")

    if failures:
        print(f"{failures} case(s) differ between implementations", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
