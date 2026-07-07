import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Drizzle Kit TLS source contract', () => {
    it('keeps Drizzle Kit TLS CA handling aligned with runtime and scripts', () => {
        const config = readFileSync(resolve(__dirname, '../../drizzle.config.ts'), 'utf8');

        expect(config).toContain('readFileSync');
        expect(config).toContain('DB_SSL_CA is required for non-local DB connections unless DB_SSL=false');
        expect(config).toContain("ca: readFileSync(caPath, 'utf8')");
        expect(config).toContain('rejectUnauthorized: true');
    });
});
