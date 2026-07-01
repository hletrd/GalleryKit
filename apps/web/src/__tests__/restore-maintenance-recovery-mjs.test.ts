import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
