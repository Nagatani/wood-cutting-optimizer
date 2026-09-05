from __future__ import annotations
from typing import List, Dict, Any
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


class ActiveStock1D:
    def __init__(self, stock_id: str, index: int, total_length: float):
        self.stock_id = stock_id
        self.index = index
        self.total_length = total_length
        self.used_length: float = 0.0
        self.placements: List[Placement1D] = []
        self.cuts: List[Cut1D] = []
        self.cut_step_count: int = 0


def optimize_1d(
    stocks: List[Stock1D],
    parts: List[Part1D],
    kerf: float = 0.0,
    min_remnant_size: MinRemnantSize = None,
) -> OptimizationResult:
    kerf = max(0.0, float(kerf))
    min_remnant_length = float(min_remnant_size.length) if (min_remnant_size and min_remnant_size.length is not None) else 0.0

    # Expand parts
    expanded_parts: List[Dict[str, Any]] = []
    total_parts_count = 0
    for p in parts:
        qty = p.quantity if p.quantity is not None else 1
        total_parts_count += qty
        for _ in range(qty):
            expanded_parts.append({
                "part_id": p.id,
                "name": p.name,
                "length": float(p.length),
            })

    # Sort parts descending by length (Best Fit Decreasing)
    expanded_parts.sort(key=lambda x: x["length"], reverse=True)

    # Stock inventory pool
    stock_pool = []
    for s in stocks:
        stock_pool.append({
            "id": s.id,
            "length": float(s.length),
            "cost": float(s.cost) if s.cost is not None else float(s.length),
            "remaining_quantity": s.quantity if s.quantity is not None else 1,
        })

    active_stocks: List[ActiveStock1D] = []
    unplaced_parts_map: Dict[str, int] = {}
    global_stock_index = 0

    for part in expanded_parts:
        part_len = part["length"]
        best_stock_idx = -1
        min_remaining_after_placement = float("inf")

        # Try to fit into an existing open stock (Best Fit)
        for i, stock in enumerate(active_stocks):
            additional_space_needed = (kerf + part_len) if len(stock.placements) > 0 else part_len
            space_left = stock.total_length - stock.used_length

            if space_left >= additional_space_needed:
                remaining = space_left - additional_space_needed
                if remaining < min_remaining_after_placement:
                    min_remaining_after_placement = remaining
                    best_stock_idx = i

        if best_stock_idx != -1:
            stock = active_stocks[best_stock_idx]
            current_pos = stock.used_length
            start_x = (current_pos + kerf) if len(stock.placements) > 0 else current_pos

            if len(stock.placements) > 0:
                stock.cut_step_count += 1
                stock.cuts.append(Cut1D(
                    x=current_pos,
                    kerf=kerf,
                    step=stock.cut_step_count,
                ))

            stock.placements.append(Placement1D(
                part_id=part["part_id"],
                x=start_x,
                length=part_len,
            ))
            stock.used_length = start_x + part_len
        else:
            # Open new stock from pool
            chosen_pool_idx = -1
            min_waste = float("inf")

            for i, pool in enumerate(stock_pool):
                if pool["remaining_quantity"] > 0 and pool["length"] >= part_len:
                    waste = pool["length"] - part_len
                    if waste < min_waste:
                        min_waste = waste
                        chosen_pool_idx = i

            if chosen_pool_idx != -1:
                chosen = stock_pool[chosen_pool_idx]
                chosen["remaining_quantity"] -= 1

                new_stock = ActiveStock1D(
                    stock_id=chosen["id"],
                    index=global_stock_index,
                    total_length=chosen["length"],
                )
                global_stock_index += 1

                new_stock.placements.append(Placement1D(
                    part_id=part["part_id"],
                    x=0.0,
                    length=part_len,
                ))
                new_stock.used_length = part_len
                active_stocks.append(new_stock)
            else:
                unplaced_parts_map[part["part_id"]] = unplaced_parts_map.get(part["part_id"], 0) + 1

    # Summarize results
    result_stocks: List[StockResult1D] = []
    total_stock_measure = 0.0
    total_used_measure = 0.0
    total_waste_measure = 0.0
    total_remnant_measure = 0.0
    total_placed_count = 0

    for stock in active_stocks:
        total_stock_measure += stock.total_length
        parts_len_sum = sum(p.length for p in stock.placements)
        total_used_measure += parts_len_sum
        total_placed_count += len(stock.placements)

        remaining = stock.total_length - stock.used_length
        remnants: List[Segment1D] = []
        waste: List[Segment1D] = []

        if remaining > 0:
            if min_remnant_length > 0 and remaining >= min_remnant_length:
                remnants.append(Segment1D(x=stock.used_length, length=remaining))
                total_remnant_measure += remaining
            else:
                waste.append(Segment1D(x=stock.used_length, length=remaining))
                total_waste_measure += remaining

        cut_loss = len(stock.cuts) * kerf
        total_waste_measure += cut_loss

        result_stocks.append(StockResult1D(
            stock_id=stock.stock_id,
            index=stock.index,
            length=stock.total_length,
            placements=stock.placements,
            cuts=stock.cuts,
            remnants=remnants,
            waste=waste,
        ))

    unplaced_parts = [
        UnplacedPart(part_id=pid, quantity=qty)
        for pid, qty in unplaced_parts_map.items()
    ]

    yield_rate = (total_used_measure / total_stock_measure) if total_stock_measure > 0 else 0.0

    return OptimizationResult(
        dimension="1D",
        summary=Summary(
            stock_count_used=len(result_stocks),
            parts_placed=total_placed_count,
            parts_total=total_parts_count,
            total_stock_measure=round(total_stock_measure, 4),
            total_used_measure=round(total_used_measure, 4),
            total_waste_measure=round(total_waste_measure, 4),
            total_remnant_measure=round(total_remnant_measure, 4),
            yield_rate=round(yield_rate, 4),
        ),
        stocks=result_stocks,
        unplaced_parts=unplaced_parts,
    )
