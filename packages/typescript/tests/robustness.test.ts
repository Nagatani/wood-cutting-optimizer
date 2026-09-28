import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimize, binPack1D, InputRequest, StockResult1D, StockResult2D } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testCasesDir = fs.existsSync(path.resolve(__dirname, '../../../../test-cases'))
  ? path.resolve(__dirname, '../../../../test-cases')
  : path.resolve(process.cwd(), '../../test-cases');

const caseFiles = fs.readdirSync(testCasesDir).filter((f) => f.endsWith('.json'));

describe('Invariants across all shared test cases', () => {
  for (const file of caseFiles) {
    it(`used + waste + remnant equals stock measure (${file})`, () => {
      const caseData = JSON.parse(fs.readFileSync(path.join(testCasesDir, file), 'utf-8'));
      const { summary } = optimize(caseData.input);
      const total =
        summary.total_used_measure + summary.total_waste_measure + summary.total_remnant_measure;
      assert.ok(
        Math.abs(total - summary.total_stock_measure) < 1e-3,
        `Balance mismatch: ${total} vs ${summary.total_stock_measure}`
      );
    });
  }
});

describe('Stock usage (purchase list)', () => {
  for (const file of caseFiles) {
    it(`stock_usage quantities add up to stock_count_used (${file})`, () => {
      const caseData = JSON.parse(fs.readFileSync(path.join(testCasesDir, file), 'utf-8'));
      const { summary } = optimize(caseData.input);
      const total = summary.stock_usage.reduce((sum, u) => sum + u.quantity, 0);
      assert.strictEqual(total, summary.stock_count_used);
    });
  }

  it('should report cost per stock entry, or null without cost', () => {
    const result = optimize({
      dimension: '1D',
      stocks: [
        { id: 'priced', length: 1000, quantity: 2, cost: 250 },
        { id: 'free', length: 1000, quantity: 2 },
      ],
      parts: [{ id: 'a', length: 900, quantity: 4 }],
    });
    assert.deepStrictEqual(result.summary.stock_usage, [
      { stock_id: 'priced', quantity: 2, cost: 500 },
      { stock_id: 'free', quantity: 2, cost: null },
    ]);
  });
});

describe('1D cutting', () => {
  it('should add a final cut and subtract kerf before the leftover', () => {
    const result = optimize({
      dimension: '1D',
      kerf: 3,
      min_remnant_size: { length: 100 },
      stocks: [{ id: 's', length: 1000 }],
      parts: [{ id: 'a', length: 400 }],
    });
    const stock = result.stocks[0] as StockResult1D;
    assert.deepStrictEqual(stock.cuts, [{ x: 400, kerf: 3, step: 1 }]);
    assert.deepStrictEqual(stock.remnants, [{ x: 403, length: 597 }]);
    assert.strictEqual(result.summary.total_waste_measure, 3);
  });

  it('should treat a leftover thinner than the kerf as cut loss', () => {
    const result = optimize({
      dimension: '1D',
      kerf: 3,
      stocks: [{ id: 's', length: 1000 }],
      parts: [{ id: 'a', length: 998 }],
    });
    const stock = result.stocks[0] as StockResult1D;
    assert.strictEqual(stock.cuts.length, 1);
    assert.strictEqual(stock.waste.length, 0);
    assert.strictEqual(result.summary.total_waste_measure, 2);
  });

  it('should tolerate floating-point error when parts fill the stock exactly', () => {
    const result = optimize({
      dimension: '1D',
      stocks: [{ id: 's', length: 0.3 }],
      parts: [
        { id: 'a', length: 0.1 },
        { id: 'b', length: 0.2 },
      ],
    });
    assert.strictEqual(result.summary.stock_count_used, 1);
    assert.strictEqual(result.unplaced_parts.length, 0);
  });
});

describe('2D cutting', () => {
  it('should count only the actual cut loss when the leftover is thinner than the kerf', () => {
    const result = optimize({
      dimension: '2D',
      kerf: 3,
      stocks: [{ id: 's', width: 100, height: 100 }],
      parts: [{ id: 'a', width: 99, height: 100 }],
    });
    assert.strictEqual(result.summary.total_waste_measure, 100);
    assert.strictEqual((result.stocks[0] as StockResult2D).waste.length, 0);
  });

  it('should tolerate floating-point error when parts fill the stock exactly', () => {
    const result = optimize({
      dimension: '2D',
      stocks: [{ id: 's', width: 0.3, height: 1 }],
      parts: [
        { id: 'a', width: 0.1, height: 1, can_rotate: false },
        { id: 'b', width: 0.2, height: 1, can_rotate: false },
      ],
    });
    assert.strictEqual(result.unplaced_parts.length, 0);
  });
});

describe('Cost-aware stock selection', () => {
  for (const file of ['1d_cost_aware.json', '2d_cost_aware.json']) {
    it(`should choose the cheapest stock combination (${file})`, () => {
      const caseData = JSON.parse(fs.readFileSync(path.join(testCasesDir, file), 'utf-8'));
      const result = optimize(caseData.input);
      const costs = new Map<string, number>(caseData.input.stocks.map((s: any) => [s.id, s.cost]));
      assert.strictEqual(result.unplaced_parts.length, 0);
      assert.deepStrictEqual(
        result.stocks.map((s) => s.stock_id),
        caseData.expected.stock_ids
      );
      const totalCost = result.stocks.reduce((sum, s) => sum + costs.get(s.stock_id)!, 0);
      assert.strictEqual(totalCost, caseData.expected.total_cost);
    });
  }
});

describe('Remnant orientation', () => {
  const input = (grain: 'none' | 'length'): InputRequest => ({
    dimension: '2D',
    min_remnant_size: { width: 100, height: 300 },
    stocks: [{ id: 's', width: 1000, height: 1000, grain }],
    parts: [{ id: 'a', width: 1000, height: 850, can_rotate: false }],
  });

  it('should accept a turned leftover as remnant when the stock has no grain', () => {
    const stock = optimize(input('none')).stocks[0] as StockResult2D;
    assert.deepStrictEqual(stock.remnants, [{ x: 0, y: 850, width: 1000, height: 150 }]);
  });

  it('should keep the orientation fixed when the stock has grain', () => {
    const stock = optimize(input('length')).stocks[0] as StockResult2D;
    assert.strictEqual(stock.remnants.length, 0);
    assert.strictEqual(stock.waste.length, 1);
  });
});

describe('Unlimited stock quantity', () => {
  it('should use as many sheets as needed (2D)', () => {
    const caseData = JSON.parse(fs.readFileSync(path.join(testCasesDir, '2d_unlimited_stock.json'), 'utf-8'));
    const result = optimize(caseData.input);
    assert.strictEqual(result.unplaced_parts.length, 0);
    assert.ok(result.summary.stock_count_used <= caseData.expected.max_stocks_used);
  });

  it('should use as many stocks as needed (1D)', () => {
    const result = optimize({
      dimension: '1D',
      kerf: 3,
      stocks: [{ id: 's', length: 1820, quantity: 'unlimited' }],
      parts: [{ id: 'a', length: 900, quantity: 20 }],
    });
    assert.strictEqual(result.unplaced_parts.length, 0);
    assert.strictEqual(result.summary.stock_count_used, 10);
  });
});

describe('Input handling', () => {
  const valid: InputRequest = {
    dimension: '1D',
    stocks: [{ id: 's', length: 100 }],
    parts: [{ id: 'a', length: 10 }],
  };

  it('should accept the test case wrapper form { input }', () => {
    assert.deepStrictEqual(optimize({ input: valid }), optimize(valid));
  });

  const invalidCases: [string, unknown][] = [
    ['unknown dimension', { ...valid, dimension: '3D' }],
    ['negative kerf', { ...valid, kerf: -1 }],
    ['negative part length', { ...valid, parts: [{ id: 'a', length: -5 }] }],
    ['zero stock length', { ...valid, stocks: [{ id: 's', length: 0 }] }],
    ['fractional quantity', { ...valid, parts: [{ id: 'a', length: 10, quantity: 2.5 }] }],
    ['missing id', { ...valid, parts: [{ length: 10 }] }],
    ['unlimited part quantity', { ...valid, parts: [{ id: 'a', length: 10, quantity: 'unlimited' }] }],
    ['unknown stock quantity string', { ...valid, stocks: [{ id: 's', length: 100, quantity: 'many' }] }],
    ['stocks not an array', { ...valid, stocks: null }],
    [
      'invalid grain',
      {
        dimension: '2D',
        stocks: [{ id: 's', width: 100, height: 100, grain: 'diagonal' }],
        parts: [{ id: 'a', width: 10, height: 10 }],
      },
    ],
  ];

  for (const [label, input] of invalidCases) {
    it(`should reject ${label}`, () => {
      assert.throws(() => optimize(input as InputRequest), /Invalid input/);
    });
  }
});

describe('Generic 1D Bin Packing validation', () => {
  it('should reject unknown strategy', () => {
    assert.throws(
      () => binPack1D([{ id: 'b', capacity: 10 }], [{ id: 'i', size: 5 }], { strategy: 'foo' as any }),
      /Unsupported strategy/
    );
  });

  it('should reject negative itemSpacing', () => {
    assert.throws(
      () => binPack1D([{ id: 'b', capacity: 10 }], [{ id: 'i', size: 5 }], { itemSpacing: -1 }),
      /itemSpacing/
    );
  });

  it('should reject unknown binSelection', () => {
    assert.throws(
      () => binPack1D([{ id: 'b', capacity: 10 }], [{ id: 'i', size: 5 }], { binSelection: 'foo' as any }),
      /Unsupported binSelection/
    );
  });

  it('should open the largest bin with binSelection "largest"', () => {
    const result = binPack1D(
      [
        { id: 'small', capacity: 10, quantity: 5 },
        { id: 'large', capacity: 30, quantity: 5 },
      ],
      [{ id: 'i', size: 5, quantity: 6 }],
      { binSelection: 'largest' }
    );
    assert.deepStrictEqual(result.bins.map((b) => b.binId), ['large']);
  });

  it('should allow unlimited bin quantity (Infinity)', () => {
    const result = binPack1D([{ id: 'b', capacity: 10, quantity: Infinity }], [{ id: 'i', size: 6, quantity: 5 }]);
    assert.strictEqual(result.summary.binsUsed, 5);
  });
});
