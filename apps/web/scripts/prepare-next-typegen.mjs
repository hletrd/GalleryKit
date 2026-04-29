import fs from 'node:fs/promises';
import path from 'node:path';

const appRoot = process.cwd();
const nextDir = path.join(appRoot, '.next');
const nextTypesDir = path.join(nextDir, 'types');

async function isWritable(dir) {
  try {
    await fs.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

try {
  await fs.mkdir(nextDir, { recursive: true });
  if (!(await isWritable(nextDir))) {
    throw new Error(`Generated Next directory is not writable: ${nextDir}`);
  }

  // Route/type generation is deterministic. Removing only `.next/types`
  // avoids stale or foreign-owned route validators blocking `next typegen`
  // while preserving unrelated build cache data.
  await fs.rm(nextTypesDir, { recursive: true, force: true });
} catch (error) {
  console.error('[typecheck] Unable to prepare .next/types for fresh generation.');
  console.error(error instanceof Error ? error.message : error);
  console.error('Fix ownership/permissions or remove apps/web/.next before retrying.');
  process.exit(1);
}
