import { analyze, ANS_NAME, CalcError, evaluateSource, type Analysis, type AngleMode } from '../engine/index.ts';
import type { JsonFileStore } from '../storage/file-store.ts';
import type { Database, HistoryEntry } from '../storage/types.ts';

export const MAX_INPUT_LENGTH = 500;
export const MAX_HISTORY_ENTRIES = 1000;
export const MAX_VARIABLES = 200;

export interface VariableEntry {
  readonly name: string;
  readonly value: number;
}

export interface CalculatorState {
  /** Sorted by name. */
  readonly variables: readonly VariableEntry[];
  /** Oldest first. */
  readonly history: readonly HistoryEntry[];
  /** Result of the most recent calculation, or null when there is none. */
  readonly ans: number | null;
}

export interface SubmitResult {
  readonly entry: HistoryEntry;
  readonly state: CalculatorState;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

function lastResult(database: Database): number | null {
  return database.history.at(-1)?.result ?? null;
}

function snapshot(database: Database): CalculatorState {
  const variables = [...database.variables]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { variables, history: [...database.history], ans: lastResult(database) };
}

function evaluationVariables(database: Database): Map<string, number> {
  const variables = new Map(database.variables);
  const ans = lastResult(database);
  if (ans !== null) variables.set(ANS_NAME, ans);
  return variables;
}

function requireUsableInput(input: string): string {
  if (input.trim() === '') throw new CalcError('syntax', 'Enter an expression');
  if (input.length > MAX_INPUT_LENGTH) {
    throw new CalcError('syntax', `Expression is too long (maximum ${MAX_INPUT_LENGTH} characters)`);
  }
  return input;
}

/** Business logic: evaluates input against stored variables and records the outcome. */
export class CalculatorService {
  private readonly store: JsonFileStore;
  private readonly clock: () => Date;

  constructor(store: JsonFileStore, clock: () => Date = () => new Date()) {
    this.store = store;
    this.clock = clock;
  }

  async getState(): Promise<CalculatorState> {
    return snapshot(await this.store.read());
  }

  /** Live validation; never changes state. Over-long input is cut so analysis stays cheap. */
  async analyze(input: string): Promise<Analysis> {
    const database = await this.store.read();
    return analyze(input.slice(0, MAX_INPUT_LENGTH * 2), new Set(database.variables.keys()), ANS_NAME);
  }

  /**
   * Evaluates `input`, applies an assignment, appends a history entry and persists everything in one
   * locked update. Throws CalcError for bad input, in which case nothing is recorded.
   */
  async submit(input: string, angleMode: AngleMode): Promise<SubmitResult> {
    const usable = requireUsableInput(input);
    return await this.store.update((database) => {
      const outcome = evaluateSource(usable, { angleMode, variables: evaluationVariables(database) });
      if (outcome.variable !== null) {
        if (!database.variables.has(outcome.variable) && database.variables.size >= MAX_VARIABLES) {
          throw new CalcError('name', `Variable limit reached (maximum ${MAX_VARIABLES})`);
        }
        database.variables.set(outcome.variable, outcome.value);
      }
      const entry: HistoryEntry = {
        id: database.nextId,
        timestamp: this.clock().toISOString(),
        input: usable.trim(),
        result: outcome.value,
        kind: outcome.kind,
        variable: outcome.variable,
      };
      database.nextId += 1;
      database.history.push(entry);
      if (database.history.length > MAX_HISTORY_ENTRIES) {
        database.history.splice(0, database.history.length - MAX_HISTORY_ENTRIES);
      }
      return { entry, state: snapshot(database) };
    });
  }

  deleteVariable(name: string): Promise<CalculatorState> {
    return this.store.update((database) => {
      if (!database.variables.delete(name)) throw new NotFoundError(`No variable named '${name}'`);
      return snapshot(database);
    });
  }

  clearHistory(): Promise<CalculatorState> {
    return this.store.update((database) => {
      database.history = [];
      return snapshot(database);
    });
  }
}
