import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'restore-maintenance-recovery.mjs');
const CLEAR_CONFIRM_FLAG = '--confirm-clear-restore-maintenance';

function runRecovery(args: string[], markerPath: string) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_ENV: 'test',
            RESTORE_MAINTENANCE_MARKER_PATH: markerPath,
        },
    });
}

describe('restore-maintenance-recovery.mjs shipped command', () => {
    let tempDir: string;
    let markerPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'gk-restore-mjs-'));
        markerPath = join(tempDir, 'restore-maintenance.json');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('reports inactive status when the durable marker is absent', () => {
        const result = runRecovery(['status'], markerPath);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            markerPath,
            active: false,
        });
    });

    it('reports active status when the durable marker exists', () => {
        writeFileSync(markerPath, JSON.stringify({ active: true }));

        const result = runRecovery(['status'], markerPath);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            markerPath,
            active: true,
        });
    });

    it('refuses to clear without the explicit confirmation flag', () => {
        writeFileSync(markerPath, JSON.stringify({ active: true }));

        const result = runRecovery(['clear'], markerPath);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain(`Refusing to clear restore maintenance without ${CLEAR_CONFIRM_FLAG}.`);
        expect(existsSync(markerPath)).toBe(true);
    });

    it('clears the marker with the explicit confirmation flag', () => {
        mkdirSync(tempDir, { recursive: true });
        writeFileSync(markerPath, JSON.stringify({ active: true }));

        const result = runRecovery(['clear', CLEAR_CONFIRM_FLAG], markerPath);

        expect(result.status).toBe(0);
        expect(existsSync(markerPath)).toBe(false);
        expect(JSON.parse(result.stdout)).toEqual({
            markerPath,
            active: false,
        });
    });
});

// C7-22 (run-10 cycle 7b): the shipped .mjs hand-duplicates the marker-path
// derivation from restore-maintenance-durable.ts (it cannot import TS). This
// parity pin fails loudly if either side's filename constant, default-dir
// expression, or test-override hook drifts — this is the incident-recovery
// command the runbook depends on working under pressure. The unused
// scripts/restore-maintenance-recovery.ts twin was removed in the same
// change (zero references: package.json, Dockerfile, and tests all point at
// the .mjs).
describe('marker-path derivation parity with restore-maintenance-durable.ts (C7-22)', () => {
    const mjsSource = readFileSync(SCRIPT_PATH, 'utf8');
    const durableSource = readFileSync(
        join(process.cwd(), 'src', 'lib', 'restore-maintenance-durable.ts'),
        'utf8',
    );

    it('uses the same marker filename', () => {
        expect(mjsSource).toContain("const MARKER_FILENAME = 'restore-maintenance.json'");
        expect(durableSource).toContain("const RESTORE_MAINTENANCE_MARKER_FILENAME = 'restore-maintenance.json'");
    });

    it('uses the same default-directory expression (env override, prod /app/data, dev data)', () => {
        const defaultDirExpr = "configuredDir || (process.env.NODE_ENV === 'production' ? '/app/data' : 'data')";
        expect(mjsSource).toContain(defaultDirExpr);
        expect(durableSource).toContain(defaultDirExpr);
        expect(mjsSource).toContain('RESTORE_MAINTENANCE_DIR');
        expect(durableSource).toContain('RESTORE_MAINTENANCE_DIR');
    });

    it('honors the same test-override marker-path hook', () => {
        expect(mjsSource).toContain('RESTORE_MAINTENANCE_MARKER_PATH');
        expect(durableSource).toContain('RESTORE_MAINTENANCE_MARKER_PATH');
    });

    it('the dead .ts twin stays deleted (references must point at the .mjs)', () => {
        expect(existsSync(join(process.cwd(), 'scripts', 'restore-maintenance-recovery.ts'))).toBe(false);
    });
});
