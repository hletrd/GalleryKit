import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SECRET_ASSIGNMENT_RE = /\b(ADMIN_PASSWORD|SESSION_SECRET|DB_PASSWORD|MYSQL_PWD|DATABASE_URL|GALLERYKIT_TOKEN|CLOUDFLARE_API_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=([^\s]+)/g;
const SECRET_ASSIGNMENT_GREP = String.raw`\b(ADMIN_PASSWORD|SESSION_SECRET|DB_PASSWORD|MYSQL_PWD|DATABASE_URL|GALLERYKIT_TOKEN|CLOUDFLARE_API_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=[^[:space:]]+`;
const ALLOWED_VALUE_RE = /^(?:\[REDACTED\]|<[^>\s]+>?|\$\{[^}]+}|""|''|changeme|change-me|placeholder)$/i;
const TEXT_PATHS = [
    '*.cjs',
    '*.env',
    '*.example',
    '*.js',
    '*.json',
    '*.jsx',
    '*.log',
    '*.md',
    '*.mjs',
    '*.sh',
    '*.sql',
    '*.ts',
    '*.tsx',
    '*.txt',
    '*.yaml',
    '*.yml',
];

describe('tracked secret hygiene', () => {
    it('does not commit literal credential assignments in tracked text files', () => {
        const repoRoot = resolve(__dirname, '../../../..');
        const failures: string[] = [];

        let matches = '';
        try {
            matches = execFileSync('git', ['grep', '-I', '-n', '-E', SECRET_ASSIGNMENT_GREP, '--', ...TEXT_PATHS], {
                cwd: repoRoot,
                encoding: 'utf8',
            });
        } catch (err) {
            const status = typeof err === 'object' && err !== null && 'status' in err ? (err as { status?: number }).status : undefined;
            if (status !== 1) throw err;
        }

        for (const line of matches.split('\n')) {
            if (!line) continue;
            const rel = line.split(':', 1)[0] ?? '<unknown>';
            for (const match of line.matchAll(SECRET_ASSIGNMENT_RE)) {
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
