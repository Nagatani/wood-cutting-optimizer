"""
SVG cutting diagram renderer.
The output is byte-for-byte identical to the TypeScript implementation (svg.ts),
so number formatting and text measurement are implemented by hand.
"""
from __future__ import annotations
import math
from typing import Any, Dict, List, Optional
from .types import OptimizationResult, StockResult1D, StockResult2D

STYLE = (
    "text{font-family:sans-serif;fill:#222}"
    ".stock{fill:#e3e3e3;stroke:#555}"
    ".part{fill:#f2d7a6;stroke:#8a5a2b}"
    ".remnant{fill:#d5eed5;stroke:#3c8c3c;stroke-dasharray:4 3}"
    ".cut{stroke:#d33}"
    ".stock,.part,.remnant,.cut{stroke-width:1px;vector-effect:non-scaling-stroke}"
    ".label{text-anchor:middle;dominant-baseline:central}"
    ".remnant-label{fill:#2e6b2e}"
    ".title{font-weight:bold}"
)

# Size (mm) the text scale is based on when no stock was used (e.g. every part is unplaced).
FALLBACK_BASE_SIZE = 900

# Labels smaller than this fraction of the base font size are dropped.
MIN_LABEL_RATIO = 0.35


def _fmt(value: float, digits: int = 2) -> str:
    """Formats a number with at most `digits` decimals (half-up), without trailing zeros."""
    scale = 10 ** digits
    n = math.floor(value * scale + 0.5)
    sign = "-" if n < 0 else ""
    n = abs(n)
    int_part = n // scale
    frac = str(n % scale).rjust(digits, "0").rstrip("0")
    return f"{sign}{int_part}.{frac}" if frac else f"{sign}{int_part}"


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _text_width_em(text: str) -> float:
    """Approximate text width in em (ASCII 0.6em, others 1em)."""
    width = 0.0
    for ch in text:
        width += 1.0 if ord(ch) > 0x7F else 0.6
    return width


def _render_label(
    lines: List[str],
    cx: float,
    cy: float,
    w: float,
    h: float,
    base_font_size: float,
    class_name: str,
) -> str:
    """
    Renders centered, multi-line label text that fits inside a w x h box.
    Falls back to the last line only, then to no label, when the box is too small.
    """
    candidates = [lines, lines[-1:]] if len(lines) > 1 else [lines]
    for candidate in candidates:
        max_em = max(_text_width_em(line) for line in candidate)
        font_size = min(
            base_font_size,
            (h * 0.9) / (len(candidate) * 1.2),
            (w * 0.9) / max_em,
        )
        if font_size < base_font_size * MIN_LABEL_RATIO:
            continue
        tspans = []
        for i, line in enumerate(candidate):
            y = cy + (i - (len(candidate) - 1) / 2) * font_size * 1.2
            tspans.append(f'<tspan x="{_fmt(cx)}" y="{_fmt(y)}">{_escape_xml(line)}</tspan>')
        return f'<text class="{class_name}" font-size="{_fmt(font_size)}">{"".join(tspans)}</text>'
    return ""


def _part_name_map(input_data: Optional[Dict[str, Any]]) -> Dict[str, str]:
    names: Dict[str, str] = {}
    if not input_data:
        return names
    request = input_data.get("input", input_data)
    for p in request.get("parts", []):
        if p.get("name"):
            names[p["id"]] = p["name"]
    return names


def _part_label(names: Dict[str, str], part_id: str) -> str:
    return names.get(part_id, part_id)


def render_svg(result: OptimizationResult, input_data: Optional[Dict[str, Any]] = None) -> str:
    """
    Renders an optimization result as a single SVG document with one diagram per used stock.
    Pass the original input dict to label parts with their names.
    """
    names = _part_name_map(input_data)
    is_2d = result.dimension == "2D"

    max_width = 0.0
    max_height = 0.0
    for stock in result.stocks:
        if is_2d:
            max_width = max(max_width, stock.width)
            max_height = max(max_height, stock.height)
        else:
            max_width = max(max_width, stock.length)
    max_dimension = max(max_width, max_height)
    base_size = max_dimension if max_dimension > 0 else FALLBACK_BASE_SIZE
    font_size = float(_fmt(base_size / 45))
    margin = font_size
    bar_height = font_size * 3.5

    body: List[str] = []
    cursor = margin
    content_width = max_width

    def add_title(text: str, class_name: str) -> None:
        nonlocal content_width
        class_attr = f' class="{class_name}"' if class_name else ""
        body.append(
            f'<text{class_attr} x="{_fmt(margin)}" y="{_fmt(cursor + font_size)}" '
            f'font-size="{_fmt(font_size)}">{_escape_xml(text)}</text>'
        )
        content_width = max(content_width, _text_width_em(text) * font_size)

    # Overall summary
    unplaced_count = sum(u.quantity for u in result.unplaced_parts)
    summary_text = (
        f"{result.dimension} · yield {_fmt(result.summary.yield_rate * 100, 1)}%"
        f" · stocks {result.summary.stock_count_used}"
        f" · parts {result.summary.parts_placed}/{result.summary.parts_total}"
        + (f" · unplaced {unplaced_count}" if unplaced_count > 0 else "")
    )
    add_title(summary_text, "title")
    cursor += font_size * 2

    for stock in result.stocks:
        ox = margin
        used_measure = 0.0
        if is_2d:
            stock_measure = stock.width * stock.height
            for p in stock.placements:
                used_measure += p.width * p.height
            size_text = f"{_fmt(stock.width)}×{_fmt(stock.height)}"
            draw_height = stock.height
        else:
            stock_measure = stock.length
            for p in stock.placements:
                used_measure += p.length
            size_text = _fmt(stock.length)
            draw_height = bar_height

        stock_yield = (used_measure / stock_measure) * 100 if stock_measure > 0 else 0.0
        title_text = (
            f"#{stock.index + 1} {stock.stock_id} {size_text}"
            f" · parts {len(stock.placements)} · yield {_fmt(stock_yield, 1)}%"
        )
        add_title(title_text, "title")
        cursor += font_size * 1.6
        oy = cursor

        body.append(f'<g transform="translate({_fmt(ox)} {_fmt(oy)})">')
        if is_2d:
            body.extend(_render_2d_stock(stock, names, font_size))
        else:
            body.extend(_render_1d_stock(stock, names, font_size, bar_height))
        body.append("</g>")

        cursor += draw_height + font_size * 1.5

    if result.unplaced_parts:
        text = "unplaced: " + ", ".join(
            f"{_part_label(names, u.part_id)} ×{u.quantity}" for u in result.unplaced_parts
        )
        add_title(text, "")
        cursor += font_size * 1.6

    width = content_width + margin * 2
    height = cursor + margin
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_fmt(width)} {_fmt(height)}">'
        f"<style>{STYLE}</style>"
        '<rect width="100%" height="100%" fill="#fff"/>'
        + "".join(body)
        + "</svg>\n"
    )


def _render_2d_stock(stock: StockResult2D, names: Dict[str, str], font_size: float) -> List[str]:
    out: List[str] = []
    out.append(f'<rect class="stock" width="{_fmt(stock.width)}" height="{_fmt(stock.height)}"/>')

    for r in stock.remnants:
        out.append(
            f'<rect class="remnant" x="{_fmt(r.x)}" y="{_fmt(r.y)}" width="{_fmt(r.width)}" height="{_fmt(r.height)}">'
            f"<title>remnant {_fmt(r.width)}×{_fmt(r.height)}</title></rect>"
        )
        out.append(_render_label(
            [f"{_fmt(r.width)}×{_fmt(r.height)}"],
            r.x + r.width / 2, r.y + r.height / 2, r.width, r.height, font_size, "label remnant-label",
        ))

    for p in stock.placements:
        name = _part_label(names, p.part_id)
        dims = f"{_fmt(p.width)}×{_fmt(p.height)}{' ↻' if p.rotated else ''}"
        out.append(
            f'<rect class="part" x="{_fmt(p.x)}" y="{_fmt(p.y)}" width="{_fmt(p.width)}" height="{_fmt(p.height)}">'
            f"<title>{_escape_xml(f'{name} ({p.part_id}) {dims}')}</title></rect>"
        )
        out.append(_render_label(
            [name, dims], p.x + p.width / 2, p.y + p.height / 2, p.width, p.height, font_size, "label",
        ))

    for c in stock.cuts:
        offset = c.kerf / 2
        if c.type == "horizontal":
            x1, y1, x2, y2 = c.x, c.y + offset, c.x + c.length, c.y + offset
        else:
            x1, y1, x2, y2 = c.x + offset, c.y, c.x + offset, c.y + c.length
        out.append(
            f'<line class="cut" x1="{_fmt(x1)}" y1="{_fmt(y1)}" x2="{_fmt(x2)}" y2="{_fmt(y2)}">'
            f"<title>cut {c.step}</title></line>"
        )
    return out


def _render_1d_stock(stock: StockResult1D, names: Dict[str, str], font_size: float, bar_height: float) -> List[str]:
    out: List[str] = []
    out.append(f'<rect class="stock" width="{_fmt(stock.length)}" height="{_fmt(bar_height)}"/>')

    for r in stock.remnants:
        out.append(
            f'<rect class="remnant" x="{_fmt(r.x)}" width="{_fmt(r.length)}" height="{_fmt(bar_height)}">'
            f"<title>remnant {_fmt(r.length)}</title></rect>"
        )
        out.append(_render_label(
            [_fmt(r.length)], r.x + r.length / 2, bar_height / 2, r.length, bar_height, font_size, "label remnant-label",
        ))

    for p in stock.placements:
        name = _part_label(names, p.part_id)
        dims = _fmt(p.length)
        out.append(
            f'<rect class="part" x="{_fmt(p.x)}" width="{_fmt(p.length)}" height="{_fmt(bar_height)}">'
            f"<title>{_escape_xml(f'{name} ({p.part_id}) {dims}')}</title></rect>"
        )
        out.append(_render_label(
            [name, dims], p.x + p.length / 2, bar_height / 2, p.length, bar_height, font_size, "label",
        ))

    for c in stock.cuts:
        x = c.x + c.kerf / 2
        out.append(
            f'<line class="cut" x1="{_fmt(x)}" y1="0" x2="{_fmt(x)}" y2="{_fmt(bar_height)}">'
            f"<title>cut {c.step}</title></line>"
        )
    return out
