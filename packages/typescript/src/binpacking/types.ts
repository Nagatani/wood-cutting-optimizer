/**
 * Types for generic 1D Bin Packing
 */

export type PackingStrategy1D = 'best-fit-decreasing' | 'first-fit-decreasing' | 'worst-fit-decreasing';

export interface BinDefinition<T = unknown> {
  id: string;
  capacity: number;
  quantity?: number; // Available quantity of this bin type (defaults to 1, Infinity for unlimited)
  cost?: number;     // Cost or selection priority (lower cost / higher fit priority)
  data?: T;          // Optional user metadata
}

export interface ItemDefinition<T = unknown> {
  id: string;
  size: number;
  quantity?: number; // Number of copies of this item (defaults to 1)
  data?: T;          // Optional user metadata
}

export interface BinPacking1DOptions {
  /**
   * Spacing / gap required between adjacent items in the same bin.
   * Defaults to 0 (no spacing). In cutting problems, this corresponds to kerf (blade width).
   */
  itemSpacing?: number;

  /**
   * Heuristic algorithm strategy to use.
   * Defaults to 'best-fit-decreasing'.
   */
  strategy?: PackingStrategy1D;
}

export interface PackedItem<T = unknown> {
  id: string;
  size: number;
  offset: number;    // Starting offset/position in the bin
  data?: T;
}

export interface PackedBin<TBin = unknown, TItem = unknown> {
  binId: string;
  index: number;
  capacity: number;
  usedCapacity: number;
  remainingCapacity: number;
  utilization: number; // usedCapacity / capacity (0.0 - 1.0)
  items: PackedItem<TItem>[];
  data?: TBin;
}

export interface UnpackedItem<T = unknown> {
  id: string;
  size: number;
  quantity: number;
  data?: T;
}

export interface BinPacking1DSummary {
  binsUsed: number;
  itemsPacked: number;
  itemsTotal: number;
  totalCapacity: number;
  totalItemSize: number;
  averageUtilization: number;
}

export interface BinPacking1DResult<TBin = unknown, TItem = unknown> {
  bins: PackedBin<TBin, TItem>[];
  unpackedItems: UnpackedItem<TItem>[];
  summary: BinPacking1DSummary;
}
