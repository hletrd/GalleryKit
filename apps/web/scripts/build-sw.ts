/**
 * build-sw.ts — Stamps __SW_VERSION__ into the service worker template.
 *
 * Reads public/sw.template.js, replaces __SW_VERSION__ with a build-time
 * identifier composed of:
 *   <git short-SHA or build timestamp> "-p" <IMAGE_PIPELINE_VERSION>
 *
 * Embedding the pipeline version (R10-L12 / R11-H2-partial) means a
 * pipeline-only bump (e.g. encoder byte-output change with no git
 * commit landing on this file) still invalidates the Service Worker
 * caches on the next activation. Without it, a bump that ships with
 * a deploy whose commit hash already matched would leave stale image
 * bytes in clients' SW cache.
 *
 * Run via the prebuild hook in package.json.
 *
 * US-P24 PWA story.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { IMAGE_PIPELINE_VERSION } from '../src/lib/gallery-config-shared';

const root = resolve(__dirname, '..');

function getCommitOrTimestamp(): string {
  try {
    // execFileSync (not execSync) with a fixed argv passes no shell
    // metacharacters; the arguments are literal and not parsed by sh.
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
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

function getVersion(): string {
  return `${getCommitOrTimestamp()}-p${IMAGE_PIPELINE_VERSION}`;
}

const version = getVersion();
const templatePath = resolve(root, 'public', 'sw.template.js');
const outputPath = resolve(root, 'public', 'sw.js');

const template = readFileSync(templatePath, 'utf8');
const output = template.replaceAll('__SW_VERSION__', version);

writeFileSync(outputPath, output, 'utf8');
console.log(`[build-sw] wrote sw.js (version=${version})`);
