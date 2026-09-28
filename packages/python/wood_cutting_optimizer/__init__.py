"""
wood-cutting-optimizer: Zero-dependency 1D and 2D wood cutting optimization core library
"""

from typing import Dict, Any, Union
from .types import (
    OptimizationResult,
    Stock1D,
    Part1D,
    Stock2D,
    Part2D,
    MinRemnantSize,
)
from .optimizer1d import optimize_1d
from .optimizer2d import optimize_2d
from .validate import validate_1d, validate_2d
from .svg import render_svg
from .binpacking import (
    BinDefinition,
    ItemDefinition,
    BinPacking1DOptions,
    BinPacking1DResult,
    PackedBin,
    PackedItem,
    UnpackedItem,
    BinPacking1DSummary,
    PackingStrategy1D,
    BinSelection1D,
    bin_pack_1d,
)

__version__ = "0.1.0"
__all__ = [
    "optimize",
    "optimize_1d",
    "optimize_2d",
    "validate_1d",
    "validate_2d",
    "render_svg",
    "bin_pack_1d",
    "BinDefinition",
    "ItemDefinition",
    "BinPacking1DOptions",
    "BinPacking1DResult",
    "PackedBin",
    "PackedItem",
    "UnpackedItem",
    "BinPacking1DSummary",
    "PackingStrategy1D",
    "BinSelection1D",
]



def optimize(data: Dict[str, Any]) -> OptimizationResult:
    """
    Main optimization entry point. Dispatches to 1D or 2D optimizer based on 'dimension'.
    Accepts raw dictionary conforming to specification/schema.json.
    """
    if not isinstance(data, dict):
        raise ValueError("Invalid input: input must be an object")

    # Support wrapper like { "input": { ... } }
    input_data = data.get("input", data)
    if not isinstance(input_data, dict):
        raise ValueError("Invalid input: input must be an object")

    dimension = input_data.get("dimension")
    if dimension not in ("1D", "2D"):
        raise ValueError(f"Invalid input: dimension must be \"1D\" or \"2D\" (got {dimension})")
    kerf = input_data.get("kerf", 0.0)

    for key in ("stocks", "parts"):
        if not isinstance(input_data.get(key), list):
            raise ValueError(f"Invalid input: {key} must be an array")
        for i, entry in enumerate(input_data[key]):
            if not isinstance(entry, dict):
                raise ValueError(f"Invalid input: {key}[{i}] must be an object")

    min_rem_dict = input_data.get("min_remnant_size")
    min_remnant_size = None
    if min_rem_dict:
        min_remnant_size = MinRemnantSize(
            length=min_rem_dict.get("length"),
            width=min_rem_dict.get("width"),
            height=min_rem_dict.get("height"),
        )

    if dimension == "1D":
        stocks = [
            Stock1D(
                id=s.get("id"),
                length=s.get("length"),
                quantity=s.get("quantity", 1),
                cost=s.get("cost"),
                trim=s.get("trim", 0.0),
            )
            for s in input_data.get("stocks", [])
        ]
        parts = [
            Part1D(
                id=p.get("id"),
                length=p.get("length"),
                name=p.get("name"),
                quantity=p.get("quantity", 1),
            )
            for p in input_data.get("parts", [])
        ]
        return optimize_1d(
            stocks=stocks,
            parts=parts,
            kerf=kerf,
            min_remnant_size=min_remnant_size,
        )

    elif dimension == "2D":
        stocks = [
            Stock2D(
                id=s.get("id"),
                width=s.get("width"),
                height=s.get("height"),
                quantity=s.get("quantity", 1),
                cost=s.get("cost"),
                trim=s.get("trim", 0.0),
                grain=s.get("grain", "none"),
            )
            for s in input_data.get("stocks", [])
        ]
        parts = [
            Part2D(
                id=p.get("id"),
                width=p.get("width"),
                height=p.get("height"),
                name=p.get("name"),
                quantity=p.get("quantity", 1),
                can_rotate=p.get("can_rotate", True),
                grain=p.get("grain", "none"),
            )
            for p in input_data.get("parts", [])
        ]
        return optimize_2d(
            stocks=stocks,
            parts=parts,
            kerf=kerf,
            min_remnant_size=min_remnant_size,
        )
    else:  # pragma: no cover - dimension is validated above
        raise ValueError(f"Unsupported dimension: {dimension}")
