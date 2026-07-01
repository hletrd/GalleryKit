import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(__dirname, '..', '..');
const repoRoot = resolve(appRoot, '..', '..');
const readApp = (rel: string) => readFileSync(resolve(appRoot, rel), 'utf8');
const readRepo = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

describe('cycle 71 sidecar restore-maintenance guards', () => {
    it('exposes a script-safe durable restore-maintenance assertion', () => {
        const source = readApp('src/lib/restore-maintenance-durable.ts');
        expect(source).toContain('export function assertNoDurableRestoreMaintenanceForScript');
        expect(source).toContain('isDurableRestoreMaintenanceMarked()');
        expect(source).toContain('Refusing sidecar writes');
    });

    it('guards both DB-mutating sidecar backfills before and after advisory locks', () => {
        const scripts = [
            readApp('scripts/backfill-color-pipeline.ts'),
            readApp('scripts/backfill-clip-embeddings.ts'),
        ];

        for (const source of scripts) {
            expect(source).toContain("import { assertNoDurableRestoreMaintenanceForScript } from '../src/lib/restore-maintenance-durable'");
            const firstGuard = source.indexOf('assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME)');
            const lockQuery = source.indexOf('SELECT GET_LOCK');
            expect(firstGuard).toBeGreaterThanOrEqual(0);
            expect(lockQuery).toBeGreaterThan(firstGuard);
            expect(source.match(/assertNoDurableRestoreMaintenanceForScript\(SCRIPT_NAME\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
        }
    });
});

describe('cycle 71 deploy/env documentation contracts', () => {
    it('keeps disk-full SSH recovery config-driven', () => {
        const claude = readRepo('CLAUDE.md');
        expect(claude).not.toContain('ssh ubuntu@atik.kr');
        expect(claude).toContain('configured DEPLOY_USER@DEPLOY_HOST');
        expect(claude).toContain('DEPLOY_KEY when set');
    });

    it('surfaces verified MySQL CLI TLS CA in the copied env template', () => {
        const envExample = readApp('.env.local.example');
        expect(envExample).toContain('DB_SSL_CA=/path/to/ca.pem');
        expect(envExample.indexOf('DB_SSL_CA=/path/to/ca.pem')).toBeLessThan(envExample.indexOf('DB_SSL=false'));
    });
});
