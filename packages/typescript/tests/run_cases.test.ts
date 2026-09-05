import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimize } from '../src/index.js';
import { StockResult1D, StockResult2D } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Try relative to dist/tests or relative to repo root
const testCasesDir = fs.existsSync(path.resolve(__dirname, '../../../../test-cases'))
  ? path.resolve(__dirname, '../../../../test-cases')
  : path.resolve(process.cwd(), '../../test-cases');

describe('Wood Cutting Optimizer Test Cases', () => {
  it('should optimize 1D basic timber cut case', () => {
    const casePath = path.join(testCasesDir, '1d_basic.json');
    const caseData = JSON.parse(fs.readFileSync(casePath, 'utf-8'));

    const result = optimize(caseData.input);

    assert.strictEqual(result.dimension, '1D');
    assert.strictEqual(result.unplaced_parts.length, 0, 'All parts should be placed');
    assert.ok(
      result.summary.stock_count_used <= caseData.expected.max_stocks_used,
      `Stocks used (${result.summary.stock_count_used}) should be <= ${caseData.expected.max_stocks_used}`
    );

    // Verify placements validity
    for (const stock of result.stocks as StockResult1D[]) {
      assert.ok(stock.placements.length > 0);
      // Verify no overlap and kerf spacing
      for (let i = 0; i < stock.placements.length - 1; i++) {
        const curr = stock.placements[i];
        const next = stock.placements[i + 1];
        assert.ok(
          curr.x + curr.length + (caseData.input.kerf ?? 0) <= next.x + 1e-6,
          `Overlap or missing kerf between part ${curr.part_id} and ${next.part_id}`
        );
      }
      const lastPlacement = stock.placements[stock.placements.length - 1];
      assert.ok(
        lastPlacement.x + lastPlacement.length <= stock.length + 1e-6,
        'Placements must fit within stock length'
      );
    }
  });

  it('should optimize 2D guillotine plywood cut case', () => {
    const casePath = path.join(testCasesDir, '2d_guillotine.json');
    const caseData = JSON.parse(fs.readFileSync(casePath, 'utf-8'));

    const result = optimize(caseData.input);

    assert.strictEqual(result.dimension, '2D');
    assert.strictEqual(result.unplaced_parts.length, 0, 'All parts should be placed');
    assert.ok(
      result.summary.stock_count_used <= caseData.expected.max_stocks_used,
      `Stocks used (${result.summary.stock_count_used}) should be <= ${caseData.expected.max_stocks_used}`
    );

    // Verify placements validity
    for (const stock of result.stocks as StockResult2D[]) {
      assert.ok(stock.placements.length > 0);
      assert.ok(stock.cuts.length > 0, 'Guillotine cuts should be generated');

      for (let i = 0; i < stock.placements.length; i++) {
        const p1 = stock.placements[i];
        // Must fit inside stock
        assert.ok(p1.x >= 0 && p1.y >= 0);
        assert.ok(p1.x + p1.width <= stock.width + 1e-6);
        assert.ok(p1.y + p1.height <= stock.height + 1e-6);

        // Must not overlap with any other placement
        for (let j = i + 1; j < stock.placements.length; j++) {
          const p2 = stock.placements[j];
          const overlapX = Math.max(0, Math.min(p1.x + p1.width, p2.x + p2.width) - Math.max(p1.x, p2.x));
          const overlapY = Math.max(0, Math.min(p1.y + p1.height, p2.y + p2.height) - Math.max(p1.y, p2.y));
          assert.ok(
            overlapX <= 1e-6 || overlapY <= 1e-6,
            `Overlap detected between ${p1.part_id} and ${p2.part_id}`
          );
        }
      }
    }
  });

  it('should respect grain direction and rotation constraints in 2D', () => {
    const casePath = path.join(testCasesDir, '2d_grain_rotation.json');
    const caseData = JSON.parse(fs.readFileSync(casePath, 'utf-8'));

    const result = optimize(caseData.input);

    const placedPartIds = new Set<string>();
    for (const stock of result.stocks as StockResult2D[]) {
      for (const p of stock.placements) {
        placedPartIds.add(p.part_id);
      }
    }

    const unplacedPartIds = new Set<string>();
    for (const u of result.unplaced_parts) {
      unplacedPartIds.add(u.part_id);
    }

    for (const expectedPlacedId of caseData.expected.placed_part_ids) {
      assert.ok(placedPartIds.has(expectedPlacedId), `Part ${expectedPlacedId} should be placed`);
    }

    for (const expectedUnplacedId of caseData.expected.unplaced_part_ids) {
      assert.ok(unplacedPartIds.has(expectedUnplacedId), `Part ${expectedUnplacedId} should be unplaced`);
    }
  });
});
