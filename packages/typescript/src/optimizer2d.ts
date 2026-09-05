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

interface ActiveStock2D {
  stockId: string;
  index: number;
  width: number;
  height: number;
  grain: GrainDirection;
  freeRects: FreeRect[];
  placements: Placement2D[];
  cuts: Cut2D[];
  cutStepCount: number;
}

interface PlacementFit {
  rectIndex: number;
  rotated: boolean;
  partWidth: number;
  partHeight: number;
  score: number; // For BSSF (Best Short Side Fit)
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
 * 2D Guillotine Bin Packing Optimizer with Kerf, Grain, and Remnant constraints.
 */
export function optimize2D(input: InputRequest): OptimizationResult {
  const kerf = Math.max(0, input.kerf ?? 0);
  const minRemnantWidth = input.min_remnant_size?.width ?? 0;
  const minRemnantHeight = input.min_remnant_size?.height ?? 0;

  // Flatten parts
  const expandedParts: ExpandedPart2D[] = [];
  let totalPartsCount = 0;
  for (const p of input.parts as Part2D[]) {
    const qty = p.quantity ?? 1;
    totalPartsCount += qty;
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

  // Sort parts by Area descending (and then max dimension descending)
  expandedParts.sort((a, b) => {
    if (b.area !== a.area) {
      return b.area - a.area;
    }
    return Math.max(b.width, b.height) - Math.max(a.width, a.height);
  });

  // Stock inventory pool
  interface StockPoolItem {
    id: string;
    width: number;
    height: number;
    grain: GrainDirection;
    cost: number;
    remainingQuantity: number;
  }

  const stockPool: StockPoolItem[] = (input.stocks as Stock2D[]).map((s) => ({
    id: s.id,
    width: s.width,
    height: s.height,
    grain: s.grain ?? 'none',
    cost: s.cost ?? s.width * s.height,
    remainingQuantity: s.quantity ?? 1,
  }));

  const activeStocks: ActiveStock2D[] = [];
  const unplacedPartsMap = new Map<string, number>();

  let globalStockIndex = 0;

  for (const part of expandedParts) {
    let bestStockIdx = -1;
    let bestFit: PlacementFit | null = null;

    // Search through existing open active stocks
    for (let sIdx = 0; sIdx < activeStocks.length; sIdx++) {
      const stock = activeStocks[sIdx];
      const fit = findBestFit(stock, part);
      if (fit !== null) {
        if (bestFit === null || fit.score < bestFit.score) {
          bestFit = fit;
          bestStockIdx = sIdx;
        }
      }
    }

    if (bestStockIdx !== -1 && bestFit !== null) {
      // Place in existing stock
      placePartInStock(activeStocks[bestStockIdx], part, bestFit, kerf);
    } else {
      // Open a new stock sheet
      let chosenPoolIdx = -1;
      let minStockArea = Infinity;

      for (let pIdx = 0; pIdx < stockPool.length; pIdx++) {
        const pool = stockPool[pIdx];
        if (pool.remainingQuantity > 0) {
          // Check if part can fit in this stock at all (including grain constraints)
          const canFitUnrotated =
            part.width <= pool.width &&
            part.height <= pool.height &&
            isOrientationAllowed(pool.grain, part.grain, part.canRotate, false);

          const canFitRotated =
            part.height <= pool.width &&
            part.width <= pool.height &&
            isOrientationAllowed(pool.grain, part.grain, part.canRotate, true);

          if (canFitUnrotated || canFitRotated) {
            const area = pool.width * pool.height;
            if (area < minStockArea) {
              minStockArea = area;
              chosenPoolIdx = pIdx;
            }
          }
        }
      }

      if (chosenPoolIdx !== -1) {
        const chosen = stockPool[chosenPoolIdx];
        chosen.remainingQuantity -= 1;

        const newStock: ActiveStock2D = {
          stockId: chosen.id,
          index: globalStockIndex++,
          width: chosen.width,
          height: chosen.height,
          grain: chosen.grain,
          freeRects: [
            {
              x: 0,
              y: 0,
              width: chosen.width,
              height: chosen.height,
            },
          ],
          placements: [],
          cuts: [],
          cutStepCount: 0,
        };

        const fit = findBestFit(newStock, part);
        if (fit !== null) {
          placePartInStock(newStock, part, fit, kerf);
          activeStocks.push(newStock);
        } else {
          // This should not happen since we checked feasibility, but fallback
          chosen.remainingQuantity += 1;
          unplacedPartsMap.set(part.partId, (unplacedPartsMap.get(part.partId) ?? 0) + 1);
        }
      } else {
        // Part cannot be placed in any stock
        unplacedPartsMap.set(part.partId, (unplacedPartsMap.get(part.partId) ?? 0) + 1);
      }
    }
  }

  // Calculate results, summary, remnants, and waste
  const resultStocks: StockResult2D[] = [];
  let totalStockMeasure = 0;
  let totalUsedMeasure = 0;
  let totalWasteMeasure = 0;
  let totalRemnantMeasure = 0;
  let totalPlacedCount = 0;

  for (const stock of activeStocks) {
    const stockArea = stock.width * stock.height;
    totalStockMeasure += stockArea;

    let stockPartsArea = 0;
    for (const p of stock.placements) {
      stockPartsArea += p.width * p.height;
    }
    totalUsedMeasure += stockPartsArea;
    totalPlacedCount += stock.placements.length;

    const remnants: Rect2D[] = [];
    const waste: Rect2D[] = [];

    for (const rect of stock.freeRects) {
      if (rect.width <= 0 || rect.height <= 0) continue;

      const isRemnant =
        rect.width >= minRemnantWidth &&
        rect.height >= minRemnantHeight &&
        (minRemnantWidth > 0 || minRemnantHeight > 0);

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

    // Cut loss area (kerf * length)
    let cutLossArea = 0;
    for (const cut of stock.cuts) {
      cutLossArea += cut.kerf * cut.length;
    }
    totalWasteMeasure += cutLossArea;

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
  for (const [partId, qty] of unplacedPartsMap.entries()) {
    unplaced_parts.push({ part_id: partId, quantity: qty });
  }

  const yieldRate = totalStockMeasure > 0 ? totalUsedMeasure / totalStockMeasure : 0;

  return {
    dimension: '2D',
    summary: {
      stock_count_used: resultStocks.length,
      parts_placed: totalPlacedCount,
      parts_total: totalPartsCount,
      total_stock_measure: totalStockMeasure,
      total_used_measure: totalUsedMeasure,
      total_waste_measure: Number(totalWasteMeasure.toFixed(4)),
      total_remnant_measure: Number(totalRemnantMeasure.toFixed(4)),
      yield_rate: Number(yieldRate.toFixed(4)),
    },
    stocks: resultStocks,
    unplaced_parts,
  };
}

/**
 * Finds the best free rectangle in the stock using Best Short Side Fit (BSSF).
 */
function findBestFit(stock: ActiveStock2D, part: ExpandedPart2D): PlacementFit | null {
  let bestFit: PlacementFit | null = null;
  let minScore = Infinity;

  for (let i = 0; i < stock.freeRects.length; i++) {
    const free = stock.freeRects[i];

    // Try unrotated
    if (
      part.width <= free.width &&
      part.height <= free.height &&
      isOrientationAllowed(stock.grain, part.grain, part.canRotate, false)
    ) {
      const leftoverW = free.width - part.width;
      const leftoverH = free.height - part.height;
      const score = Math.min(leftoverW, leftoverH);
      if (score < minScore) {
        minScore = score;
        bestFit = {
          rectIndex: i,
          rotated: false,
          partWidth: part.width,
          partHeight: part.height,
          score,
        };
      }
    }

    // Try rotated (90 deg)
    if (
      part.height <= free.width &&
      part.width <= free.height &&
      isOrientationAllowed(stock.grain, part.grain, part.canRotate, true)
    ) {
      const leftoverW = free.width - part.height;
      const leftoverH = free.height - part.width;
      const score = Math.min(leftoverW, leftoverH);
      if (score < minScore) {
        minScore = score;
        bestFit = {
          rectIndex: i,
          rotated: true,
          partWidth: part.height,
          partHeight: part.width,
          score,
        };
      }
    }
  }

  return bestFit;
}

/**
 * Places a part into the selected free rectangle and performs a guillotine split,
 * taking kerf into account and producing guillotine cut segments.
 */
function placePartInStock(
  stock: ActiveStock2D,
  part: ExpandedPart2D,
  fit: PlacementFit,
  kerf: number
): void {
  const free = stock.freeRects.splice(fit.rectIndex, 1)[0];

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

  // Guillotine Split Decision: Shorter Leftover Axis Split (SLAS)
  // Split along the axis that leaves the smaller remnant, maximizing the size of the other remnant.
  const splitHorizontal = leftoverW <= leftoverH;

  if (splitHorizontal) {
    // Horizontal cut across the full width of this free rect at (px, py + ph)
    if (leftoverH > 0) {
      stock.cuts.push({
        type: 'horizontal',
        x: px,
        y: py + ph,
        length: free.width,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
    }

    // Vertical cut from base to horizontal cut line at (px + pw, py)
    if (leftoverW > 0) {
      stock.cuts.push({
        type: 'vertical',
        x: px + pw,
        y: py,
        length: ph,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
    }

    // Top free rect
    const topH = free.height - ph - (leftoverH > 0 ? kerf : 0);
    if (topH > 0) {
      stock.freeRects.push({
        x: px,
        y: py + ph + kerf,
        width: free.width,
        height: topH,
      });
    }

    // Right free rect
    const rightW = free.width - pw - (leftoverW > 0 ? kerf : 0);
    if (rightW > 0) {
      stock.freeRects.push({
        x: px + pw + kerf,
        y: py,
        width: rightW,
        height: ph,
      });
    }
  } else {
    // Vertical cut across the full height of this free rect at (px + pw, py)
    if (leftoverW > 0) {
      stock.cuts.push({
        type: 'vertical',
        x: px + pw,
        y: py,
        length: free.height,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
    }

    // Horizontal cut within the column at (px, py + ph)
    if (leftoverH > 0) {
      stock.cuts.push({
        type: 'horizontal',
        x: px,
        y: py + ph,
        length: pw,
        kerf: kerf,
        step: ++stock.cutStepCount,
      });
    }

    // Right free rect
    const rightW = free.width - pw - (leftoverW > 0 ? kerf : 0);
    if (rightW > 0) {
      stock.freeRects.push({
        x: px + pw + kerf,
        y: py,
        width: rightW,
        height: free.height,
      });
    }

    // Top free rect
    const topH = free.height - ph - (leftoverH > 0 ? kerf : 0);
    if (topH > 0) {
      stock.freeRects.push({
        x: px,
        y: py + ph + kerf,
        width: pw,
        height: topH,
      });
    }
  }
}
