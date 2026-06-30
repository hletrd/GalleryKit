import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const seedSource = readFileSync(path.join(process.cwd(), 'scripts/seed-e2e.ts'), 'utf8');
const mainSource = seedSource.slice(seedSource.indexOf('async function main()'));

describe('seed-e2e destructive safety guard', () => {
    it('requires explicit opt-in or a disposable DB name before destructive cleanup', () => {
        const guardIdx = mainSource.indexOf('E2E_ALLOW_DESTRUCTIVE_SEED');
        const firstDbDeleteIdx = mainSource.indexOf('db.delete(');
        const firstFileRemoveIdx = mainSource.indexOf('fs.rm(');

        expect(guardIdx).toBeGreaterThan(-1);
        expect(mainSource).toContain('DISPOSABLE_DB_NAME_PATTERN');
        expect(mainSource).not.toContain("process.env.CI === 'true'");
        expect(mainSource).toContain('CI=true alone is not sufficient');
        expect(guardIdx).toBeLessThan(firstDbDeleteIdx);
        expect(guardIdx).toBeLessThan(firstFileRemoveIdx);
    });
});
