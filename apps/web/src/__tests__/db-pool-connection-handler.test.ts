import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * C4R-RPL2-01 (AGG4R2-01) — the `poolConnection.on('connection')` listener in
 * `db/index.ts` runs `connection.query('SET group_concat_max_len = 65535')`
 * which returns a Promise. Without a `.catch()` handler, a transient failure
 * surfaces as an unhandled promise rejection (Node 24 strict) AND silently
 * reverts the pooled connection to the MySQL default 1024-byte limit, which
 * truncates `GROUP_CONCAT` output in `exportImagesCsv` and SEO settings.
 *
 * This test is a structural assertion in the spirit of `auth-rethrow.test.ts`:
 * read the source and verify the `.catch` is present.
 */
describe('db/index.ts — pool-connection listener', () => {
    const source = readFileSync(resolve(__dirname, '../db/index.ts'), 'utf8');

    it('imports the pool connection from mysql2/promise', () => {
        expect(source).toMatch(/from\s+['"]mysql2\/promise['"]/);
    });

    it("attaches a 'connection' listener to the pool", () => {
        expect(source).toMatch(/poolConnection\.on\(\s*['"]connection['"]\s*,/);
    });

    it('chains a .catch() handler on the SET group_concat_max_len query', () => {
        // The listener body should contain the SET query and a .catch — both
        // syntactically linked via a Promise chain. Use a multi-line regex
        // that tolerates whitespace/newlines.
        const listenerMatch = /poolConnection\.on\(\s*['"]connection['"]\s*,\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/m.exec(source);
        expect(listenerMatch).not.toBeNull();
        const body = listenerMatch?.[2] ?? '';
        expect(body).toMatch(/SET\s+group_concat_max_len/);
        expect(body).toMatch(/\.catch\s*\(/);
    });
});
