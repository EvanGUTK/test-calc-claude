export type ErrorKind = 'syntax' | 'math' | 'name';

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The only error type for failures caused by user input; anything else is a bug. */
export class CalcError extends Error {
  readonly kind: ErrorKind;
  readonly span: Span | null;

  constructor(kind: ErrorKind, message: string, span: Span | null = null) {
    super(message);
    this.name = 'CalcError';
    this.kind = kind;
    this.span = span;
  }

  withSpanIfMissing(span: Span): CalcError {
    return this.span === null ? new CalcError(this.kind, this.message, span) : this;
  }
}
