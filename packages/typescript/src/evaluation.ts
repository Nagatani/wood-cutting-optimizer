/**
 * Metrics used to compare candidate solutions produced by different heuristics.
 */
export interface SolutionEvaluation {
  unplacedCount: number;  // Number of part pieces that could not be placed
  totalCost: number;      // Sum of `cost` of used stocks (defaults to stock area/length)
  stockCount: number;     // Number of stocks used
  remnantMeasure: number; // Total reusable remnant area/length
  cutCount: number;       // Number of cuts (less work at the saw)
}

const RELATIVE_EPS = 1e-9;

function lessThan(a: number, b: number): boolean {
  return a < b - RELATIVE_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Returns true when `a` is strictly better than `b`. Criteria in priority order:
 * 1. fewer unplaced parts
 * 2. lower total stock cost
 * 3. fewer stocks
 * 4. more reusable remnant
 * 5. fewer cuts
 */
export function isBetterEvaluation(a: SolutionEvaluation, b: SolutionEvaluation): boolean {
  if (a.unplacedCount !== b.unplacedCount) return a.unplacedCount < b.unplacedCount;
  if (lessThan(a.totalCost, b.totalCost)) return true;
  if (lessThan(b.totalCost, a.totalCost)) return false;
  if (a.stockCount !== b.stockCount) return a.stockCount < b.stockCount;
  if (lessThan(b.remnantMeasure, a.remnantMeasure)) return true;
  if (lessThan(a.remnantMeasure, b.remnantMeasure)) return false;
  return a.cutCount < b.cutCount;
}
