import { CONSTANTS } from './constants.ts';
import { tokenize, type RawToken } from './tokenizer.ts';

export type LexemeKind =
  | 'number'
  | 'function'
  | 'constant'
  | 'variable'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'assign'
  | 'factorial'
  | 'invalid';

export interface Lexeme {
  readonly kind: LexemeKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Numeric value for `number` lexemes, otherwise null. */
  readonly value: number | null;
  /** Explanation for `invalid` lexemes, otherwise null. */
  readonly message: string | null;
}

const OPERATOR_SYMBOLS = '+-*/^%';

function lexeme(raw: RawToken, kind: LexemeKind, value: number | null = null, message: string | null = null): Lexeme {
  return { kind, text: raw.text, start: raw.start, end: raw.end, value, message };
}

function lexNumber(raw: RawToken): Lexeme {
  const value = Number(raw.text);
  if (!Number.isFinite(value)) {
    return lexeme(raw, 'invalid', null, `Number '${raw.text}' is out of range`);
  }
  return lexeme(raw, 'number', value);
}

function lexWord(raw: RawToken, next: RawToken | undefined): Lexeme {
  if (next !== undefined && next.type === 'symbol' && next.text === '(') {
    return lexeme(raw, 'function');
  }
  return lexeme(raw, CONSTANTS.has(raw.text) ? 'constant' : 'variable');
}

function lexSymbol(raw: RawToken): Lexeme {
  if (OPERATOR_SYMBOLS.includes(raw.text)) return lexeme(raw, 'operator');
  switch (raw.text) {
    case '(':
      return lexeme(raw, 'lparen');
    case ')':
      return lexeme(raw, 'rparen');
    case ',':
      return lexeme(raw, 'comma');
    case '=':
      return lexeme(raw, 'assign');
    case '!':
      return lexeme(raw, 'factorial');
    default:
      return lexeme(raw, 'invalid', null, `Invalid character '${raw.text}'`);
  }
}

/** Classifies raw tokens: words become function / constant / variable, numbers get their value. */
export function lex(source: string): Lexeme[] {
  const raws = tokenize(source);
  return raws.map((raw, index): Lexeme => {
    switch (raw.type) {
      case 'number':
        return lexNumber(raw);
      case 'word':
        return lexWord(raw, raws[index + 1]);
      case 'symbol':
        return lexSymbol(raw);
      case 'invalid':
        return lexeme(raw, 'invalid', null, `Invalid character '${raw.text}'`);
    }
  });
}
