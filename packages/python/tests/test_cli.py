import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent.parent
TEST_CASES_DIR = PACKAGE_DIR.parent.parent / "test-cases"
CASE_PATH = TEST_CASES_DIR / "2d_guillotine.json"


def run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "wood_cutting_optimizer", *args],
        cwd=PACKAGE_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


class TestCli(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_prints_result_json(self):
        res = run_cli(str(CASE_PATH))
        self.assertEqual(res.returncode, 0, res.stderr)
        result = json.loads(res.stdout)
        self.assertEqual(result["dimension"], "2D")
        self.assertEqual(result["unplaced_parts"], [])

    def test_writes_json_and_svg_files(self):
        out_path = self.tmp_dir / "result.json"
        svg_path = self.tmp_dir / "plan.svg"
        res = run_cli("-i", str(CASE_PATH), "-o", str(out_path), "--svg", str(svg_path))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(res.stdout, "")
        self.assertEqual(json.loads(out_path.read_text(encoding="utf-8"))["dimension"], "2D")
        self.assertTrue(svg_path.read_text(encoding="utf-8").startswith("<svg "))

    def test_help(self):
        res = run_cli("--help")
        self.assertEqual(res.returncode, 0)
        self.assertIn("usage:", res.stdout)

    def test_no_input(self):
        res = run_cli()
        self.assertEqual(res.returncode, 1)
        self.assertIn("usage:", res.stderr)

    def test_usage_errors(self):
        cases = {
            "unknown option": [str(CASE_PATH), "--bogus"],
            "missing --svg value": [str(CASE_PATH), "--svg"],
            "missing -o value": [str(CASE_PATH), "-o"],
            "option as -o value": [str(CASE_PATH), "-o", "--svg", "x.svg"],
            "extra argument": [str(CASE_PATH), "extra.json"],
        }
        for label, args in cases.items():
            with self.subTest(case=label):
                res = run_cli(*args)
                self.assertEqual(res.returncode, 2)
                self.assertIn("error:", res.stderr)

    def test_missing_input_file(self):
        res = run_cli(str(self.tmp_dir / "missing.json"))
        self.assertEqual(res.returncode, 1)
        self.assertIn("not found", res.stderr)

    def test_invalid_input(self):
        bad_path = self.tmp_dir / "bad.json"
        bad_path.write_text(json.dumps({"dimension": "1D", "stocks": [], "parts": []}), encoding="utf-8")
        res = run_cli(str(bad_path))
        self.assertEqual(res.returncode, 1)
        self.assertIn("Invalid input", res.stderr)


if __name__ == "__main__":
    unittest.main()
