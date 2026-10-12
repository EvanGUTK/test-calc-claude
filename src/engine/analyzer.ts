import { CalcError } from './errors.ts';
import { lex, type Lexeme, type LexemeKind } from './lexer.ts';
import { parseStatement } from './parser.ts';

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface HighlightToken {
  readonly kind: LexemeKind;
  readonly start: number;
  readonly end: number;
}

export interface Analysis {
  /** True when the input is non-blank and has no errors (warnings are allowed). */
  readonly ok: boolean;
  readonly tokens: readonly HighlightToken[];
  readonly diagnostics: readonly Diagnostic[];
}

function invalidLexemeDiagnostics(lexemes: readonly Lexeme[]): Diagnostic[] {
  return lexemes
    .filter((lexeme) => lexeme.kind === 'invalid')
    .map((lexeme) => ({
      severity: 'error',
      message: lexeme.message ?? `Invalid character '${lexeme.text}'`,
      start: lexeme.start,
      end: lexeme.end,
    }));
}

function unbalancedParenDiagnostics(lexemes: readonly Lexeme[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const open: Lexeme[] = [];
  for (const lexeme of lexemes) {
    if (lexeme.kind === 'lparen') {
      open.push(lexeme);
    } else if (lexeme.kind === 'rparen' && open.pop() === undefined) {
      diagnostics.push({ severity: 'error', message: "Unmatched ')'", start: lexeme.start, end: lexeme.end });
    }
  }
  for (const lexeme of open) {
    diagnostics.push({ severity: 'error', message: "Unmatched '('", start: lexeme.start, end: lexeme.end });
  }
  return diagnostics;
}

function parseDiagnostic(lexemes: readonly Lexeme[], sourceLength: number): Diagnostic[] {
  try {
    parseStatement(lexemes, sourceLength);
    return [];
  } catch (error) {
    if (!(error instanceof CalcError)) throw error;
    const span = error.span ?? { start: 0, end: sourceLength };
    return [{ severity: 'error', message: error.message, start: span.start, end: span.end }];
  }
}

function undefinedVariableDiagnostics(
  lexemes: readonly Lexeme[],
  knownVariables: ReadonlySet<string>,
  ansName: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  lexemes.forEach((lexeme, index) => {
    if (lexeme.kind !== 'variable') return;
    const isAssignmentTarget = index === 0 && lexemes[1]?.kind === 'assign';
    if (isAssignmentTarget || lexeme.text === ansName || knownVariables.has(lexeme.text)) return;
    diagnostics.push({
      severity: 'warning',
      message: `Undefined variable '${lexeme.text}'`,
      start: lexeme.start,
      end: lexeme.end,
    });
  });
  return diagnostics;
}

function dedupe(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((d) => {
    const key = `${d.severity}|${d.start}|${d.end}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Validates `source` without evaluating it. Reports every invalid character and unmatched
 * parenthesis, the first syntax error, and warnings for variables that are not defined.
 */
export function analyze(source: string, knownVariables: ReadonlySet<string>, ansName: string): Analysis {
  const lexemes = lex(source);
  if (lexemes.length === 0) return { ok: false, tokens: [], diagnostics: [] };

  const diagnostics = dedupe([
    ...invalidLexemeDiagnostics(lexemes),
    ...unbalancedParenDiagnostics(lexemes),
    ...parseDiagnostic(lexemes, source.length),
    ...undefinedVariableDiagnostics(lexemes, knownVariables, ansName),
  ]).sort((a, b) => a.start - b.start || a.end - b.end);

  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    tokens: lexemes.map(({ kind, start, end }) => ({ kind, start, end })),
    diagnostics,
  };
}
