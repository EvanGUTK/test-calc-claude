import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodeDatabase, encodeDatabase } from '../storage/codec.ts';
import { JsonFileStore } from '../storage/file-store.ts';
import { CorruptDatabaseError, createEmptyDatabase, type HistoryEntry } from '../storage/types.ts';

const WORKER = fileURLToPath(new URL('./fixtures/increment-worker.ts', import.meta.url));

let directory: string;
let counter = 0;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'calc-storage-'));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

function freshPath(): string {
  counter += 1;
  return join(directory, `db-${counter}.json`);
}

function entry(id: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    timestamp: '2026-10-12T07:00:00.000Z',
    input: '1 + 1',
    result: 2,
    kind: 'expression',
    variable: null,
    ...overrides,
  };
}

describe('database codec', () => {
  it('round-trips a database', () => {
    const database = createEmptyDatabase();
    database.nextId = 3;
    database.variables.set('rate', 0.05);
    database.history.push(entry(1), entry(2, { kind: 'assignment', variable: 'rate', input: 'rate = 0.05' }));
    const decoded = decodeDatabase(JSON.parse(encodeDatabase(database)));
    assert.deepEqual(decoded, database);
  });

  it('keeps a variable called __proto__ as plain data', () => {
    const database = createEmptyDatabase();
    database.variables.set('__proto__', 1);
    const decoded = decodeDatabase(JSON.parse(encodeDatabase(database)));
    assert.equal(decoded.variables.get('__proto__'), 1);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  });

  const valid = {
    version: 1,
    nextId: 2,
    variables: {},
    history: [entry(1)],
  };
  const invalidDocuments: ReadonlyArray<readonly [string, unknown]> = [
    ['array at top level', []],
    ['null', null],
    ['wrong version', { ...valid, version: 2 }],
    ['history not an array', { ...valid, history: {} }],
    ['variables not an object', { ...valid, variables: [] }],
    ['non-numeric variable', { ...valid, variables: { x: 'one' } }],
    ['non-finite variable', { ...valid, variables: { x: null } }],
    ['entry not an object', { ...valid, history: [1] }],
    ['entry id zero', { ...valid, history: [entry(0)] }],
    ['entry bad timestamp', { ...valid, history: [entry(1, { timestamp: 'yesterday' })] }],
    ['entry bad kind', { ...valid, history: [{ ...entry(1), kind: 'other' }] }],
    ['entry bad result', { ...valid, history: [{ ...entry(1), result: '2' }] }],
    ['entry bad variable', { ...valid, history: [{ ...entry(1), variable: 5 }] }],
    ['nextId not above ids', { ...valid, nextId: 1 }],
  ];
  for (const [name, document] of invalidDocuments) {
    it(`rejects ${name}`, () => {
      assert.throws(() => decodeDatabase(document), CorruptDatabaseError);
    });
  }
});

describe('JsonFileStore', () => {
  it('returns an empty database when the file does not exist', async () => {
    const store = new JsonFileStore(freshPath());
    assert.deepEqual(await store.read(), createEmptyDatabase());
  });

  it('persists updates to disk as formatted JSON', async () => {
    const path = freshPath();
    const store = new JsonFileStore(path);
    await store.update((database) => {
      database.variables.set('x', 42);
      database.history.push(entry(1));
      database.nextId = 2;
    });
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { variables: Record<string, number> };
    assert.deepEqual(onDisk.variables, { x: 42 });
    assert.deepEqual((await new JsonFileStore(path).read()).history, [entry(1)]);
  });

  it('returns the mutator result', async () => {
    const store = new JsonFileStore(freshPath());
    assert.equal(await store.update(() => 'result'), 'result');
  });

  it('writes nothing when the mutator throws', async () => {
    const path = freshPath();
    const store = new JsonFileStore(path);
    await store.update((database) => database.variables.set('keep', 1));
    await assert.rejects(
      store.update((database) => {
        database.variables.set('lost', 2);
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.deepEqual([...(await store.read()).variables], [['keep', 1]]);
  });

  it('keeps working after a failed update', async () => {
    const store = new JsonFileStore(freshPath());
    await assert.rejects(
      store.update(() => {
        throw new Error('first failure');
      }),
      /first failure/,
    );
    await store.update((database) => database.variables.set('after', 1));
    assert.equal((await store.read()).variables.get('after'), 1);
  });

  it('serializes concurrent in-process updates without losing any', async () => {
    const store = new JsonFileStore(freshPath());
    const updates = 60;
    await Promise.all(
      Array.from({ length: updates }, () =>
        store.update((database) => {
          database.variables.set('n', (database.variables.get('n') ?? 0) + 1);
        }),
      ),
    );
    assert.equal((await store.read()).variables.get('n'), updates);
  });

  it('serializes updates across separate processes', async () => {
    const path = freshPath();
    const workers = 4;
    const perWorker = 15;
    const exits = await Promise.all(
      Array.from(
        { length: workers },
        () =>
          new Promise<number | null>((resolve, reject) => {
            const child = spawn(process.execPath, [WORKER, path, String(perWorker)], { stdio: 'inherit' });
            child.on('error', reject);
            child.on('exit', resolve);
          }),
      ),
    );
    assert.deepEqual(exits, [0, 0, 0, 0]);
    assert.equal((await new JsonFileStore(path).read()).variables.get('counter'), workers * perWorker);
  });

  it('leaves no lock or temp files behind', async () => {
    const path = freshPath();
    const store = new JsonFileStore(path);
    await store.update((database) => database.variables.set('x', 1));
    const leftovers = (await readdir(directory)).filter(
      (name) => name.startsWith(`${path.split('/').pop()}.`) && name !== `${path.split('/').pop()}`,
    );
    assert.deepEqual(leftovers, []);
  });

  it('quarantines a corrupt file and starts fresh', async () => {
    const path = freshPath();
    await writeFile(path, '{ not json');
    const warnings: string[] = [];
    const store = new JsonFileStore(path, { warn: (message) => warnings.push(message) });
    assert.deepEqual(await store.read(), createEmptyDatabase());
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /not valid JSON/);
    const quarantined = (await readdir(directory)).filter((name) => name.includes(`${path.split('/').pop()}.corrupt-`));
    assert.equal(quarantined.length, 1);
    assert.equal(await readFile(join(directory, quarantined[0] ?? ''), 'utf8'), '{ not json');
  });

  it('quarantines a structurally invalid file on update', async () => {
    const path = freshPath();
    await writeFile(path, JSON.stringify({ version: 1, nextId: 1, variables: [], history: [] }));
    const store = new JsonFileStore(path, { warn: () => undefined });
    await store.update((database) => database.variables.set('x', 1));
    assert.equal((await store.read()).variables.get('x'), 1);
  });

  it('removes a lock left by a dead process', async () => {
    const path = freshPath();
    await writeFile(`${path}.lock`, '2147483646');
    const warnings: string[] = [];
    const store = new JsonFileStore(path, { warn: (message) => warnings.push(message) });
    await store.update((database) => database.variables.set('x', 1));
    assert.equal((await store.read()).variables.get('x'), 1);
    assert.match(warnings.join('\n'), /Removed stale lock/);
  });

  it('removes a lock older than the stale threshold', async () => {
    const path = freshPath();
    await writeFile(`${path}.lock`, String(process.ppid));
    const store = new JsonFileStore(path, { staleLockMs: 0, warn: () => undefined });
    await store.update((database) => database.variables.set('x', 1));
    assert.equal((await store.read()).variables.get('x'), 1);
  });

  it('times out when a live process holds the lock', async () => {
    const path = freshPath();
    await writeFile(`${path}.lock`, String(process.ppid));
    const store = new JsonFileStore(path, { lockTimeoutMs: 100, staleLockMs: 60_000 });
    await assert.rejects(store.update(() => undefined), /Timed out after 100ms waiting for lock/);
    assert.ok((await stat(`${path}.lock`)).isFile());
  });
});
