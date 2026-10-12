import assert from 'node:assert/strict';
import { evaluateSource, CalcError, type AngleMode } from '../engine/index.ts';

export function calc(source: string, variables: Record<string, number> = {}, angleMode: AngleMode = 'rad'): number {
  return evaluateSource(source, { angleMode, variables: new Map(Object.entries(variables)) }).value;
}

export function assertCalcError(
  source: string,
  expected: { kind: 'syntax' | 'math' | 'name'; message: RegExp },
  variables: Record<string, number> = {},
  angleMode: AngleMode = 'rad',
): CalcError {
  try {
    calc(source, variables, angleMode);
  } catch (error) {
    assert.ok(error instanceof CalcError, `expected CalcError for "${source}", got ${String(error)}`);
    assert.equal(error.kind, expected.kind, `kind for "${source}": ${error.message}`);
    assert.match(error.message, expected.message, `message for "${source}"`);
    return error;
  }
  assert.fail(`expected "${source}" to throw`);
}
