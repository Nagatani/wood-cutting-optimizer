import { InputRequest } from './types.js';

const GRAIN_DIRECTIONS: readonly string[] = ['none', 'length', 'width'];

function fail(message: string): never {
  throw new Error(`Invalid input: ${message}`);
}

function checkPositive(label: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${label} must be a finite number > 0 (got ${value})`);
  }
}

function checkNonNegative(label: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a finite number >= 0 (got ${value})`);
  }
}

function checkQuantity(label: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(`${label}.quantity must be an integer >= 1 (got ${value})`);
  }
}

function checkGrain(label: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !GRAIN_DIRECTIONS.includes(value)) {
    fail(`${label}.grain must be one of ${GRAIN_DIRECTIONS.join(', ')} (got ${value})`);
  }
}

function checkId(label: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label}.id must be a non-empty string`);
  }
}

/**
 * Validates an InputRequest against the constraints of specification/schema.json.
 * Throws an Error describing the first violation found.
 */
export function validateInput(input: InputRequest): void {
  if (input === null || typeof input !== 'object') {
    fail('input must be an object');
  }
  if (input.dimension !== '1D' && input.dimension !== '2D') {
    fail(`dimension must be "1D" or "2D" (got ${(input as any).dimension})`);
  }
  if (input.kerf !== undefined) {
    checkNonNegative('kerf', input.kerf);
  }
  if (input.min_remnant_size !== undefined) {
    for (const key of ['length', 'width', 'height'] as const) {
      const v = input.min_remnant_size[key];
      if (v !== undefined) checkNonNegative(`min_remnant_size.${key}`, v);
    }
  }
  if (!Array.isArray(input.stocks)) fail('stocks must be an array');
  if (!Array.isArray(input.parts)) fail('parts must be an array');

  input.stocks.forEach((s: any, i) => {
    const label = `stocks[${i}]`;
    checkId(label, s?.id);
    if (input.dimension === '1D') {
      checkPositive(`${label}.length`, s.length);
    } else {
      checkPositive(`${label}.width`, s.width);
      checkPositive(`${label}.height`, s.height);
      checkGrain(label, s.grain);
    }
    checkQuantity(label, s.quantity);
    if (s.cost !== undefined) checkNonNegative(`${label}.cost`, s.cost);
  });

  input.parts.forEach((p: any, i) => {
    const label = `parts[${i}]`;
    checkId(label, p?.id);
    if (input.dimension === '1D') {
      checkPositive(`${label}.length`, p.length);
    } else {
      checkPositive(`${label}.width`, p.width);
      checkPositive(`${label}.height`, p.height);
      checkGrain(label, p.grain);
      if (p.can_rotate !== undefined && typeof p.can_rotate !== 'boolean') {
        fail(`${label}.can_rotate must be a boolean (got ${p.can_rotate})`);
      }
    }
    checkQuantity(label, p.quantity);
  });
}
