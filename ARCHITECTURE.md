# Architecture

Four isolated modules plus a thin service layer. Dependencies point downward only.

```
ui (HTTP + browser)  ->  service  ->  engine
                                  ->  storage
```

`engine` and `storage` know nothing about each other or about HTTP.

## src/engine - AST math engine

Pipeline: `tokenizer` (characters -> raw tokens) -> `lexer` (classifies words as function / constant / variable, parses numbers) -> `parser` (Shunting-Yard, builds an AST directly) -> `evaluator` (tree walk).

- Precedence (low to high): `+ -`, `* / %`, unary `- +`, `^` (right-associative), postfix `!`. So `-2^2 = -4` and `2^-1 = 0.5`.
- `CalcError { kind: 'syntax' | 'math' | 'name', message, span }` is the only error type for user-caused failures.
- Results are rounded to 12 significant digits (`0.1 + 0.2 = 0.3`); trig snaps exact zeros (`sin(pi) = 0`, `cos(90 deg) = 0`).
- `analyze(source, knownVariables)` powers live validation: highlight tokens, unbalanced parentheses, first parse error, undefined-variable warnings.
- Public API (`src/engine/index.ts`): `evaluateSource`, `analyze`, `reservedNameReason`, `ANS_NAME`, `CalcError`, types `AngleMode`, `Diagnostic`, `Analysis`, `EvalOutcome`.

## src/storage - persistence

`JsonFileStore.update(mutator)` = in-process queue -> cross-process lock file (`history.json.lock`, `O_EXCL`, stale detection by dead pid or age) -> read -> mutate -> write temp file, fsync, atomic rename. A mutator that throws writes nothing. A corrupt file is quarantined to `history.json.corrupt-<ts>` and replaced by an empty database (warning logged).

File format:

```json
{ "version": 1, "nextId": 3,
  "variables": { "rate": 0.05 },
  "history": [ { "id": 1, "timestamp": "2026-10-12T07:00:00.000Z", "input": "rate = 0.05", "result": 0.05, "kind": "assignment", "variable": "rate" } ] }
```

## src/service - business logic

`CalculatorService` composes engine and storage: `getState`, `analyze`, `submit(input, angleMode)`, `deleteVariable`, `clearHistory`. A submit evaluates, applies an assignment, appends history and trims, all inside one locked store update. Failed evaluations are not recorded.

## src/ui - web dashboard

- `main.ts` reads `PORT` (3210), `HOST` (0.0.0.0), `DATA_FILE` (`./history.json`).
- `server.ts` static files (allow-listed extensions, traversal-safe) + security headers; `api.ts` JSON routes; `api-types.ts` shared DTO types (type-only).
- Client (`src/ui/client`, compiled by `tsconfig.client.json` to `dist/ui/public/assets`): `api.ts` fetch wrapper, `render.ts` DOM rendering (text nodes only, never `innerHTML`), `main.ts` wiring.

### HTTP API

| Method | Path | Body | Success | Failure |
|---|---|---|---|---|
| GET | `/api/health` | | `{status:"ok"}` | |
| GET | `/api/state` | | `StateResponse` | |
| POST | `/api/validate` | `{input}` | `ValidateResponse` | 400 |
| POST | `/api/evaluate` | `{input, angleMode}` | `EvaluateResponse` | 400 bad shape, 422 `ErrorResponse` calc error |
| DELETE | `/api/variables/:name` | | `StateResponse` | 404 |
| DELETE | `/api/history` | | `StateResponse` | |

Mutating requests must be `application/json` (blocks cross-site form posts). Bodies are limited to 16 KiB; expressions to 500 characters.

## src/tests

`node --test`, TypeScript run natively by Node 24 (type stripping). Unit tests per engine stage and storage; integration tests start the real server on an ephemeral port with a temp `history.json`.
