import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { binPack1D, BinDefinition, ItemDefinition } from '../src/binpacking/index.js';

describe('Generic 1D Bin Packing Tests', () => {
  it('should pack items into bins without spacing (itemSpacing = 0)', () => {
    const bins: BinDefinition[] = [
      { id: 'bin-1', capacity: 100, quantity: 2 },
    ];
    const items: ItemDefinition[] = [
      { id: 'item-1', size: 60, quantity: 1 },
      { id: 'item-2', size: 40, quantity: 1 },
      { id: 'item-3', size: 50, quantity: 1 },
      { id: 'item-4', size: 50, quantity: 1 },
    ];

    const result = binPack1D(bins, items);

    // Should pack items (60 + 40 = 100) into bin 0 and (50 + 50 = 100) into bin 1
    assert.strictEqual(result.bins.length, 2);
    assert.strictEqual(result.unpackedItems.length, 0);
    assert.strictEqual(result.summary.itemsPacked, 4);
    assert.strictEqual(result.summary.itemsTotal, 4);
    assert.strictEqual(result.summary.totalCapacity, 200);
    assert.strictEqual(result.summary.totalItemSize, 200);
    assert.strictEqual(result.summary.averageUtilization, 1.0);

    for (const bin of result.bins) {
      assert.strictEqual(bin.usedCapacity, 100);
      assert.strictEqual(bin.remainingCapacity, 0);
      assert.strictEqual(bin.utilization, 1.0);
    }
  });

  it('should respect itemSpacing between items in the same bin', () => {
    const bins: BinDefinition[] = [
      { id: 'bin-1', capacity: 100, quantity: 2 },
    ];
    const items: ItemDefinition[] = [
      { id: 'item-1', size: 40, quantity: 2 },
      { id: 'item-2', size: 20, quantity: 1 },
    ];

    // spacing = 5
    // In bin 1: item(40) + spacing(5) + item(40) = 85 <= 100
    // If we tried to fit item(20), 85 + 5 + 20 = 110 > 100 (overflows to bin 2)
    const result = binPack1D(bins, items, { itemSpacing: 5 });

    assert.strictEqual(result.bins.length, 2);
    const bin1 = result.bins[0];
    assert.strictEqual(bin1.items.length, 2);
    assert.strictEqual(bin1.items[0].offset, 0);
    assert.strictEqual(bin1.items[0].size, 40);
    assert.strictEqual(bin1.items[1].offset, 45); // 40 + 5 spacing
    assert.strictEqual(bin1.items[1].size, 40);
    assert.strictEqual(bin1.usedCapacity, 85);
    assert.strictEqual(bin1.remainingCapacity, 15);

    const bin2 = result.bins[1];
    assert.strictEqual(bin2.items.length, 1);
    assert.strictEqual(bin2.items[0].offset, 0);
    assert.strictEqual(bin2.items[0].size, 20);
  });

  it('should choose best matching bin from heterogeneous bin pool', () => {
    const bins: BinDefinition[] = [
      { id: 'small-bin', capacity: 50, quantity: 5 },
      { id: 'large-bin', capacity: 100, quantity: 5 },
    ];
    const items: ItemDefinition[] = [
      { id: 'item-small', size: 45, quantity: 1 },
    ];

    const result = binPack1D(bins, items);
    assert.strictEqual(result.bins.length, 1);
    assert.strictEqual(result.bins[0].binId, 'small-bin');
    assert.strictEqual(result.bins[0].capacity, 50);
  });

  it('should track unpacked items when capacity is insufficient', () => {
    const bins: BinDefinition[] = [
      { id: 'bin-1', capacity: 50, quantity: 1 },
    ];
    const items: ItemDefinition[] = [
      { id: 'item-1', size: 40, quantity: 1 },
      { id: 'item-2', size: 30, quantity: 1 },
      { id: 'item-huge', size: 100, quantity: 2 },
    ];

    const result = binPack1D(bins, items);
    assert.strictEqual(result.bins.length, 1);
    assert.strictEqual(result.bins[0].items.length, 1);
    assert.strictEqual(result.bins[0].items[0].id, 'item-1');

    assert.strictEqual(result.unpackedItems.length, 2);
    const unpackedHuge = result.unpackedItems.find((u) => u.id === 'item-huge');
    assert.ok(unpackedHuge);
    assert.strictEqual(unpackedHuge.quantity, 2);

    const unpacked2 = result.unpackedItems.find((u) => u.id === 'item-2');
    assert.ok(unpacked2);
    assert.strictEqual(unpacked2.quantity, 1);
  });

  it('should preserve custom user metadata in data field', () => {
    interface CustomBinMeta {
      warehouseLocation: string;
    }
    interface CustomItemMeta {
      sku: string;
      fragile: boolean;
    }

    const bins: BinDefinition<CustomBinMeta>[] = [
      { id: 'b1', capacity: 100, data: { warehouseLocation: 'A-12' } },
    ];
    const items: ItemDefinition<CustomItemMeta>[] = [
      { id: 'i1', size: 50, data: { sku: 'SKU-001', fragile: true } },
    ];

    const result = binPack1D<CustomBinMeta, CustomItemMeta>(bins, items);
    assert.strictEqual(result.bins[0].data?.warehouseLocation, 'A-12');
    assert.strictEqual(result.bins[0].items[0].data?.sku, 'SKU-001');
    assert.strictEqual(result.bins[0].items[0].data?.fragile, true);
  });

  it('should support different heuristics (first-fit vs worst-fit vs best-fit)', () => {
    const bins: BinDefinition[] = [
      { id: 'b1', capacity: 100, quantity: 3 },
    ];
    // Create pre-filled bins scenario by packing item 1 and item 2
    const items: ItemDefinition[] = [
      { id: 'i1', size: 50, quantity: 1 },
      { id: 'i2', size: 30, quantity: 1 },
      { id: 'i3', size: 40, quantity: 1 },
    ];

    const resBfd = binPack1D(bins, items, { strategy: 'best-fit-decreasing' });
    const resFfd = binPack1D(bins, items, { strategy: 'first-fit-decreasing' });
    const resWfd = binPack1D(bins, items, { strategy: 'worst-fit-decreasing' });

    assert.ok(resBfd.bins.length <= 2);
    assert.ok(resFfd.bins.length <= 2);
    assert.ok(resWfd.bins.length >= 1);
  });
});
