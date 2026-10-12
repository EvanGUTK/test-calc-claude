import assert from 'node:assert/strict';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CalculatorService } from '../service/calculator-service.ts';
import { JsonFileStore } from '../storage/file-store.ts';
import type {
  ErrorResponse,
  EvaluateResponse,
  StateResponse,
  ValidateResponse,
} from '../ui/api-types.ts';
import { MAX_BODY_BYTES } from '../ui/http-utils.ts';
import { createAppServer } from '../ui/server.ts';

const PUBLIC_DIR = fileURLToPath(new URL('../ui/public/', import.meta.url));

interface DiskDocument {
  version: number;
  nextId: number;
  variables: Record<string, number>;
  history: Array<{ id: number; timestamp: string; input: string; result: number; kind: string; variable: string | null }>;
}

let directory: string;
let dataFile: string;
let server: Server;
let baseUrl: string;
let runs = 0;

async function startServer(): Promise<void> {
  const service = new CalculatorService(new JsonFileStore(dataFile));
  server = createAppServer({ service, publicDir: PUBLIC_DIR });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stopServer(): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function readDisk(): Promise<DiskDocument> {
  return JSON.parse(await readFile(dataFile, 'utf8')) as DiskDocument;
}

function post<T>(path: string, body: unknown): Promise<{ status: number; json: T; headers: Headers }> {
  return send<T>('POST', path, JSON.stringify(body));
}

async function send<T>(
  method: string,
  path: string,
  body?: string,
  contentType = 'application/json',
): Promise<{ status: number; json: T; headers: Headers }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = body;
    init.headers = { 'Content-Type': contentType };
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, json: (await response.json()) as T, headers: response.headers };
}

function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const req = httpRequest({ host: url.hostname, port: url.port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'calc-api-'));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  runs += 1;
  dataFile = join(directory, `history-${runs}.json`);
  await startServer();
});

afterEach(async () => {
  await stopServer();
});

describe('POST /api/evaluate writes memory state and history.json', () => {
  it('evaluates an expression and appends a history entry on disk', async () => {
    const { status, json } = await post<EvaluateResponse>('/api/evaluate', { input: '2 + 3 * 4', angleMode: 'rad' });
    assert.equal(status, 200);
    assert.equal(json.entry.result, 14);
    assert.equal(json.entry.kind, 'expression');
    assert.equal(json.state.history.length, 1);

    const disk = await readDisk();
    assert.equal(disk.version, 1);
    assert.equal(disk.history.length, 1);
    assert.deepEqual(disk.history[0], json.entry);
    assert.ok(!Number.isNaN(Date.parse(disk.history[0]?.timestamp ?? '')));
  });

  it('stores assignments in memory state and on disk, and uses them later', async () => {
    const assign = await post<EvaluateResponse>('/api/evaluate', { input: 'x = 42', angleMode: 'rad' });
    assert.equal(assign.json.entry.kind, 'assignment');
    assert.deepEqual(assign.json.state.variables, [{ name: 'x', value: 42 }]);
    assert.deepEqual((await readDisk()).variables, { x: 42 });

    await post('/api/evaluate', { input: 'rate = 0.05', angleMode: 'rad' });
    const use = await post<EvaluateResponse>('/api/evaluate', { input: 'x * (1 + rate)', angleMode: 'rad' });
    assert.equal(use.json.entry.result, 44.1);

    const state = await send<StateResponse>('GET', '/api/state');
    assert.deepEqual(state.json.variables, [
      { name: 'rate', value: 0.05 },
      { name: 'x', value: 42 },
    ]);
    assert.deepEqual(
      state.json.history.map((h) => h.input),
      ['x = 42', 'rate = 0.05', 'x * (1 + rate)'],
    );
    assert.equal(state.json.ans, 44.1);

    const disk = await readDisk();
    assert.deepEqual(disk.variables, { rate: 0.05, x: 42 });
    assert.deepEqual(
      disk.history.map((h) => h.id),
      [1, 2, 3],
    );
  });

  it('honours the angle mode', async () => {
    const deg = await post<EvaluateResponse>('/api/evaluate', { input: 'sin(30)', angleMode: 'deg' });
    assert.equal(deg.json.entry.result, 0.5);
    const rad = await post<EvaluateResponse>('/api/evaluate', { input: 'sin(30)', angleMode: 'rad' });
    assert.equal(rad.json.entry.result, -0.988031624093);
  });

  it('evaluates financial functions end to end', async () => {
    const compound = await post<EvaluateResponse>('/api/evaluate', {
      input: 'compound(1000, 0.05, 12, 10)',
      angleMode: 'rad',
    });
    assert.equal(compound.json.entry.result, 1647.00949769);
    const payment = await post<EvaluateResponse>('/api/evaluate', { input: 'pmt(200000, 0.06, 30)', angleMode: 'rad' });
    assert.equal(payment.json.entry.result, 1199.10105031);
  });

  it('returns 422 with a location for math errors and writes nothing', async () => {
    await post('/api/evaluate', { input: 'ok = 1', angleMode: 'rad' });
    const { status, json } = await post<ErrorResponse>('/api/evaluate', { input: 'bad = 2 + 1 / 0', angleMode: 'rad' });
    assert.equal(status, 422);
    assert.equal(json.error.kind, 'math');
    assert.match(json.error.message, /Division by zero/);
    assert.deepEqual([json.error.start, json.error.end], [10, 15]);

    const disk = await readDisk();
    assert.deepEqual(disk.variables, { ok: 1 });
    assert.equal(disk.history.length, 1);
  });

  it('returns 422 for syntax and name errors', async () => {
    const syntax = await post<ErrorResponse>('/api/evaluate', { input: '(1 + 2', angleMode: 'rad' });
    assert.equal(syntax.status, 422);
    assert.equal(syntax.json.error.kind, 'syntax');
    const name = await post<ErrorResponse>('/api/evaluate', { input: 'nope + 1', angleMode: 'rad' });
    assert.equal(name.status, 422);
    assert.equal(name.json.error.kind, 'name');
  });

  it('treats code-like input as plain invalid text', async () => {
    for (const input of ['process.exit(1)', 'require("fs")', 'constructor.constructor("return 1")()', '`${1}`']) {
      const { status, json } = await post<ErrorResponse>('/api/evaluate', { input, angleMode: 'rad' });
      assert.equal(status, 422, input);
      assert.ok(['syntax', 'name'].includes(json.error.kind), input);
    }
  });

  it('records every request when many arrive concurrently', async () => {
    const count = 20;
    const responses = await Promise.all(
      Array.from({ length: count }, (_, i) => post<EvaluateResponse>('/api/evaluate', { input: `${i} * 2`, angleMode: 'rad' })),
    );
    assert.ok(responses.every((r) => r.status === 200));
    const disk = await readDisk();
    assert.equal(disk.history.length, count);
    assert.equal(new Set(disk.history.map((h) => h.id)).size, count);
  });

  it('survives a server restart with the same data file', async () => {
    await post('/api/evaluate', { input: 'saved = 7', angleMode: 'rad' });
    await stopServer();
    await startServer();
    const state = await send<StateResponse>('GET', '/api/state');
    assert.deepEqual(state.json.variables, [{ name: 'saved', value: 7 }]);
    assert.equal(state.json.history.length, 1);
    const next = await post<EvaluateResponse>('/api/evaluate', { input: 'saved + ans', angleMode: 'rad' });
    assert.equal(next.json.entry.result, 14);
    assert.equal(next.json.entry.id, 2);
  });
});

describe('maintenance endpoints', () => {
  it('deletes a variable from memory and disk', async () => {
    await post('/api/evaluate', { input: 'a = 1', angleMode: 'rad' });
    await post('/api/evaluate', { input: 'b = 2', angleMode: 'rad' });
    const { status, json } = await send<StateResponse>('DELETE', '/api/variables/a');
    assert.equal(status, 200);
    assert.deepEqual(json.variables, [{ name: 'b', value: 2 }]);
    assert.deepEqual((await readDisk()).variables, { b: 2 });
  });

  it('returns 404 when deleting an unknown variable', async () => {
    const { status, json } = await send<ErrorResponse>('DELETE', '/api/variables/ghost');
    assert.equal(status, 404);
    assert.equal(json.error.kind, 'not_found');
  });

  it('clears history on disk', async () => {
    await post('/api/evaluate', { input: '1 + 1', angleMode: 'rad' });
    const { status, json } = await send<StateResponse>('DELETE', '/api/history');
    assert.equal(status, 200);
    assert.deepEqual(json.history, []);
    assert.deepEqual((await readDisk()).history, []);
  });

  it('answers the health check', async () => {
    const { status, json } = await send<{ status: string }>('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(json.status, 'ok');
  });
});

describe('POST /api/validate', () => {
  it('reports unbalanced parentheses without touching storage', async () => {
    const { status, json } = await post<ValidateResponse>('/api/validate', { input: '((1 + 2) * 3' });
    assert.equal(status, 200);
    assert.equal(json.ok, false);
    assert.deepEqual(
      json.diagnostics.map((d) => [d.severity, d.message, d.start]),
      [['error', "Unmatched '('", 0]],
    );
    assert.equal(json.tokens.length, 8);
    await assert.rejects(readFile(dataFile, 'utf8'), /ENOENT/);
  });

  it('accepts valid input and knows stored variables', async () => {
    await post('/api/evaluate', { input: 'rate = 0.05', angleMode: 'rad' });
    const known = await post<ValidateResponse>('/api/validate', { input: 'rate * 2' });
    assert.equal(known.json.ok, true);
    assert.deepEqual(known.json.diagnostics, []);
    const unknown = await post<ValidateResponse>('/api/validate', { input: 'rat * 2' });
    assert.equal(unknown.json.ok, true);
    assert.equal(unknown.json.diagnostics[0]?.severity, 'warning');
  });
});

describe('request validation', () => {
  it('rejects malformed JSON', async () => {
    const { status, json } = await send<ErrorResponse>('POST', '/api/evaluate', '{nope');
    assert.equal(status, 400);
    assert.match(json.error.message, /not valid JSON/);
  });

  it('rejects non-JSON content types', async () => {
    const { status } = await send<ErrorResponse>('POST', '/api/evaluate', 'input=1', 'application/x-www-form-urlencoded');
    assert.equal(status, 415);
    const plain = await send<ErrorResponse>('POST', '/api/evaluate', '{"input":"1","angleMode":"rad"}', 'text/plain');
    assert.equal(plain.status, 415);
  });

  it('rejects bad shapes', async () => {
    for (const body of [null, [], 'text', {}, { input: 5, angleMode: 'rad' }, { input: '1' }, { input: '1', angleMode: 'grad' }]) {
      const { status, json } = await post<ErrorResponse>('/api/evaluate', body);
      assert.equal(status, 400, JSON.stringify(body));
      assert.equal(json.error.kind, 'request');
    }
  });

  it('rejects oversized bodies', async () => {
    const { status } = await post<ErrorResponse>('/api/evaluate', { input: 'x'.repeat(MAX_BODY_BYTES), angleMode: 'rad' });
    assert.equal(status, 413);
  });

  it('rejects over-long expressions', async () => {
    const { status, json } = await post<ErrorResponse>('/api/evaluate', { input: '1+'.repeat(300), angleMode: 'rad' });
    assert.equal(status, 422);
    assert.match(json.error.message, /too long/);
  });

  it('rejects malformed percent-encoding in paths', async () => {
    const { status } = await send<ErrorResponse>('DELETE', '/api/variables/%E0%A4%A');
    assert.equal(status, 400);
  });

  it('returns 404 for unknown API paths and 405 for wrong methods', async () => {
    assert.equal((await send<ErrorResponse>('GET', '/api/nope')).status, 404);
    const wrong = await send<ErrorResponse>('GET', '/api/evaluate');
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'POST');
  });
});

describe('static files and headers', () => {
  it('serves the dashboard page with security headers', async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const html = await response.text();
    assert.match(html, /<input\s+id="expression"/);
    assert.match(html, /id="variables"/);
    assert.match(html, /id="history"/);
  });

  it('serves the stylesheet', async () => {
    const response = await fetch(`${baseUrl}/styles.css`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/css/);
  });

  it('answers HEAD without a body', async () => {
    const response = await fetch(`${baseUrl}/`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  });

  it('blocks path traversal', async () => {
    for (const path of ['/../../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/index.html%00.css']) {
      const { status, body } = await rawGet(path);
      assert.equal(status, 404, path);
      assert.doesNotMatch(body, /"name": "test-calc-claude"/);
    }
  });

  it('does not serve unknown file types or directories', async () => {
    assert.equal((await rawGet('/secret.txt')).status, 404);
    assert.equal((await rawGet('/assets')).status, 404);
  });

  it('rejects mutating methods on static paths', async () => {
    const response = await fetch(`${baseUrl}/`, { method: 'POST' });
    assert.equal(response.status, 405);
  });
});
