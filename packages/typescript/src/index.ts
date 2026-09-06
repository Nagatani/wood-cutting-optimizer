export * from './types.js';
export * from './binpacking/index.js';
export { optimize1D } from './optimizer1d.js';
export { optimize2D } from './optimizer2d.js';

import { InputRequest, OptimizationResult } from './types.js';
import { optimize1D } from './optimizer1d.js';
import { optimize2D } from './optimizer2d.js';

/**
 * Main optimization entry point. Dispatches to 1D or 2D optimizer based on input dimension.
 */
export function optimize(input: InputRequest): OptimizationResult {
  if (input.dimension === '1D') {
    return optimize1D(input);
  } else if (input.dimension === '2D') {
    return optimize2D(input);
  } else {
    throw new Error(`Unsupported dimension: ${(input as any).dimension}`);
  }
}
