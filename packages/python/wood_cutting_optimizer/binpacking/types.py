from __future__ import annotations
from dataclasses import dataclass, field
from typing import TypeVar, Generic, Optional, List, Any, Literal

TBin = TypeVar("TBin")
TItem = TypeVar("TItem")

PackingStrategy1D = Literal["best-fit-decreasing", "first-fit-decreasing", "worst-fit-decreasing"]


@dataclass
class BinDefinition(Generic[TBin]):
    id: str
    capacity: float
    quantity: Optional[int] = 1
    cost: Optional[float] = None
    data: Optional[TBin] = None


@dataclass
class ItemDefinition(Generic[TItem]):
    id: str
    size: float
    quantity: Optional[int] = 1
    data: Optional[TItem] = None


@dataclass
class BinPacking1DOptions:
    item_spacing: float = 0.0
    strategy: PackingStrategy1D = "best-fit-decreasing"


@dataclass
class PackedItem(Generic[TItem]):
    id: str
    size: float
    offset: float
    data: Optional[TItem] = None


@dataclass
class PackedBin(Generic[TBin, TItem]):
    bin_id: str
    index: int
    capacity: float
    used_capacity: float
    remaining_capacity: float
    utilization: float
    items: List[PackedItem[TItem]] = field(default_factory=list)
    data: Optional[TBin] = None


@dataclass
class UnpackedItem(Generic[TItem]):
    id: str
    size: float
    quantity: int
    data: Optional[TItem] = None


@dataclass
class BinPacking1DSummary:
    bins_used: int
    items_packed: int
    items_total: int
    total_capacity: float
    total_item_size: float
    average_utilization: float


@dataclass
class BinPacking1DResult(Generic[TBin, TItem]):
    bins: List[PackedBin[TBin, TItem]]
    unpacked_items: List[UnpackedItem[TItem]]
    summary: BinPacking1DSummary
