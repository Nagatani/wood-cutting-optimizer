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
    bin_pack_1d,
)

__version__ = "0.1.0"
__all__ = [
    "optimize",
    "optimize_1d",
    "optimize_2d",
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
]



def optimize(data: Dict[str, Any]) -> OptimizationResult:
    """
    Main optimization entry point. Dispatches to 1D or 2D optimizer based on 'dimension'.
    Accepts raw dictionary conforming to specification/schema.json.
    """
    # Support wrapper like { "input": { ... } }
    input_data = data.get("input", data)

    dimension = input_data.get("dimension")
    kerf = float(input_data.get("kerf", 0.0))

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
                id=s["id"],
                length=float(s["length"]),
                quantity=s.get("quantity", 1),
                cost=s.get("cost"),
            )
            for s in input_data.get("stocks", [])
        ]
        parts = [
            Part1D(
                id=p["id"],
                length=float(p["length"]),
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
                id=s["id"],
                width=float(s["width"]),
                height=float(s["height"]),
                quantity=s.get("quantity", 1),
                cost=s.get("cost"),
                grain=s.get("grain", "none"),
            )
            for s in input_data.get("stocks", [])
        ]
        parts = [
            Part2D(
                id=p["id"],
                width=float(p["width"]),
                height=float(p["height"]),
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
    else:
        raise ValueError(f"Unsupported dimension: {dimension}")
