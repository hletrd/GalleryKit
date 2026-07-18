import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const scriptSource = readFileSync(path.join(appRoot, 'scripts/check-schema-convergence.mjs'), 'utf8');
const workflowSource = readFileSync(path.join(repoRoot, '.github/workflows/quality.yml'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const journal = JSON.parse(readFileSync(path.join(appRoot, 'drizzle/meta/_journal.json'), 'utf8'));

describe('schema convergence CI gate', () => {
    it('pins the convergence probe to the latest committed migration', () => {
        const latestTag = journal.entries.at(-1)?.tag;
        expect(scriptSource).toContain(`EXPECTED_LATEST_MIGRATION = '${latestTag}'`);
    });

    it('fails closed unless both a local host and disposable database are explicit', () => {
        expect(scriptSource).toContain("SCHEMA_CONVERGENCE_ALLOW_MUTATION !== 'true'");
        expect(scriptSource).toContain('LOCAL_HOSTS.has(options.host)');
        expect(scriptSource).toContain('SAFE_DATABASE_NAME.test(options.database)');
    });

    it('runs after database initialization in CI with its mutation opt-in', () => {
        expect(packageJson.scripts['check:schema-convergence']).toBe('node scripts/check-schema-convergence.mjs');
        const initOffset = workflowSource.indexOf('name: Initialize database');
        const gateOffset = workflowSource.indexOf('name: Verify schema convergence');
        expect(initOffset).toBeGreaterThanOrEqual(0);
        expect(gateOffset).toBeGreaterThan(initOffset);
        expect(workflowSource.slice(gateOffset)).toContain('SCHEMA_CONVERGENCE_ALLOW_MUTATION: "true"');
    });
});
