import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const checkerPath = resolve(repoRoot, 'apps/web/scripts/check-js-scripts.mjs');
const checkerSource = readFileSync(checkerPath, 'utf8');

describe('check-js-scripts discovery contract', () => {
    it('fails closed when script discovery finds zero JavaScript files', () => {
        expect(checkerSource).toContain('if (files.length === 0)');
        expect(checkerSource).toContain('script discovery likely broke');
        expect(checkerSource).toContain('process.exit(1)');
    });

    it('remains valid JavaScript', () => {
        expect(() => execFileSync(process.execPath, ['--check', checkerPath], { stdio: 'pipe' })).not.toThrow();
    });
});
