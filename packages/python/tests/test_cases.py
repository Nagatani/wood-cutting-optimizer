import json
import unittest
from pathlib import Path
from wood_opt import optimize


class TestCasesCommon(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Locate test-cases directory
        base_dir = Path(__file__).resolve().parent.parent.parent.parent
        cls.test_cases_dir = base_dir / "test-cases"
        if not cls.test_cases_dir.exists():
            # Fallback
            cls.test_cases_dir = Path("test-cases").resolve()

    def test_1d_basic(self):
        case_file = self.test_cases_dir / "1d_basic.json"
        with open(case_file, "r", encoding="utf-8") as f:
            case_data = json.load(f)

        result = optimize(case_data["input"])

        self.assertEqual(result.dimension, "1D")
        self.assertEqual(len(result.unplaced_parts), 0, "All parts should be placed")
        self.assertLessEqual(
            result.summary.stock_count_used,
            case_data["expected"]["max_stocks_used"],
        )

        kerf = case_data["input"].get("kerf", 0.0)
        for stock in result.stocks:
            self.assertGreater(len(stock.placements), 0)
            for i in range(len(stock.placements) - 1):
                curr = stock.placements[i]
                nxt = stock.placements[i + 1]
                self.assertLessEqual(
                    curr.x + curr.length + kerf,
                    nxt.x + 1e-6,
                    f"Overlap or insufficient kerf between {curr.part_id} and {nxt.part_id}",
                )
            last = stock.placements[-1]
            self.assertLessEqual(
                last.x + last.length,
                stock.length + 1e-6,
                "Placements must fit within stock length",
            )

    def test_2d_guillotine(self):
        case_file = self.test_cases_dir / "2d_guillotine.json"
        with open(case_file, "r", encoding="utf-8") as f:
            case_data = json.load(f)

        result = optimize(case_data["input"])

        self.assertEqual(result.dimension, "2D")
        self.assertEqual(len(result.unplaced_parts), 0, "All parts should be placed")
        self.assertLessEqual(
            result.summary.stock_count_used,
            case_data["expected"]["max_stocks_used"],
        )

        for stock in result.stocks:
            self.assertGreater(len(stock.placements), 0)
            self.assertGreater(len(stock.cuts), 0, "Guillotine cuts should be generated")

            for i, p1 in enumerate(stock.placements):
                self.assertGreaterEqual(p1.x, 0)
                self.assertGreaterEqual(p1.y, 0)
                self.assertLessEqual(p1.x + p1.width, stock.width + 1e-6)
                self.assertLessEqual(p1.y + p1.height, stock.height + 1e-6)

                for j in range(i + 1, len(stock.placements)):
                    p2 = stock.placements[j]
                    overlap_x = max(0.0, min(p1.x + p1.width, p2.x + p2.width) - max(p1.x, p2.x))
                    overlap_y = max(0.0, min(p1.y + p1.height, p2.y + p2.height) - max(p1.y, p2.y))
                    self.assertTrue(
                        overlap_x <= 1e-6 or overlap_y <= 1e-6,
                        f"Overlap detected between {p1.part_id} and {p2.part_id}",
                    )

    def test_2d_grain_rotation(self):
        case_file = self.test_cases_dir / "2d_grain_rotation.json"
        with open(case_file, "r", encoding="utf-8") as f:
            case_data = json.load(f)

        result = optimize(case_data["input"])

        placed_ids = {p.part_id for stock in result.stocks for p in stock.placements}
        unplaced_ids = {u.part_id for u in result.unplaced_parts}

        for expected_placed in case_data["expected"]["placed_part_ids"]:
            self.assertIn(expected_placed, placed_ids)

        for expected_unplaced in case_data["expected"]["unplaced_part_ids"]:
            self.assertIn(expected_unplaced, unplaced_ids)


if __name__ == "__main__":
    unittest.main()
