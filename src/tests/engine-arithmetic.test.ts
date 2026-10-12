import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertCalcError, calc } from './helpers.ts';

describe('arithmetic and precedence', () => {
  it('evaluates the four operations', () => {
    assert.equal(calc('1 + 2'), 3);
    assert.equal(calc('7 - 10'), -3);
    assert.equal(calc('6 * 7'), 42);
    assert.equal(calc('9 / 4'), 2.25);
  });

  it('applies * and / before + and -', () => {
    assert.equal(calc('2 + 3 * 4'), 14);
    assert.equal(calc('10 - 4 / 2'), 8);
  });

  it('is left-associative for same-precedence operators', () => {
    assert.equal(calc('10 - 3 - 2'), 5);
    assert.equal(calc('100 / 10 / 5'), 2);
  });

  it('is right-associative for exponentiation', () => {
    assert.equal(calc('2 ^ 3 ^ 2'), 512);
  });

  it('gives unary minus lower precedence than ^', () => {
    assert.equal(calc('-2 ^ 2'), -4);
    assert.equal(calc('(-2) ^ 2'), 4);
    assert.equal(calc('2 ^ -2'), 0.25);
    assert.equal(calc('2 * -3'), -6);
    assert.equal(calc('--4'), 4);
    assert.equal(calc('+5'), 5);
  });

  it('honours parentheses', () => {
    assert.equal(calc('(2 + 3) * 4'), 20);
    assert.equal(calc('((1 + 2) * (3 + 4))'), 21);
  });

  it('supports modulo with the sign of the dividend', () => {
    assert.equal(calc('10 % 3'), 1);
    assert.equal(calc('-10 % 3'), -1);
  });

  it('parses decimals and scientific notation', () => {
    assert.equal(calc('.5 + 0.25'), 0.75);
    assert.equal(calc('1.5e3'), 1500);
    assert.equal(calc('2E-2'), 0.02);
    assert.equal(calc('3.'), 3);
  });

  it('supports factorial as a postfix operator', () => {
    assert.equal(calc('5!'), 120);
    assert.equal(calc('0!'), 1);
    assert.equal(calc('(2 + 3)!'), 120);
    assert.equal(calc('2 ^ 3!'), 64);
    assert.equal(calc('-3!'), -6);
    assert.equal(calc('3!!'), 720);
    assert.equal(calc('fact(4)'), 24);
  });

  it('supports constants', () => {
    assert.equal(calc('pi'), 3.14159265359);
    assert.equal(calc('e'), 2.71828182846);
    assert.equal(calc('2 * pi'), 6.28318530718);
  });

  it('keeps expression whitespace-insensitive', () => {
    assert.equal(calc('  2+\t3 *\n4 '), 14);
  });
});

describe('floating-point precision bounds', () => {
  it('hides binary rounding noise', () => {
    assert.equal(calc('0.1 + 0.2'), 0.3);
    assert.equal(calc('0.3 - 0.1'), 0.2);
    assert.equal(calc('1.1 * 1.1'), 1.21);
    assert.equal(calc('4.35 * 100'), 435);
  });

  it('keeps 12 significant digits', () => {
    assert.equal(calc('1 / 3'), 0.333333333333);
    assert.equal(calc('2 / 3'), 0.666666666667);
    assert.equal(calc('123456789.123456789'), 123456789.123);
  });

  it('handles very large and very small magnitudes', () => {
    assert.equal(calc('1e300 * 1e3'), 1e303);
    assert.equal(calc('1e-300 / 1e3'), 1e-303);
    assert.equal(calc('9007199254740993'), 9007199254740000);
  });

  it('normalizes negative zero', () => {
    assert.ok(Object.is(calc('-0'), 0));
    assert.ok(Object.is(calc('0 * -5'), 0));
  });

  it('reports overflow instead of returning Infinity', () => {
    assertCalcError('1e308 * 10', { kind: 'math', message: /too large/ });
    assertCalcError('10 ^ 400', { kind: 'math', message: /too large/ });
  });

  it('rejects numeric literals outside the double range', () => {
    assertCalcError('1e999', { kind: 'syntax', message: /out of range/ });
  });
});

describe('division by zero and domain errors', () => {
  it('rejects division by zero', () => {
    assertCalcError('1 / 0', { kind: 'math', message: /Division by zero/ });
    assertCalcError('0 / 0', { kind: 'math', message: /Division by zero/ });
    assertCalcError('5 / (3 - 3)', { kind: 'math', message: /Division by zero/ });
  });

  it('rejects modulo by zero', () => {
    assertCalcError('5 % 0', { kind: 'math', message: /Modulo by zero/ });
  });

  it('rejects zero to a negative power', () => {
    assertCalcError('0 ^ -1', { kind: 'math', message: /Division by zero/ });
  });

  it('rejects non-real powers', () => {
    assertCalcError('(-8) ^ 0.5', { kind: 'math', message: /not a real number/ });
  });

  it('rejects invalid factorials', () => {
    assertCalcError('(-1)!', { kind: 'math', message: /non-negative whole/ });
    assertCalcError('2.5!', { kind: 'math', message: /non-negative whole/ });
    assertCalcError('171!', { kind: 'math', message: /too large/ });
    assert.equal(calc('170!'), 7.25741561531e306);
  });

  it('attaches the failing sub-expression span to math errors', () => {
    const error = assertCalcError('2 + 1 / 0', { kind: 'math', message: /Division by zero/ });
    assert.deepEqual(error.span, { start: 4, end: 9 });
  });
});

describe('variables', () => {
  it('resolves variables from the context', () => {
    assert.equal(calc('x * 2 + y', { x: 21, y: 0 }), 42);
  });

  it('reports undefined variables as name errors', () => {
    assertCalcError('foo + 1', { kind: 'name', message: /Undefined variable 'foo'/ });
  });
});
