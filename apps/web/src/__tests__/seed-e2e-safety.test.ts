import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const seedSource = readFileSync(path.join(process.cwd(), 'scripts/seed-e2e.ts'), 'utf8');
const mainSource = seedSource.slice(seedSource.indexOf('async function main()'));
const e2eServerSource = readFileSync(path.join(process.cwd(), 'scripts/run-e2e-server.mjs'), 'utf8');
const e2eServerMainSource = e2eServerSource.slice(e2eServerSource.indexOf('async function main()'));
const workflowSource = readFileSync(path.join(process.cwd(), '..', '..', '.github/workflows/quality.yml'), 'utf8');

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

    it('keeps the CI E2E database name disposable', () => {
        expect(workflowSource).toContain('MYSQL_DATABASE: gallery_ci');
        expect(workflowSource).toContain('DB_NAME: gallery_ci');
        expect(workflowSource).not.toContain('MYSQL_DATABASE: gallery\n');
        expect(workflowSource).not.toContain('DB_NAME: gallery\n');
    });

    it('runs the same disposable database guard before E2E init/migration', () => {
        const loadEnvIdx = e2eServerMainSource.indexOf('loadDotenvAsData();');
        const guardIdx = e2eServerMainSource.indexOf('assertSafeE2eDatabase();');
        const initIdx = e2eServerMainSource.indexOf("await run('npm', ['run', 'init'])");

        expect(e2eServerSource).toContain('DISPOSABLE_DB_NAME_PATTERN');
        expect(e2eServerSource).toContain('E2E_ALLOW_DESTRUCTIVE_SEED');
        expect(e2eServerSource).toContain('CI=true alone is not sufficient');
        expect(loadEnvIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(loadEnvIdx);
        expect(guardIdx).toBeLessThan(initIdx);
    });
});
