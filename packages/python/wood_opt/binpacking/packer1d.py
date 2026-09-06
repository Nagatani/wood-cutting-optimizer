from __future__ import annotations
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


def bin_pack_1d(
    bins: List[BinDefinition[TBin]],
    items: List[ItemDefinition[TItem]],
    options: Optional[BinPacking1DOptions] = None,
) -> BinPacking1DResult[TBin, TItem]:
    if options is None:
        options = BinPacking1DOptions()

    item_spacing = max(0.0, float(options.item_spacing))
    strategy = options.strategy

    # 1. Flatten items based on quantity
    expanded_items: List[_ExpandedItem] = []
    total_items_count = 0
    for item in items:
        qty = max(0, item.quantity if item.quantity is not None else 1)
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
                if space_left >= additional_space:
                    remaining = space_left - additional_space
                    if remaining < min_remaining_space:
                        min_remaining_space = remaining
                        chosen_bin_index = i
        elif strategy == "first-fit-decreasing":
            for i, bin_obj in enumerate(active_bins):
                additional_space = (item_spacing + item.size) if len(bin_obj.items) > 0 else item.size
                space_left = bin_obj.capacity - bin_obj.used_offset
                if space_left >= additional_space:
                    chosen_bin_index = i
                    break
        elif strategy == "worst-fit-decreasing":
            max_remaining_space = -1.0
            for i, bin_obj in enumerate(active_bins):
                additional_space = (item_spacing + item.size) if len(bin_obj.items) > 0 else item.size
                space_left = bin_obj.capacity - bin_obj.used_offset
                if space_left >= additional_space:
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
            chosen_pool_idx = -1
            min_waste = float("inf")

            for i, pool in enumerate(bin_pool):
                if pool.remaining_quantity > 0 and pool.capacity >= item.size:
                    waste = pool.capacity - item.size
                    if waste < min_waste:
                        min_waste = waste
                        chosen_pool_idx = i

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
