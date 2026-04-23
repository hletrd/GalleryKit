import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * C4R-RPL2-01 (AGG4R2-01) — the `poolConnection.on('connection')` listener in
 * `db/index.ts` runs `connection.promise().query('SET group_concat_max_len = 65535')`.
 *
 * Even though the pool is created via `mysql2/promise`, the 'connection'
 * event receives the base callback-style Connection. Calling `.query(...)`
 * directly returns `undefined`, not a Promise — chaining `.catch` on it
 * crashes with the mysql2 runtime guard. Call `.promise()` first to obtain
 * a PromiseConnection whose `.query(...)` returns a real Promise.
 *
 * The `.catch()` handler ensures a transient failure is logged via
 * `console.error` instead of (a) producing an unhandled promise rejection
 * under Node 24 strict defaults, AND (b) silently reverting the pooled
 * connection to the MySQL default 1024-byte limit, which would truncate
 * `GROUP_CONCAT` output in `exportImagesCsv` and SEO settings.
 *
 * This test is a structural assertion in the spirit of `auth-rethrow.test.ts`:
 * read the source and verify the error-handling is present.
 */
describe('db/index.ts — pool-connection listener', () => {
    const source = readFileSync(resolve(__dirname, '../db/index.ts'), 'utf8');

    it('imports the pool connection from mysql2/promise', () => {
        expect(source).toMatch(/from\s+['"]mysql2\/promise['"]/);
    });

    it("attaches a 'connection' listener to the pool", () => {
        expect(source).toMatch(/poolConnection\.on\(\s*['"]connection['"]\s*,/);
    });

    it('uses connection.promise() and chains .catch() so SET failures are logged', () => {
        const listenerMatch = /poolConnection\.on\(\s*['"]connection['"]\s*,\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;/m.exec(source);
        expect(listenerMatch).not.toBeNull();
        const body = listenerMatch?.[2] ?? '';

        // Query text
        expect(body).toMatch(/SET\s+group_concat_max_len/);
        // Must use .promise() to get a PromiseConnection — otherwise the
        // callback-style Connection returns undefined and .catch crashes.
        expect(body).toMatch(/\.promise\(\)\s*\.\s*query/);
        // Must chain .catch to observe failures (no unhandled rejections).
        expect(body).toMatch(/\.catch\s*\(/);
        // Must log via console.error so operators see the truncation risk.
        expect(body).toMatch(/console\.error/);
    });
});
