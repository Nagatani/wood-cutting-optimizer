from __future__ import annotations
from typing import List, Optional
from .types import (
    Stock1D,
    Part1D,
    MinRemnantSize,
    OptimizationResult,
    StockResult1D,
    Placement1D,
    Cut1D,
    Segment1D,
    Summary,
    UnplacedPart,
)
from .binpacking import (
    BinDefinition,
    ItemDefinition,
    BinPacking1DOptions,
    bin_pack_1d,
)


def optimize_1d(
    stocks: List[Stock1D],
    parts: List[Part1D],
    kerf: float = 0.0,
    min_remnant_size: Optional[MinRemnantSize] = None,
) -> OptimizationResult:
    kerf = max(0.0, float(kerf))
    min_remnant_length = float(min_remnant_size.length) if (min_remnant_size and min_remnant_size.length is not None) else 0.0

    bins = [
        BinDefinition(
            id=s.id,
            capacity=float(s.length),
            quantity=s.quantity if s.quantity is not None else 1,
            cost=float(s.cost) if s.cost is not None else float(s.length),
            data=s,
        )
        for s in stocks
    ]

    items = [
        ItemDefinition(
            id=p.id,
            size=float(p.length),
            quantity=p.quantity if p.quantity is not None else 1,
            data=p,
        )
        for p in parts
    ]

    pack_result = bin_pack_1d(
        bins=bins,
        items=items,
        options=BinPacking1DOptions(
            item_spacing=kerf,
            strategy="best-fit-decreasing",
        ),
    )

    result_stocks: List[StockResult1D] = []
    total_stock_measure = 0.0
    total_used_measure = 0.0
    total_waste_measure = 0.0
    total_remnant_measure = 0.0
    total_placed_count = 0

    for packed_bin in pack_result.bins:
        total_stock_measure += packed_bin.capacity
        placements: List[Placement1D] = []
        cuts: List[Cut1D] = []

        for i, item in enumerate(packed_bin.items):
            if i > 0:
                cuts.append(Cut1D(
                    x=item.offset - kerf,
                    kerf=kerf,
                    step=i,
                ))
            placements.append(Placement1D(
                part_id=item.id,
                x=item.offset,
                length=item.size,
            ))
            total_used_measure += item.size

        total_placed_count += len(placements)

        remaining = packed_bin.remaining_capacity
        remnants: List[Segment1D] = []
        waste: List[Segment1D] = []

        if remaining > 0:
            if min_remnant_length > 0 and remaining >= min_remnant_length:
                remnants.append(Segment1D(x=packed_bin.used_capacity, length=remaining))
                total_remnant_measure += remaining
            else:
                waste.append(Segment1D(x=packed_bin.used_capacity, length=remaining))
                total_waste_measure += remaining

        cut_loss = len(cuts) * kerf
        total_waste_measure += cut_loss

        result_stocks.append(StockResult1D(
            stock_id=packed_bin.bin_id,
            index=packed_bin.index,
            length=packed_bin.capacity,
            placements=placements,
            cuts=cuts,
            remnants=remnants,
            waste=waste,
        ))

    unplaced_parts = [
        UnplacedPart(part_id=u.id, quantity=u.quantity)
        for u in pack_result.unpacked_items
    ]

    yield_rate = (total_used_measure / total_stock_measure) if total_stock_measure > 0 else 0.0

    return OptimizationResult(
        dimension="1D",
        summary=Summary(
            stock_count_used=len(result_stocks),
            parts_placed=total_placed_count,
            parts_total=pack_result.summary.items_total,
            total_stock_measure=round(total_stock_measure, 4),
            total_used_measure=round(total_used_measure, 4),
            total_waste_measure=round(total_waste_measure, 4),
            total_remnant_measure=round(total_remnant_measure, 4),
            yield_rate=round(yield_rate, 4),
        ),
        stocks=result_stocks,
        unplaced_parts=unplaced_parts,
    )

