from __future__ import annotations
from dataclasses import dataclass

RELATIVE_EPS = 1e-9


@dataclass
class SolutionEvaluation:
    """Metrics used to compare candidate solutions produced by different heuristics."""
    unplaced_count: int      # Number of part pieces that could not be placed
    total_cost: float        # Sum of `cost` of used stocks (defaults to stock area/length)
    stock_count: int         # Number of stocks used
    remnant_measure: float   # Total reusable remnant area/length
    cut_count: int           # Number of cuts (less work at the saw)


def _less_than(a: float, b: float) -> bool:
    return a < b - RELATIVE_EPS * max(1.0, abs(a), abs(b))


def is_better_evaluation(a: SolutionEvaluation, b: SolutionEvaluation) -> bool:
    """
    Returns True when `a` is strictly better than `b`. Criteria in priority order:
    1. fewer unplaced parts
    2. lower total stock cost
    3. fewer stocks
    4. more reusable remnant
    5. fewer cuts
    """
    if a.unplaced_count != b.unplaced_count:
        return a.unplaced_count < b.unplaced_count
    if _less_than(a.total_cost, b.total_cost):
        return True
    if _less_than(b.total_cost, a.total_cost):
        return False
    if a.stock_count != b.stock_count:
        return a.stock_count < b.stock_count
    if _less_than(b.remnant_measure, a.remnant_measure):
        return True
    if _less_than(a.remnant_measure, b.remnant_measure):
        return False
    return a.cut_count < b.cut_count
