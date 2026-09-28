#!/usr/bin/env python3
"""
Validates every scenario in test-cases/ and the TypeScript/Python outputs for it
against specification/schema.json, so the schema cannot drift from the implementations.

This is development tooling only: it needs the `jsonschema` package
(pip install jsonschema), which the libraries themselves never depend on.
Prerequisites: the TypeScript package must be built (cd packages/typescript && npm run build).

Usage:
    python scripts/validate_schema.py
"""
import json
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft7Validator

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "specification" / "schema.json"
TS_CLI = ROOT / "packages" / "typescript" / "dist" / "bin" / "cli.js"
PY_DIR = ROOT / "packages" / "python"
TEST_CASES_DIR = ROOT / "test-cases"


def validator_for(schema: dict, definition: str) -> Draft7Validator:
    return Draft7Validator({"$ref": f"#/definitions/{definition}", "definitions": schema["definitions"]})


def run(cmd, cwd) -> dict:
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        raise RuntimeError(f"{' '.join(map(str, cmd))} failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def report(label: str, validator: Draft7Validator, instance) -> bool:
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
    for error in errors[:5]:
        print(f"  {label}: {error.json_path}: {error.message}")
    return not errors


def main() -> int:
    if not TS_CLI.exists():
        print(f"TypeScript CLI not found at {TS_CLI}. Run `npm run build` first.", file=sys.stderr)
        return 1

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    input_validator = validator_for(schema, "InputRequest")
    output_validator = validator_for(schema, "OptimizationResult")

    failures = 0
    for case_file in sorted(TEST_CASES_DIR.glob("*.json")):
        case_data = json.loads(case_file.read_text(encoding="utf-8"))
        ts_result = run(["node", str(TS_CLI), str(case_file)], cwd=ROOT)
        py_result = run([sys.executable, "-m", "wood_cutting_optimizer", str(case_file)], cwd=PY_DIR)
        ok = all([
            report("input", input_validator, case_data["input"]),
            report("TypeScript output", output_validator, ts_result),
            report("Python output", output_validator, py_result),
        ])
        print(f"{'OK  ' if ok else 'FAIL'}  {case_file.name}")
        failures += 0 if ok else 1

    if failures:
        print(f"{failures} case(s) do not conform to specification/schema.json", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
