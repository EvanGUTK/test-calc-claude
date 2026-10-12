import { evaluateNode, type EvalContext } from './evaluator.ts';
import { lex } from './lexer.ts';
import { parseStatement } from './parser.ts';
import { roundSignificant } from './precision.ts';

export { analyze } from './analyzer.ts';
export type { Analysis, Diagnostic, DiagnosticSeverity, HighlightToken } from './analyzer.ts';
export type { AngleMode } from './ast.ts';
export { CalcError } from './errors.ts';
export type { ErrorKind, Span } from './errors.ts';
export type { EvalContext } from './evaluator.ts';
export { ANS_NAME, reservedNameReason } from './names.ts';

export interface EvalOutcome {
  readonly kind: 'expression' | 'assignment';
  readonly value: number;
  /** The assigned variable for `assignment` outcomes, otherwise null. */
  readonly variable: string | null;
}

/** Parses and evaluates one statement: an expression or `name = expression`. */
export function evaluateSource(source: string, context: EvalContext): EvalOutcome {
  const statement = parseStatement(lex(source), source.length);
  if (statement.kind === 'assignment') {
    return { kind: 'assignment', value: roundSignificant(evaluateNode(statement.value, context)), variable: statement.name };
  }
  return { kind: 'expression', value: roundSignificant(evaluateNode(statement.expr, context)), variable: null };
}
