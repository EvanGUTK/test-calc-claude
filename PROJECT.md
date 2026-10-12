# Project: Financial & Scientific Calculator

Zero-runtime-dependency calculator. A hand-written math engine (no `eval`, no `Function`) behind a small web dashboard, with state persisted to `history.json`.

## Scope

- Scientific: `+ - * / ^ %`, unary minus, factorial `!`, trigonometry (radians or degrees), `ln`, `log10`, `log2`, `exp`, `sqrt`, `cbrt`, `abs`, rounding, `min`, `max`, constants `pi` and `e`.
- Financial:
  - `compound(P, r, n, t)` = P(1 + r/n)^(nt)
  - `pmt(P, annualRate, years, perYear = 12)` = amortizing loan payment
  - `npv(rate, C0, C1, ..., Cn)` = sum of C_t / (1 + rate)^t, first cash flow at t = 0
- Variables: `x = 42`, `rate = 0.05`; `ans` always holds the last result.
- History: timestamped entries (input, result), persisted, capped at 1000 entries.
- Dashboard: live syntax validation (unbalanced parentheses, invalid tokens, unknown functions, undefined variables), variable panel, scrollable history, RAD/DEG toggle.

## Non-goals

Multi-user accounts, authentication, remote deployment, complex numbers, symbolic algebra.

## Run

```
npm install        # dev tooling only (typescript, @types/node)
npm run build
npm start          # http://localhost:3210  (PORT, HOST, DATA_FILE override)
npm run check      # typecheck + tests
```

## Quality bar

Strict TypeScript (no implicit `any`), no placeholders, every engine operation unit tested, integration tests over HTTP asserting on `history.json`.
