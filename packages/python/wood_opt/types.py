from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Literal, Dict, Any

Dimension = Literal["1D", "2D"]
GrainDirection = Literal["none", "length", "width"]


@dataclass
class MinRemnantSize:
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None


@dataclass
class Stock1D:
    id: str
    length: float
    quantity: int = 1
    cost: Optional[float] = None


@dataclass
class Part1D:
    id: str
    length: float
    name: Optional[str] = None
    quantity: int = 1


@dataclass
class Stock2D:
    id: str
    width: float
    height: float
    quantity: int = 1
    cost: Optional[float] = None
    grain: GrainDirection = "none"


@dataclass
class Part2D:
    id: str
    width: float
    height: float
    name: Optional[str] = None
    quantity: int = 1
    can_rotate: bool = True
    grain: GrainDirection = "none"


@dataclass
class Cut1D:
    x: float
    kerf: float
    step: int


@dataclass
class Placement1D:
    part_id: str
    x: float
    length: float


@dataclass
class Segment1D:
    x: float
    length: float


@dataclass
class StockResult1D:
    stock_id: str
    index: int
    length: float
    placements: List[Placement1D] = field(default_factory=list)
    cuts: List[Cut1D] = field(default_factory=list)
    remnants: List[Segment1D] = field(default_factory=list)
    waste: List[Segment1D] = field(default_factory=list)


@dataclass
class Cut2D:
    type: Literal["horizontal", "vertical"]
    x: float
    y: float
    length: float
    kerf: float
    step: int


@dataclass
class Placement2D:
    part_id: str
    x: float
    y: float
    width: float
    height: float
    rotated: bool


@dataclass
class Rect2D:
    x: float
    y: float
    width: float
    height: float


@dataclass
class StockResult2D:
    stock_id: str
    index: int
    width: float
    height: float
    placements: List[Placement2D] = field(default_factory=list)
    cuts: List[Cut2D] = field(default_factory=list)
    remnants: List[Rect2D] = field(default_factory=list)
    waste: List[Rect2D] = field(default_factory=list)


@dataclass
class Summary:
    stock_count_used: int
    parts_placed: int
    parts_total: int
    total_stock_measure: float
    total_used_measure: float
    total_waste_measure: float
    total_remnant_measure: float
    yield_rate: float


@dataclass
class UnplacedPart:
    part_id: str
    quantity: int


@dataclass
class OptimizationResult:
    dimension: Dimension
    summary: Summary
    stocks: List[Any]  # StockResult1D or StockResult2D
    unplaced_parts: List[UnplacedPart]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
