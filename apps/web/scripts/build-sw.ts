/**
 * build-sw.ts — Stamps __SW_VERSION__ into the service worker template.
 *
 * Reads public/sw.template.js, replaces __SW_VERSION__ with a build-time
 * hash (git short-SHA or Date.now() fallback), and writes public/sw.js.
 *
 * Run via the prebuild hook in package.json.
 *
 * US-P24 PWA story.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');

function getVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (/^[0-9a-f]{6,}$/.test(sha)) return sha;
  } catch {
    // fall through
  }
  return String(Date.now());
}

const version = getVersion();
const templatePath = resolve(root, 'public', 'sw.template.js');
const outputPath = resolve(root, 'public', 'sw.js');

const template = readFileSync(templatePath, 'utf8');
const output = template.replaceAll('__SW_VERSION__', version);

writeFileSync(outputPath, output, 'utf8');
console.log(`[build-sw] wrote sw.js (version=${version})`);
