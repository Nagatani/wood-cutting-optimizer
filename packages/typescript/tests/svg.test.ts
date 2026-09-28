import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimize, renderSvg, InputRequest } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testCasesDir = fs.existsSync(path.resolve(__dirname, '../../../../test-cases'))
  ? path.resolve(__dirname, '../../../../test-cases')
  : path.resolve(process.cwd(), '../../test-cases');

function count(svg: string, pattern: RegExp): number {
  return (svg.match(pattern) ?? []).length;
}

describe('SVG cutting diagram', () => {
  for (const file of fs.readdirSync(testCasesDir).filter((f) => f.endsWith('.json'))) {
    it(`should draw every placement, remnant and cut (${file})`, () => {
      const caseData = JSON.parse(fs.readFileSync(path.join(testCasesDir, file), 'utf-8'));
      const result = optimize(caseData);
      const svg = renderSvg(result, caseData);

      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
      assert.ok(svg.trimEnd().endsWith('</svg>'));
      const placements = result.stocks.reduce((n, s) => n + s.placements.length, 0);
      const remnants = result.stocks.reduce((n, s) => n + s.remnants.length, 0);
      const cuts = result.stocks.reduce((n, s) => n + s.cuts.length, 0);
      assert.strictEqual(count(svg, /<rect class="part"/g), placements);
      assert.strictEqual(count(svg, /<rect class="remnant"/g), remnants);
      assert.strictEqual(count(svg, /<line class="cut"/g), cuts);
      assert.strictEqual(count(svg, /<rect class="stock"/g), result.stocks.length);
    });
  }

  it('should label parts with their names and escape XML', () => {
    const input: InputRequest = {
      dimension: '2D',
      stocks: [{ id: 's', width: 1000, height: 1000 }],
      parts: [
        { id: 'a', name: 'Top & <Side>', width: 600, height: 600 },
        { id: 'huge', name: '大きすぎる板', width: 2000, height: 2000 },
      ],
    };
    const svg = renderSvg(optimize(input), input);
    assert.ok(svg.includes('Top &amp; &lt;Side&gt;'));
    assert.ok(!svg.includes('Top & <Side>'));
    assert.ok(svg.includes('unplaced: 大きすぎる板 ×1'));
  });

  it('should fall back to part ids without input', () => {
    const input: InputRequest = {
      dimension: '1D',
      stocks: [{ id: 's', length: 2000 }],
      parts: [{ id: 'leg-id', name: 'Leg', length: 800 }],
    };
    const svg = renderSvg(optimize(input));
    assert.ok(svg.includes('leg-id'));
    assert.ok(!svg.includes('Leg'));
  });
});
