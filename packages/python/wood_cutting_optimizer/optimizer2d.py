from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
from .types import (
    Stock2D,
    Part2D,
    MinRemnantSize,
    OptimizationResult,
    StockResult2D,
    Placement2D,
    Cut2D,
    Rect2D,
    Summary,
    UnplacedPart,
    GrainDirection,
)
from .validate import validate_2d, resolve_stock_quantity
from .evaluation import SolutionEvaluation, is_better_evaluation

# Tolerance for floating-point comparisons (e.g. 0.1 + 0.2 fitting into 0.3).
EPS = 1e-9

# Order in which parts are placed (all descending).
SORT_RULES = ("area", "long-side", "short-side", "perimeter")
# How to score a free rectangle for a part (lower is better).
FIT_RULES = ("best-short-side", "best-long-side", "best-area")
# Which guillotine cut to make first after placing a part.
SPLIT_RULES = ("shorter-leftover-axis", "longer-leftover-axis", "min-area", "max-area")
# Which stock to open when a part fits in no open stock.
STOCK_RULES = ("smallest", "largest", "lowest-cost-ratio")

# All heuristic combinations tried by optimize_2d as (sort, fit, split, stock).
# The first entry is the baseline (area / BSSF / SLAS / smallest stock); later entries
# only replace it when they produce a strictly better solution.
HEURISTICS_2D: List[Tuple[str, str, str, str]] = [
    (sort, fit, split, stock)
    for sort in SORT_RULES
    for fit in FIT_RULES
    for split in SPLIT_RULES
    for stock in STOCK_RULES
]

# Above this many part pieces, only the first REDUCED_HEURISTIC_COUNT heuristics
# (the baseline sort order) are tried to keep runtime bounded.
LARGE_INPUT_PIECES = 500
REDUCED_HEURISTIC_COUNT = len(FIT_RULES) * len(SPLIT_RULES) * len(STOCK_RULES)


class FreeRect:
    def __init__(self, x: float, y: float, width: float, height: float):
        self.x = x
        self.y = y
        self.width = width
        self.height = height


class ActiveStock2D:
    def __init__(self, stock_id: str, index: int, width: float, height: float, grain: GrainDirection, cost: float):
        self.stock_id = stock_id
        self.index = index
        self.width = width
        self.height = height
        self.grain = grain
        self.cost = cost
        self.free_rects: List[FreeRect] = [FreeRect(0.0, 0.0, width, height)]
        self.placements: List[Placement2D] = []
        self.cuts: List[Cut2D] = []
        self.cut_step_count: int = 0
        self.cut_loss_area: float = 0.0  # Actual material removed by the blade


class PlacementFit:
    def __init__(self, rect_index: int, rotated: bool, part_width: float, part_height: float, score: float):
        self.rect_index = rect_index
        self.rotated = rotated
        self.part_width = part_width
        self.part_height = part_height
        self.score = score  # Lower is better (depends on the fit rule)


def is_orientation_allowed(
    stock_grain: GrainDirection,
    part_grain: GrainDirection,
    can_rotate: bool,
    rotated: bool,
) -> bool:
    if rotated and not can_rotate:
        return False

    if stock_grain == "none" or part_grain == "none":
        return True

    if stock_grain == part_grain:
        return not rotated
    else:
        return rotated


def _sort_keys(part: Dict[str, Any], rule: str) -> Tuple[float, float]:
    """Returns the (primary, secondary) sort keys of a part (sorted descending)."""
    long_side = max(part["width"], part["height"])
    short_side = min(part["width"], part["height"])
    if rule == "area":
        return (part["area"], long_side)
    if rule == "long-side":
        return (long_side, short_side)
    if rule == "short-side":
        return (short_side, long_side)
    return (part["width"] + part["height"], long_side)  # perimeter


def _fit_score(free: FreeRect, pw: float, ph: float, rule: str) -> float:
    leftover_w = free.width - pw
    leftover_h = free.height - ph
    if rule == "best-short-side":
        return min(leftover_w, leftover_h)
    if rule == "best-long-side":
        return max(leftover_w, leftover_h)
    return free.width * free.height - pw * ph  # best-area


def find_best_fit(stock: ActiveStock2D, part: Dict[str, Any], rule: str = "best-short-side") -> Optional[PlacementFit]:
    """Finds the best free rectangle in the stock for the part (lowest score wins)."""
    best_fit: Optional[PlacementFit] = None
    min_score = float("inf")

    orientations = (
        (False, part["width"], part["height"]),
        (True, part["height"], part["width"]),
    )

    for i, free in enumerate(stock.free_rects):
        # Try unrotated, then rotated (90 degrees)
        for rotated, pw, ph in orientations:
            if (
                pw <= free.width + EPS
                and ph <= free.height + EPS
                and is_orientation_allowed(stock.grain, part["grain"], part["can_rotate"], rotated)
            ):
                score = _fit_score(free, pw, ph, rule)
                if score < min_score:
                    min_score = score
                    best_fit = PlacementFit(
                        rect_index=i,
                        rotated=rotated,
                        part_width=pw,
                        part_height=ph,
                        score=score,
                    )

    return best_fit


def _should_split_horizontal(pw: float, ph: float, leftover_w: float, leftover_h: float, rule: str) -> bool:
    """Decides whether the full-length cut runs horizontally (True) or vertically (False)."""
    if rule == "shorter-leftover-axis":
        # Split along the axis that leaves the smaller remnant, maximizing the size of the other remnant.
        return leftover_w <= leftover_h
    if rule == "longer-leftover-axis":
        return leftover_w > leftover_h
    if rule == "min-area":
        # Makes the smaller of the two new free rects as small as possible
        return pw * leftover_h > ph * leftover_w
    # max-area: keeps the two new free rects as balanced as possible
    return pw * leftover_h <= ph * leftover_w


def place_part_in_stock(
    stock: ActiveStock2D,
    part: Dict[str, Any],
    fit: PlacementFit,
    kerf: float,
    split_rule: str = "shorter-leftover-axis",
) -> None:
    free = stock.free_rects.pop(fit.rect_index)

    pw = fit.part_width
    ph = fit.part_height
    px = free.x
    py = free.y

    stock.placements.append(Placement2D(
        part_id=part["part_id"],
        x=px,
        y=py,
        width=pw,
        height=ph,
        rotated=fit.rotated,
    ))

    leftover_w = free.width - pw
    leftover_h = free.height - ph
    has_leftover_w = leftover_w > EPS
    has_leftover_h = leftover_h > EPS

    split_horizontal = _should_split_horizontal(pw, ph, leftover_w, leftover_h, split_rule)

    # Width/height of the free rects left after the blade passes (<= 0 when the kerf eats the leftover)
    top_h = free.height - ph - kerf
    right_w = free.width - pw - kerf

    if split_horizontal:
        if has_leftover_h:
            stock.cut_step_count += 1
            stock.cuts.append(Cut2D(
                type="horizontal",
                x=px,
                y=py + ph,
                length=free.width,
                kerf=kerf,
                step=stock.cut_step_count,
            ))
            stock.cut_loss_area += min(kerf, leftover_h) * free.width

        if has_leftover_w:
            stock.cut_step_count += 1
            stock.cuts.append(Cut2D(
                type="vertical",
                x=px + pw,
                y=py,
                length=ph,
                kerf=kerf,
                step=stock.cut_step_count,
            ))
            stock.cut_loss_area += min(kerf, leftover_w) * ph

        if has_leftover_h and top_h > EPS:
            stock.free_rects.append(FreeRect(
                x=px,
                y=py + ph + kerf,
                width=free.width,
                height=top_h,
            ))

        if has_leftover_w and right_w > EPS:
            stock.free_rects.append(FreeRect(
                x=px + pw + kerf,
                y=py,
                width=right_w,
                height=ph,
            ))
    else:
        if has_leftover_w:
            stock.cut_step_count += 1
            stock.cuts.append(Cut2D(
                type="vertical",
                x=px + pw,
                y=py,
                length=free.height,
                kerf=kerf,
                step=stock.cut_step_count,
            ))
            stock.cut_loss_area += min(kerf, leftover_w) * free.height

        if has_leftover_h:
            stock.cut_step_count += 1
            stock.cuts.append(Cut2D(
                type="horizontal",
                x=px,
                y=py + ph,
                length=pw,
                kerf=kerf,
                step=stock.cut_step_count,
            ))
            stock.cut_loss_area += min(kerf, leftover_h) * pw

        if has_leftover_w and right_w > EPS:
            stock.free_rects.append(FreeRect(
                x=px + pw + kerf,
                y=py,
                width=right_w,
                height=free.height,
            ))

        if has_leftover_h and top_h > EPS:
            stock.free_rects.append(FreeRect(
                x=px,
                y=py + ph + kerf,
                width=pw,
                height=top_h,
            ))


def _choose_stock(stock_pool: List[Dict[str, Any]], part: Dict[str, Any], rule: str) -> int:
    """
    Chooses which stock type to open for a part that fits in no open stock.
    Returns -1 when no remaining stock can hold the part.
    """
    chosen_pool_idx = -1
    best_key = float("inf")
    best_area = float("inf")

    for p_idx, pool in enumerate(stock_pool):
        if pool["remaining_quantity"] <= 0:
            continue

        can_fit_unrotated = (
            part["width"] <= pool["width"] + EPS
            and part["height"] <= pool["height"] + EPS
            and is_orientation_allowed(pool["grain"], part["grain"], part["can_rotate"], False)
        )
        can_fit_rotated = (
            part["height"] <= pool["width"] + EPS
            and part["width"] <= pool["height"] + EPS
            and is_orientation_allowed(pool["grain"], part["grain"], part["can_rotate"], True)
        )
        if not can_fit_unrotated and not can_fit_rotated:
            continue

        area = pool["width"] * pool["height"]
        if rule == "smallest":
            key = area
        elif rule == "largest":
            key = -area
        else:  # lowest-cost-ratio
            key = pool["cost"] / area

        # Ties are broken by the smaller area, then by input order
        if key < best_key - EPS or (abs(key - best_key) <= EPS and area < best_area):
            best_key = key
            best_area = area
            chosen_pool_idx = p_idx

    return chosen_pool_idx


def _run_heuristic(
    stocks: List[Stock2D],
    parts: List[Dict[str, Any]],
    kerf: float,
    heuristic: Tuple[str, str, str, str],
) -> Tuple[List[ActiveStock2D], Dict[str, int]]:
    """Runs one greedy packing pass with the given heuristic."""
    sort_rule, fit_rule, split_rule, stock_rule = heuristic

    # Sort parts descending by the heuristic's keys (stable, so ties keep input order)
    sorted_parts = sorted(parts, key=lambda p: _sort_keys(p, sort_rule), reverse=True)

    stock_pool = []
    for s in stocks:
        stock_pool.append({
            "id": s.id,
            "width": float(s.width),
            "height": float(s.height),
            "grain": s.grain or "none",
            "cost": float(s.cost) if s.cost is not None else float(s.width) * float(s.height),
            "remaining_quantity": resolve_stock_quantity(s.quantity),
        })

    active_stocks: List[ActiveStock2D] = []
    unplaced_parts_map: Dict[str, int] = {}
    global_stock_index = 0

    for part in sorted_parts:
        best_stock_idx = -1
        best_fit: Optional[PlacementFit] = None

        for s_idx, stock in enumerate(active_stocks):
            fit = find_best_fit(stock, part, fit_rule)
            if fit is not None:
                if best_fit is None or fit.score < best_fit.score:
                    best_fit = fit
                    best_stock_idx = s_idx

        if best_stock_idx != -1 and best_fit is not None:
            place_part_in_stock(active_stocks[best_stock_idx], part, best_fit, kerf, split_rule)
            continue

        chosen_pool_idx = _choose_stock(stock_pool, part, stock_rule)
        if chosen_pool_idx == -1:
            unplaced_parts_map[part["part_id"]] = unplaced_parts_map.get(part["part_id"], 0) + 1
            continue

        chosen = stock_pool[chosen_pool_idx]
        chosen["remaining_quantity"] -= 1

        new_stock = ActiveStock2D(
            stock_id=chosen["id"],
            index=global_stock_index,
            width=chosen["width"],
            height=chosen["height"],
            grain=chosen["grain"],
            cost=chosen["cost"],
        )
        global_stock_index += 1

        fit = find_best_fit(new_stock, part, fit_rule)
        if fit is not None:
            place_part_in_stock(new_stock, part, fit, kerf, split_rule)
            active_stocks.append(new_stock)
        else:
            # This should not happen since we checked feasibility, but fallback
            chosen["remaining_quantity"] += 1
            global_stock_index -= 1
            unplaced_parts_map[part["part_id"]] = unplaced_parts_map.get(part["part_id"], 0) + 1

    return active_stocks, unplaced_parts_map


def _is_remnant_rect(
    rect: FreeRect,
    stock_grain: GrainDirection,
    min_remnant_width: float,
    min_remnant_height: float,
) -> bool:
    """
    A leftover rect is a reusable remnant when it meets min_remnant_size.
    Without grain the remnant can be turned, so either orientation qualifies;
    with grain the orientation is fixed.
    """
    if min_remnant_width <= 0 and min_remnant_height <= 0:
        return False
    fits_as_is = rect.width >= min_remnant_width and rect.height >= min_remnant_height
    fits_turned = rect.height >= min_remnant_width and rect.width >= min_remnant_height
    return fits_as_is or (stock_grain == "none" and fits_turned)


def _build_result(
    active_stocks: List[ActiveStock2D],
    unplaced_parts_map: Dict[str, int],
    total_parts_count: int,
    min_remnant_width: float,
    min_remnant_height: float,
) -> Tuple[OptimizationResult, SolutionEvaluation]:
    """Builds the output result and its evaluation from a finished packing pass."""
    result_stocks: List[StockResult2D] = []
    total_stock_measure = 0.0
    total_used_measure = 0.0
    total_waste_measure = 0.0
    total_remnant_measure = 0.0
    total_placed_count = 0
    total_cost = 0.0
    cut_count = 0

    for stock in active_stocks:
        stock_area = stock.width * stock.height
        total_stock_measure += stock_area
        total_cost += stock.cost
        cut_count += len(stock.cuts)

        stock_parts_area = sum(p.width * p.height for p in stock.placements)
        total_used_measure += stock_parts_area
        total_placed_count += len(stock.placements)

        remnants: List[Rect2D] = []
        waste: List[Rect2D] = []

        for rect in stock.free_rects:
            if rect.width <= 0 or rect.height <= 0:
                continue

            is_remnant = _is_remnant_rect(rect, stock.grain, min_remnant_width, min_remnant_height)

            area = rect.width * rect.height
            if is_remnant:
                remnants.append(Rect2D(x=rect.x, y=rect.y, width=rect.width, height=rect.height))
                total_remnant_measure += area
            else:
                waste.append(Rect2D(x=rect.x, y=rect.y, width=rect.width, height=rect.height))
                total_waste_measure += area

        # Cut loss area (kerf * length, or less when the leftover was thinner than the kerf)
        total_waste_measure += stock.cut_loss_area

        result_stocks.append(StockResult2D(
            stock_id=stock.stock_id,
            index=stock.index,
            width=stock.width,
            height=stock.height,
            placements=stock.placements,
            cuts=stock.cuts,
            remnants=remnants,
            waste=waste,
        ))

    unplaced_parts = [
        UnplacedPart(part_id=pid, quantity=qty)
        for pid, qty in unplaced_parts_map.items()
    ]
    unplaced_count = sum(unplaced_parts_map.values())

    yield_rate = (total_used_measure / total_stock_measure) if total_stock_measure > 0 else 0.0

    result = OptimizationResult(
        dimension="2D",
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
    evaluation = SolutionEvaluation(
        unplaced_count=unplaced_count,
        total_cost=total_cost,
        stock_count=len(result_stocks),
        remnant_measure=total_remnant_measure,
        cut_count=cut_count,
    )
    return result, evaluation


def optimize_2d(
    stocks: List[Stock2D],
    parts: List[Part2D],
    kerf: float = 0.0,
    min_remnant_size: MinRemnantSize = None,
) -> OptimizationResult:
    """
    2D Guillotine Bin Packing Optimizer with Kerf, Grain, and Remnant constraints.
    Runs several greedy heuristics and returns the best solution (see evaluation.py).
    """
    validate_2d(stocks, parts, kerf, min_remnant_size)
    kerf = float(kerf)
    min_remnant_width = float(min_remnant_size.width) if (min_remnant_size and min_remnant_size.width is not None) else 0.0
    min_remnant_height = float(min_remnant_size.height) if (min_remnant_size and min_remnant_size.height is not None) else 0.0

    expanded_parts: List[Dict[str, Any]] = []
    for p in parts:
        qty = p.quantity if p.quantity is not None else 1
        for _ in range(qty):
            expanded_parts.append({
                "part_id": p.id,
                "name": p.name,
                "width": float(p.width),
                "height": float(p.height),
                "can_rotate": p.can_rotate if p.can_rotate is not None else True,
                "grain": p.grain or "none",
                "area": float(p.width) * float(p.height),
            })

    heuristics = (
        HEURISTICS_2D[:REDUCED_HEURISTIC_COUNT]
        if len(expanded_parts) > LARGE_INPUT_PIECES
        else HEURISTICS_2D
    )

    best: Optional[Tuple[OptimizationResult, SolutionEvaluation]] = None
    for heuristic in heuristics:
        active_stocks, unplaced_parts_map = _run_heuristic(stocks, expanded_parts, kerf, heuristic)
        candidate = _build_result(
            active_stocks,
            unplaced_parts_map,
            len(expanded_parts),
            min_remnant_width,
            min_remnant_height,
        )
        if best is None or is_better_evaluation(candidate[1], best[1]):
            best = candidate

    return best[0]
