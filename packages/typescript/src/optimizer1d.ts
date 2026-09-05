import {
  InputRequest,
  OptimizationResult,
  Stock1D,
  Part1D,
  StockResult1D,
  Placement1D,
  Cut1D,
  Segment1D,
  UnplacedPart,
} from './types.js';

interface ExpandedPart1D {
  partId: string;
  name?: string;
  length: number;
}

interface ActiveStock1D {
  stockId: string;
  index: number;
  totalLength: number;
  usedLength: number; // sum of parts length + sum of kerfs
  placements: Placement1D[];
  cuts: Cut1D[];
  cutStepCount: number;
}

export function optimize1D(input: InputRequest): OptimizationResult {
  const kerf = Math.max(0, input.kerf ?? 0);
  const minRemnantLength = input.min_remnant_size?.length ?? 0;

  // Flatten parts
  const expandedParts: ExpandedPart1D[] = [];
  let totalPartsCount = 0;
  for (const p of input.parts as Part1D[]) {
    const qty = p.quantity ?? 1;
    totalPartsCount += qty;
    for (let i = 0; i < qty; i++) {
      expandedParts.push({
        partId: p.id,
        name: p.name,
        length: p.length,
      });
    }
  }

  // Sort parts descending by length (First-Fit / Best-Fit Decreasing)
  expandedParts.sort((a, b) => b.length - a.length);

  // Available stock inventory
  interface StockPoolItem {
    id: string;
    length: number;
    cost: number;
    remainingQuantity: number;
  }

  const stockPool: StockPoolItem[] = (input.stocks as Stock1D[]).map((s) => ({
    id: s.id,
    length: s.length,
    cost: s.cost ?? s.length,
    remainingQuantity: s.quantity ?? 1,
  }));

  const activeStocks: ActiveStock1D[] = [];
  const unplacedPartsMap = new Map<string, number>();

  let globalStockIndex = 0;

  for (const part of expandedParts) {
    let bestStockIndex = -1;
    let minRemainingAfterPlacement = Infinity;

    // Try to fit into an existing open stock (Best Fit)
    for (let i = 0; i < activeStocks.length; i++) {
      const stock = activeStocks[i];
      const additionalSpaceNeeded = stock.placements.length > 0 ? kerf + part.length : part.length;
      const spaceLeft = stock.totalLength - stock.usedLength;

      if (spaceLeft >= additionalSpaceNeeded) {
        const remaining = spaceLeft - additionalSpaceNeeded;
        if (remaining < minRemainingAfterPlacement) {
          minRemainingAfterPlacement = remaining;
          bestStockIndex = i;
        }
      }
    }

    if (bestStockIndex !== -1) {
      // Place into best existing stock
      const stock = activeStocks[bestStockIndex];
      const currentPos = stock.usedLength;
      const startX = stock.placements.length > 0 ? currentPos + kerf : currentPos;

      if (stock.placements.length > 0) {
        stock.cuts.push({
          x: currentPos,
          kerf: kerf,
          step: ++stock.cutStepCount,
        });
      }

      stock.placements.push({
        part_id: part.partId,
        x: startX,
        length: part.length,
      });

      stock.usedLength = startX + part.length;
    } else {
      // Open a new stock from pool
      // Choose stock that fits the part with minimal excess or best cost
      let chosenPoolIndex = -1;
      let minWaste = Infinity;

      for (let i = 0; i < stockPool.length; i++) {
        const pool = stockPool[i];
        if (pool.remainingQuantity > 0 && pool.length >= part.length) {
          const waste = pool.length - part.length;
          if (waste < minWaste) {
            minWaste = waste;
            chosenPoolIndex = i;
          }
        }
      }

      if (chosenPoolIndex !== -1) {
        const chosen = stockPool[chosenPoolIndex];
        chosen.remainingQuantity -= 1;

        const newStock: ActiveStock1D = {
          stockId: chosen.id,
          index: globalStockIndex++,
          totalLength: chosen.length,
          usedLength: part.length,
          placements: [
            {
              part_id: part.partId,
              x: 0,
              length: part.length,
            },
          ],
          cuts: [],
          cutStepCount: 0,
        };
        activeStocks.push(newStock);
      } else {
        // Part cannot be placed in any stock
        unplacedPartsMap.set(part.partId, (unplacedPartsMap.get(part.partId) ?? 0) + 1);
      }
    }
  }

  // Calculate remnants and waste for each stock
  const resultStocks: StockResult1D[] = [];
  let totalStockMeasure = 0;
  let totalUsedMeasure = 0;
  let totalWasteMeasure = 0;
  let totalRemnantMeasure = 0;
  let totalPlacedCount = 0;

  for (const stock of activeStocks) {
    totalStockMeasure += stock.totalLength;
    const partsLengthSum = stock.placements.reduce((sum, p) => sum + p.length, 0);
    totalUsedMeasure += partsLengthSum;
    totalPlacedCount += stock.placements.length;

    const remaining = stock.totalLength - stock.usedLength;
    const remnants: Segment1D[] = [];
    const waste: Segment1D[] = [];

    // Kerf waste is inherent in cut loss
    if (remaining > 0) {
      if (remaining >= minRemnantLength && minRemnantLength > 0) {
        remnants.push({
          x: stock.usedLength,
          length: remaining,
        });
        totalRemnantMeasure += remaining;
      } else {
        waste.push({
          x: stock.usedLength,
          length: remaining,
        });
        totalWasteMeasure += remaining;
      }
    }

    // Cut loss is also considered waste
    const cutLoss = stock.cuts.length * kerf;
    totalWasteMeasure += cutLoss;

    resultStocks.push({
      stock_id: stock.stockId,
      index: stock.index,
      length: stock.totalLength,
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
    dimension: '1D',
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
