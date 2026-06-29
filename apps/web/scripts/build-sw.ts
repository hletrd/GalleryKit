/**
 * build-sw.ts — Stamps __SW_VERSION__ into the service worker template.
 *
 * Reads public/sw.template.js, replaces __SW_VERSION__ with a deterministic
 * identifier composed of:
 *   <template hash> "-p" <IMAGE_PIPELINE_VERSION>
 *
 * Embedding the pipeline version (R10-L12 / R11-H2-partial) means a
 * pipeline-only bump (e.g. encoder byte-output change with no git
 * commit landing on this file) still invalidates the Service Worker caches on
 * the next activation. The template hash avoids the impossible "committed
 * sw.js contains the commit that commits sw.js" freshness loop.
 *
 * Run via the prebuild hook in package.json.
 *
 * US-P24 PWA story.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { IMAGE_PIPELINE_VERSION } from '../src/lib/gallery-config-shared';

const root = resolve(__dirname, '..');

function getVersion(template: string): string {
  const templateHash = createHash('sha256')
    .update(template)
    .update(`\nPIPELINE=${IMAGE_PIPELINE_VERSION}`)
    .digest('hex')
    .slice(0, 8);
  return `${templateHash}-p${IMAGE_PIPELINE_VERSION}`;
}

const templatePath = resolve(root, 'public', 'sw.template.js');
const outputPath = resolve(root, 'public', 'sw.js');

const template = readFileSync(templatePath, 'utf8');
const version = getVersion(template);
const output = template.replaceAll('__SW_VERSION__', version);

writeFileSync(outputPath, output, 'utf8');
console.log(`[build-sw] wrote sw.js (version=${version})`);
