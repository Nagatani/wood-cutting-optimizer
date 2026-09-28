import {
  InputRequest,
  OptimizationResult1D,
  Stock1D,
  Part1D,
  StockResult1D,
  Placement1D,
  Cut1D,
  Segment1D,
  UnplacedPart,
} from './types.js';
import {
  binPack1D,
  BinDefinition,
  ItemDefinition,
  BinPacking1DResult,
  BinSelection1D,
  PackingStrategy1D,
} from './binpacking/index.js';
import { validateInput, resolveStockQuantity } from './validate.js';
import { isBetterEvaluation, SolutionEvaluation } from './evaluation.js';
import { computeStockUsage } from './usage.js';

const EPS = 1e-9;

/**
 * Heuristic combinations tried by optimize1D. The first entry is the baseline
 * (best-fit-decreasing / smallest stock); later entries only replace it when strictly better.
 */
const STRATEGIES: PackingStrategy1D[] = ['best-fit-decreasing', 'first-fit-decreasing', 'worst-fit-decreasing'];
const BIN_SELECTIONS: BinSelection1D[] = ['smallest', 'largest', 'lowest-cost-ratio'];

interface UsedStock1D {
  stockIndex: number; // Index into input.stocks
  index: number;
  items: { id: string; size: number; offset: number }[];
  usedCapacity: number; // End offset of the last item
}

export function optimize1D(input: InputRequest): OptimizationResult1D {
  validateInput(input);
  const kerf = input.kerf ?? 0;
  const minRemnantLength = input.min_remnant_size?.length ?? 0;
  const stocks = input.stocks as Stock1D[];

  const bins: BinDefinition<number>[] = stocks.map((s, i) => ({
    id: s.id,
    capacity: usableLength(s),
    quantity: resolveStockQuantity(s.quantity),
    cost: stockCost(s),
    data: i,
  }));

  const items: ItemDefinition<Part1D>[] = (input.parts as Part1D[]).map((p) => ({
    id: p.id,
    size: p.length,
    quantity: p.quantity ?? 1,
    data: p,
  }));

  let best: { result: OptimizationResult1D; evaluation: SolutionEvaluation } | null = null;
  for (const strategy of STRATEGIES) {
    for (const binSelection of BIN_SELECTIONS) {
      const packResult = binPack1D(bins, items, { itemSpacing: kerf, strategy, binSelection });
      const usedStocks = downsizeStocks(stocks, packResult);
      const candidate = buildResult(stocks, usedStocks, packResult, kerf, minRemnantLength);
      if (best === null || isBetterEvaluation(candidate.evaluation, best.evaluation)) {
        best = candidate;
      }
    }
  }

  return best!.result;
}

/** Length available for parts after trimming both ends. */
function usableLength(stock: Stock1D): number {
  return stock.length - (stock.trim ?? 0) * 2;
}

function stockCost(stock: Stock1D): number {
  return stock.cost ?? stock.length;
}

/**
 * Swaps each used stock for the cheapest remaining stock type that still holds its parts
 * (e.g. a 3m stock holding 1.5m of parts becomes a 2m stock when one is available and cheaper).
 */
function downsizeStocks(stocks: Stock1D[], packResult: BinPacking1DResult<number, Part1D>): UsedStock1D[] {
  const remaining = stocks.map((s) => resolveStockQuantity(s.quantity));
  const usedStocks: UsedStock1D[] = packResult.bins.map((bin) => {
    const stockIndex = bin.data as number;
    remaining[stockIndex] -= 1;
    return {
      stockIndex,
      index: bin.index,
      items: bin.items.map((it) => ({ id: it.id, size: it.size, offset: it.offset })),
      usedCapacity: bin.usedCapacity,
    };
  });

  for (const used of usedStocks) {
    let bestIndex = used.stockIndex;
    for (let j = 0; j < stocks.length; j++) {
      if (j === used.stockIndex || remaining[j] <= 0) continue;
      if (usableLength(stocks[j]) < used.usedCapacity - EPS) continue;
      const cost = stockCost(stocks[j]);
      const bestCost = stockCost(stocks[bestIndex]);
      if (
        cost < bestCost - EPS ||
        (Math.abs(cost - bestCost) <= EPS && stocks[j].length < stocks[bestIndex].length)
      ) {
        bestIndex = j;
      }
    }
    if (bestIndex !== used.stockIndex) {
      remaining[used.stockIndex] += 1;
      remaining[bestIndex] -= 1;
      used.stockIndex = bestIndex;
    }
  }

  return usedStocks;
}

function buildResult(
  stocks: Stock1D[],
  usedStocks: UsedStock1D[],
  packResult: BinPacking1DResult<number, Part1D>,
  kerf: number,
  minRemnantLength: number
): { result: OptimizationResult1D; evaluation: SolutionEvaluation } {
  const resultStocks: StockResult1D[] = [];
  let totalStockMeasure = 0;
  let totalUsedMeasure = 0;
  let totalWasteMeasure = 0;
  let totalRemnantMeasure = 0;
  let totalPlacedCount = 0;
  let totalCost = 0;
  let cutCount = 0;

  for (const used of usedStocks) {
    const stock = stocks[used.stockIndex];
    // Parts are laid out after the trimmed start of the stock
    const trim = stock.trim ?? 0;
    const capacity = usableLength(stock);
    totalStockMeasure += stock.length;
    totalCost += stockCost(stock);
    const placements: Placement1D[] = [];
    const cuts: Cut1D[] = [];

    for (let i = 0; i < used.items.length; i++) {
      const item = used.items[i];
      if (i > 0) {
        cuts.push({
          x: trim + item.offset - kerf,
          kerf: kerf,
          step: i,
        });
      }
      placements.push({
        part_id: item.id,
        x: trim + item.offset,
        length: item.size,
      });
      totalUsedMeasure += item.size;
    }

    totalPlacedCount += placements.length;

    // Cut loss between parts
    let cutLoss = cuts.length * kerf;

    const remaining = Number(Math.max(0, capacity - used.usedCapacity).toFixed(6));
    const remnants: Segment1D[] = [];
    const waste: Segment1D[] = [];

    // Trimmed ends are waste
    if (trim > 0) {
      waste.push({ x: 0, length: trim });
      totalWasteMeasure += trim * 2;
    }

    if (remaining > EPS) {
      // A final cut separates the last part from the leftover.
      // If the leftover is thinner than the kerf, the blade consumes all of it.
      const endCutLoss = Math.min(kerf, remaining);
      cuts.push({
        x: trim + used.usedCapacity,
        kerf: kerf,
        step: cuts.length + 1,
      });
      cutLoss += endCutLoss;

      const leftover = Number((remaining - endCutLoss).toFixed(6));
      if (leftover > EPS) {
        const segment: Segment1D = {
          x: trim + used.usedCapacity + endCutLoss,
          length: leftover,
        };
        if (minRemnantLength > 0 && leftover >= minRemnantLength) {
          remnants.push(segment);
          totalRemnantMeasure += leftover;
        } else {
          waste.push(segment);
          totalWasteMeasure += leftover;
        }
      }
    }

    if (trim > 0) {
      waste.push({ x: stock.length - trim, length: trim });
    }

    // Cut loss is also considered waste
    totalWasteMeasure += cutLoss;
    cutCount += cuts.length;

    resultStocks.push({
      stock_id: stock.id,
      index: used.index,
      length: stock.length,
      placements,
      cuts,
      remnants,
      waste,
    });
  }

  let unplacedCount = 0;
  const unplaced_parts: UnplacedPart[] = packResult.unpackedItems.map((u) => {
    unplacedCount += u.quantity;
    return {
      part_id: u.id,
      quantity: u.quantity,
    };
  });

  const yieldRate = totalStockMeasure > 0 ? totalUsedMeasure / totalStockMeasure : 0;

  const result: OptimizationResult1D = {
    dimension: '1D',
    summary: {
      stock_count_used: resultStocks.length,
      parts_placed: totalPlacedCount,
      parts_total: packResult.summary.itemsTotal,
      total_stock_measure: Number(totalStockMeasure.toFixed(4)),
      total_used_measure: Number(totalUsedMeasure.toFixed(4)),
      total_waste_measure: Number(totalWasteMeasure.toFixed(4)),
      total_remnant_measure: Number(totalRemnantMeasure.toFixed(4)),
      yield_rate: Number(yieldRate.toFixed(4)),
      stock_usage: computeStockUsage(
        stocks,
        usedStocks.map((u) => u.stockIndex)
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
