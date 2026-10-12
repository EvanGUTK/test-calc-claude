import { JsonFileStore } from '../../storage/file-store.ts';

const [filePath, countArg] = process.argv.slice(2);
if (filePath === undefined || countArg === undefined) {
  console.error('usage: increment-worker <file> <count>');
  process.exit(2);
}

const store = new JsonFileStore(filePath, { lockTimeoutMs: 20000 });
const count = Number.parseInt(countArg, 10);
for (let i = 0; i < count; i += 1) {
  await store.update((database) => {
    database.variables.set('counter', (database.variables.get('counter') ?? 0) + 1);
  });
}
