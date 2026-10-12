import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CalcError } from '../engine/index.ts';
import {
  CalculatorService,
  MAX_HISTORY_ENTRIES,
  MAX_INPUT_LENGTH,
  MAX_VARIABLES,
  NotFoundError,
} from '../service/calculator-service.ts';
import { JsonFileStore } from '../storage/file-store.ts';

let directory: string;
let counter = 0;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'calc-service-'));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

function create(): { service: CalculatorService; path: string } {
  counter += 1;
  const path = join(directory, `history-${counter}.json`);
  const clock = () => new Date(Date.UTC(2026, 9, 12, 7, 0, counter));
  return { service: new CalculatorService(new JsonFileStore(path), clock), path };
}

async function readDisk(path: string): Promise<{
  variables: Record<string, number>;
  history: Array<{ id: number; timestamp: string; input: string; result: number; kind: string; variable: string | null }>;
}> {
  return JSON.parse(await readFile(path, 'utf8')) as Awaited<ReturnType<typeof readDisk>>;
}

describe('CalculatorService.submit', () => {
  it('records a timestamped history entry on disk', async () => {
    const { service, path } = create();
    const { entry } = await service.submit('  2 + 3 * 4  ', 'rad');
    assert.equal(entry.result, 14);
    assert.equal(entry.input, '2 + 3 * 4');
    assert.match(entry.timestamp, /^2026-10-12T07:00:\d\d\.000Z$/);
    const disk = await readDisk(path);
    assert.deepEqual(disk.history, [{ ...entry }]);
  });

  it('stores assignments as variables and exposes them to later input', async () => {
    const { service, path } = create();
    await service.submit('rate = 0.05', 'rad');
    await service.submit('x = 42', 'rad');
    const { entry } = await service.submit('x * (1 + rate)', 'rad');
    assert.equal(entry.result, 44.1);
    assert.deepEqual((await readDisk(path)).variables, { rate: 0.05, x: 42 });
    const state = await service.getState();
    assert.deepEqual(state.variables, [
      { name: 'rate', value: 0.05 },
      { name: 'x', value: 42 },
    ]);
  });

  it('marks assignment entries with their variable', async () => {
    const { service } = create();
    const { entry } = await service.submit('total = 10 / 4', 'rad');
    assert.equal(entry.kind, 'assignment');
    assert.equal(entry.variable, 'total');
    assert.equal(entry.result, 2.5);
  });

  it('provides the previous result as ans', async () => {
    const { service } = create();
    await service.submit('6 * 7', 'rad');
    assert.equal((await service.submit('ans + 8', 'rad')).entry.result, 50);
    assert.equal((await service.getState()).ans, 50);
  });

  it('uses the requested angle mode', async () => {
    const { service } = create();
    assert.equal((await service.submit('sin(90)', 'deg')).entry.result, 1);
    assert.notEqual((await service.submit('sin(90)', 'rad')).entry.result, 1);
  });

  it('assigns increasing ids', async () => {
    const { service } = create();
    const ids = [(await service.submit('1', 'rad')).entry.id, (await service.submit('2', 'rad')).entry.id];
    assert.deepEqual(ids, [1, 2]);
  });

  it('does not record failed evaluations or half-applied assignments', async () => {
    const { service, path } = create();
    await service.submit('ok = 1', 'rad');
    await assert.rejects(service.submit('bad = 1 / 0', 'rad'), CalcError);
    await assert.rejects(service.submit('(', 'rad'), CalcError);
    await assert.rejects(service.submit('missing + 1', 'rad'), CalcError);
    const disk = await readDisk(path);
    assert.deepEqual(disk.variables, { ok: 1 });
    assert.equal(disk.history.length, 1);
  });

  it('rejects blank and over-long input before touching storage', async () => {
    const { service, path } = create();
    await assert.rejects(service.submit('   ', 'rad'), /Enter an expression/);
    await assert.rejects(service.submit('1+'.repeat(MAX_INPUT_LENGTH), 'rad'), /too long/);
    await assert.rejects(readFile(path, 'utf8'), /ENOENT/);
  });

  it('caps the history at the maximum size, dropping the oldest entries', async () => {
    const { service } = create();
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 3; i += 1) await service.submit(String(i), 'rad');
    const { history } = await service.getState();
    assert.equal(history.length, MAX_HISTORY_ENTRIES);
    assert.equal(history[0]?.input, '3');
    assert.equal(history.at(-1)?.input, String(MAX_HISTORY_ENTRIES + 2));
  });

  it('limits the number of variables but allows updating existing ones', async () => {
    const { service } = create();
    for (let i = 0; i < MAX_VARIABLES; i += 1) await service.submit(`v${i} = ${i}`, 'rad');
    await assert.rejects(service.submit('overflow = 1', 'rad'), /Variable limit reached/);
    assert.equal((await service.submit('v0 = 99', 'rad')).entry.result, 99);
  });

  it('keeps every entry when submissions race', async () => {
    const { service, path } = create();
    await Promise.all(Array.from({ length: 25 }, (_, i) => service.submit(`${i} + 1`, 'rad')));
    const disk = await readDisk(path);
    assert.equal(disk.history.length, 25);
    assert.deepEqual(
      disk.history.map((h) => h.id).sort((a, b) => a - b),
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });
});

describe('CalculatorService maintenance', () => {
  it('deletes a variable', async () => {
    const { service, path } = create();
    await service.submit('x = 1', 'rad');
    await service.submit('y = 2', 'rad');
    const state = await service.deleteVariable('x');
    assert.deepEqual(state.variables, [{ name: 'y', value: 2 }]);
    assert.deepEqual((await readDisk(path)).variables, { y: 2 });
  });

  it('reports a missing variable', async () => {
    const { service } = create();
    await assert.rejects(service.deleteVariable('nope'), NotFoundError);
  });

  it('clears history but keeps variables', async () => {
    const { service, path } = create();
    await service.submit('x = 5', 'rad');
    const state = await service.clearHistory();
    assert.deepEqual(state.history, []);
    assert.equal(state.ans, null);
    const disk = await readDisk(path);
    assert.deepEqual(disk.history, []);
    assert.deepEqual(disk.variables, { x: 5 });
  });

  it('continues ids after clearing history', async () => {
    const { service } = create();
    await service.submit('1', 'rad');
    await service.clearHistory();
    assert.equal((await service.submit('2', 'rad')).entry.id, 2);
  });
});

describe('CalculatorService.analyze', () => {
  it('knows stored variables', async () => {
    const { service } = create();
    await service.submit('rate = 0.05', 'rad');
    assert.deepEqual((await service.analyze('rate * 2')).diagnostics, []);
    assert.equal((await service.analyze('nope * 2')).diagnostics[0]?.severity, 'warning');
  });

  it('does not write anything', async () => {
    const { service, path } = create();
    await service.analyze('1 +');
    await assert.rejects(readFile(path, 'utf8'), /ENOENT/);
  });
});
