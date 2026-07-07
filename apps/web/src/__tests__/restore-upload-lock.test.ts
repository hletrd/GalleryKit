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
        expect(source.indexOf('restoreMaintenanceStarted = beginDurableRestoreMaintenance({ allowExisting: true })'))
            .toBeGreaterThan(source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)'));
        expect(source).toContain('if (!restoreMaintenanceStarted)');
        expect(source).toContain('await uploadContractLock?.release()');
    });

    it('holds the color-pipeline backfill lock during database restore', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        const uploadLockIdx = source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)');
        const backfillGetLockIdx = source.indexOf('[LOCK_COLOR_PIPELINE_BACKFILL]');
        const maintenanceIdx = source.indexOf('restoreMaintenanceStarted = beginDurableRestoreMaintenance({ allowExisting: true })');
        expect(uploadLockIdx).toBeGreaterThan(-1);
        expect(backfillGetLockIdx).toBeGreaterThan(uploadLockIdx);
        expect(maintenanceIdx).toBeGreaterThan(backfillGetLockIdx);
        expect(source).toContain('backfillLockHeld = true');
        expect(source).toContain("await lockReleaser.release(LOCK_COLOR_PIPELINE_BACKFILL, 'backfill restore finally')");
    });

    it('holds the semantic embedding backfill lock during database restore', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        const colorLockIdx = source.indexOf('[LOCK_COLOR_PIPELINE_BACKFILL]');
        const semanticLockIdx = source.indexOf('[LOCK_SEMANTIC_EMBEDDING_BACKFILL]');
        const maintenanceIdx = source.indexOf('restoreMaintenanceStarted = beginDurableRestoreMaintenance({ allowExisting: true })');
        expect(colorLockIdx).toBeGreaterThan(-1);
        expect(semanticLockIdx).toBeGreaterThan(colorLockIdx);
        expect(maintenanceIdx).toBeGreaterThan(semanticLockIdx);
        expect(source).toContain('semanticBackfillLockHeld = true');
        expect(source).toContain("await lockReleaser.release(LOCK_SEMANTIC_EMBEDDING_BACKFILL, 'semantic-backfill restore finally')");
    });

    it('runs migrations after mysql import before reporting restore success', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        const mysqlSuccessIdx = source.indexOf('if (code === 0) {');
        const migrationIdx = source.indexOf('migrationResult = await runPostRestoreMigrations(t)');
        const revalidateIdx = source.indexOf('revalidateAllAppData();', migrationIdx);
        expect(migrationIdx).toBeGreaterThan(mysqlSuccessIdx);
        expect(revalidateIdx).toBeGreaterThan(migrationIdx);
        expect(source).toContain("path.join(process.cwd(), 'scripts', 'migrate.js')");
        expect(source).toContain("path.join(process.cwd(), 'apps', 'web', 'scripts', 'migrate.js')");
        expect(source).toContain("console.error('post-restore migrate setup error:', err)");
    });

    it('has setup-fallback cleanup for restore locks acquired before maintenance begins', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        expect(source).toContain('let dbRestoreLockHeld = false');
        expect(source).toContain('dbRestoreLockHeld = true');
        expect(source).toContain('upload-processing contract release (setup fallback) failed');
        expect(source).toContain("await lockReleaser.release(LOCK_COLOR_PIPELINE_BACKFILL, 'backfill setup fallback')");
        expect(source).toContain("await lockReleaser.release(LOCK_DB_RESTORE, 'setup fallback')");
        expect(source).toContain('lockReleaser.finish()');
    });

    it('keeps restore maintenance active after post-restore migration failure', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        expect(source).toContain('let keepRestoreMaintenance = false');
        expect(source).toContain('keepRestoreMaintenance = restoreResult.keepMaintenance === true');
        expect(source).toContain('if (restoreLifecycleVerified || !keepRestoreMaintenance)');
        expect(source).toContain('keepMaintenance: true');
    });

    it('keeps restore maintenance active after mysql import handoff failures', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        const failRestoreIdx = source.indexOf('const failRestore = (error: string');
        const failResolveIdx = source.indexOf('resolve({ success: false, error, keepMaintenance: true })', failRestoreIdx);
        const nonzeroIdx = source.indexOf("t('restoreExitedWithCode'", failRestoreIdx);
        const nonzeroWindow = source.slice(nonzeroIdx, nonzeroIdx + 180);

        expect(failRestoreIdx).toBeGreaterThan(-1);
        expect(failResolveIdx).toBeGreaterThan(failRestoreIdx);
        expect(nonzeroWindow).toContain('keepMaintenance: true');
    });

    it('does not reject corrective restore attempts before advisory-lock acquisition while maintenance is active', () => {
        const source = readFileSync(dbActionsPath, 'utf8');
        const functionStart = source.indexOf('export async function restoreDatabase');
        const getConnectionIdx = source.indexOf('const conn = await connection.getConnection()', functionStart);
        const setupWindow = source.slice(functionStart, getConnectionIdx);

        expect(setupWindow).not.toContain('getRestoreMaintenanceMessage');
        expect(source).toContain('beginDurableRestoreMaintenance({ allowExisting: true })');
    });

    it('resumes quiesced image-processing rows when restore exits maintenance after failure', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        const flagIdx = source.indexOf('let imageQueueQuiesced = false');
        const quiesceIdx = source.indexOf('await quiesceImageProcessingQueueForRestore()');
        const setIdx = source.indexOf('imageQueueQuiesced = true');
        const drainIdx = source.indexOf('await drainBackgroundDbWritesForRestore()');
        const maintenanceExitIdx = source.indexOf('if (restoreLifecycleVerified || !keepRestoreMaintenance)');
        const resumeConditionIdx = source.indexOf('if (restoreLifecycleVerified || imageQueueQuiesced)');
        const resumeIdx = source.indexOf('await resumeImageProcessingQueueAfterRestore()');

        expect(flagIdx).toBeGreaterThan(-1);
        expect(quiesceIdx).toBeGreaterThan(flagIdx);
        expect(setIdx).toBeGreaterThan(quiesceIdx);
        expect(drainIdx).toBeGreaterThan(setIdx);
        expect(maintenanceExitIdx).toBeGreaterThan(setIdx);
        expect(resumeConditionIdx).toBeGreaterThan(maintenanceExitIdx);
        expect(resumeIdx).toBeGreaterThan(resumeConditionIdx);
    });
});
