import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const appRoot = process.cwd();
const requiredGeneratedTypes = [
  path.join(appRoot, '.next', 'types', 'cache-life.d.ts'),
  path.join(appRoot, '.next', 'types', 'routes.d.ts'),
  path.join(appRoot, '.next', 'types', 'validator.ts'),
];

function run(command, args) {
  execFileSync(command, args, { cwd: appRoot, stdio: 'inherit' });
}

async function waitForGeneratedTypes(timeoutMs = 5000) {
  const startedAt = Date.now();
  const missing = [];

  for (;;) {
    missing.length = 0;
    await Promise.all(requiredGeneratedTypes.map(async (file) => {
      try {
        await fs.access(file);
      } catch {
        missing.push(path.relative(appRoot, file));
      }
    }));

    if (missing.length === 0) return;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`next typegen did not create required type files: ${missing.join(', ')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

try {
  run(process.execPath, ['scripts/prepare-next-typegen.mjs']);
  run('next', ['typegen']);
  await waitForGeneratedTypes();
  run('tsc', ['-p', 'tsconfig.typecheck.json', '--noEmit']);
} catch (error) {
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
    process.exit(error.status);
  }
  console.error('[typecheck] App typecheck failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
