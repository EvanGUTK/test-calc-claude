import type { BinaryOperator, Expr, Statement, UnaryOperator } from './ast.ts';
import { CONSTANTS } from './constants.ts';
import { CalcError } from './errors.ts';
import { FUNCTIONS } from './functions.ts';
import type { Lexeme } from './lexer.ts';
import { reservedNameReason } from './names.ts';

interface BinarySpec {
  readonly precedence: number;
  readonly rightAssociative: boolean;
}

const BINARY_SPECS: Readonly<Record<BinaryOperator, BinarySpec>> = {
  '+': { precedence: 1, rightAssociative: false },
  '-': { precedence: 1, rightAssociative: false },
  '*': { precedence: 2, rightAssociative: false },
  '/': { precedence: 2, rightAssociative: false },
  '%': { precedence: 2, rightAssociative: false },
  '^': { precedence: 4, rightAssociative: true },
};

/** Binds tighter than * and / but looser than ^, so -2^2 is -(2^2). */
const UNARY_PRECEDENCE = 3;

interface CallFrame {
  argCount: number;
}

type StackItem =
  | { readonly kind: 'binary'; readonly op: BinaryOperator; readonly lexeme: Lexeme }
  | { readonly kind: 'unary'; readonly op: UnaryOperator; readonly lexeme: Lexeme }
  | { readonly kind: 'function'; readonly lexeme: Lexeme }
  | { readonly kind: 'group'; readonly lexeme: Lexeme; readonly call: CallFrame | null };

function isBinaryOperator(text: string): text is BinaryOperator {
  return text in BINARY_SPECS;
}

function isUnaryOperator(text: string): text is UnaryOperator {
  return text === '+' || text === '-';
}

function syntaxError(message: string, start: number, end: number = start): CalcError {
  return new CalcError('syntax', message, { start, end });
}

function describe(lexeme: Lexeme): string {
  return `'${lexeme.text}'`;
}

class ShuntingYard {
  private readonly output: Expr[] = [];
  private readonly stack: StackItem[] = [];
  private expectOperand = true;
  private readonly lexemes: readonly Lexeme[];
  private readonly sourceLength: number;

  constructor(lexemes: readonly Lexeme[], sourceLength: number) {
    this.lexemes = lexemes;
    this.sourceLength = sourceLength;
  }

  parse(): Expr {
    if (this.lexemes.length === 0) throw syntaxError('Expression is empty', 0);
    for (const lexeme of this.lexemes) this.consume(lexeme);
    return this.finish();
  }

  private consume(lexeme: Lexeme): void {
    switch (lexeme.kind) {
      case 'number':
        return this.pushNumber(lexeme);
      case 'constant':
      case 'variable':
        return this.pushVariable(lexeme);
      case 'function':
        return this.pushFunction(lexeme);
      case 'operator':
        return this.pushOperator(lexeme);
      case 'factorial':
        return this.applyFactorial(lexeme);
      case 'lparen':
        return this.openGroup(lexeme);
      case 'rparen':
        return this.closeGroup(lexeme);
      case 'comma':
        return this.nextArgument(lexeme);
      case 'assign':
        throw syntaxError("Unexpected '='", lexeme.start, lexeme.end);
      case 'invalid':
        throw syntaxError(lexeme.message ?? `Invalid character ${describe(lexeme)}`, lexeme.start, lexeme.end);
    }
  }

  private requireOperandPosition(lexeme: Lexeme, what: string): void {
    if (!this.expectOperand) {
      throw syntaxError(`Unexpected ${what} ${describe(lexeme)}; expected an operator`, lexeme.start, lexeme.end);
    }
  }

  private pushNumber(lexeme: Lexeme): void {
    this.requireOperandPosition(lexeme, 'number');
    if (lexeme.value === null) throw syntaxError(`Invalid number ${describe(lexeme)}`, lexeme.start, lexeme.end);
    this.output.push({ kind: 'number', value: lexeme.value, start: lexeme.start, end: lexeme.end });
    this.expectOperand = false;
  }

  private pushVariable(lexeme: Lexeme): void {
    this.requireOperandPosition(lexeme, 'name');
    this.output.push({ kind: 'variable', name: lexeme.text, start: lexeme.start, end: lexeme.end });
    this.expectOperand = false;
  }

  private pushFunction(lexeme: Lexeme): void {
    this.requireOperandPosition(lexeme, 'function');
    if (!FUNCTIONS.has(lexeme.text)) {
      throw syntaxError(`Unknown function ${describe(lexeme)}`, lexeme.start, lexeme.end);
    }
    this.stack.push({ kind: 'function', lexeme });
  }

  private pushOperator(lexeme: Lexeme): void {
    const text = lexeme.text;
    if (this.expectOperand) {
      if (!isUnaryOperator(text)) {
        throw syntaxError(`Unexpected operator ${describe(lexeme)}; expected a value`, lexeme.start, lexeme.end);
      }
      this.stack.push({ kind: 'unary', op: text, lexeme });
      return;
    }
    if (!isBinaryOperator(text)) throw syntaxError(`Unknown operator ${describe(lexeme)}`, lexeme.start, lexeme.end);
    const current = BINARY_SPECS[text];
    for (;;) {
      const top = this.stack.at(-1);
      if (top === undefined || (top.kind !== 'binary' && top.kind !== 'unary')) break;
      const topPrecedence = top.kind === 'unary' ? UNARY_PRECEDENCE : BINARY_SPECS[top.op].precedence;
      const shouldPop =
        topPrecedence > current.precedence || (topPrecedence === current.precedence && !current.rightAssociative);
      if (!shouldPop) break;
      this.applyOperator(top);
      this.stack.pop();
    }
    this.stack.push({ kind: 'binary', op: text, lexeme });
    this.expectOperand = true;
  }

  private applyFactorial(lexeme: Lexeme): void {
    if (this.expectOperand) {
      throw syntaxError("Unexpected '!'; expected a value before it", lexeme.start, lexeme.end);
    }
    const operand = this.popOutput(lexeme);
    this.output.push({ kind: 'factorial', operand, start: operand.start, end: lexeme.end });
  }

  private openGroup(lexeme: Lexeme): void {
    this.requireOperandPosition(lexeme, 'parenthesis');
    const owner = this.stack.at(-1);
    const call = owner !== undefined && owner.kind === 'function' ? { argCount: 0 } : null;
    this.stack.push({ kind: 'group', lexeme, call });
    this.expectOperand = true;
  }

  private closeGroup(lexeme: Lexeme): void {
    const emptyCallAllowed = this.expectOperand && this.isTopEmptyCall();
    if (this.expectOperand && !emptyCallAllowed) {
      throw syntaxError("Expected a value before ')'", lexeme.start, lexeme.end);
    }
    const group = this.popUntilGroup(lexeme, "Unmatched ')'");
    this.stack.pop();
    this.expectOperand = false;
    if (group.call === null) return;

    const argCount = emptyCallAllowed ? 0 : group.call.argCount + 1;
    const owner = this.stack.pop();
    if (owner === undefined || owner.kind !== 'function') {
      throw syntaxError('Internal parser error: call without function', lexeme.start, lexeme.end);
    }
    this.finishCall(owner.lexeme, argCount, lexeme);
  }

  private isTopEmptyCall(): boolean {
    const top = this.stack.at(-1);
    return top !== undefined && top.kind === 'group' && top.call !== null && top.call.argCount === 0;
  }

  private finishCall(name: Lexeme, argCount: number, closing: Lexeme): void {
    const spec = FUNCTIONS.get(name.text);
    if (spec === undefined) throw syntaxError(`Unknown function ${describe(name)}`, name.start, name.end);
    if (argCount < spec.minArgs || argCount > spec.maxArgs) {
      throw syntaxError(`${name.text}() ${describeArity(spec.minArgs, spec.maxArgs)}, got ${argCount}`, name.start, closing.end);
    }
    const args = this.output.splice(this.output.length - argCount, argCount);
    this.output.push({ kind: 'call', name: name.text, args, start: name.start, end: closing.end });
  }

  private nextArgument(lexeme: Lexeme): void {
    if (this.expectOperand) {
      throw syntaxError("Expected a value before ','", lexeme.start, lexeme.end);
    }
    const group = this.popUntilGroup(lexeme, "Unexpected ','");
    if (group.call === null) throw syntaxError("Unexpected ',' outside a function call", lexeme.start, lexeme.end);
    group.call.argCount += 1;
    this.expectOperand = true;
  }

  /** Applies operators down to the nearest group and returns that group without removing it. */
  private popUntilGroup(at: Lexeme, missingMessage: string): Extract<StackItem, { kind: 'group' }> {
    for (;;) {
      const top = this.stack.at(-1);
      if (top === undefined) throw syntaxError(missingMessage, at.start, at.end);
      if (top.kind === 'group') return top;
      if (top.kind === 'function') throw syntaxError('Internal parser error: dangling function', at.start, at.end);
      this.applyOperator(top);
      this.stack.pop();
    }
  }

  private finish(): Expr {
    if (this.expectOperand) {
      throw syntaxError('Unexpected end of expression', this.sourceLength);
    }
    while (this.stack.length > 0) {
      const top = this.stack.pop();
      if (top === undefined) break;
      if (top.kind === 'group') {
        throw syntaxError("Unmatched '('", top.lexeme.start, top.lexeme.end);
      }
      if (top.kind === 'function') {
        throw syntaxError('Internal parser error: dangling function', top.lexeme.start, top.lexeme.end);
      }
      this.applyOperator(top);
    }
    const result = this.output.pop();
    if (result === undefined || this.output.length > 0) {
      throw syntaxError('Malformed expression', 0, this.sourceLength);
    }
    return result;
  }

  private applyOperator(item: Extract<StackItem, { kind: 'binary' | 'unary' }>): void {
    if (item.kind === 'unary') {
      const operand = this.popOutput(item.lexeme);
      this.output.push({ kind: 'unary', op: item.op, operand, start: item.lexeme.start, end: operand.end });
      return;
    }
    const right = this.popOutput(item.lexeme);
    const left = this.popOutput(item.lexeme);
    this.output.push({ kind: 'binary', op: item.op, left, right, start: left.start, end: right.end });
  }

  private popOutput(at: Lexeme): Expr {
    const node = this.output.pop();
    if (node === undefined) throw syntaxError(`Missing value for ${describe(at)}`, at.start, at.end);
    return node;
  }
}

function describeArity(min: number, max: number): string {
  if (min === max) return `expects ${min} argument${min === 1 ? '' : 's'}`;
  if (max === Infinity) return `expects at least ${min} argument${min === 1 ? '' : 's'}`;
  return `expects ${min} to ${max} arguments`;
}

export function parseExpression(lexemes: readonly Lexeme[], sourceLength: number): Expr {
  return new ShuntingYard(lexemes, sourceLength).parse();
}

/** Parses `name = expression` or a bare expression. */
export function parseStatement(lexemes: readonly Lexeme[], sourceLength: number): Statement {
  const [first, second] = lexemes;
  if (first !== undefined && second !== undefined && second.kind === 'assign') {
    if (first.kind !== 'variable' && first.kind !== 'constant') {
      throw syntaxError('Only a variable name can be assigned to', first.start, first.end);
    }
    const reason = reservedNameReason(first.text);
    if (reason !== null || CONSTANTS.has(first.text)) {
      throw syntaxError(reason ?? `Cannot assign to constant ${describe(first)}`, first.start, first.end);
    }
    const valueLexemes = lexemes.slice(2);
    if (valueLexemes.length === 0) {
      throw syntaxError("Expected a value after '='", second.start, second.end);
    }
    return { kind: 'assignment', name: first.text, value: parseExpression(valueLexemes, sourceLength) };
  }
  return { kind: 'expression', expr: parseExpression(lexemes, sourceLength) };
}
