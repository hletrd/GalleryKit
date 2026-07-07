import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getMysqlConnectionOptions } = require('../../scripts/mysql-connection-options.js') as {
    getMysqlConnectionOptions: (overrides?: Record<string, string>) => {
        ssl?: { ca: string; rejectUnauthorized: boolean };
    };
};

const dbIndexSource = readFileSync(path.join(__dirname, '..', 'db', 'index.ts'), 'utf8');

function withBaseEnv<T>(fn: () => T): T {
    const original = { ...process.env };
    process.env.DB_USER = 'gallery';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_NAME = 'gallery';
    try {
        return fn();
    } finally {
        process.env = original;
    }
}

describe('runtime MySQL SSL configuration', () => {
    it('loads the configured CA for non-local TLS connections', () => withBaseEnv(() => {
        const dir = mkdtempSync(path.join(tmpdir(), 'gallery-db-ca-'));
        const caPath = path.join(dir, 'ca.pem');
        writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n');

        const options = getMysqlConnectionOptions({ host: 'db.example.test', sslCa: caPath });

        expect(options.ssl).toEqual({
            ca: '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n',
            rejectUnauthorized: true,
        });
    }));

    it('fails before connecting when non-local TLS has no CA path', () => withBaseEnv(() => {
        delete process.env.DB_SSL_CA;
        delete process.env.DB_SSL;

        expect(() => getMysqlConnectionOptions({ host: 'db.example.test' }))
            .toThrow(/DB_SSL_CA is required/);
    }));

    it('keeps localhost and explicit DB_SSL=false connections without TLS config', () => withBaseEnv(() => {
        expect(getMysqlConnectionOptions({ host: '127.0.0.1' }).ssl).toBeUndefined();
        process.env.DB_SSL = 'false';
        expect(getMysqlConnectionOptions({ host: 'db.internal.test' }).ssl).toBeUndefined();
    }));

    it('uses the same DB_SSL_CA contract in the runtime db pool source', () => {
        expect(dbIndexSource).toContain("import { readFileSync } from \"node:fs\"");
        expect(dbIndexSource).toContain('process.env.DB_SSL_CA');
        expect(dbIndexSource).toContain("throw new Error('DB_SSL_CA is required for non-local DB connections unless DB_SSL=false')");
        expect(dbIndexSource).toContain("readFileSync(caPath, 'utf8')");
        expect(dbIndexSource).toContain('rejectUnauthorized: true');
    });
});
