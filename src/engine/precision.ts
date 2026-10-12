import { CalcError, type Span } from './errors.ts';

/** Significant digits kept in final results; hides binary floating-point noise such as 0.1 + 0.2. */
export const RESULT_SIGNIFICANT_DIGITS = 12;

/** Relative tolerance used to snap trig inputs that land on a zero of the function. */
const SNAP_TOLERANCE = 8 * Number.EPSILON;

export function roundSignificant(value: number): number {
  if (value === 0) return 0;
  return Number(value.toPrecision(RESULT_SIGNIFICANT_DIGITS));
}

export function ensureFinite(value: number, span: Span | null = null): number {
  if (Number.isNaN(value)) throw new CalcError('math', 'Result is not a real number', span);
  if (!Number.isFinite(value)) throw new CalcError('math', 'Result is too large to represent', span);
  return value;
}

/** True when `x` is within floating-point noise of `offset + k * step` for some integer k. */
export function isNearLatticePoint(x: number, offset: number, step: number): boolean {
  const k = Math.round((x - offset) / step);
  return Math.abs(x - (offset + k * step)) <= SNAP_TOLERANCE * Math.max(1, Math.abs(x));
}
