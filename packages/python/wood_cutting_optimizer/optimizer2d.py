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
from .validate import validate_2d

# Tolerance for floating-point comparisons (e.g. 0.1 + 0.2 fitting into 0.3).
EPS = 1e-9


class FreeRect:
    def __init__(self, x: float, y: float, width: float, height: float):
        self.x = x
        self.y = y
        self.width = width
        self.height = height


class ActiveStock2D:
    def __init__(self, stock_id: str, index: int, width: float, height: float, grain: GrainDirection):
        self.stock_id = stock_id
        self.index = index
        self.width = width
        self.height = height
        self.grain = grain
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
        self.score = score


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


def find_best_fit(stock: ActiveStock2D, part: Dict[str, Any]) -> Optional[PlacementFit]:
    best_fit: Optional[PlacementFit] = None
    min_score = float("inf")

    pw = part["width"]
    ph = part["height"]
    can_rotate = part["can_rotate"]
    part_grain = part["grain"]
    stock_grain = stock.grain

    for i, free in enumerate(stock.free_rects):
        # Try unrotated
        if (
            pw <= free.width + EPS
            and ph <= free.height + EPS
            and is_orientation_allowed(stock_grain, part_grain, can_rotate, False)
        ):
            leftover_w = free.width - pw
            leftover_h = free.height - ph
            score = min(leftover_w, leftover_h)
            if score < min_score:
                min_score = score
                best_fit = PlacementFit(
                    rect_index=i,
                    rotated=False,
                    part_width=pw,
                    part_height=ph,
                    score=score,
                )

        # Try rotated (90 degrees)
        if (
            ph <= free.width + EPS
            and pw <= free.height + EPS
            and is_orientation_allowed(stock_grain, part_grain, can_rotate, True)
        ):
            leftover_w = free.width - ph
            leftover_h = free.height - pw
            score = min(leftover_w, leftover_h)
            if score < min_score:
                min_score = score
                best_fit = PlacementFit(
                    rect_index=i,
                    rotated=True,
                    part_width=ph,
                    part_height=pw,
                    score=score,
                )

    return best_fit


def place_part_in_stock(
    stock: ActiveStock2D,
    part: Dict[str, Any],
    fit: PlacementFit,
    kerf: float,
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

    # Shorter Leftover Axis Split (SLAS)
    split_horizontal = leftover_w <= leftover_h

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


def optimize_2d(
    stocks: List[Stock2D],
    parts: List[Part2D],
    kerf: float = 0.0,
    min_remnant_size: MinRemnantSize = None,
) -> OptimizationResult:
    validate_2d(stocks, parts, kerf, min_remnant_size)
    kerf = float(kerf)
    min_remnant_width = float(min_remnant_size.width) if (min_remnant_size and min_remnant_size.width is not None) else 0.0
    min_remnant_height = float(min_remnant_size.height) if (min_remnant_size and min_remnant_size.height is not None) else 0.0

    expanded_parts: List[Dict[str, Any]] = []
    total_parts_count = 0
    for p in parts:
        qty = p.quantity if p.quantity is not None else 1
        total_parts_count += qty
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

    # Sort descending by Area, then max dimension
    expanded_parts.sort(
        key=lambda x: (x["area"], max(x["width"], x["height"])),
        reverse=True,
    )

    stock_pool = []
    for s in stocks:
        stock_pool.append({
            "id": s.id,
            "width": float(s.width),
            "height": float(s.height),
            "grain": s.grain or "none",
            "cost": float(s.cost) if s.cost is not None else float(s.width) * float(s.height),
            "remaining_quantity": s.quantity if s.quantity is not None else 1,
        })

    active_stocks: List[ActiveStock2D] = []
    unplaced_parts_map: Dict[str, int] = {}
    global_stock_index = 0

    for part in expanded_parts:
        best_stock_idx = -1
        best_fit: Optional[PlacementFit] = None

        for s_idx, stock in enumerate(active_stocks):
            fit = find_best_fit(stock, part)
            if fit is not None:
                if best_fit is None or fit.score < best_fit.score:
                    best_fit = fit
                    best_stock_idx = s_idx

        if best_stock_idx != -1 and best_fit is not None:
            place_part_in_stock(active_stocks[best_stock_idx], part, best_fit, kerf)
        else:
            chosen_pool_idx = -1
            min_stock_area = float("inf")

            for p_idx, pool in enumerate(stock_pool):
                if pool["remaining_quantity"] > 0:
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

                    if can_fit_unrotated or can_fit_rotated:
                        area = pool["width"] * pool["height"]
                        if area < min_stock_area:
                            min_stock_area = area
                            chosen_pool_idx = p_idx

            if chosen_pool_idx != -1:
                chosen = stock_pool[chosen_pool_idx]
                chosen["remaining_quantity"] -= 1

                new_stock = ActiveStock2D(
                    stock_id=chosen["id"],
                    index=global_stock_index,
                    width=chosen["width"],
                    height=chosen["height"],
                    grain=chosen["grain"],
                )
                global_stock_index += 1

                fit = find_best_fit(new_stock, part)
                if fit is not None:
                    place_part_in_stock(new_stock, part, fit, kerf)
                    active_stocks.append(new_stock)
                else:
                    chosen["remaining_quantity"] += 1
                    unplaced_parts_map[part["part_id"]] = unplaced_parts_map.get(part["part_id"], 0) + 1
            else:
                unplaced_parts_map[part["part_id"]] = unplaced_parts_map.get(part["part_id"], 0) + 1

    # Summarize results
    result_stocks: List[StockResult2D] = []
    total_stock_measure = 0.0
    total_used_measure = 0.0
    total_waste_measure = 0.0
    total_remnant_measure = 0.0
    total_placed_count = 0

    for stock in active_stocks:
        stock_area = stock.width * stock.height
        total_stock_measure += stock_area

        stock_parts_area = sum(p.width * p.height for p in stock.placements)
        total_used_measure += stock_parts_area
        total_placed_count += len(stock.placements)

        remnants: List[Rect2D] = []
        waste: List[Rect2D] = []

        for rect in stock.free_rects:
            if rect.width <= 0 or rect.height <= 0:
                continue

            is_remnant = (
                rect.width >= min_remnant_width
                and rect.height >= min_remnant_height
                and (min_remnant_width > 0 or min_remnant_height > 0)
            )

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

    yield_rate = (total_used_measure / total_stock_measure) if total_stock_measure > 0 else 0.0

    return OptimizationResult(
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
