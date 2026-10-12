import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyze, ANS_NAME, evaluateSource, reservedNameReason } from '../engine/index.ts';
import { lex } from '../engine/lexer.ts';
import { tokenize } from '../engine/tokenizer.ts';
import { assertCalcError, calc } from './helpers.ts';

describe('tokenizer', () => {
  it('splits numbers, words and symbols with positions', () => {
    const tokens = tokenize('x1 = 3.5e2*(y)');
    assert.deepEqual(
      tokens.map((t) => [t.type, t.text, t.start, t.end]),
      [
        ['word', 'x1', 0, 2],
        ['symbol', '=', 3, 4],
        ['number', '3.5e2', 5, 10],
        ['symbol', '*', 10, 11],
        ['symbol', '(', 11, 12],
        ['word', 'y', 12, 13],
        ['symbol', ')', 13, 14],
      ],
    );
  });

  it('marks unknown characters as invalid without throwing', () => {
    const tokens = tokenize('2 $ 3 # 😀');
    assert.deepEqual(
      tokens.filter((t) => t.type === 'invalid').map((t) => t.text),
      ['$', '#', '😀'],
    );
  });

  it('does not treat a trailing e as an exponent', () => {
    assert.deepEqual(
      tokenize('2e').map((t) => [t.type, t.text]),
      [
        ['number', '2'],
        ['word', 'e'],
      ],
    );
  });
});

describe('lexer', () => {
  it('classifies words by what follows and what they are', () => {
    const kinds = lex('sin(pi) + rate').map((l) => [l.text, l.kind]);
    assert.deepEqual(kinds, [
      ['sin', 'function'],
      ['(', 'lparen'],
      ['pi', 'constant'],
      [')', 'rparen'],
      ['+', 'operator'],
      ['rate', 'variable'],
    ]);
  });

  it('classifies a word followed by whitespace and a parenthesis as a function', () => {
    assert.equal(lex('sin (1)')[0]?.kind, 'function');
  });
});

describe('illegal input', () => {
  it('rejects an empty expression', () => {
    assertCalcError('', { kind: 'syntax', message: /empty/ });
    assertCalcError('   ', { kind: 'syntax', message: /empty/ });
  });

  it('rejects invalid characters', () => {
    assertCalcError('2 $ 3', { kind: 'syntax', message: /Invalid character '\$'/ });
    assertCalcError('2 + 3;', { kind: 'syntax', message: /Invalid character ';'/ });
    assertCalcError('process.exit()', { kind: 'syntax', message: /Invalid character '\.'/ });
    assertCalcError('alert`1`', { kind: 'syntax', message: /Invalid character/ });
  });

  it('does not execute code: identifiers are never evaluated as JavaScript', () => {
    assertCalcError('constructor', { kind: 'name', message: /Undefined variable 'constructor'/ });
    assertCalcError('__proto__', { kind: 'name', message: /Undefined variable '__proto__'/ });
    assertCalcError('toString(1)', { kind: 'syntax', message: /Unknown function 'toString'/ });
  });

  it('rejects unbalanced parentheses', () => {
    assertCalcError('(1 + 2', { kind: 'syntax', message: /Unmatched '\('/ });
    assertCalcError('1 + 2)', { kind: 'syntax', message: /Unmatched '\)'/ });
    assertCalcError('((1)', { kind: 'syntax', message: /Unmatched '\('/ });
    assertCalcError('sin(1', { kind: 'syntax', message: /Unmatched '\('/ });
  });

  it('rejects dangling and doubled operators', () => {
    assertCalcError('1 +', { kind: 'syntax', message: /Unexpected end of expression/ });
    assertCalcError('* 2', { kind: 'syntax', message: /Unexpected operator '\*'/ });
    assertCalcError('1 * / 2', { kind: 'syntax', message: /Unexpected operator '\/'/ });
    assertCalcError('^', { kind: 'syntax', message: /Unexpected operator/ });
    assertCalcError('!', { kind: 'syntax', message: /Unexpected '!'/ });
    assertCalcError('(!3)', { kind: 'syntax', message: /Unexpected '!'/ });
  });

  it('rejects missing operators between values', () => {
    assertCalcError('2 3', { kind: 'syntax', message: /Unexpected number '3'/ });
    assertCalcError('2 (3)', { kind: 'syntax', message: /Unexpected parenthesis/ });
    assertCalcError('(1)(2)', { kind: 'syntax', message: /Unexpected parenthesis/ });
    assertCalcError('2 x', { kind: 'syntax', message: /Unexpected name 'x'/ });
    assertCalcError('2 sin(1)', { kind: 'syntax', message: /Unexpected function 'sin'/ });
    assertCalcError('1.2.3', { kind: 'syntax', message: /Unexpected number '\.3'/ });
  });

  it('rejects empty parentheses and misplaced commas', () => {
    assertCalcError('()', { kind: 'syntax', message: /Expected a value before '\)'/ });
    assertCalcError('(1,2)', { kind: 'syntax', message: /outside a function call/ });
    assertCalcError('1, 2', { kind: 'syntax', message: /Unexpected ','/ });
    assertCalcError('max(,1)', { kind: 'syntax', message: /Expected a value before ','/ });
    assertCalcError('max(1,)', { kind: 'syntax', message: /Expected a value before '\)'/ });
    assertCalcError('max(1,,2)', { kind: 'syntax', message: /Expected a value before ','/ });
  });

  it('rejects unknown functions and wrong argument counts', () => {
    assertCalcError('foo(1)', { kind: 'syntax', message: /Unknown function 'foo'/ });
    assertCalcError('pi(2)', { kind: 'syntax', message: /Unknown function 'pi'/ });
    assertCalcError('sin()', { kind: 'syntax', message: /sin\(\) expects 1 argument, got 0/ });
    assertCalcError('sin(1, 2)', { kind: 'syntax', message: /sin\(\) expects 1 argument, got 2/ });
    assertCalcError('compound(1, 2, 3)', { kind: 'syntax', message: /compound\(\) expects 4 arguments, got 3/ });
    assertCalcError('pmt(1, 2)', { kind: 'syntax', message: /pmt\(\) expects 3 to 4 arguments, got 2/ });
    assertCalcError('npv(0.1)', { kind: 'syntax', message: /npv\(\) expects at least 2 arguments, got 1/ });
    assertCalcError('min()', { kind: 'syntax', message: /min\(\) expects at least 1 argument, got 0/ });
  });

  it('rejects assignment where an expression is expected', () => {
    assertCalcError('1 = 2', { kind: 'syntax', message: /Only a variable name/ });
    assertCalcError('x = y = 2', { kind: 'syntax', message: /Unexpected '='/ });
    assertCalcError('(x = 2)', { kind: 'syntax', message: /Unexpected '='/ });
    assertCalcError('x =', { kind: 'syntax', message: /Expected a value after '='/ });
  });

  it('reports locations for syntax errors', () => {
    try {
      calc('1 + * 2');
      assert.fail('expected a syntax error');
    } catch (error) {
      assert.deepEqual((error as { span: unknown }).span, { start: 4, end: 5 });
    }
  });

  it('survives deeply nested input', () => {
    const depth = 400;
    assert.equal(calc(`${'('.repeat(depth)}7${')'.repeat(depth)}`), 7);
    assert.equal(calc('-'.repeat(depth) + '3'), 3);
  });
});

describe('assignment statements', () => {
  const context = { angleMode: 'rad', variables: new Map<string, number>() } as const;

  it('returns the assigned name and rounded value', () => {
    const outcome = evaluateSource('x = 0.1 + 0.2', context);
    assert.deepEqual(outcome, { kind: 'assignment', value: 0.3, variable: 'x' });
  });

  it('evaluates bare expressions without a variable', () => {
    assert.deepEqual(evaluateSource('2 + 2', context), { kind: 'expression', value: 4, variable: null });
  });

  it('allows reassignment using the previous value on the right-hand side', () => {
    const withX = { ...context, variables: new Map([['x', 5]]) };
    assert.equal(evaluateSource('x = x * 2', withX).value, 10);
  });

  it('rejects reserved names', () => {
    assertCalcError('pi = 3', { kind: 'syntax', message: /Cannot assign to constant 'pi'/ });
    assertCalcError('e = 3', { kind: 'syntax', message: /Cannot assign to constant 'e'/ });
    assertCalcError('ans = 3', { kind: 'syntax', message: /reserved/ });
    assertCalcError('sin = 3', { kind: 'syntax', message: /function name/ });
  });

  it('exposes reserved-name checks', () => {
    assert.equal(reservedNameReason('rate'), null);
    assert.match(reservedNameReason('9x') ?? '', /not a valid variable name/);
    assert.match(reservedNameReason(ANS_NAME) ?? '', /reserved/);
  });
});

describe('analyze (live validation)', () => {
  const known = new Set(['rate']);
  const run = (source: string) => analyze(source, known, ANS_NAME);

  it('accepts valid input and returns highlight tokens', () => {
    const result = run('sin(pi) * rate');
    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
      result.tokens.map((t) => t.kind),
      ['function', 'lparen', 'constant', 'rparen', 'operator', 'variable'],
    );
  });

  it('treats blank input as not ok but without diagnostics', () => {
    const result = run('  ');
    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics, []);
  });

  it('reports every unmatched parenthesis with its position', () => {
    const result = run('((1 + 2)) ) + (3');
    const parens = result.diagnostics.filter((d) => /Unmatched/.test(d.message));
    assert.deepEqual(
      parens.map((d) => [d.message, d.start]),
      [
        ["Unmatched ')'", 10],
        ["Unmatched '('", 14],
      ],
    );
    assert.equal(result.ok, false);
  });

  it('does not duplicate diagnostics that the parser also finds', () => {
    const result = run('(1 + 2');
    assert.equal(result.diagnostics.filter((d) => d.message === "Unmatched '('").length, 1);
  });

  it('reports all invalid characters', () => {
    const result = run('2 $ 3 # 4');
    assert.deepEqual(
      result.diagnostics.map((d) => d.message),
      ["Invalid character '$'", "Invalid character '#'"],
    );
  });

  it('reports incomplete input at the end of the text', () => {
    const result = run('2 +');
    assert.deepEqual(result.diagnostics, [
      { severity: 'error', message: 'Unexpected end of expression', start: 3, end: 3 },
    ]);
  });

  it('warns about undefined variables but still allows the input', () => {
    const result = run('rate + missing + ans');
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.diagnostics.map((d) => [d.severity, d.message]),
      [['warning', "Undefined variable 'missing'"]],
    );
  });

  it('does not warn about the variable being assigned', () => {
    assert.deepEqual(run('fresh = 3').diagnostics, []);
  });

  it('flags unknown functions and arity errors', () => {
    assert.match(run('foo(1)').diagnostics[0]?.message ?? '', /Unknown function 'foo'/);
    assert.match(run('sin(1, 2)').diagnostics[0]?.message ?? '', /expects 1 argument/);
  });
});
