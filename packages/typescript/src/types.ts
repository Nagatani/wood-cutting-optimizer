/**
 * Types definition for wood-cutting-optimizer
 * Conforms to specification/schema.json
 */

export type Dimension = '1D' | '2D';

export type GrainDirection = 'none' | 'length' | 'width';

export interface MinRemnantSize {
  length?: number;
  width?: number;
  height?: number;
}

export interface Stock1D {
  id: string;
  length: number;
  quantity?: number;
  cost?: number;
}

export interface Part1D {
  id: string;
  name?: string;
  length: number;
  quantity?: number;
}

export interface Stock2D {
  id: string;
  width: number;
  height: number;
  quantity?: number;
  cost?: number;
  grain?: GrainDirection;
}

export interface Part2D {
  id: string;
  name?: string;
  width: number;
  height: number;
  quantity?: number;
  can_rotate?: boolean;
  grain?: GrainDirection;
}

export interface InputRequest {
  dimension: Dimension;
  kerf?: number;
  min_remnant_size?: MinRemnantSize;
  stocks: (Stock1D | Stock2D)[];
  parts: (Part1D | Part2D)[];
}

export interface Cut1D {
  x: number;
  kerf: number;
  step: number;
}

export interface Placement1D {
  part_id: string;
  x: number;
  length: number;
}

export interface Segment1D {
  x: number;
  length: number;
}

export interface StockResult1D {
  stock_id: string;
  index: number;
  length: number;
  placements: Placement1D[];
  cuts: Cut1D[];
  remnants: Segment1D[];
  waste: Segment1D[];
}

export interface Cut2D {
  type: 'horizontal' | 'vertical';
  x: number;
  y: number;
  length: number;
  kerf: number;
  step: number;
}

export interface Placement2D {
  part_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
}

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StockResult2D {
  stock_id: string;
  index: number;
  width: number;
  height: number;
  placements: Placement2D[];
  cuts: Cut2D[];
  remnants: Rect2D[];
  waste: Rect2D[];
}

export interface Summary {
  stock_count_used: number;
  parts_placed: number;
  parts_total: number;
  total_stock_measure: number;
  total_used_measure: number;
  total_waste_measure: number;
  total_remnant_measure: number;
  yield_rate: number;
}

export interface UnplacedPart {
  part_id: string;
  quantity: number;
}

export interface OptimizationResult {
  dimension: Dimension;
  summary: Summary;
  stocks: (StockResult1D | StockResult2D)[];
  unplaced_parts: UnplacedPart[];
}
