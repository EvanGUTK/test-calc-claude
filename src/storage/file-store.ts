import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodeDatabase, encodeDatabase } from './codec.ts';
import { CorruptDatabaseError, StorageError, createEmptyDatabase, type Database } from './types.ts';

export interface StoreOptions {
  /** How long to wait for another writer before giving up. */
  readonly lockTimeoutMs?: number;
  /** A lock file older than this is considered abandoned. */
  readonly staleLockMs?: number;
  readonly retryDelayMs?: number;
  readonly warn?: (message: string) => void;
}

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_STALE_LOCK_MS = 10000;
const DEFAULT_RETRY_DELAY_MS = 10;
const LOCK_EXISTS = 'EEXIST';
const NOT_FOUND = 'ENOENT';
const NO_SUCH_PROCESS = 'ESRCH';

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== NO_SUCH_PROCESS;
  }
}

/**
 * JSON database in a single file. Writers are serialized in-process by a promise queue and across
 * processes by an exclusive lock file; the document is replaced with an atomic rename, so readers
 * never observe a partial write.
 */
export class JsonFileStore {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private readonly retryDelayMs: number;
  private readonly warn: (message: string) => void;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string, options: StoreOptions = {}) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  /** Returns a snapshot of the database. A corrupt file is quarantined first. */
  async read(): Promise<Database> {
    try {
      return await this.load();
    } catch (error) {
      if (!(error instanceof CorruptDatabaseError)) throw error;
    }
    return this.update((database) => structuredClone(database));
  }

  /**
   * Runs `mutator` on the current database under an exclusive lock and persists the result.
   * Nothing is written when `mutator` throws.
   */
  update<T>(mutator: (database: Database) => T): Promise<T> {
    const run = this.queue.then(() => this.withLock(() => this.mutateAndSave(mutator)));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async mutateAndSave<T>(mutator: (database: Database) => T): Promise<T> {
    const database = await this.loadOrQuarantine();
    const result = mutator(database);
    await this.save(database);
    return result;
  }

  private async load(): Promise<Database> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (errorCode(error) === NOT_FOUND) return createEmptyDatabase();
      throw new StorageError(`Cannot read ${this.filePath}`, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new CorruptDatabaseError(`Invalid history file: not valid JSON (${this.filePath})`, { cause: error });
    }
    return decodeDatabase(parsed);
  }

  private async loadOrQuarantine(): Promise<Database> {
    try {
      return await this.load();
    } catch (error) {
      if (!(error instanceof CorruptDatabaseError)) throw error;
      const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;
      await rename(this.filePath, quarantinePath);
      this.warn(`${error.message}; moved it to ${quarantinePath} and started a new database`);
      return createEmptyDatabase();
    }
  }

  private async save(database: Database): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, encodeDatabase(database), { encoding: 'utf8', mode: 0o600 });
      const handle = await open(tempPath, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw new StorageError(`Cannot write ${this.filePath}`, { cause: error });
    }
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const handle = await this.acquireLock();
    try {
      return await action();
    } finally {
      await handle.close();
      await rm(this.lockPath, { force: true });
    }
  }

  private async acquireLock(): Promise<FileHandle> {
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        const handle = await open(this.lockPath, 'wx', 0o600);
        await handle.writeFile(String(process.pid));
        return handle;
      } catch (error) {
        if (errorCode(error) !== LOCK_EXISTS) {
          throw new StorageError(`Cannot create lock ${this.lockPath}`, { cause: error });
        }
      }
      if (await this.removeIfStale()) continue;
      if (Date.now() >= deadline) {
        throw new StorageError(`Timed out after ${this.lockTimeoutMs}ms waiting for lock ${this.lockPath}`);
      }
      await sleep(this.retryDelayMs);
    }
  }

  /** Removes a lock left behind by a dead process or one older than the stale threshold. */
  private async removeIfStale(): Promise<boolean> {
    let ageMs: number;
    let ownerPid: number;
    try {
      const info = await stat(this.lockPath);
      ageMs = Date.now() - info.mtimeMs;
      ownerPid = Number.parseInt(await readFile(this.lockPath, 'utf8'), 10);
    } catch (error) {
      if (errorCode(error) === NOT_FOUND) return true;
      throw new StorageError(`Cannot inspect lock ${this.lockPath}`, { cause: error });
    }
    const ownerDead = Number.isInteger(ownerPid) && ownerPid !== process.pid && !isProcessAlive(ownerPid);
    if (!ownerDead && ageMs < this.staleLockMs) return false;

    // Rename rather than delete so that only one contender can claim the stale lock.
    const graveyard = `${this.lockPath}.stale-${randomUUID()}`;
    try {
      await rename(this.lockPath, graveyard);
    } catch (error) {
      if (errorCode(error) === NOT_FOUND) return true;
      throw new StorageError(`Cannot remove stale lock ${this.lockPath}`, { cause: error });
    }
    await rm(graveyard, { force: true });
    this.warn(`Removed stale lock ${this.lockPath} (owner pid ${ownerPid}, age ${Math.round(ageMs)}ms)`);
    return true;
  }
}
