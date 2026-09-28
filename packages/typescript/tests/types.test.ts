import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  optimize,
  InputRequest,
  OptimizationResult,
  OptimizationResult1D,
  OptimizationResult2D,
} from '../src/index.js';

// Compile-time assertions: this file fails to build if the result types regress.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<T extends true>(_: T): void {}

describe('optimize() result types', () => {
  it('should infer the 2D result type from a literal input', () => {
    const result = optimize({
      dimension: '2D',
      stocks: [{ id: 's', width: 100, height: 100 }],
      parts: [{ id: 'a', width: 50, height: 50 }],
    });
    expectType<Equal<typeof result, OptimizationResult2D>>(true);
    assert.strictEqual(result.stocks[0].width, 100); // No cast needed
  });

  it('should infer the 1D result type, also through the { input } wrapper', () => {
    const result = optimize({
      input: {
        dimension: '1D',
        stocks: [{ id: 's', length: 100 }],
        parts: [{ id: 'a', length: 50 }],
      },
    });
    expectType<Equal<typeof result, OptimizationResult1D>>(true);
    assert.strictEqual(result.stocks[0].length, 100);
  });

  it('should return a union that narrows by dimension for untyped (any) input', () => {
    const parsed: any = JSON.parse(
      '{"dimension":"1D","stocks":[{"id":"s","length":100}],"parts":[{"id":"a","length":50}]}'
    );
    const result = optimize(parsed);
    expectType<Equal<typeof result, OptimizationResult1D | OptimizationResult2D>>(true);
    if (result.dimension === '1D') {
      assert.strictEqual(result.stocks[0].length, 100);
    } else {
      assert.fail('expected a 1D result');
    }
  });

  it('should keep the general type when the dimension is not known statically', () => {
    const input: InputRequest = {
      dimension: '1D',
      stocks: [{ id: 's', length: 100 }],
      parts: [{ id: 'a', length: 50 }],
    };
    const result = optimize(input);
    expectType<Equal<typeof result, OptimizationResult>>(true);
    assert.strictEqual(result.dimension, '1D');
  });
});
