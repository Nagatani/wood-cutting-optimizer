from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
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
    BinPacking1DResult,
    bin_pack_1d,
)
from .validate import validate_1d, resolve_stock_quantity
from .evaluation import SolutionEvaluation, is_better_evaluation
from .usage import compute_stock_usage

EPS = 1e-9

# Heuristic combinations tried by optimize_1d. The first entry is the baseline
# (best-fit-decreasing / smallest stock); later entries only replace it when strictly better.
STRATEGIES = ("best-fit-decreasing", "first-fit-decreasing", "worst-fit-decreasing")
BIN_SELECTIONS = ("smallest", "largest", "lowest-cost-ratio")


def _usable_length(stock: Stock1D) -> float:
    """Length available for parts after trimming both ends."""
    return float(stock.length) - float(stock.trim or 0.0) * 2


def _stock_cost(stock: Stock1D) -> float:
    return float(stock.cost) if stock.cost is not None else float(stock.length)


def _downsize_stocks(stocks: List[Stock1D], pack_result: BinPacking1DResult) -> List[Dict[str, Any]]:
    """
    Swaps each used stock for the cheapest remaining stock type that still holds its parts
    (e.g. a 3m stock holding 1.5m of parts becomes a 2m stock when one is available and cheaper).
    """
    remaining = [resolve_stock_quantity(s.quantity) for s in stocks]
    used_stocks: List[Dict[str, Any]] = []
    for packed_bin in pack_result.bins:
        stock_index = packed_bin.data
        remaining[stock_index] -= 1
        used_stocks.append({
            "stock_index": stock_index,
            "index": packed_bin.index,
            "items": packed_bin.items,
            "used_capacity": packed_bin.used_capacity,
        })

    for used in used_stocks:
        best_index = used["stock_index"]
        for j, candidate in enumerate(stocks):
            if j == used["stock_index"] or remaining[j] <= 0:
                continue
            if _usable_length(candidate) < used["used_capacity"] - EPS:
                continue
            cost = _stock_cost(candidate)
            best_cost = _stock_cost(stocks[best_index])
            if cost < best_cost - EPS or (abs(cost - best_cost) <= EPS and candidate.length < stocks[best_index].length):
                best_index = j
        if best_index != used["stock_index"]:
            remaining[used["stock_index"]] += 1
            remaining[best_index] -= 1
            used["stock_index"] = best_index

    return used_stocks


def _build_result(
    stocks: List[Stock1D],
    used_stocks: List[Dict[str, Any]],
    pack_result: BinPacking1DResult,
    kerf: float,
    min_remnant_length: float,
) -> Tuple[OptimizationResult, SolutionEvaluation]:
    result_stocks: List[StockResult1D] = []
    total_stock_measure = 0.0
    total_used_measure = 0.0
    total_waste_measure = 0.0
    total_remnant_measure = 0.0
    total_placed_count = 0
    total_cost = 0.0
    cut_count = 0

    for used in used_stocks:
        stock = stocks[used["stock_index"]]
        # Parts are laid out after the trimmed start of the stock
        trim = float(stock.trim or 0.0)
        capacity = _usable_length(stock)
        total_stock_measure += float(stock.length)
        total_cost += _stock_cost(stock)
        placements: List[Placement1D] = []
        cuts: List[Cut1D] = []

        for i, item in enumerate(used["items"]):
            if i > 0:
                cuts.append(Cut1D(
                    x=trim + item.offset - kerf,
                    kerf=kerf,
                    step=i,
                ))
            placements.append(Placement1D(
                part_id=item.id,
                x=trim + item.offset,
                length=item.size,
            ))
            total_used_measure += item.size

        total_placed_count += len(placements)

        # Cut loss between parts
        cut_loss = len(cuts) * kerf

        remaining = round(max(0.0, capacity - used["used_capacity"]), 6)
        remnants: List[Segment1D] = []
        waste: List[Segment1D] = []

        # Trimmed ends are waste
        if trim > 0:
            waste.append(Segment1D(x=0.0, length=trim))
            total_waste_measure += trim * 2

        if remaining > EPS:
            # A final cut separates the last part from the leftover.
            # If the leftover is thinner than the kerf, the blade consumes all of it.
            end_cut_loss = min(kerf, remaining)
            cuts.append(Cut1D(
                x=trim + used["used_capacity"],
                kerf=kerf,
                step=len(cuts) + 1,
            ))
            cut_loss += end_cut_loss

            leftover = round(remaining - end_cut_loss, 6)
            if leftover > EPS:
                segment = Segment1D(x=trim + used["used_capacity"] + end_cut_loss, length=leftover)
                if min_remnant_length > 0 and leftover >= min_remnant_length:
                    remnants.append(segment)
                    total_remnant_measure += leftover
                else:
                    waste.append(segment)
                    total_waste_measure += leftover

        if trim > 0:
            waste.append(Segment1D(x=float(stock.length) - trim, length=trim))

        # Cut loss is also considered waste
        total_waste_measure += cut_loss
        cut_count += len(cuts)

        result_stocks.append(StockResult1D(
            stock_id=stock.id,
            index=used["index"],
            length=float(stock.length),
            placements=placements,
            cuts=cuts,
            remnants=remnants,
            waste=waste,
        ))

    unplaced_parts = [
        UnplacedPart(part_id=u.id, quantity=u.quantity)
        for u in pack_result.unpacked_items
    ]
    unplaced_count = sum(u.quantity for u in pack_result.unpacked_items)

    yield_rate = (total_used_measure / total_stock_measure) if total_stock_measure > 0 else 0.0

    result = OptimizationResult(
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
            stock_usage=compute_stock_usage(stocks, [u["stock_index"] for u in used_stocks]),
        ),
        stocks=result_stocks,
        unplaced_parts=unplaced_parts,
    )
    evaluation = SolutionEvaluation(
        unplaced_count=unplaced_count,
        total_cost=total_cost,
        stock_count=len(result_stocks),
        remnant_measure=total_remnant_measure,
        cut_count=cut_count,
    )
    return result, evaluation


def optimize_1d(
    stocks: List[Stock1D],
    parts: List[Part1D],
    kerf: float = 0.0,
    min_remnant_size: Optional[MinRemnantSize] = None,
) -> OptimizationResult:
    validate_1d(stocks, parts, kerf, min_remnant_size)
    kerf = float(kerf)
    min_remnant_length = float(min_remnant_size.length) if (min_remnant_size and min_remnant_size.length is not None) else 0.0

    bins = [
        BinDefinition(
            id=s.id,
            capacity=_usable_length(s),
            quantity=resolve_stock_quantity(s.quantity),
            cost=_stock_cost(s),
            data=i,
        )
        for i, s in enumerate(stocks)
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

    best: Optional[Tuple[OptimizationResult, SolutionEvaluation]] = None
    for strategy in STRATEGIES:
        for bin_selection in BIN_SELECTIONS:
            pack_result = bin_pack_1d(
                bins=bins,
                items=items,
                options=BinPacking1DOptions(
                    item_spacing=kerf,
                    strategy=strategy,
                    bin_selection=bin_selection,
                ),
            )
            used_stocks = _downsize_stocks(stocks, pack_result)
            candidate = _build_result(stocks, used_stocks, pack_result, kerf, min_remnant_length)
            if best is None or is_better_evaluation(candidate[1], best[1]):
                best = candidate

    return best[0]
