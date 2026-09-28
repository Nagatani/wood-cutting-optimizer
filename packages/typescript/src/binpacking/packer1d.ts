import {
  BinDefinition,
  ItemDefinition,
  BinPacking1DOptions,
  BinSelection1D,
  BinPacking1DResult,
  PackedBin,
  PackedItem,
  UnpackedItem,
} from './types.js';

/** Tolerance for floating-point comparisons (e.g. 0.1 + 0.2 fitting into 0.3). */
const EPS = 1e-9;

const STRATEGIES: readonly string[] = ['best-fit-decreasing', 'first-fit-decreasing', 'worst-fit-decreasing'];
const BIN_SELECTIONS: readonly string[] = ['smallest', 'largest', 'lowest-cost-ratio'];

function validateBinPackingInput(
  bins: BinDefinition<unknown>[],
  items: ItemDefinition<unknown>[],
  itemSpacing: number,
  strategy: string,
  binSelection: string
): void {
  if (!Array.isArray(bins)) throw new Error('bins must be an array');
  if (!Array.isArray(items)) throw new Error('items must be an array');
  if (!Number.isFinite(itemSpacing) || itemSpacing < 0) {
    throw new Error(`itemSpacing must be a finite number >= 0 (got ${itemSpacing})`);
  }
  if (!STRATEGIES.includes(strategy)) {
    throw new Error(`Unsupported strategy: ${strategy}`);
  }
  if (!BIN_SELECTIONS.includes(binSelection)) {
    throw new Error(`Unsupported binSelection: ${binSelection}`);
  }
  for (const b of bins) {
    if (!Number.isFinite(b.capacity) || b.capacity <= 0) {
      throw new Error(`Bin "${b.id}": capacity must be a finite number > 0 (got ${b.capacity})`);
    }
    if (b.cost !== undefined && (!Number.isFinite(b.cost) || b.cost < 0)) {
      throw new Error(`Bin "${b.id}": cost must be a finite number >= 0 (got ${b.cost})`);
    }
    const q = b.quantity ?? 1;
    if (q !== Infinity && (!Number.isInteger(q) || q < 0)) {
      throw new Error(`Bin "${b.id}": quantity must be an integer >= 0 or Infinity (got ${q})`);
    }
  }
  for (const it of items) {
    if (!Number.isFinite(it.size) || it.size <= 0) {
      throw new Error(`Item "${it.id}": size must be a finite number > 0 (got ${it.size})`);
    }
    const q = it.quantity ?? 1;
    if (!Number.isInteger(q) || q < 0) {
      throw new Error(`Item "${it.id}": quantity must be an integer >= 0 (got ${q})`);
    }
  }
}

interface ExpandedItem<T = unknown> {
  id: string;
  size: number;
  data?: T;
}

interface ActiveBin<TBin = unknown, TItem = unknown> {
  binId: string;
  index: number;
  capacity: number;
  usedOffset: number; // offset of the end of the last placed item
  items: PackedItem<TItem>[];
  data?: TBin;
}

interface PoolBin<T = unknown> {
  id: string;
  capacity: number;
  cost: number;
  remainingQuantity: number;
  data?: T;
}

/**
 * Chooses which bin type to open for an item. Returns -1 when no remaining bin can hold it.
 */
function chooseBin(binPool: PoolBin<unknown>[], size: number, rule: BinSelection1D): number {
  let chosenPoolIndex = -1;
  let bestKey = Infinity;
  let bestCapacity = Infinity;

  for (let i = 0; i < binPool.length; i++) {
    const pool = binPool[i];
    if (pool.remainingQuantity <= 0 || pool.capacity < size - EPS) continue;

    let key: number;
    switch (rule) {
      case 'smallest':
        key = pool.capacity;
        break;
      case 'largest':
        key = -pool.capacity;
        break;
      case 'lowest-cost-ratio':
        key = pool.cost / pool.capacity;
        break;
    }
    // Ties are broken by the smaller capacity, then by input order
    if (key < bestKey - EPS || (Math.abs(key - bestKey) <= EPS && pool.capacity < bestCapacity)) {
      bestKey = key;
      bestCapacity = pool.capacity;
      chosenPoolIndex = i;
    }
  }

  return chosenPoolIndex;
}

/**
 * 1D Bin Packing algorithm.
 * Packs items into bins with minimal waste, supporting multiple bin sizes,
 * item spacing (e.g. kerf/blade width), and various heuristics (BFD, FFD, WFD).
 */
export function binPack1D<TBin = unknown, TItem = unknown>(
  bins: BinDefinition<TBin>[],
  items: ItemDefinition<TItem>[],
  options?: BinPacking1DOptions
): BinPacking1DResult<TBin, TItem> {
  const itemSpacing = options?.itemSpacing ?? 0;
  const strategy = options?.strategy ?? 'best-fit-decreasing';
  const binSelection = options?.binSelection ?? 'smallest';
  validateBinPackingInput(bins, items, itemSpacing, strategy, binSelection);

  // 1. Flatten items based on quantity
  const expandedItems: ExpandedItem<TItem>[] = [];
  let totalItemsCount = 0;
  for (const item of items) {
    const qty = item.quantity ?? 1;
    totalItemsCount += qty;
    for (let i = 0; i < qty; i++) {
      expandedItems.push({
        id: item.id,
        size: item.size,
        data: item.data,
      });
    }
  }

  // 2. Sort items descending by size (Decreasing heuristics)
  expandedItems.sort((a, b) => b.size - a.size);

  // 3. Setup bin inventory pool
  const binPool: PoolBin<TBin>[] = bins.map((b) => ({
    id: b.id,
    capacity: b.capacity,
    cost: b.cost ?? b.capacity,
    remainingQuantity: b.quantity ?? 1,
    data: b.data,
  }));

  const activeBins: ActiveBin<TBin, TItem>[] = [];
  const unpackedItemsMap = new Map<string, { size: number; quantity: number; data?: TItem }>();
  let globalBinIndex = 0;

  // 4. Place each item
  for (const item of expandedItems) {
    let chosenBinIndex = -1;

    if (strategy === 'best-fit-decreasing') {
      let minRemainingSpace = Infinity;
      for (let i = 0; i < activeBins.length; i++) {
        const bin = activeBins[i];
        const additionalSpace = bin.items.length > 0 ? itemSpacing + item.size : item.size;
        const spaceLeft = bin.capacity - bin.usedOffset;
        if (spaceLeft >= additionalSpace - EPS) {
          const remaining = spaceLeft - additionalSpace;
          if (remaining < minRemainingSpace) {
            minRemainingSpace = remaining;
            chosenBinIndex = i;
          }
        }
      }
    } else if (strategy === 'first-fit-decreasing') {
      for (let i = 0; i < activeBins.length; i++) {
        const bin = activeBins[i];
        const additionalSpace = bin.items.length > 0 ? itemSpacing + item.size : item.size;
        const spaceLeft = bin.capacity - bin.usedOffset;
        if (spaceLeft >= additionalSpace - EPS) {
          chosenBinIndex = i;
          break;
        }
      }
    } else if (strategy === 'worst-fit-decreasing') {
      let maxRemainingSpace = -1;
      for (let i = 0; i < activeBins.length; i++) {
        const bin = activeBins[i];
        const additionalSpace = bin.items.length > 0 ? itemSpacing + item.size : item.size;
        const spaceLeft = bin.capacity - bin.usedOffset;
        if (spaceLeft >= additionalSpace - EPS) {
          const remaining = spaceLeft - additionalSpace;
          if (remaining > maxRemainingSpace) {
            maxRemainingSpace = remaining;
            chosenBinIndex = i;
          }
        }
      }
    }

    if (chosenBinIndex !== -1) {
      // Place into selected active bin
      const bin = activeBins[chosenBinIndex];
      const startOffset = bin.items.length > 0 ? bin.usedOffset + itemSpacing : bin.usedOffset;
      bin.items.push({
        id: item.id,
        size: item.size,
        offset: startOffset,
        data: item.data,
      });
      bin.usedOffset = startOffset + item.size;
    } else {
      // Open a new bin from pool
      const chosenPoolIndex = chooseBin(binPool, item.size, binSelection);

      if (chosenPoolIndex !== -1) {
        const chosen = binPool[chosenPoolIndex];
        chosen.remainingQuantity -= 1;

        const newBin: ActiveBin<TBin, TItem> = {
          binId: chosen.id,
          index: globalBinIndex++,
          capacity: chosen.capacity,
          usedOffset: item.size,
          items: [
            {
              id: item.id,
              size: item.size,
              offset: 0,
              data: item.data,
            },
          ],
          data: chosen.data,
        };
        activeBins.push(newBin);
      } else {
        // Item cannot be placed into any available bin
        const existing = unpackedItemsMap.get(item.id);
        if (existing) {
          existing.quantity += 1;
        } else {
          unpackedItemsMap.set(item.id, {
            size: item.size,
            quantity: 1,
            data: item.data,
          });
        }
      }
    }
  }

  // 5. Construct results and calculate metrics
  let totalCapacity = 0;
  let totalItemSize = 0;
  let totalItemsPacked = 0;

  const resultBins: PackedBin<TBin, TItem>[] = activeBins.map((bin) => {
    totalCapacity += bin.capacity;
    const itemsSize = bin.items.reduce((sum, it) => sum + it.size, 0);
    totalItemSize += itemsSize;
    totalItemsPacked += bin.items.length;

    const remainingCapacity = Math.max(0, bin.capacity - bin.usedOffset);
    const utilization = bin.capacity > 0 ? itemsSize / bin.capacity : 0;

    return {
      binId: bin.binId,
      index: bin.index,
      capacity: bin.capacity,
      usedCapacity: bin.usedOffset,
      remainingCapacity: Number(remainingCapacity.toFixed(6)),
      utilization: Number(utilization.toFixed(4)),
      items: bin.items,
      data: bin.data,
    };
  });

  const unpackedItems: UnpackedItem<TItem>[] = Array.from(unpackedItemsMap.entries()).map(
    ([id, val]) => ({
      id,
      size: val.size,
      quantity: val.quantity,
      data: val.data,
    })
  );

  const averageUtilization = totalCapacity > 0 ? totalItemSize / totalCapacity : 0;

  return {
    bins: resultBins,
    unpackedItems,
    summary: {
      binsUsed: resultBins.length,
      itemsPacked: totalItemsPacked,
      itemsTotal: totalItemsCount,
      totalCapacity: Number(totalCapacity.toFixed(6)),
      totalItemSize: Number(totalItemSize.toFixed(6)),
      averageUtilization: Number(averageUtilization.toFixed(4)),
    },
  };
}
