import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * C4R-RPL2-01 (AGG4R2-01) — the `poolConnection.on('connection')` listener in
 * `db/index.ts` runs `connection.query('SET group_concat_max_len = 65535')`.
 *
 * Even though the pool is created via `mysql2/promise`, the 'connection' event
 * receives the base callback-style Connection. Calling `.query(...)` on it
 * returns `undefined`, not a Promise — so chaining `.catch` on it would crash
 * with "Try calling con.promise().query()". Use the `(err, results)` callback
 * form so a transient failure is logged via `console.error` instead of
 * producing an unhandled promise rejection AND silently reverting the pooled
 * connection to the MySQL default 1024-byte limit, which would truncate
 * `GROUP_CONCAT` output in `exportImagesCsv` and SEO settings.
 *
 * This test is a structural assertion in the spirit of `auth-rethrow.test.ts`:
 * read the source and verify the error-handling callback is present.
 */
describe('db/index.ts — pool-connection listener', () => {
    const source = readFileSync(resolve(__dirname, '../db/index.ts'), 'utf8');

    it('imports the pool connection from mysql2/promise', () => {
        expect(source).toMatch(/from\s+['"]mysql2\/promise['"]/);
    });

    it("attaches a 'connection' listener to the pool", () => {
        expect(source).toMatch(/poolConnection\.on\(\s*['"]connection['"]\s*,/);
    });

    it('passes a callback to connection.query so errors are observable', () => {
        // The listener body should contain the SET query and an error callback —
        // the classic `(err, results) => { if (err) ... }` shape, or similar.
        // Use a tolerant regex that checks:
        //   connection.query('SET group_concat_max_len ...', (err...) => { ... })
        const listenerMatch = /poolConnection\.on\(\s*['"]connection['"]\s*,\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;/m.exec(source);
        expect(listenerMatch).not.toBeNull();
        const body = listenerMatch?.[2] ?? '';
        expect(body).toMatch(/SET\s+group_concat_max_len/);
        // Callback-style query: second argument is an arrow function that
        // receives `err` and handles it (console.error or similar).
        expect(body).toMatch(/\(\s*err[^)]*\)\s*=>/);
        expect(body).toMatch(/console\.error/);
    });
});
