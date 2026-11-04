/**
 * Windows-safe Vitest launcher. npm scripts of the form `NODE_ENV=test vitest`
 * fail under cmd.exe; this sets NODE_ENV and spawns the local vitest CLI.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(backend, '..');
const vitestCli = [
  path.join(backend, 'node_modules/vitest/vitest.mjs'),
  path.join(root, 'node_modules/vitest/vitest.mjs'),
].find((candidate) => existsSync(candidate));
if (!vitestCli) {
  console.error('vitest CLI was not found in node_modules.');
  process.exit(1);
}

const child = spawn(process.execPath, [vitestCli, ...process.argv.slice(2)], {
  cwd: backend,
  env: { ...process.env, NODE_ENV: 'test' },
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
