#!/usr/bin/env python3
"""
Checks that the TypeScript and Python implementations produce identical results
for every scenario in test-cases/.

Prerequisites: the TypeScript package must be built (cd packages/typescript && npm run build).

Usage:
    python scripts/check_parity.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TS_CLI = ROOT / "packages" / "typescript" / "dist" / "bin" / "cli.js"
PY_DIR = ROOT / "packages" / "python"
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


def main() -> int:
    if not TS_CLI.exists():
        print(f"TypeScript CLI not found at {TS_CLI}. Run `npm run build` first.", file=sys.stderr)
        return 1

    failures = 0
    for case_file in sorted(TEST_CASES_DIR.glob("*.json")):
        ts_result = run(["node", str(TS_CLI), str(case_file)], cwd=ROOT)
        py_result = run([sys.executable, "-m", "wood_cutting_optimizer", str(case_file)], cwd=PY_DIR)
        if normalize(ts_result) == normalize(py_result):
            print(f"OK    {case_file.name}")
        else:
            failures += 1
            print(f"DIFF  {case_file.name}")

    if failures:
        print(f"{failures} case(s) differ between TypeScript and Python", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
