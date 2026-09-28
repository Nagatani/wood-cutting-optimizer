from __future__ import annotations
import math
from typing import Any, List, Optional
from .types import MinRemnantSize

GRAIN_DIRECTIONS = ("none", "length", "width")


def _fail(message: str) -> None:
    raise ValueError(f"Invalid input: {message}")


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _check_positive(label: str, value: Any) -> None:
    if not _is_number(value) or value <= 0:
        _fail(f"{label} must be a finite number > 0 (got {value})")


def _check_non_negative(label: str, value: Any) -> None:
    if not _is_number(value) or value < 0:
        _fail(f"{label} must be a finite number >= 0 (got {value})")


def _check_quantity(label: str, value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        _fail(f"{label}.quantity must be an integer >= 1 (got {value})")


def _check_stock_quantity(label: str, value: Any) -> None:
    if value == "unlimited":
        return
    _check_quantity(label, value)


def resolve_stock_quantity(quantity: Any) -> float:
    """Resolves a stock quantity to a number (math.inf for "unlimited", 1 when omitted)."""
    if quantity == "unlimited":
        return math.inf
    return quantity if quantity is not None else 1


def _check_grain(label: str, value: Any) -> None:
    if value is None:
        return
    if value not in GRAIN_DIRECTIONS:
        _fail(f"{label}.grain must be one of {', '.join(GRAIN_DIRECTIONS)} (got {value})")


def _check_id(label: str, value: Any) -> None:
    if not isinstance(value, str) or len(value) == 0:
        _fail(f"{label}.id must be a non-empty string")


def validate_common(kerf: Any, min_remnant_size: Optional[MinRemnantSize]) -> None:
    _check_non_negative("kerf", kerf)
    if min_remnant_size is not None:
        for key in ("length", "width", "height"):
            v = getattr(min_remnant_size, key)
            if v is not None:
                _check_non_negative(f"min_remnant_size.{key}", v)


def validate_1d(stocks: List[Any], parts: List[Any], kerf: Any, min_remnant_size: Optional[MinRemnantSize]) -> None:
    """Validates 1D input against the constraints of specification/schema.json."""
    validate_common(kerf, min_remnant_size)
    for i, s in enumerate(stocks):
        label = f"stocks[{i}]"
        _check_id(label, s.id)
        _check_positive(f"{label}.length", s.length)
        _check_stock_quantity(label, s.quantity)
        if s.cost is not None:
            _check_non_negative(f"{label}.cost", s.cost)
    for i, p in enumerate(parts):
        label = f"parts[{i}]"
        _check_id(label, p.id)
        _check_positive(f"{label}.length", p.length)
        _check_quantity(label, p.quantity)


def validate_2d(stocks: List[Any], parts: List[Any], kerf: Any, min_remnant_size: Optional[MinRemnantSize]) -> None:
    """Validates 2D input against the constraints of specification/schema.json."""
    validate_common(kerf, min_remnant_size)
    for i, s in enumerate(stocks):
        label = f"stocks[{i}]"
        _check_id(label, s.id)
        _check_positive(f"{label}.width", s.width)
        _check_positive(f"{label}.height", s.height)
        _check_grain(label, s.grain)
        _check_stock_quantity(label, s.quantity)
        if s.cost is not None:
            _check_non_negative(f"{label}.cost", s.cost)
    for i, p in enumerate(parts):
        label = f"parts[{i}]"
        _check_id(label, p.id)
        _check_positive(f"{label}.width", p.width)
        _check_positive(f"{label}.height", p.height)
        _check_grain(label, p.grain)
        if p.can_rotate is not None and not isinstance(p.can_rotate, bool):
            _fail(f"{label}.can_rotate must be a boolean (got {p.can_rotate})")
        _check_quantity(label, p.quantity)
