/**
 * C2-03 (run-10 c2) + C3-02/C3-03 (run-10 c3): behavioral coverage for the
 * WARN-ONLY single-writer boot guard. The guard probes a DB-scoped MySQL
 * advisory lock on a dedicated (non-pooled) connection at startup:
 *   - acquired  -> hold the connection open for process lifetime, silently,
 *     with a periodic unref'd SELECT 1 keepalive so MySQL's wait_timeout
 *     cannot silently reap the lock (C3-02).
 *   - unavailable (0) -> close the probe connection QUIETLY, re-probe once
 *     after ~25s (rolling-deploy drain tolerance, C3-03); only a persistent
 *     holder earns the loud console.error naming the topology doc. Never throw.
 *   - any connection/query error -> console.warn only, never throw.
 *   - a later 'error' event or keepalive failure on the held connection ->
 *     console.warn once, never crash the process.
 *   - stopSingleWriterGuard() clears timers, releases the lock, closes the
 *     connection.
 *
 * Both the mysql2/promise module and the connection-options helper
 * (scripts/mysql-connection-options.js) are mocked so this suite never
 * depends on real DB_* environment variables or a live MySQL server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { createConnectionMock } = vi.hoisted(() => ({
    createConnectionMock: vi.fn(),
}));

vi.mock('mysql2/promise', () => ({
    default: { createConnection: createConnectionMock },
    createConnection: createConnectionMock,
}));

vi.mock('../../scripts/mysql-connection-options', () => ({
    getMysqlConnectionOptions: vi.fn(() => ({
        host: '127.0.0.1',
        port: 3306,
        user: 'test-user',
        password: 'test-password',
        database: 'test-db',
    })),
}));

type FakeConnection = {
    query: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
};

/**
 * Build a fake mysql2/promise Connection whose GET_LOCK query resolves to
 * `acquiredValue` and whose RELEASE_LOCK / other queries resolve to an
 * empty result (unless `queryError` is set, in which case every query
 * rejects — simulating a lost connection mid-probe).
 */
function makeConn(acquiredValue: number | bigint | null, queryError?: Error): FakeConnection {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
        if (queryError) throw queryError;
        if (String(sql).includes('GET_LOCK')) {
            return [[{ acquired: acquiredValue }], undefined];
        }
        return [[], undefined];
    });
    const on = vi.fn();
    const end = vi.fn(async () => undefined);
    return { query, on, end };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.resetModules();
    createConnectionMock.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
});

describe('startSingleWriterGuard — lock acquired', () => {
    it('holds the connection open, registers an error handler, and logs nothing', async () => {
        const conn = makeConn(1);
        createConnectionMock.mockResolvedValue(conn);

        const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await startSingleWriterGuard();

        expect(conn.end).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).not.toHaveBeenCalled();

        const errorHandlerCall = conn.on.mock.calls.find((c) => c[0] === 'error');
        expect(errorHandlerCall).toBeTruthy();
        expect(errorHandlerCall?.[1]).toBeInstanceOf(Function);

        // GET_LOCK was called with the DB-SCOPED singleton lock name (C3-03):
        // prefix + 16-hex sha256 fold of the database name, under MySQL's
        // 64-char advisory-lock-name limit.
        const { getSingleWriterLockName, LOCK_SINGLE_WRITER_GUARD_PREFIX } = await import('@/lib/advisory-locks');
        const expectedName = getSingleWriterLockName('test-db');
        expect(expectedName).toMatch(
            new RegExp(`^${LOCK_SINGLE_WRITER_GUARD_PREFIX}_[0-9a-f]{16}$`),
        );
        expect(expectedName.length).toBeLessThanOrEqual(64);
        expect(getSingleWriterLockName('other-db')).not.toBe(expectedName);
        const getLockCall = conn.query.mock.calls.find((c) => String(c[0]).includes('GET_LOCK'));
        expect(getLockCall).toBeTruthy();
        expect((getLockCall![1] as unknown[])[0]).toBe(expectedName);
    });

    it('accepts BigInt(1) and the string "1" as acquired, matching isAdvisoryLockAcquired', async () => {
        for (const value of [BigInt(1), '1']) {
            vi.resetModules();
            createConnectionMock.mockReset();
            const conn = makeConn(value as unknown as number);
            createConnectionMock.mockResolvedValue(conn);

            const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
            await startSingleWriterGuard();

            expect(conn.end).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        }
    });

    it('is idempotent — a second call while already holding the lock does not open another connection', async () => {
        const conn = makeConn(1);
        createConnectionMock.mockResolvedValue(conn);

        const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await startSingleWriterGuard();
        await startSingleWriterGuard();

        expect(createConnectionMock).toHaveBeenCalledTimes(1);
    });
});

describe('startSingleWriterGuard — lock unavailable (re-probe, C3-03)', () => {
    it('stays quiet on first contention, then logs the loud topology error only after the re-probe confirms a persistent holder', async () => {
        vi.useFakeTimers();
        try {
            const conn1 = makeConn(0);
            const conn2 = makeConn(0);
            createConnectionMock.mockResolvedValueOnce(conn1).mockResolvedValueOnce(conn2);

            const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
            await startSingleWriterGuard();

            // First contention: probe connection closed quietly — a rolling
            // deploy's old process legitimately holds the lock through its
            // drain window, so no cry-wolf error yet.
            expect(conn1.end).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(25_000);

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const message = consoleErrorSpy.mock.calls[0].join(' ');
            expect(message.toLowerCase()).toMatch(/singleton/);
            expect(message).toMatch(/CLAUDE\.md/);
            expect(message.toLowerCase()).toMatch(/runtime topology/);
            expect(conn2.end).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('acquires quietly on re-probe when the first contention was transient (rolling-deploy overlap)', async () => {
        vi.useFakeTimers();
        try {
            const conn1 = makeConn(0);
            const conn2 = makeConn(1);
            createConnectionMock.mockResolvedValueOnce(conn1).mockResolvedValueOnce(conn2);

            const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
            await startSingleWriterGuard();
            expect(conn1.end).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(25_000);

            // Old process finished draining; the re-probe acquired the lock
            // and now HOLDS the second connection — no operator noise.
            expect(consoleErrorSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(conn2.end).not.toHaveBeenCalled();
            const errorHandlerCall = conn2.on.mock.calls.find((c) => c[0] === 'error');
            expect(errorHandlerCall).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('treats a null GET_LOCK result (timeout/unhealthy) the same as unavailable', async () => {
        vi.useFakeTimers();
        try {
            const conn1 = makeConn(null);
            const conn2 = makeConn(null);
            createConnectionMock.mockResolvedValueOnce(conn1).mockResolvedValueOnce(conn2);

            const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
            await startSingleWriterGuard();
            expect(conn1.end).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(25_000);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('held-connection keepalive (C3-02)', () => {
    it('issues a periodic SELECT 1 so MySQL wait_timeout cannot reap the lock', async () => {
        vi.useFakeTimers();
        try {
            const conn = makeConn(1);
            createConnectionMock.mockResolvedValue(conn);

            const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
            await startSingleWriterGuard();

            const keepaliveCalls = () =>
                conn.query.mock.calls.filter((c) => String(c[0]).includes('SELECT 1')).length;
            expect(keepaliveCalls()).toBe(0);

            await vi.advanceTimersByTimeAsync(60_000);
            expect(keepaliveCalls()).toBe(1);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(keepaliveCalls()).toBe(2);
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('warns once, stops the keepalive, and closes the connection when the keepalive query fails', async () => {
        vi.useFakeTimers();
        try {
            const conn = makeConn(1);
            createConnectionMock.mockResolvedValue(conn);

            const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
            await startSingleWriterGuard();

            conn.query.mockImplementation(async (sql: string) => {
                if (String(sql).includes('SELECT 1')) throw new Error('server has gone away');
                return [[], undefined];
            });

            await vi.advanceTimersByTimeAsync(60_000);
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy.mock.calls[0].join(' ').toLowerCase()).toMatch(/lapsed/);
            expect(conn.end).toHaveBeenCalled();

            // Keepalive was cleared — a later tick must not warn again.
            await vi.advanceTimersByTimeAsync(120_000);
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('startSingleWriterGuard — error paths never throw', () => {
    it('warns only (no throw) when the probe connection cannot be established', async () => {
        createConnectionMock.mockRejectedValue(new Error('ECONNREFUSED'));

        const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await expect(startSingleWriterGuard()).resolves.toBeUndefined();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('warns only (no throw) and closes the connection when the GET_LOCK query itself fails', async () => {
        const conn = makeConn(1, new Error('lost connection mid-GET_LOCK'));
        createConnectionMock.mockResolvedValue(conn);

        const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await expect(startSingleWriterGuard()).resolves.toBeUndefined();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(conn.end).toHaveBeenCalledTimes(1);
    });

    it('warns only when getMysqlConnectionOptions() itself throws (e.g. missing required env vars)', async () => {
        const optionsModule = await import('../../scripts/mysql-connection-options');
        vi.mocked(optionsModule.getMysqlConnectionOptions).mockImplementationOnce(() => {
            throw new Error('Missing required environment variable: DB_USER');
        });

        const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await expect(startSingleWriterGuard()).resolves.toBeUndefined();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(createConnectionMock).not.toHaveBeenCalled();
    });
});

describe("held connection 'error' event after acquisition", () => {
    it('warns once without crashing when the held connection later errors', async () => {
        const conn = makeConn(1);
        createConnectionMock.mockResolvedValue(conn);

        const { startSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await startSingleWriterGuard();

        const errorHandler = conn.on.mock.calls.find((c) => c[0] === 'error')?.[1] as
            | ((err: Error) => void)
            | undefined;
        expect(errorHandler).toBeInstanceOf(Function);

        expect(() => errorHandler!(new Error('PROTOCOL_CONNECTION_LOST'))).not.toThrow();
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        const message = consoleWarnSpy.mock.calls[0].join(' ').toLowerCase();
        expect(message).toMatch(/lapsed/);

        // Firing again must not log a second warning ("a single console.warn").
        errorHandler!(new Error('ECONNRESET'));
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    });
});

describe('stopSingleWriterGuard', () => {
    it('releases the lock and closes the connection after a successful acquisition', async () => {
        const conn = makeConn(1);
        createConnectionMock.mockResolvedValue(conn);

        const { startSingleWriterGuard, stopSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await startSingleWriterGuard();
        await stopSingleWriterGuard();

        const releaseCall = conn.query.mock.calls.find((c) => String(c[0]).includes('RELEASE_LOCK'));
        expect(releaseCall).toBeTruthy();
        expect(conn.end).toHaveBeenCalledTimes(1);
    });

    it('is a safe no-op when the guard never acquired a connection', async () => {
        createConnectionMock.mockRejectedValue(new Error('ECONNREFUSED'));

        const { startSingleWriterGuard, stopSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await startSingleWriterGuard();

        await expect(stopSingleWriterGuard()).resolves.toBeUndefined();
    });

    it('does not throw even when RELEASE_LOCK fails', async () => {
        const conn = makeConn(1);
        createConnectionMock.mockResolvedValue(conn);

        const { startSingleWriterGuard, stopSingleWriterGuard } = await import('@/lib/single-writer-guard');
        await startSingleWriterGuard();

        conn.query.mockImplementationOnce(async () => {
            throw new Error('RELEASE_LOCK failed');
        });

        await expect(stopSingleWriterGuard()).resolves.toBeUndefined();
        expect(conn.end).toHaveBeenCalledTimes(1);
    });
});

describe('instrumentation.ts wiring (C2-03)', () => {
    const INSTRUMENTATION_SRC = readFileSync(resolve(__dirname, '../instrumentation.ts'), 'utf8');

    it('fire-and-forget starts the guard after existing boot init, without awaiting it inline', () => {
        expect(INSTRUMENTATION_SRC).toMatch(
            /import\(\s*['"]@\/lib\/single-writer-guard['"]\s*\)\s*\n?\s*\.then\(\s*\(\{\s*startSingleWriterGuard\s*\}\)\s*=>\s*startSingleWriterGuard\(\)\s*\)/,
        );
        // Must not be `await import(...).then(...)` — that would still block
        // boot until the guard settles.
        expect(INSTRUMENTATION_SRC).not.toMatch(
            /await\s+import\(\s*['"]@\/lib\/single-writer-guard['"]\s*\)\s*\n?\s*\.then\(/,
        );
    });

    it('wires stopSingleWriterGuard into the graceful-shutdown drain', () => {
        expect(INSTRUMENTATION_SRC).toContain("await import('@/lib/single-writer-guard')");
        expect(INSTRUMENTATION_SRC).toContain('stopSingleWriterGuard()');
        // It must be inside the same Promise.all(...) as the other drains,
        // not fired separately/unawaited during shutdown.
        const promiseAllIndex = INSTRUMENTATION_SRC.indexOf('Promise.all([');
        const stopCallIndex = INSTRUMENTATION_SRC.indexOf('stopSingleWriterGuard()', promiseAllIndex);
        expect(promiseAllIndex).toBeGreaterThan(-1);
        expect(stopCallIndex).toBeGreaterThan(promiseAllIndex);
    });
});
