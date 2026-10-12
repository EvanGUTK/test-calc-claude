# Repo notes

- Node >= 24 runs the TypeScript sources directly (type stripping), so imports use `.ts` extensions and only erasable syntax is allowed (no enums, namespaces or constructor parameter properties).
- `npm run check` = typecheck (server + client configs) + tests. `npm run build` compiles to `dist/`; `npm start` serves it on port 3210 (`PORT`, `HOST`, `DATA_FILE` override).
- Runtime has zero dependencies; `typescript` and `@types/node` are dev-only.
- Browser code lives in `src/ui/client` and has its own `tsconfig.client.json` (DOM lib). `src/ui/api-types.ts` is the only file shared with the server and must stay type-only.
- Engine results are rounded to 12 significant digits; test expectations for numeric results must use that rounding (verify expected values independently, not from engine output).
