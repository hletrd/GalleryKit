import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const scriptSource = readFileSync(path.join(appRoot, 'scripts/check-schema-convergence.mjs'), 'utf8');
const workflowSource = readFileSync(path.join(repoRoot, '.github/workflows/quality.yml'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const journal = JSON.parse(readFileSync(path.join(appRoot, 'drizzle/meta/_journal.json'), 'utf8'));
const timelinePageSource = readFileSync(
    path.join(appRoot, 'src/app/[locale]/(public)/timeline/page.tsx'),
    'utf8',
);

describe('schema convergence CI gate', () => {
    it('pins the convergence probe to the latest committed migration', () => {
        const latestTag = journal.entries.at(-1)?.tag;
        expect(scriptSource).toContain(`EXPECTED_LATEST_MIGRATION = '${latestTag}'`);
        expect(scriptSource).toContain(`'${latestTag}': {`);
        expect(scriptSource).toContain('No explicit prior-release upgrade fixture exists');
    });

    it('executes the real pending migration path and checks recorded hashes', () => {
        expect(scriptSource).toContain('getAllJournalMigrations');
        expect(scriptSource).toContain('await runMigrations(connection, migrationsFolder, migrations)');
        expect(scriptSource).toContain('await assertMigrationHashesRecorded(connection, pending)');
        expect(scriptSource).toContain('Real pending migration upgrade did not match');
    });

    it('challenges same-named definition drift and live capture-date semantics', () => {
        expect(scriptSource).toContain('simulateDefinitionDrift');
        expect(scriptSource).toContain('ADD COLUMN capture_month tinyint unsigned NULL');
        expect(scriptSource).toContain('INVISIBLE');
        expect(scriptSource).toContain('verifyCaptureDateSemantics');
        expect(scriptSource).toContain('2024-02-29 12:00:00');
        expect(scriptSource).toContain('9999-12-31 23:59:59');
        expect(scriptSource).toContain('capture_year IS NOT NULL');
        expect(scriptSource).toContain(`includes('"using_index": true')`);
        expect(scriptSource).toContain('LIMIT 6');
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

    it('starts an explicit-year photo query with the other request-time work', () => {
        expect(timelinePageSource).toContain('const requestedTimelinePromise = requestedYear !== null');
        expect(timelinePageSource).toContain('requestedTimelinePromise,');
        expect(timelinePageSource).toContain('years.includes(requestedYear)');
        expect(timelinePageSource).toContain('(requestedYearIsAvailable ? requestedTimeline : null)');
    });
});
