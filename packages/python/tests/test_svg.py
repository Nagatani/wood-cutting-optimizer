import json
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from wood_cutting_optimizer import optimize, render_svg

TEST_CASES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "test-cases"
if not TEST_CASES_DIR.exists():
    TEST_CASES_DIR = Path("test-cases").resolve()

SVG_NS = "{http://www.w3.org/2000/svg}"


def _count(root: ET.Element, tag: str, class_name: str) -> int:
    return sum(1 for el in root.iter(SVG_NS + tag) if el.get("class") == class_name)


class TestSvgRenderer(unittest.TestCase):
    def test_draws_every_placement_remnant_and_cut(self):
        for case_file in sorted(TEST_CASES_DIR.glob("*.json")):
            with self.subTest(case=case_file.name):
                with open(case_file, "r", encoding="utf-8") as f:
                    case_data = json.load(f)
                result = optimize(case_data)
                root = ET.fromstring(render_svg(result, case_data))

                self.assertEqual(root.tag, SVG_NS + "svg")
                self.assertEqual(_count(root, "rect", "part"), sum(len(s.placements) for s in result.stocks))
                self.assertEqual(_count(root, "rect", "remnant"), sum(len(s.remnants) for s in result.stocks))
                self.assertEqual(_count(root, "line", "cut"), sum(len(s.cuts) for s in result.stocks))
                self.assertEqual(_count(root, "rect", "stock"), len(result.stocks))

    def test_labels_names_and_escapes_xml(self):
        data = {
            "dimension": "2D",
            "stocks": [{"id": "s", "width": 1000, "height": 1000}],
            "parts": [
                {"id": "a", "name": "Top & <Side>", "width": 600, "height": 600},
                {"id": "huge", "name": "大きすぎる板", "width": 2000, "height": 2000},
            ],
        }
        svg = render_svg(optimize(data), data)
        self.assertIn("Top &amp; &lt;Side&gt;", svg)
        self.assertNotIn("Top & <Side>", svg)
        self.assertIn("unplaced: 大きすぎる板 ×1", svg)
        ET.fromstring(svg)

    def test_readable_when_no_stock_is_used(self):
        data = {
            "dimension": "2D",
            "stocks": [{"id": "s", "width": 100, "height": 100}],
            "parts": [{"id": "big", "width": 500, "height": 500}],
        }
        root = ET.fromstring(render_svg(optimize(data), data))
        width = float(root.get("viewBox").split()[2])
        font_sizes = {el.get("font-size") for el in root.iter(SVG_NS + "text")}
        self.assertEqual(font_sizes, {"20"})
        self.assertGreater(width, 300)

    def test_falls_back_to_part_ids_without_input(self):
        data = {
            "dimension": "1D",
            "stocks": [{"id": "s", "length": 2000}],
            "parts": [{"id": "leg-id", "name": "Leg", "length": 800}],
        }
        svg = render_svg(optimize(data))
        self.assertIn("leg-id", svg)
        self.assertNotIn("Leg", svg)


if __name__ == "__main__":
    unittest.main()
