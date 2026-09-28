from __future__ import annotations
from typing import Any, List
from .types import StockUsage


def compute_stock_usage(stocks: List[Any], used_stock_indices: List[int]) -> List[StockUsage]:
    """
    Aggregates how many of each input stock entry were used, in input order (a purchase list).
    `cost` is the unit cost times the quantity, or None when the stock has no cost.
    """
    counts = [0] * len(stocks)
    for i in used_stock_indices:
        counts[i] += 1
    usage: List[StockUsage] = []
    for i, s in enumerate(stocks):
        if counts[i] == 0:
            continue
        usage.append(StockUsage(
            stock_id=s.id,
            quantity=counts[i],
            cost=None if s.cost is None else round(float(s.cost) * counts[i], 4),
        ))
    return usage
