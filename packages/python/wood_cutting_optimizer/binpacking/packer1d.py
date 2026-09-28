from __future__ import annotations
import math
from typing import List, Optional, TypeVar, Dict, Any
from .types import (
    BinDefinition,
    ItemDefinition,
    BinPacking1DOptions,
    BinPacking1DResult,
    PackedBin,
    PackedItem,
    UnpackedItem,
    BinPacking1DSummary,
)

TBin = TypeVar("TBin")
TItem = TypeVar("TItem")

# Tolerance for floating-point comparisons (e.g. 0.1 + 0.2 fitting into 0.3).
EPS = 1e-9

_STRATEGIES = ("best-fit-decreasing", "first-fit-decreasing", "worst-fit-decreasing")
_BIN_SELECTIONS = ("smallest", "largest", "lowest-cost-ratio")


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_bin_packing_input(
    bins: List[BinDefinition],
    items: List[ItemDefinition],
    item_spacing: Any,
    strategy: Any,
    bin_selection: Any,
) -> None:
    if not _is_number(item_spacing) or item_spacing < 0:
        raise ValueError(f"item_spacing must be a finite number >= 0 (got {item_spacing})")
    if strategy not in _STRATEGIES:
        raise ValueError(f"Unsupported strategy: {strategy}")
    if bin_selection not in _BIN_SELECTIONS:
        raise ValueError(f"Unsupported bin_selection: {bin_selection}")
    for b in bins:
        if not _is_number(b.capacity) or b.capacity <= 0:
            raise ValueError(f'Bin "{b.id}": capacity must be a finite number > 0 (got {b.capacity})')
        if b.cost is not None and (not _is_number(b.cost) or b.cost < 0):
            raise ValueError(f'Bin "{b.id}": cost must be a finite number >= 0 (got {b.cost})')
        q = b.quantity if b.quantity is not None else 1
        if q != math.inf and (not isinstance(q, int) or isinstance(q, bool) or q < 0):
            raise ValueError(f'Bin "{b.id}": quantity must be an integer >= 0 or math.inf (got {q})')
    for it in items:
        if not _is_number(it.size) or it.size <= 0:
            raise ValueError(f'Item "{it.id}": size must be a finite number > 0 (got {it.size})')
        q = it.quantity if it.quantity is not None else 1
        if not isinstance(q, int) or isinstance(q, bool) or q < 0:
            raise ValueError(f'Item "{it.id}": quantity must be an integer >= 0 (got {q})')


class _ExpandedItem:
    def __init__(self, item_id: str, size: float, data: Any = None):
        self.item_id = item_id
        self.size = size
        self.data = data


class _ActiveBin:
    def __init__(self, bin_id: str, index: int, capacity: float, data: Any = None):
        self.bin_id = bin_id
        self.index = index
        self.capacity = capacity
        self.used_offset: float = 0.0
        self.items: List[PackedItem] = []
        self.data = data


class _PoolBin:
    def __init__(self, bin_id: str, capacity: float, cost: float, remaining_quantity: int, data: Any = None):
        self.bin_id = bin_id
        self.capacity = capacity
        self.cost = cost
        self.remaining_quantity = remaining_quantity
        self.data = data


def _choose_bin(bin_pool: List[_PoolBin], size: float, rule: str) -> int:
    """Chooses which bin type to open for an item. Returns -1 when no remaining bin can hold it."""
    chosen_pool_idx = -1
    best_key = float("inf")
    best_capacity = float("inf")

    for i, pool in enumerate(bin_pool):
        if pool.remaining_quantity <= 0 or pool.capacity < size - EPS:
            continue

        if rule == "smallest":
            key = pool.capacity
        elif rule == "largest":
            key = -pool.capacity
        else:  # lowest-cost-ratio
            key = pool.cost / pool.capacity

        # Ties are broken by the smaller capacity, then by input order
        if key < best_key - EPS or (abs(key - best_key) <= EPS and pool.capacity < best_capacity):
            best_key = key
            best_capacity = pool.capacity
            chosen_pool_idx = i

    return chosen_pool_idx


def bin_pack_1d(
    bins: List[BinDefinition[TBin]],
    items: List[ItemDefinition[TItem]],
    options: Optional[BinPacking1DOptions] = None,
) -> BinPacking1DResult[TBin, TItem]:
    if options is None:
        options = BinPacking1DOptions()

    item_spacing = options.item_spacing
    strategy = options.strategy
    bin_selection = options.bin_selection
    _validate_bin_packing_input(bins, items, item_spacing, strategy, bin_selection)
    item_spacing = float(item_spacing)

    # 1. Flatten items based on quantity
    expanded_items: List[_ExpandedItem] = []
    total_items_count = 0
    for item in items:
        qty = item.quantity if item.quantity is not None else 1
        total_items_count += qty
        for _ in range(qty):
            expanded_items.append(_ExpandedItem(
                item_id=item.id,
                size=float(item.size),
                data=item.data,
            ))

    # 2. Sort items descending by size
    expanded_items.sort(key=lambda x: x.size, reverse=True)

    # 3. Bin inventory pool
    bin_pool: List[_PoolBin] = [
        _PoolBin(
            bin_id=b.id,
            capacity=float(b.capacity),
            cost=float(b.cost) if b.cost is not None else float(b.capacity),
            remaining_quantity=b.quantity if b.quantity is not None else 1,
            data=b.data,
        )
        for b in bins
    ]

    active_bins: List[_ActiveBin] = []
    unpacked_items_map: Dict[str, Dict[str, Any]] = {}
    global_bin_index = 0

    # 4. Place items
    for item in expanded_items:
        chosen_bin_index = -1

        if strategy == "best-fit-decreasing":
            min_remaining_space = float("inf")
            for i, bin_obj in enumerate(active_bins):
                additional_space = (item_spacing + item.size) if len(bin_obj.items) > 0 else item.size
                space_left = bin_obj.capacity - bin_obj.used_offset
                if space_left >= additional_space - EPS:
                    remaining = space_left - additional_space
                    if remaining < min_remaining_space:
                        min_remaining_space = remaining
                        chosen_bin_index = i
        elif strategy == "first-fit-decreasing":
            for i, bin_obj in enumerate(active_bins):
                additional_space = (item_spacing + item.size) if len(bin_obj.items) > 0 else item.size
                space_left = bin_obj.capacity - bin_obj.used_offset
                if space_left >= additional_space - EPS:
                    chosen_bin_index = i
                    break
        elif strategy == "worst-fit-decreasing":
            max_remaining_space = -1.0
            for i, bin_obj in enumerate(active_bins):
                additional_space = (item_spacing + item.size) if len(bin_obj.items) > 0 else item.size
                space_left = bin_obj.capacity - bin_obj.used_offset
                if space_left >= additional_space - EPS:
                    remaining = space_left - additional_space
                    if remaining > max_remaining_space:
                        max_remaining_space = remaining
                        chosen_bin_index = i

        if chosen_bin_index != -1:
            bin_obj = active_bins[chosen_bin_index]
            start_offset = (bin_obj.used_offset + item_spacing) if len(bin_obj.items) > 0 else bin_obj.used_offset
            bin_obj.items.append(PackedItem(
                id=item.item_id,
                size=item.size,
                offset=start_offset,
                data=item.data,
            ))
            bin_obj.used_offset = start_offset + item.size
        else:
            # Open new bin from pool
            chosen_pool_idx = _choose_bin(bin_pool, item.size, bin_selection)

            if chosen_pool_idx != -1:
                chosen = bin_pool[chosen_pool_idx]
                chosen.remaining_quantity -= 1

                new_bin = _ActiveBin(
                    bin_id=chosen.bin_id,
                    index=global_bin_index,
                    capacity=chosen.capacity,
                    data=chosen.data,
                )
                global_bin_index += 1

                new_bin.items.append(PackedItem(
                    id=item.item_id,
                    size=item.size,
                    offset=0.0,
                    data=item.data,
                ))
                new_bin.used_offset = item.size
                active_bins.append(new_bin)
            else:
                if item.item_id in unpacked_items_map:
                    unpacked_items_map[item.item_id]["quantity"] += 1
                else:
                    unpacked_items_map[item.item_id] = {
                        "size": item.size,
                        "quantity": 1,
                        "data": item.data,
                    }

    # 5. Summarize
    total_capacity = 0.0
    total_item_size = 0.0
    total_items_packed = 0

    result_bins: List[PackedBin[TBin, TItem]] = []
    for bin_obj in active_bins:
        total_capacity += bin_obj.capacity
        items_size = sum(it.size for it in bin_obj.items)
        total_item_size += items_size
        total_items_packed += len(bin_obj.items)

        remaining_capacity = max(0.0, bin_obj.capacity - bin_obj.used_offset)
        utilization = (items_size / bin_obj.capacity) if bin_obj.capacity > 0 else 0.0

        result_bins.append(PackedBin(
            bin_id=bin_obj.bin_id,
            index=bin_obj.index,
            capacity=bin_obj.capacity,
            used_capacity=bin_obj.used_offset,
            remaining_capacity=round(remaining_capacity, 6),
            utilization=round(utilization, 4),
            items=bin_obj.items,
            data=bin_obj.data,
        ))

    unpacked_items: List[UnpackedItem[TItem]] = [
        UnpackedItem(
            id=item_id,
            size=val["size"],
            quantity=val["quantity"],
            data=val["data"],
        )
        for item_id, val in unpacked_items_map.items()
    ]

    average_utilization = (total_item_size / total_capacity) if total_capacity > 0 else 0.0

    return BinPacking1DResult(
        bins=result_bins,
        unpacked_items=unpacked_items,
        summary=BinPacking1DSummary(
            bins_used=len(result_bins),
            items_packed=total_items_packed,
            items_total=total_items_count,
            total_capacity=round(total_capacity, 6),
            total_item_size=round(total_item_size, 6),
            average_utilization=round(average_utilization, 4),
        ),
    )
