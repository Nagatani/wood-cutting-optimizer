import json
import math
import unittest
from pathlib import Path
from wood_cutting_optimizer import optimize
from wood_cutting_optimizer.binpacking import (
    bin_pack_1d,
    BinDefinition,
    ItemDefinition,
    BinPacking1DOptions,
)
from wood_cutting_optimizer.types import Cut1D, Segment1D, Rect2D

TEST_CASES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "test-cases"
if not TEST_CASES_DIR.exists():
    TEST_CASES_DIR = Path("test-cases").resolve()


class TestInvariants(unittest.TestCase):
    def test_balance_across_all_shared_cases(self):
        case_files = sorted(TEST_CASES_DIR.glob("*.json"))
        self.assertGreater(len(case_files), 0)
        for case_file in case_files:
            with self.subTest(case=case_file.name):
                with open(case_file, "r", encoding="utf-8") as f:
                    case_data = json.load(f)
                s = optimize(case_data["input"]).summary
                total = s.total_used_measure + s.total_waste_measure + s.total_remnant_measure
                self.assertAlmostEqual(total, s.total_stock_measure, delta=1e-3)


class TestCutting1D(unittest.TestCase):
    def test_final_cut_and_kerf_before_leftover(self):
        result = optimize({
            "dimension": "1D",
            "kerf": 3,
            "min_remnant_size": {"length": 100},
            "stocks": [{"id": "s", "length": 1000}],
            "parts": [{"id": "a", "length": 400}],
        })
        stock = result.stocks[0]
        self.assertEqual(stock.cuts, [Cut1D(x=400.0, kerf=3.0, step=1)])
        self.assertEqual(stock.remnants, [Segment1D(x=403.0, length=597.0)])
        self.assertEqual(result.summary.total_waste_measure, 3.0)

    def test_leftover_thinner_than_kerf(self):
        result = optimize({
            "dimension": "1D",
            "kerf": 3,
            "stocks": [{"id": "s", "length": 1000}],
            "parts": [{"id": "a", "length": 998}],
        })
        stock = result.stocks[0]
        self.assertEqual(len(stock.cuts), 1)
        self.assertEqual(len(stock.waste), 0)
        self.assertEqual(result.summary.total_waste_measure, 2.0)

    def test_float_tolerance(self):
        result = optimize({
            "dimension": "1D",
            "stocks": [{"id": "s", "length": 0.3}],
            "parts": [{"id": "a", "length": 0.1}, {"id": "b", "length": 0.2}],
        })
        self.assertEqual(result.summary.stock_count_used, 1)
        self.assertEqual(len(result.unplaced_parts), 0)


class TestCutting2D(unittest.TestCase):
    def test_leftover_thinner_than_kerf(self):
        result = optimize({
            "dimension": "2D",
            "kerf": 3,
            "stocks": [{"id": "s", "width": 100, "height": 100}],
            "parts": [{"id": "a", "width": 99, "height": 100}],
        })
        self.assertEqual(result.summary.total_waste_measure, 100.0)
        self.assertEqual(len(result.stocks[0].waste), 0)

    def test_float_tolerance(self):
        result = optimize({
            "dimension": "2D",
            "stocks": [{"id": "s", "width": 0.3, "height": 1}],
            "parts": [
                {"id": "a", "width": 0.1, "height": 1, "can_rotate": False},
                {"id": "b", "width": 0.2, "height": 1, "can_rotate": False},
            ],
        })
        self.assertEqual(len(result.unplaced_parts), 0)


class TestCostAwareSelection(unittest.TestCase):
    def test_cheapest_stock_combination(self):
        for name in ("1d_cost_aware.json", "2d_cost_aware.json"):
            with self.subTest(case=name):
                with open(TEST_CASES_DIR / name, "r", encoding="utf-8") as f:
                    case_data = json.load(f)
                result = optimize(case_data["input"])
                costs = {s["id"]: s["cost"] for s in case_data["input"]["stocks"]}
                self.assertEqual(len(result.unplaced_parts), 0)
                self.assertEqual([s.stock_id for s in result.stocks], case_data["expected"]["stock_ids"])
                self.assertEqual(sum(costs[s.stock_id] for s in result.stocks), case_data["expected"]["total_cost"])


class TestRemnantOrientation(unittest.TestCase):
    @staticmethod
    def _input(grain):
        return {
            "dimension": "2D",
            "min_remnant_size": {"width": 100, "height": 300},
            "stocks": [{"id": "s", "width": 1000, "height": 1000, "grain": grain}],
            "parts": [{"id": "a", "width": 1000, "height": 850, "can_rotate": False}],
        }

    def test_turned_remnant_without_grain(self):
        stock = optimize(self._input("none")).stocks[0]
        self.assertEqual(stock.remnants, [Rect2D(x=0.0, y=850.0, width=1000.0, height=150.0)])

    def test_fixed_orientation_with_grain(self):
        stock = optimize(self._input("length")).stocks[0]
        self.assertEqual(len(stock.remnants), 0)
        self.assertEqual(len(stock.waste), 1)


class TestUnlimitedStock(unittest.TestCase):
    def test_unlimited_2d(self):
        with open(TEST_CASES_DIR / "2d_unlimited_stock.json", "r", encoding="utf-8") as f:
            case_data = json.load(f)
        result = optimize(case_data["input"])
        self.assertEqual(len(result.unplaced_parts), 0)
        self.assertLessEqual(result.summary.stock_count_used, case_data["expected"]["max_stocks_used"])

    def test_unlimited_1d(self):
        result = optimize({
            "dimension": "1D",
            "kerf": 3,
            "stocks": [{"id": "s", "length": 1820, "quantity": "unlimited"}],
            "parts": [{"id": "a", "length": 900, "quantity": 20}],
        })
        self.assertEqual(len(result.unplaced_parts), 0)
        self.assertEqual(result.summary.stock_count_used, 10)


class TestInputHandling(unittest.TestCase):
    VALID = {
        "dimension": "1D",
        "stocks": [{"id": "s", "length": 100}],
        "parts": [{"id": "a", "length": 10}],
    }

    def test_wrapper_form(self):
        self.assertEqual(optimize({"input": self.VALID}), optimize(self.VALID))

    def test_rejects_invalid_input(self):
        cases = {
            "unknown dimension": {**self.VALID, "dimension": "3D"},
            "negative kerf": {**self.VALID, "kerf": -1},
            "negative part length": {**self.VALID, "parts": [{"id": "a", "length": -5}]},
            "zero stock length": {**self.VALID, "stocks": [{"id": "s", "length": 0}]},
            "fractional quantity": {**self.VALID, "parts": [{"id": "a", "length": 10, "quantity": 2.5}]},
            "missing id": {**self.VALID, "parts": [{"length": 10}]},
            "unlimited part quantity": {**self.VALID, "parts": [{"id": "a", "length": 10, "quantity": "unlimited"}]},
            "unknown stock quantity string": {**self.VALID, "stocks": [{"id": "s", "length": 100, "quantity": "many"}]},
            "stocks not an array": {**self.VALID, "stocks": None},
            "invalid grain": {
                "dimension": "2D",
                "stocks": [{"id": "s", "width": 100, "height": 100, "grain": "diagonal"}],
                "parts": [{"id": "a", "width": 10, "height": 10}],
            },
        }
        for label, data in cases.items():
            with self.subTest(case=label):
                with self.assertRaisesRegex(ValueError, "Invalid input"):
                    optimize(data)


class TestBinPackingValidation(unittest.TestCase):
    def test_rejects_unknown_strategy(self):
        with self.assertRaisesRegex(ValueError, "Unsupported strategy"):
            bin_pack_1d(
                [BinDefinition(id="b", capacity=10.0)],
                [ItemDefinition(id="i", size=5.0)],
                BinPacking1DOptions(strategy="foo"),
            )

    def test_rejects_negative_item_spacing(self):
        with self.assertRaisesRegex(ValueError, "item_spacing"):
            bin_pack_1d(
                [BinDefinition(id="b", capacity=10.0)],
                [ItemDefinition(id="i", size=5.0)],
                BinPacking1DOptions(item_spacing=-1.0),
            )

    def test_rejects_unknown_bin_selection(self):
        with self.assertRaisesRegex(ValueError, "Unsupported bin_selection"):
            bin_pack_1d(
                [BinDefinition(id="b", capacity=10.0)],
                [ItemDefinition(id="i", size=5.0)],
                BinPacking1DOptions(bin_selection="foo"),
            )

    def test_largest_bin_selection(self):
        result = bin_pack_1d(
            [BinDefinition(id="small", capacity=10.0, quantity=5), BinDefinition(id="large", capacity=30.0, quantity=5)],
            [ItemDefinition(id="i", size=5.0, quantity=6)],
            BinPacking1DOptions(bin_selection="largest"),
        )
        self.assertEqual([b.bin_id for b in result.bins], ["large"])

    def test_unlimited_bin_quantity(self):
        result = bin_pack_1d(
            [BinDefinition(id="b", capacity=10.0, quantity=math.inf)],
            [ItemDefinition(id="i", size=6.0, quantity=5)],
        )
        self.assertEqual(result.summary.bins_used, 5)


if __name__ == "__main__":
    unittest.main()
