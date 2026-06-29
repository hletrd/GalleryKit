import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dbActionsPath = path.join(process.cwd(), 'src/app/[locale]/admin/db-actions.ts');

describe('restore/upload writer coordination', () => {
    it('holds the upload-processing contract lock during database restore', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        expect(source).toContain('acquireUploadProcessingContractLock');
        const dbRestoreLockIdx = source.indexOf('[LOCK_DB_RESTORE]');
        expect(dbRestoreLockIdx).toBeGreaterThan(-1);
        expect(source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)'))
            .toBeGreaterThan(dbRestoreLockIdx);
        expect(source.indexOf('if (!beginRestoreMaintenance())'))
            .toBeGreaterThan(source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)'));
        expect(source).toContain('await uploadContractLock?.release()');
    });

    it('holds the color-pipeline backfill lock during database restore', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        const uploadLockIdx = source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)');
        const backfillGetLockIdx = source.indexOf('[LOCK_COLOR_PIPELINE_BACKFILL]');
        const maintenanceIdx = source.indexOf('if (!beginRestoreMaintenance())');
        expect(uploadLockIdx).toBeGreaterThan(-1);
        expect(backfillGetLockIdx).toBeGreaterThan(uploadLockIdx);
        expect(maintenanceIdx).toBeGreaterThan(backfillGetLockIdx);
        expect(source).toContain('backfillLockHeld = true');
        expect(source).toContain("console.debug('RELEASE_LOCK (backfill restore finally) failed:', err)");
    });

    it('runs migrations after mysql import before reporting restore success', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        const mysqlSuccessIdx = source.indexOf('if (code === 0) {');
        const migrationIdx = source.indexOf('const migrationResult = await runPostRestoreMigrations(t)');
        const revalidateIdx = source.indexOf('revalidateAllAppData();', migrationIdx);
        expect(migrationIdx).toBeGreaterThan(mysqlSuccessIdx);
        expect(revalidateIdx).toBeGreaterThan(migrationIdx);
        expect(source).toContain("path.join(process.cwd(), 'scripts', 'migrate.js')");
        expect(source).toContain("path.join(process.cwd(), 'apps', 'web', 'scripts', 'migrate.js')");
    });

    it('releases the upload-processing contract lock exactly once (C3-AGG-01)', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        // Count occurrences of the release call on uploadContractLock.
        // After the C3-AGG-01 fix, the outer finally block no longer
        // has a redundant release — only the inner finally releases it.
        const releaseMatches = source.match(/uploadContractLock\?\.release\(\)/g);
        expect(releaseMatches).not.toBeNull();
        expect(releaseMatches!.length).toBe(1);

        // The single release must be inside the inner finally block
        // (the one that also nulls the reference).
        const innerFinallyIdx = source.indexOf('await uploadContractLock?.release()');
        const nullAssignmentIdx = source.indexOf('uploadContractLock = null', innerFinallyIdx);
        expect(nullAssignmentIdx).toBeGreaterThan(innerFinallyIdx);

        // Confirm the outer finally block does NOT contain a release call.
        // The outer finally starts after the inner finally closes.
        const outerFinallyMarker = 'C3-AGG-01';
        expect(source).toContain(outerFinallyMarker);
    });
});
