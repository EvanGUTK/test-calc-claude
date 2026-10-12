import {
  CorruptDatabaseError,
  DATABASE_VERSION,
  type Database,
  type HistoryEntry,
  type HistoryKind,
} from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new CorruptDatabaseError(`Invalid history file: ${message}`);
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}

function isHistoryKind(value: unknown): value is HistoryKind {
  return value === 'expression' || value === 'assignment';
}

function decodeEntry(raw: unknown, index: number): HistoryEntry {
  const label = `history[${index}]`;
  if (!isRecord(raw)) fail(`${label} must be an object`);
  const id = readFiniteNumber(raw['id'], `${label}.id`);
  if (!Number.isInteger(id) || id < 1) fail(`${label}.id must be a positive integer`);
  const timestamp = readString(raw['timestamp'], `${label}.timestamp`);
  if (Number.isNaN(Date.parse(timestamp))) fail(`${label}.timestamp must be an ISO date`);
  const kind = raw['kind'];
  if (!isHistoryKind(kind)) fail(`${label}.kind must be "expression" or "assignment"`);
  const variable = raw['variable'];
  if (variable !== null && typeof variable !== 'string') fail(`${label}.variable must be a string or null`);
  return {
    id,
    timestamp,
    input: readString(raw['input'], `${label}.input`),
    result: readFiniteNumber(raw['result'], `${label}.result`),
    kind,
    variable,
  };
}

function decodeVariables(raw: unknown): Map<string, number> {
  if (!isRecord(raw)) fail('variables must be an object');
  const variables = new Map<string, number>();
  for (const [name, value] of Object.entries(raw)) {
    variables.set(name, readFiniteNumber(value, `variables.${name}`));
  }
  return variables;
}

export function decodeDatabase(raw: unknown): Database {
  if (!isRecord(raw)) fail('top level must be an object');
  if (raw['version'] !== DATABASE_VERSION) fail(`unsupported version ${String(raw['version'])}`);
  const history = raw['history'];
  if (!Array.isArray(history)) fail('history must be an array');
  const entries = history.map((entry: unknown, index: number) => decodeEntry(entry, index));
  const nextId = readFiniteNumber(raw['nextId'], 'nextId');
  const highestId = entries.reduce((max, entry) => Math.max(max, entry.id), 0);
  if (!Number.isInteger(nextId) || nextId <= highestId) fail('nextId must be greater than every history id');
  return { nextId, variables: decodeVariables(raw['variables']), history: entries };
}

export function encodeDatabase(database: Database): string {
  const document = {
    version: DATABASE_VERSION,
    nextId: database.nextId,
    variables: Object.fromEntries(database.variables),
    history: database.history,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
