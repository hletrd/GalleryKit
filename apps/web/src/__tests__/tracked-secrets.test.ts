import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SECRET_ASSIGNMENT_RE = /\b(ADMIN_PASSWORD|SESSION_SECRET|DB_PASSWORD|MYSQL_PWD|DATABASE_URL|GALLERYKIT_TOKEN|CLOUDFLARE_API_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=([^\s]+)/g;
const ALLOWED_VALUE_RE = /^(?:\[REDACTED\]|<[^>\s]+>?|\$\{[^}]+}|""|''|changeme|change-me|placeholder)$/i;
const TEXT_EXTS = new Set([
    '.cjs',
    '.env',
    '.example',
    '.js',
    '.json',
    '.jsx',
    '.log',
    '.md',
    '.mjs',
    '.sh',
    '.sql',
    '.ts',
    '.tsx',
    '.txt',
    '.yaml',
    '.yml',
]);

describe('tracked secret hygiene', () => {
    it('does not commit literal credential assignments in tracked text files', () => {
        const repoRoot = resolve(__dirname, '../../../..');
        const failures: string[] = [];

        const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
            cwd: repoRoot,
            encoding: 'utf8',
        }).split('\0').filter(Boolean);

        for (const rel of trackedFiles) {
            if (!TEXT_EXTS.has(extname(rel))) continue;

            let content: string;
            try {
                content = readFileSync(resolve(repoRoot, rel), 'utf8');
            } catch {
                continue;
            }

            for (const match of content.matchAll(SECRET_ASSIGNMENT_RE)) {
                const value = match[2] ?? '';
                const normalizedValue = value.replace(/^[`'"]+|[`'",.;:)]*$/g, '');
                if (!ALLOWED_VALUE_RE.test(normalizedValue)) {
                    failures.push(`${rel}: ${match[1]} has a non-placeholder value`);
                }
            }
        }

        expect(failures).toEqual([]);
    });
});
