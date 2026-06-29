import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SECRET_ASSIGNMENT_RE = /\b(ADMIN_PASSWORD|SESSION_SECRET|DB_PASSWORD|MYSQL_PWD|DATABASE_URL|GALLERYKIT_TOKEN|CLOUDFLARE_API_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=([^\s]+)/g;
const ALLOWED_VALUE_RE = /^(?:\[REDACTED\]|<[^>]+>|\$\{[^}]+}|""|''|changeme|change-me|placeholder|password)$/i;
const REVIEW_ARTIFACTS_TO_SCAN = [
    '.context/reviews/logs-cycle4/security-reviewer.log',
    '.context/reviews/cycle-8-2026-06-29/_aggregate.md',
    '.context/reviews/cycle-8-2026-06-29/architect.md',
    '.context/reviews/cycle-8-2026-06-29/code-reviewer.md',
    '.context/reviews/cycle-8-2026-06-29/critic.md',
    '.context/reviews/cycle-8-2026-06-29/debugger.md',
    '.context/reviews/cycle-8-2026-06-29/designer.md',
    '.context/reviews/cycle-8-2026-06-29/document-specialist.md',
    '.context/reviews/cycle-8-2026-06-29/perf-reviewer.md',
    '.context/reviews/cycle-8-2026-06-29/security-reviewer.md',
    '.context/reviews/cycle-8-2026-06-29/test-engineer.md',
    '.context/reviews/cycle-8-2026-06-29/tracer.md',
    '.context/reviews/cycle-8-2026-06-29/verifier.md',
];

describe('tracked secret hygiene', () => {
    it('does not commit literal credential assignments in tracked text files', () => {
        const repoRoot = resolve(__dirname, '../../../..');
        const failures: string[] = [];

        for (const rel of REVIEW_ARTIFACTS_TO_SCAN) {
            if (!['.log', '.md'].includes(extname(rel))) continue;

            let content: string;
            try {
                content = readFileSync(resolve(repoRoot, rel), 'utf8');
            } catch {
                continue;
            }

            for (const match of content.matchAll(SECRET_ASSIGNMENT_RE)) {
                const value = match[2] ?? '';
                if (!ALLOWED_VALUE_RE.test(value)) {
                    failures.push(`${rel}: ${match[1]} has a non-placeholder value`);
                }
            }
        }

        expect(failures).toEqual([]);
    });
});
