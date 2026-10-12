import { CalcError } from './errors.ts';
import type { AngleMode } from './ast.ts';
import { ensureFinite, isNearLatticePoint } from './precision.ts';

export interface FunctionContext {
  readonly angleMode: AngleMode;
}

export interface FunctionSpec {
  readonly name: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly apply: (args: readonly number[], context: FunctionContext) => number;
}

const DEGREES_PER_HALF_TURN = 180;
const MAX_FACTORIAL_INPUT = 170;
const MAX_ROUND_DIGITS = 15;
const WHOLE_NUMBER_TOLERANCE = 1e-9;
const DEFAULT_PAYMENTS_PER_YEAR = 12;
const FULL_TURN_DEGREES = 360;
const QUARTER_TURN_DEGREES = 90;
const EXACT_QUARTER_TURN_SINES = [0, 1, 0, -1] as const;

function argAt(args: readonly number[], index: number): number {
  const value = args[index];
  if (value === undefined) {
    throw new CalcError('syntax', `Missing argument ${index + 1}`);
  }
  return value;
}

function toRadians(x: number, mode: AngleMode): number {
  return mode === 'deg' ? (x * Math.PI) / DEGREES_PER_HALF_TURN : x;
}

function fromRadians(x: number, mode: AngleMode): number {
  return mode === 'deg' ? (x * DEGREES_PER_HALF_TURN) / Math.PI : x;
}

/** Sine in degrees, exact at multiples of 90. */
function sinDegrees(x: number): number {
  const turns = ((x % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
  const quarters = turns / QUARTER_TURN_DEGREES;
  if (Number.isInteger(quarters)) {
    return EXACT_QUARTER_TURN_SINES[quarters] ?? 0;
  }
  return Math.sin(toRadians(turns, 'deg'));
}

function sinRadians(x: number): number {
  const k = Math.round(x / Math.PI);
  if (k !== 0 && isNearLatticePoint(x, 0, Math.PI)) return 0;
  return Math.sin(x);
}

function cosRadians(x: number): number {
  if (isNearLatticePoint(x, Math.PI / 2, Math.PI)) return 0;
  return Math.cos(x);
}

function sine(x: number, mode: AngleMode): number {
  return mode === 'deg' ? sinDegrees(x) : sinRadians(x);
}

function cosine(x: number, mode: AngleMode): number {
  return mode === 'deg' ? sinDegrees(x + QUARTER_TURN_DEGREES) : cosRadians(x);
}

function tangent(x: number, mode: AngleMode): number {
  const cos = cosine(x, mode);
  if (cos === 0) throw new CalcError('math', 'tan is undefined at this angle');
  return sine(x, mode) / cos;
}

function requireRange(name: string, x: number, low: number, high: number): number {
  if (x < low || x > high) {
    throw new CalcError('math', `${name} is only defined for values from ${low} to ${high}`);
  }
  return x;
}

function requirePositive(name: string, x: number): number {
  if (!(x > 0)) throw new CalcError('math', `${name} is only defined for values greater than 0`);
  return x;
}

function requireWholeNumber(label: string, x: number): number {
  if (Math.abs(x - Math.round(x)) > WHOLE_NUMBER_TOLERANCE) {
    throw new CalcError('math', `${label} must be a whole number`);
  }
  return Math.round(x);
}

export function power(base: number, exponent: number): number {
  if (base === 0 && exponent < 0) {
    throw new CalcError('math', 'Division by zero (zero raised to a negative power)');
  }
  return ensureFinite(Math.pow(base, exponent));
}

export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new CalcError('math', 'Factorial is only defined for non-negative whole numbers');
  }
  if (n > MAX_FACTORIAL_INPUT) {
    throw new CalcError('math', `Factorial is too large (maximum is ${MAX_FACTORIAL_INPUT}!)`);
  }
  let product = 1;
  for (let i = 2; i <= n; i += 1) product *= i;
  return product;
}

function roundHalfAwayFromZero(x: number, digits: number): number {
  const places = requireWholeNumber('Digits', digits);
  if (places < 0 || places > MAX_ROUND_DIGITS) {
    throw new CalcError('math', `Digits must be between 0 and ${MAX_ROUND_DIGITS}`);
  }
  const scale = 10 ** places;
  return (Math.sign(x) * Math.round(Math.abs(x) * scale)) / scale;
}

/** A = P(1 + r/n)^(nt) */
function compoundInterest(principal: number, rate: number, periodsPerYear: number, years: number): number {
  if (!(periodsPerYear > 0)) {
    throw new CalcError('math', 'Compounding periods per year must be greater than 0');
  }
  return principal * power(1 + rate / periodsPerYear, periodsPerYear * years);
}

/** Level payment of a fully amortizing loan: P * i / (1 - (1 + i)^-N). */
function amortizedPayment(principal: number, annualRate: number, years: number, paymentsPerYear: number): number {
  if (!(paymentsPerYear > 0)) {
    throw new CalcError('math', 'Payments per year must be greater than 0');
  }
  const payments = requireWholeNumber('Number of payments (years x payments per year)', years * paymentsPerYear);
  if (payments < 1) throw new CalcError('math', 'There must be at least one payment');
  const periodRate = annualRate / paymentsPerYear;
  if (periodRate <= -1) throw new CalcError('math', 'Interest rate per period must be greater than -100%');
  if (periodRate === 0) return principal / payments;
  return (principal * periodRate) / (1 - power(1 + periodRate, -payments));
}

/** NPV = sum of C_t / (1 + rate)^t, where the first cash flow is at t = 0. */
function netPresentValue(rate: number, cashFlows: readonly number[]): number {
  if (rate <= -1) throw new CalcError('math', 'Discount rate must be greater than -100%');
  return cashFlows.reduce((total, flow, t) => total + flow / power(1 + rate, t), 0);
}

function define(
  name: string,
  minArgs: number,
  maxArgs: number,
  apply: FunctionSpec['apply'],
): readonly [string, FunctionSpec] {
  return [name, { name, minArgs, maxArgs, apply }];
}

function unary(name: string, fn: (x: number, context: FunctionContext) => number): readonly [string, FunctionSpec] {
  return define(name, 1, 1, (args, context) => fn(argAt(args, 0), context));
}

export const FUNCTIONS: ReadonlyMap<string, FunctionSpec> = new Map([
  unary('sin', (x, c) => sine(x, c.angleMode)),
  unary('cos', (x, c) => cosine(x, c.angleMode)),
  unary('tan', (x, c) => tangent(x, c.angleMode)),
  unary('asin', (x, c) => fromRadians(Math.asin(requireRange('asin', x, -1, 1)), c.angleMode)),
  unary('acos', (x, c) => fromRadians(Math.acos(requireRange('acos', x, -1, 1)), c.angleMode)),
  unary('atan', (x, c) => fromRadians(Math.atan(x), c.angleMode)),
  define('atan2', 2, 2, (args, c) => fromRadians(Math.atan2(argAt(args, 0), argAt(args, 1)), c.angleMode)),
  unary('sinh', (x) => ensureFinite(Math.sinh(x))),
  unary('cosh', (x) => ensureFinite(Math.cosh(x))),
  unary('tanh', (x) => Math.tanh(x)),
  unary('ln', (x) => Math.log(requirePositive('ln', x))),
  unary('log10', (x) => Math.log10(requirePositive('log10', x))),
  unary('log', (x) => Math.log10(requirePositive('log', x))),
  unary('log2', (x) => Math.log2(requirePositive('log2', x))),
  unary('exp', (x) => ensureFinite(Math.exp(x))),
  unary('sqrt', (x) => Math.sqrt(requireRange('sqrt', x, 0, Infinity))),
  unary('cbrt', (x) => Math.cbrt(x)),
  unary('abs', (x) => Math.abs(x)),
  unary('floor', (x) => Math.floor(x)),
  unary('ceil', (x) => Math.ceil(x)),
  define('round', 1, 2, (args) => roundHalfAwayFromZero(argAt(args, 0), args.length > 1 ? argAt(args, 1) : 0)),
  define('pow', 2, 2, (args) => power(argAt(args, 0), argAt(args, 1))),
  define('min', 1, Infinity, (args) => Math.min(...args)),
  define('max', 1, Infinity, (args) => Math.max(...args)),
  unary('fact', (x) => factorial(x)),
  define('compound', 4, 4, (args) =>
    compoundInterest(argAt(args, 0), argAt(args, 1), argAt(args, 2), argAt(args, 3)),
  ),
  define('pmt', 3, 4, (args) =>
    amortizedPayment(
      argAt(args, 0),
      argAt(args, 1),
      argAt(args, 2),
      args.length > 3 ? argAt(args, 3) : DEFAULT_PAYMENTS_PER_YEAR,
    ),
  ),
  define('npv', 2, Infinity, (args) => netPresentValue(argAt(args, 0), args.slice(1))),
]);
