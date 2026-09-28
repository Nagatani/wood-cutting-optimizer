import { StockUsage } from './types.js';

/**
 * Aggregates how many of each input stock entry were used, in input order (a purchase list).
 * `cost` is the unit cost times the quantity, or null when the stock has no cost.
 */
export function computeStockUsage(
  stocks: { id: string; cost?: number }[],
  usedStockIndices: number[]
): StockUsage[] {
  const counts = new Array<number>(stocks.length).fill(0);
  for (const i of usedStockIndices) {
    counts[i] += 1;
  }
  const usage: StockUsage[] = [];
  stocks.forEach((s, i) => {
    if (counts[i] === 0) return;
    usage.push({
      stock_id: s.id,
      quantity: counts[i],
      cost: s.cost === undefined ? null : Number((s.cost * counts[i]).toFixed(4)),
    });
  });
  return usage;
}
