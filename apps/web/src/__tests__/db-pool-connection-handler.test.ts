import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * C4R-RPL2-01 (AGG4R2-01) — the `poolConnection.on('connection')` listener in
 * `db/index.ts` runs `connection.promise().query('SET group_concat_max_len = 65535')`.
 *
 * Even though the pool is created via `mysql2/promise`, the 'connection'
 * event receives the base callback-style Connection. We still call
 * `.promise().query(...)` to set the session variable, but the pool now
 * waits for that per-connection initialization promise before handing the
 * connection back to callers. That keeps the first query on a new pooled
 * connection from racing the session setup.
 *
 * The `.catch()` handler ensures a transient failure is logged via
 * `console.error` instead of producing an unhandled promise rejection.
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

    it('stores a per-connection init promise and awaits it in getConnection()', () => {
        expect(source).toMatch(/new WeakMap<CallbackPoolConnection,\s*Promise<void>>\(\)/);
        expect(source).toMatch(/connectionInitPromises\.set\(/);
        expect(source).toMatch(/const originalGetConnection = poolConnection\.getConnection\.bind\(poolConnection\)/);
        expect(source).toMatch(/await originalGetConnection\(/);
        expect(source).toMatch(/await initPromise/);
    });


    it('routes pool query and execute through the initialized connection path', () => {
        expect(source).toMatch(/poolConnection\.query\s*=\s*\(async/);
        expect(source).toMatch(/const queryConnection = await poolConnection\.getConnection\(\)/);
        expect(source).toMatch(/return await queryConnection\.query/);
        expect(source).toMatch(/queryConnection\.release\(\)/);
        expect(source).toMatch(/poolConnection\.execute\s*=\s*\(async/);
        expect(source).toMatch(/const executeConnection = await poolConnection\.getConnection\(\)/);
        expect(source).toMatch(/return await executeConnection\.execute/);
        expect(source).toMatch(/executeConnection\.release\(\)/);
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
