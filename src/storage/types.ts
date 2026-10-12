export const DATABASE_VERSION = 1;

export type HistoryKind = 'expression' | 'assignment';

export interface HistoryEntry {
  readonly id: number;
  /** ISO 8601 UTC timestamp. */
  readonly timestamp: string;
  readonly input: string;
  readonly result: number;
  readonly kind: HistoryKind;
  /** Assigned variable name for `assignment` entries, otherwise null. */
  readonly variable: string | null;
}

export interface Database {
  nextId: number;
  variables: Map<string, number>;
  history: HistoryEntry[];
}

export function createEmptyDatabase(): Database {
  return { nextId: 1, variables: new Map(), history: [] };
}

export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
  }
}

/** The file exists but is not a valid database document. */
export class CorruptDatabaseError extends StorageError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CorruptDatabaseError';
  }
}
