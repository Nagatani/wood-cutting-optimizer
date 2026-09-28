import {
  InputRequest,
  OptimizationResult,
  Stock2D,
  Part2D,
  StockResult2D,
  Placement2D,
  Cut2D,
  Rect2D,
  UnplacedPart,
  GrainDirection,
} from './types.js';
import { validateInput, resolveStockQuantity } from './validate.js';
import { isBetterEvaluation, SolutionEvaluation } from './evaluation.js';
import { computeStockUsage } from './usage.js';

/** Tolerance for floating-point comparisons (e.g. 0.1 + 0.2 fitting into 0.3). */
const EPS = 1e-9;

/** Order in which parts are placed (all descending). */
type SortRule2D = 'area' | 'long-side' | 'short-side' | 'perimeter';
/** How to score a free rectangle for a part (lower is better). */
type FitRule2D = 'best-short-side' | 'best-long-side' | 'best-area';
/** Which guillotine cut to make first after placing a part. */
type SplitRule2D = 'shorter-leftover-axis' | 'longer-leftover-axis' | 'min-area' | 'max-area';
/** Which stock to open when a part fits in no open stock. */
type StockRule2D = 'smallest' | 'largest' | 'lowest-cost-ratio';

interface Heuristic2D {
  sort: SortRule2D;
  fit: FitRule2D;
  split: SplitRule2D;
  stock: StockRule2D;
}

const SORT_RULES: SortRule2D[] = ['area', 'long-side', 'short-side', 'perimeter'];
const FIT_RULES: FitRule2D[] = ['best-short-side', 'best-long-side', 'best-area'];
const SPLIT_RULES: SplitRule2D[] = ['shorter-leftover-axis', 'longer-leftover-axis', 'min-area', 'max-area'];
const STOCK_RULES: StockRule2D[] = ['smallest', 'largest', 'lowest-cost-ratio'];

/**
 * All heuristic combinations tried by optimize2D.
 * The first entry is the baseline (area / BSSF / SLAS / smallest stock); later entries
 * only replace it when they produce a strictly better solution.
 */
const HEURISTICS_2D: Heuristic2D[] = [];
for (const sort of SORT_RULES) {
  for (const fit of FIT_RULES) {
    for (const split of SPLIT_RULES) {
      for (const stock of STOCK_RULES) {
        HEURISTICS_2D.push({ sort, fit, split, stock });
      }
    }
  }
}

/**
 * Heuristics are tried in list order, so larger inputs try only a prefix to keep runtime bounded:
 * above LARGE_INPUT_PIECES part pieces only the baseline sort order (36 heuristics), and above
 * HUGE_INPUT_PIECES only the baseline sort and fit rules (12 heuristics).
 */
const LARGE_INPUT_PIECES = 500;
const HUGE_INPUT_PIECES = 2000;

function heuristicCount(pieces: number): number {
  if (pieces > HUGE_INPUT_PIECES) return SPLIT_RULES.length * STOCK_RULES.length;
  if (pieces > LARGE_INPUT_PIECES) return FIT_RULES.length * SPLIT_RULES.length * STOCK_RULES.length;
  return HEURISTICS_2D.length;
}

interface ExpandedPart2D {
  partId: string;
  name?: string;
  width: number;
  height: number;
  canRotate: boolean;
  grain: GrainDirection;
  area: number;
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StockPoolItem {
  id: string;
  width: number;
  height: number;
  trim: number;
  grain: GrainDirection;
  cost: number;
  remainingQuantity: number;
}

interface ActiveStock2D {
  stockId: string;
  stockIndex: number; // Index into input.stocks
  index: number;
  width: number;
  height: number;
  trim: number;
  grain: GrainDirection;
  cost: number;
  freeRects: FreeRect[];
  placements: Placement2D[];
  cuts: Cut2D[];
  cutStepCount: number;
  cutLossArea: number; // Actual material removed by the blade
  // Largest free width / height over all free rects (for skipping stocks that cannot fit a part)
  maxFreeWidth: number;
  maxFreeHeight: number;
}

interface PlacementFit {
  rectIndex: number;
  rotated: boolean;
  partWidth: number;
  partHeight: number;
  score: number; // Lower is better (depends on FitRule2D)
}

/**
 * Checks if a part orientation is allowed given the stock and part grain settings.
 */
function isOrientationAllowed(
  stockGrain: GrainDirection,
  partGrain: GrainDirection,
  canRotate: boolean,
  rotated: boolean
): boolean {
  if (rotated && !canRotate) {
    return false;
  }

  // If either has no grain direction, orientation is free (subject only to canRotate)
  if (stockGrain === 'none' || partGrain === 'none') {
    return true;
  }

  // Both have grain direction.
  // stockGrain "length" means grain along height; "width" means along width.
  // When unrotated, part's grain aligns directly with stock's grain.
  if (stockGrain === partGrain) {
    // Grain matches when NOT rotated
    return !rotated;
  } else {
    // Grain matches when rotated by 90 degrees
    return rotated;
  }
}

/**
 * Returns the [primary, secondary] sort keys of a part (sorted descending).
 */
function sortKeys(part: ExpandedPart2D, rule: SortRule2D): [number, number] {
  const longSide = Math.max(part.width, part.height);
  const shortSide = Math.min(part.width, part.height);
  switch (rule) {
    case 'area':
      return [part.area, longSide];
    case 'long-side':
      return [longSide, shortSide];
    case 'short-side':
      return [shortSide, longSide];
    case 'perimeter':
      return [part.width + part.height, longSide];
  }
}

/**
 * 2D Guillotine Bin Packing Optimizer with Kerf, Grain, and Remnant constraints.
 * Runs several greedy heuristics and returns the best solution (see evaluation.ts).
 */
export function optimize2D(input: InputRequest): OptimizationResult {
  validateInput(input);
  const kerf = input.kerf ?? 0;
  const minRemnantWidth = input.min_remnant_size?.width ?? 0;
  const minRemnantHeight = input.min_remnant_size?.height ?? 0;

  // Flatten parts
  const expandedParts: ExpandedPart2D[] = [];
  for (const p of input.parts as Part2D[]) {
    const qty = p.quantity ?? 1;
    for (let i = 0; i < qty; i++) {
      expandedParts.push({
        partId: p.id,
        name: p.name,
        width: p.width,
        height: p.height,
        canRotate: p.can_rotate ?? true,
        grain: p.grain ?? 'none',
        area: p.width * p.height,
      });
    }
  }

  const heuristics = HEURISTICS_2D.slice(0, heuristicCount(expandedParts.length));

  let best: { result: OptimizationResult; evaluation: SolutionEvaluation } | null = null;
  for (const heuristic of heuristics) {
    const activeStocksAndUnplaced = runHeuristic(input.stocks as Stock2D[], expandedParts, kerf, heuristic);
    const candidate = buildResult(
      input.stocks as Stock2D[],
      activeStocksAndUnplaced.activeStocks,
      activeStocksAndUnplaced.unplacedPartsMap,
      expandedParts.length,
      minRemnantWidth,
      minRemnantHeight
    );
    if (best === null || isBetterEvaluation(candidate.evaluation, best.evaluation)) {
      best = candidate;
    }
  }

  return best!.result;
}

/**
 * Runs one greedy packing pass with the given heuristic.
 */
function runHeuristic(
  stocks: Stock2D[],
  parts: ExpandedPart2D[],
  kerf: number,
  heuristic: Heuristic2D
): { activeStocks: ActiveStock2D[]; unplacedPartsMap: Map<string, number> } {
  // Sort parts descending by the heuristic's keys (stable, so ties keep input order)
  const sortedParts = parts.slice().sort((a, b) => {
    const [a1, a2] = sortKeys(a, heuristic.sort);
    const [b1, b2] = sortKeys(b, heuristic.sort);
    if (b1 !== a1) {
      return b1 - a1;
    }
    return b2 - a2;
  });

  // Stock inventory pool
  const stockPool: StockPoolItem[] = stocks.map((s) => ({
    id: s.id,
    width: s.width,
    height: s.height,
    trim: s.trim ?? 0,
    grain: s.grain ?? 'none',
    cost: s.cost ?? s.width * s.height,
    remainingQuantity: resolveStockQuantity(s.quantity),
  }));

  const activeStocks: ActiveStock2D[] = [];
  const unplacedPartsMap = new Map<string, number>();

  let globalStockIndex = 0;

  for (const part of sortedParts) {
    let bestStockIdx = -1;
    let bestFit: PlacementFit | null = null;

    // Search through existing open active stocks
    for (let sIdx = 0; sIdx < activeStocks.length; sIdx++) {
      const stock = activeStocks[sIdx];
      if (!mayFit(stock, part)) continue;
      const fit = findBestFit(stock, part, heuristic.fit);
      if (fit !== null) {
        if (bestFit === null || fit.score < bestFit.score) {
          bestFit = fit;
          bestStockIdx = sIdx;
        }
      }
    }

    if (bestStockIdx !== -1 && bestFit !== null) {
      // Place in existing stock
      placePartInStock(activeStocks[bestStockIdx], part, bestFit, kerf, heuristic.split);
      continue;
    }

    // Open a new stock sheet
    const chosenPoolIdx = chooseStock(stockPool, part, heuristic.stock);
    if (chosenPoolIdx === -1) {
      // Part cannot be placed in any stock
      unplacedPartsMap.set(part.partId, (unplacedPartsMap.get(part.partId) ?? 0) + 1);
      continue;
    }

    const chosen = stockPool[chosenPoolIdx];
    chosen.remainingQuantity -= 1;

    const newStock: ActiveStock2D = {
      stockId: chosen.id,
      stockIndex: chosenPoolIdx,
      index: globalStockIndex++,
      width: chosen.width,
      height: chosen.height,
      trim: chosen.trim,
      grain: chosen.grain,
      cost: chosen.cost,
      // The usable area inside the trimmed edges
      freeRects: [
        {
          x: chosen.trim,
          y: chosen.trim,
          width: chosen.width - chosen.trim * 2,
          height: chosen.height - chosen.trim * 2,
        },
      ],
      placements: [],
      cuts: [],
      cutStepCount: 0,
      cutLossArea: 0,
      maxFreeWidth: chosen.width - chosen.trim * 2,
      maxFreeHeight: chosen.height - chosen.trim * 2,
    };

    const fit = findBestFit(newStock, part, heuristic.fit);
    if (fit !== null) {
      placePartInStock(newStock, part, fit, kerf, heuristic.split);
      activeStocks.push(newStock);
    } else {
      // This should not happen since we checked feasibility, but fallback
      chosen.remainingQuantity += 1;
      globalStockIndex--;
      unplacedPartsMap.set(part.partId, (unplacedPartsMap.get(part.partId) ?? 0) + 1);
    }
  }

  return { activeStocks, unplacedPartsMap };
}

/**
 * Quick necessary condition for a part to fit anywhere in the stock (either orientation).
 * Skipping stocks that fail it does not change the result, only the runtime.
 */
function mayFit(stock: ActiveStock2D, part: ExpandedPart2D): boolean {
  const w = stock.maxFreeWidth + EPS;
  const h = stock.maxFreeHeight + EPS;
  return (part.width <= w && part.height <= h) || (part.height <= w && part.width <= h);
}

function updateMaxFreeSize(stock: ActiveStock2D): void {
  let maxWidth = 0;
  let maxHeight = 0;
  for (const free of stock.freeRects) {
    if (free.width > maxWidth) maxWidth = free.width;
    if (free.height > maxHeight) maxHeight = free.height;
  }
  stock.maxFreeWidth = maxWidth;
  stock.maxFreeHeight = maxHeight;
}

/**
 * Chooses which stock type to open for a part that fits in no open stock.
 * Returns -1 when no remaining stock can hold the part.
 */
function chooseStock(stockPool: StockPoolItem[], part: ExpandedPart2D, rule: StockRule2D): number {
  let chosenPoolIdx = -1;
  let bestKey = Infinity;
  let bestArea = Infinity;

  for (let pIdx = 0; pIdx < stockPool.length; pIdx++) {
    const pool = stockPool[pIdx];
    if (pool.remainingQuantity <= 0) continue;

    // Check if part can fit in the usable (trimmed) area at all (including grain constraints)
    const usableWidth = pool.width - pool.trim * 2;
    const usableHeight = pool.height - pool.trim * 2;
    const canFitUnrotated =
      part.width <= usableWidth + EPS &&
      part.height <= usableHeight + EPS &&
      isOrientationAllowed(pool.grain, part.grain, part.canRotate, false);

    const canFitRotated =
      part.height <= usableWidth + EPS &&
      part.width <= usableHeight + EPS &&
      isOrientationAllowed(pool.grain, part.grain, part.canRotate, true);

    if (!canFitUnrotated && !canFitRotated) continue;

    const area = usableWidth * usableHeight;
    let key: number;
    switch (rule) {
      case 'smallest':
        key = area;
        break;
      case 'largest':
        key = -area;
        break;
      case 'lowest-cost-ratio':
        key = pool.cost / area;
        break;
    }
    // Ties are broken by the smaller area, then by input order
    if (key < bestKey - EPS || (Math.abs(key - bestKey) <= EPS && area < bestArea)) {
      bestKey = key;
      bestArea = area;
      chosenPoolIdx = pIdx;
    }
  }

  return chosenPoolIdx;
}

/**
 * Builds the output result and its evaluation from a finished packing pass.
 */
function buildResult(
  stocks: Stock2D[],
  activeStocks: ActiveStock2D[],
  unplacedPartsMap: Map<string, number>,
  totalPartsCount: number,
  minRemnantWidth: number,
  minRemnantHeight: number
): { result: OptimizationResult; evaluation: SolutionEvaluation } {
  const resultStocks: StockResult2D[] = [];
  let totalStockMeasure = 0;
  let totalUsedMeasure = 0;
  let totalWasteMeasure = 0;
  let totalRemnantMeasure = 0;
  let totalPlacedCount = 0;
  let totalCost = 0;
  let cutCount = 0;

  for (const stock of activeStocks) {
    const stockArea = stock.width * stock.height;
    totalStockMeasure += stockArea;
    totalCost += stock.cost;
    cutCount += stock.cuts.length;

    let stockPartsArea = 0;
    for (const p of stock.placements) {
      stockPartsArea += p.width * p.height;
    }
    totalUsedMeasure += stockPartsArea;
    totalPlacedCount += stock.placements.length;

    const remnants: Rect2D[] = [];
    const waste: Rect2D[] = trimStrips(stock);
    for (const strip of waste) {
      totalWasteMeasure += strip.width * strip.height;
    }

    for (const rect of stock.freeRects) {
      if (rect.width <= 0 || rect.height <= 0) continue;

      const isRemnant = isRemnantRect(rect, stock.grain, minRemnantWidth, minRemnantHeight);

      const area = rect.width * rect.height;
      if (isRemnant) {
        remnants.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
        totalRemnantMeasure += area;
      } else {
        waste.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
        totalWasteMeasure += area;
      }
    }

    // Cut loss area (kerf * length, or less when the leftover was thinner than the kerf)
    totalWasteMeasure += stock.cutLossArea;

    resultStocks.push({
      stock_id: stock.stockId,
      index: stock.index,
      width: stock.width,
      height: stock.height,
      placements: stock.placements,
      cuts: stock.cuts,
      remnants,
      waste,
    });
  }

  const unplaced_parts: UnplacedPart[] = [];
  let unplacedCount = 0;
  for (const [partId, qty] of unplacedPartsMap.entries()) {
    unplaced_parts.push({ part_id: partId, quantity: qty });
    unplacedCount += qty;
  }

  const yieldRate = totalStockMeasure > 0 ? totalUsedMeasure / totalStockMeasure : 0;

  const result: OptimizationResult = {
    dimension: '2D',
    summary: {
      stock_count_used: resultStocks.length,
      parts_placed: totalPlacedCount,
      parts_total: totalPartsCount,
      total_stock_measure: Number(totalStockMeasure.toFixed(4)),
      total_used_measure: Number(totalUsedMeasure.toFixed(4)),
      total_waste_measure: Number(totalWasteMeasure.toFixed(4)),
      total_remnant_measure: Number(totalRemnantMeasure.toFixed(4)),
      yield_rate: Number(yieldRate.toFixed(4)),
      stock_usage: computeStockUsage(
        stocks,
        activeStocks.map((s) => s.stockIndex)
      ),
    },
    stocks: resultStocks,
    unplaced_parts,
  };

  return {
    result,
    evaluation: {
      unplacedCount,
      totalCost,
      stockCount: resultStocks.length,
      remnantMeasure: totalRemnantMeasure,
      cutCount,
    },
  };
}

/**
 * Strips removed by the edge trim (top, bottom, left, right), reported as waste.
 */
function trimStrips(stock: ActiveStock2D): Rect2D[] {
  const t = stock.trim;
  if (t <= 0) return [];
  const innerHeight = stock.height - t * 2;
  return [
    { x: 0, y: 0, width: stock.width, height: t },
    { x: 0, y: stock.height - t, width: stock.width, height: t },
    { x: 0, y: t, width: t, height: innerHeight },
    { x: stock.width - t, y: t, width: t, height: innerHeight },
  ];
}

/**
 * A leftover rect is a reusable remnant when it meets min_remnant_size.
 * Without grain the remnant can be turned, so either orientation qualifies;
 * with grain the orientation is fixed.
 */
function isRemnantRect(
  rect: FreeRect,
  stockGrain: GrainDirection,
  minRemnantWidth: number,
  minRemnantHeight: number
): boolean {
  if (minRemnantWidth <= 0 && minRemnantHeight <= 0) {
    return false;
  }
  const fitsAsIs = rect.width >= minRemnantWidth && rect.height >= minRemnantHeight;
  const fitsTurned = rect.height >= minRemnantWidth && rect.width >= minRemnantHeight;
  return fitsAsIs || (stockGrain === 'none' && fitsTurned);
}

/**
 * Finds the best free rectangle in the stock for the part (lowest score wins).
 */
function findBestFit(stock: ActiveStock2D, part: ExpandedPart2D, rule: FitRule2D): PlacementFit | null {
  let bestFit: PlacementFit | null = null;
  let minScore = Infinity;

  const orientations: [boolean, number, number][] = [
    [false, part.width, part.height],
    [true, part.height, part.width],
  ];

  for (let i = 0; i < stock.freeRects.length; i++) {
    const free = stock.freeRects[i];

    // Try unrotated, then rotated (90 deg)
    for (const [rotated, pw, ph] of orientations) {
      if (
        pw <= free.width + EPS &&
        ph <= free.height + EPS &&
        isOrientationAllowed(stock.grain, part.grain, part.canRotate, rotated)
      ) {
        const score = fitScore(free, pw, ph, rule);
        if (score < minScore) {
          minScore = score;
          bestFit = {
            rectIndex: i,
            rotated,
            partWidth: pw,
            partHeight: ph,
            score,
          };
        }
      }
    }
  }

  return bestFit;
}

function fitScore(free: FreeRect, pw: number, ph: number, rule: FitRule2D): number {
  const leftoverW = free.width - pw;
  const leftoverH = free.height - ph;
  switch (rule) {
    case 'best-short-side':
      return Math.min(leftoverW, leftoverH);
    case 'best-long-side':
      return Math.max(leftoverW, leftoverH);
    case 'best-area':
      return free.width * free.height - pw * ph;
  }
}

/**
 * Decides whether the full-length cut runs horizontally (true) or vertically (false).
 */
function shouldSplitHorizontal(
  pw: number,
  ph: number,
  leftoverW: number,
  leftoverH: number,
  rule: SplitRule2D
): boolean {
  switch (rule) {
    case 'shorter-leftover-axis':
      // Split along the axis that leaves the smaller remnant, maximizing the size of the other remnant.
      return leftoverW <= leftoverH;
    case 'longer-leftover-axis':
      return leftoverW > leftoverH;
    case 'min-area':
      // Makes the smaller of the two new free rects as small as possible
      return pw * leftoverH > ph * leftoverW;
    case 'max-area':
      // Keeps the two new free rects as balanced as possible
      return pw * leftoverH <= ph * leftoverW;
  }
}

/**
 * Places a part into the selected free rectangle and performs a guillotine split,
 * taking kerf into account and producing guillotine cut segments.
 */
function placePartInStock(
  stock: ActiveStock2D,
  part: ExpandedPart2D,
  fit: PlacementFit,
  kerf: number,
  splitRule: SplitRule2D
): void {
  const free = stock.freeRects.splice(fit.rectIndex, 1)[0];
  splitFreeRect(stock, part, fit, kerf, splitRule, free);
  updateMaxFreeSize(stock);
}

function splitFreeRect(
  stock: ActiveStock2D,
  part: ExpandedPart2D,
  fit: PlacementFit,
  kerf: number,
  splitRule: SplitRule2D,
  free: FreeRect
): void {
  const pw = fit.partWidth;
  const ph = fit.partHeight;
  const px = free.x;
  const py = free.y;

  // Record placement
  stock.placements.push({
    part_id: part.partId,
    x: px,
    y: py,
    width: pw,
    height: ph,
    rotated: fit.rotated,
  });

  const leftoverW = free.width - pw;
  const leftoverH = free.height - ph;
  const hasLeftoverW = leftoverW > EPS;
  const hasLeftoverH = leftoverH > EPS;

  const splitHorizontal = shouldSplitHorizontal(pw, ph, leftoverW, leftoverH, splitRule);

  // Width/height of the free rects left after the blade passes (<= 0 when the kerf eats the leftover)
  const topH = free.height - ph - kerf;
  const rightW = free.width - pw - kerf;

  if (splitHorizontal) {
    // Horizontal cut across the full width of this free rect at (px, py + ph)
    if (hasLeftoverH) {
      stock.cuts.push({
        type: 'horizontal',
        x: px,
        y: py + ph,
        length: free.width,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
      stock.cutLossArea += Math.min(kerf, leftoverH) * free.width;
    }

    // Vertical cut from base to horizontal cut line at (px + pw, py)
    if (hasLeftoverW) {
      stock.cuts.push({
        type: 'vertical',
        x: px + pw,
        y: py,
        length: ph,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
      stock.cutLossArea += Math.min(kerf, leftoverW) * ph;
    }

    // Top free rect
    if (hasLeftoverH && topH > EPS) {
      stock.freeRects.push({
        x: px,
        y: py + ph + kerf,
        width: free.width,
        height: topH,
      });
    }

    // Right free rect
    if (hasLeftoverW && rightW > EPS) {
      stock.freeRects.push({
        x: px + pw + kerf,
        y: py,
        width: rightW,
        height: ph,
      });
    }
  } else {
    // Vertical cut across the full height of this free rect at (px + pw, py)
    if (hasLeftoverW) {
      stock.cuts.push({
        type: 'vertical',
        x: px + pw,
        y: py,
        length: free.height,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
      stock.cutLossArea += Math.min(kerf, leftoverW) * free.height;
    }

    // Horizontal cut within the column at (px, py + ph)
    if (hasLeftoverH) {
      stock.cuts.push({
        type: 'horizontal',
        x: px,
        y: py + ph,
        length: pw,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
      stock.cutLossArea += Math.min(kerf, leftoverH) * pw;
    }

    // Right free rect
    if (hasLeftoverW && rightW > EPS) {
      stock.freeRects.push({
        x: px + pw + kerf,
        y: py,
        width: rightW,
        height: free.height,
      });
    }

    // Top free rect
    if (hasLeftoverH && topH > EPS) {
      stock.freeRects.push({
        x: px,
        y: py + ph + kerf,
        width: pw,
        height: topH,
      });
    }
  }
}
