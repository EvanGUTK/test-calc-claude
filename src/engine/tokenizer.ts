export type RawTokenType = 'number' | 'word' | 'symbol' | 'invalid';

export interface RawToken {
  readonly type: RawTokenType;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const NUMBER_PATTERN = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/y;
const WHITESPACE_PATTERN = /\s+/y;
const SYMBOLS = '+-*/^%(),=!';

function matchAt(pattern: RegExp, source: string, index: number): string | null {
  pattern.lastIndex = index;
  const match = pattern.exec(source);
  return match === null ? null : match[0];
}

/** Splits source text into raw tokens. Never throws: unknown characters become `invalid` tokens. */
export function tokenize(source: string): RawToken[] {
  const tokens: RawToken[] = [];
  let index = 0;

  while (index < source.length) {
    const whitespace = matchAt(WHITESPACE_PATTERN, source, index);
    if (whitespace !== null) {
      index += whitespace.length;
      continue;
    }

    const number = matchAt(NUMBER_PATTERN, source, index);
    if (number !== null) {
      tokens.push({ type: 'number', text: number, start: index, end: index + number.length });
      index += number.length;
      continue;
    }

    const word = matchAt(WORD_PATTERN, source, index);
    if (word !== null) {
      tokens.push({ type: 'word', text: word, start: index, end: index + word.length });
      index += word.length;
      continue;
    }

    const codePoint = source.codePointAt(index);
    const char = codePoint === undefined ? '' : String.fromCodePoint(codePoint);
    const type = SYMBOLS.includes(char) ? 'symbol' : 'invalid';
    tokens.push({ type, text: char, start: index, end: index + char.length });
    index += char.length;
  }

  return tokens;
}
