import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scanRoots = [
  path.join(appDir, 'scripts'),
];

function collectJavaScriptFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && /\.(?:m?js|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = scanRoots
  .filter((root) => {
    try {
      return statSync(root).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap(collectJavaScriptFiles)
  .sort();

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Checked ${files.length} JavaScript script file${files.length === 1 ? '' : 's'}.`);
