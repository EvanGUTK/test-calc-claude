import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

function run(args) {
  const result = spawnSync(process.execPath, [tsc, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`build failed: tsc ${args.join(' ')} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

rmSync(`${root}dist`, { recursive: true, force: true });
run(['-p', 'tsconfig.build.json']);
run(['-p', 'tsconfig.client.json']);
cpSync(`${root}src/ui/public`, `${root}dist/ui/public`, { recursive: true });
console.log('build complete: dist/');
