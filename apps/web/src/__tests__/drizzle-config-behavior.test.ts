import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * C7-16 (run-10 cycle 7b): the drizzle.config.ts TLS-CA requirement was
 * locked only by source-text pins (drizzle-tls-source.test.ts). These
 * behavioral tests import the real config factory under stubbed env and
 * assert the actual throw/no-throw contract, matching the runtime
 * (db/index.ts) and CLI (mysql-connection-options.js) fail-closed posture.
 *
 * dotenv.config() inside drizzle.config.ts does NOT override pre-set env
 * vars, so vi.stubEnv wins over any local .env.local.
 */

async function importFreshConfig() {
    vi.resetModules();
    return import('../../drizzle.config');
}

describe('drizzle.config TLS behavior (C7-16)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('throws for a non-local DB_HOST without DB_SSL_CA', async () => {
        vi.stubEnv('DB_HOST', 'db.example.com');
        vi.stubEnv('DB_SSL', '');
        vi.stubEnv('DB_SSL_CA', '');
        await expect(importFreshConfig()).rejects.toThrow(
            'DB_SSL_CA is required for non-local DB connections unless DB_SSL=false',
        );
    });

    it('does not throw for localhost hosts without a CA', async () => {
        for (const host of ['127.0.0.1', 'localhost', '::1']) {
            vi.stubEnv('DB_HOST', host);
            vi.stubEnv('DB_SSL', '');
            vi.stubEnv('DB_SSL_CA', '');
            const mod = await importFreshConfig();
            expect(mod.default).toBeTruthy();
        }
    });

    it('does not throw for a non-local host when DB_SSL=false (explicit opt-out)', async () => {
        vi.stubEnv('DB_HOST', 'db.example.com');
        vi.stubEnv('DB_SSL', 'false');
        vi.stubEnv('DB_SSL_CA', '');
        const mod = await importFreshConfig();
        expect(mod.default).toBeTruthy();
    });
});
