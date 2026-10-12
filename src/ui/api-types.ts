/** Request and response shapes of the HTTP API; shared by the server and the browser client (types only). */

export type AngleModeDto = 'rad' | 'deg';

export interface VariableDto {
  name: string;
  value: number;
}

export interface HistoryEntryDto {
  id: number;
  timestamp: string;
  input: string;
  result: number;
  kind: 'expression' | 'assignment';
  variable: string | null;
}

export interface StateResponse {
  variables: VariableDto[];
  history: HistoryEntryDto[];
  ans: number | null;
}

export interface ValidateRequest {
  input: string;
}

export type LexemeKindDto =
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

export interface TokenDto {
  kind: LexemeKindDto;
  start: number;
  end: number;
}

export interface DiagnosticDto {
  severity: 'error' | 'warning';
  message: string;
  start: number;
  end: number;
}

export interface ValidateResponse {
  ok: boolean;
  tokens: TokenDto[];
  diagnostics: DiagnosticDto[];
}

export interface EvaluateRequest {
  input: string;
  angleMode: AngleModeDto;
}

export interface EvaluateResponse {
  entry: HistoryEntryDto;
  state: StateResponse;
}

export type ErrorKindDto = 'syntax' | 'math' | 'name' | 'request' | 'not_found' | 'internal';

export interface ErrorResponse {
  error: {
    kind: ErrorKindDto;
    message: string;
    /** Character range of the problem in the submitted input, when known. */
    start: number | null;
    end: number | null;
  };
}
