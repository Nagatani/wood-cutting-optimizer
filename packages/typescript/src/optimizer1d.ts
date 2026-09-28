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
import { binPack1D, BinDefinition, ItemDefinition } from './binpacking/index.js';
import { validateInput } from './validate.js';

const EPS = 1e-9;

export function optimize1D(input: InputRequest): OptimizationResult {
  validateInput(input);
  const kerf = input.kerf ?? 0;
  const minRemnantLength = input.min_remnant_size?.length ?? 0;

  const bins: BinDefinition<Stock1D>[] = (input.stocks as Stock1D[]).map((s) => ({
    id: s.id,
    capacity: s.length,
    quantity: s.quantity ?? 1,
    cost: s.cost ?? s.length,
    data: s,
  }));

  const items: ItemDefinition<Part1D>[] = (input.parts as Part1D[]).map((p) => ({
    id: p.id,
    size: p.length,
    quantity: p.quantity ?? 1,
    data: p,
  }));

  const packResult = binPack1D(bins, items, {
    itemSpacing: kerf,
    strategy: 'best-fit-decreasing',
  });

  const resultStocks: StockResult1D[] = [];
  let totalStockMeasure = 0;
  let totalUsedMeasure = 0;
  let totalWasteMeasure = 0;
  let totalRemnantMeasure = 0;
  let totalPlacedCount = 0;

  for (const packedBin of packResult.bins) {
    totalStockMeasure += packedBin.capacity;
    const placements: Placement1D[] = [];
    const cuts: Cut1D[] = [];

    for (let i = 0; i < packedBin.items.length; i++) {
      const item = packedBin.items[i];
      if (i > 0) {
        cuts.push({
          x: item.offset - kerf,
          kerf: kerf,
          step: i,
        });
      }
      placements.push({
        part_id: item.id,
        x: item.offset,
        length: item.size,
      });
      totalUsedMeasure += item.size;
    }

    totalPlacedCount += placements.length;

    // Cut loss between parts
    let cutLoss = cuts.length * kerf;

    const remaining = packedBin.remainingCapacity;
    const remnants: Segment1D[] = [];
    const waste: Segment1D[] = [];

    if (remaining > EPS) {
      // A final cut separates the last part from the leftover.
      // If the leftover is thinner than the kerf, the blade consumes all of it.
      const endCutLoss = Math.min(kerf, remaining);
      cuts.push({
        x: packedBin.usedCapacity,
        kerf: kerf,
        step: cuts.length + 1,
      });
      cutLoss += endCutLoss;

      const leftover = Number((remaining - endCutLoss).toFixed(6));
      if (leftover > EPS) {
        const segment: Segment1D = {
          x: packedBin.usedCapacity + endCutLoss,
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

    // Cut loss is also considered waste
    totalWasteMeasure += cutLoss;

    resultStocks.push({
      stock_id: packedBin.binId,
      index: packedBin.index,
      length: packedBin.capacity,
      placements,
      cuts,
      remnants,
      waste,
    });
  }

  const unplaced_parts: UnplacedPart[] = packResult.unpackedItems.map((u) => ({
    part_id: u.id,
    quantity: u.quantity,
  }));

  const yieldRate = totalStockMeasure > 0 ? totalUsedMeasure / totalStockMeasure : 0;

  return {
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
    },
    stocks: resultStocks,
    unplaced_parts,
  };
}

