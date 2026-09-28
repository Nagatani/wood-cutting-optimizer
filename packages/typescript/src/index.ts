export * from './types.js';
export * from './binpacking/index.js';
export { optimize1D } from './optimizer1d.js';
export { optimize2D } from './optimizer2d.js';
export { validateInput } from './validate.js';
export { renderSvg } from './svg.js';

import { InputRequest, OptimizationResult } from './types.js';
import { optimize1D } from './optimizer1d.js';
import { optimize2D } from './optimizer2d.js';

/**
 * Main optimization entry point. Dispatches to 1D or 2D optimizer based on input dimension.
 * Also accepts the test-case wrapper form `{ input: InputRequest }`.
 */
export function optimize(data: InputRequest | { input: InputRequest }): OptimizationResult {
  const input: InputRequest =
    data !== null && typeof data === 'object' && 'input' in data ? data.input : data;
  if (input === null || typeof input !== 'object') {
    throw new Error('Invalid input: input must be an object');
  }
  if (input.dimension === '1D') {
    return optimize1D(input);
  } else if (input.dimension === '2D') {
    return optimize2D(input);
  } else {
    throw new Error(`Invalid input: dimension must be "1D" or "2D" (got ${(input as any)?.dimension})`);
  }
}
