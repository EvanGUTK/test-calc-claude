import type { AngleMode, Expr } from './ast.ts';
import { CONSTANTS } from './constants.ts';
import { CalcError } from './errors.ts';
import { FUNCTIONS, factorial, power } from './functions.ts';
import { ensureFinite } from './precision.ts';

export interface EvalContext {
  readonly angleMode: AngleMode;
  readonly variables: ReadonlyMap<string, number>;
}

function lookupVariable(name: string, context: EvalContext): number {
  const constant = CONSTANTS.get(name);
  if (constant !== undefined) return constant;
  const value = context.variables.get(name);
  if (value === undefined) throw new CalcError('name', `Undefined variable '${name}'`);
  return value;
}

function divide(left: number, right: number): number {
  if (right === 0) throw new CalcError('math', 'Division by zero');
  return left / right;
}

function modulo(left: number, right: number): number {
  if (right === 0) throw new CalcError('math', 'Modulo by zero');
  return left % right;
}

function evaluateBinary(op: string, left: number, right: number): number {
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return divide(left, right);
    case '%':
      return modulo(left, right);
    case '^':
      return power(left, right);
    default:
      throw new CalcError('syntax', `Unknown operator '${op}'`);
  }
}

function evaluateCall(name: string, args: readonly number[], context: EvalContext): number {
  const spec = FUNCTIONS.get(name);
  if (spec === undefined) throw new CalcError('syntax', `Unknown function '${name}'`);
  return spec.apply(args, { angleMode: context.angleMode });
}

function compute(node: Expr, context: EvalContext): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'variable':
      return lookupVariable(node.name, context);
    case 'unary': {
      const operand = evaluateNode(node.operand, context);
      return node.op === '-' ? -operand : operand;
    }
    case 'binary':
      return evaluateBinary(node.op, evaluateNode(node.left, context), evaluateNode(node.right, context));
    case 'factorial':
      return factorial(evaluateNode(node.operand, context));
    case 'call':
      return evaluateCall(
        node.name,
        node.args.map((arg) => evaluateNode(arg, context)),
        context,
      );
  }
}

/** Evaluates an AST. Errors raised without a location are tagged with the innermost node that failed. */
export function evaluateNode(node: Expr, context: EvalContext): number {
  try {
    return ensureFinite(compute(node, context));
  } catch (error) {
    if (error instanceof CalcError) throw error.withSpanIfMissing({ start: node.start, end: node.end });
    throw error;
  }
}
