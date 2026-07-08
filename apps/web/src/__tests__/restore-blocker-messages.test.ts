import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';

// C2-45 (run-10 c2): restoreDatabase() sequentially attempts four
// non-blocking advisory-lock acquisitions (the restore lock itself, the
// upload-processing-contract lock, the color-pipeline backfill lock,
// semantic-embedding backfill lock, and alt-text backfill lock) and previously returned the
// IDENTICAL restoreInProgress message for all four, misleading operators
// when the real blocker was a backfill or an in-flight upload. This file
// pins the branch -> message-key mapping via source-contract assertions
// (matching the style of restore-upload-lock.test.ts) and the presence of
// the new keys in both locales.
const dbActionsPath = path.join(process.cwd(), 'src/app/[locale]/admin/db-actions.ts');

describe('restore blocker messages (C2-45)', () => {
    it('keeps restoreInProgress for the literal concurrent-restore lock branch', () => {
        const source = readFileSync(dbActionsPath, 'utf8');
        const functionStart = source.indexOf('export async function restoreDatabase');
        const dbRestoreLockIdx = source.indexOf('[LOCK_DB_RESTORE]', functionStart);
        const acquiredCheckIdx = source.indexOf('if (!isAdvisoryLockAcquired(acquired)) {', dbRestoreLockIdx);
        const uploadContractLockIdx = source.indexOf('acquireUploadProcessingContractLock(0)', functionStart);

        expect(functionStart).toBeGreaterThan(-1);
        expect(dbRestoreLockIdx).toBeGreaterThan(functionStart);
        expect(acquiredCheckIdx).toBeGreaterThan(dbRestoreLockIdx);
        expect(uploadContractLockIdx).toBeGreaterThan(acquiredCheckIdx);

        const branchWindow = source.slice(acquiredCheckIdx, uploadContractLockIdx);
        expect(branchWindow).toContain("t('restoreInProgress')");
        expect(branchWindow).not.toContain('restoreBlockedByUpload');
        expect(branchWindow).not.toContain('restoreBlockedByBackfill');
    });

    it('maps the upload-processing-contract lock branch to restoreBlockedByUpload', () => {
        const source = readFileSync(dbActionsPath, 'utf8');
        const uploadContractLockIdx = source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)');
        const backfillGetLockIdx = source.indexOf('[LOCK_COLOR_PIPELINE_BACKFILL]');

        expect(uploadContractLockIdx).toBeGreaterThan(-1);
        expect(backfillGetLockIdx).toBeGreaterThan(uploadContractLockIdx);

        const branchWindow = source.slice(uploadContractLockIdx, backfillGetLockIdx);
        expect(branchWindow).toContain("if (!uploadContractLock) {");
        expect(branchWindow).toContain("t('restoreBlockedByUpload')");
        expect(branchWindow).not.toContain("t('restoreInProgress')");
    });

    it('maps the color-pipeline backfill lock branch to restoreBlockedByBackfill', () => {
        const source = readFileSync(dbActionsPath, 'utf8');
        const backfillGetLockIdx = source.indexOf('[LOCK_COLOR_PIPELINE_BACKFILL]');
        const semanticGetLockIdx = source.indexOf('[LOCK_SEMANTIC_EMBEDDING_BACKFILL]');

        expect(backfillGetLockIdx).toBeGreaterThan(-1);
        expect(semanticGetLockIdx).toBeGreaterThan(backfillGetLockIdx);

        const branchWindow = source.slice(backfillGetLockIdx, semanticGetLockIdx);
        expect(branchWindow).toContain('if (!isAdvisoryLockAcquired(backfillLockAcquired)) {');
        expect(branchWindow).toContain("t('restoreBlockedByBackfill')");
        expect(branchWindow).not.toContain("t('restoreInProgress')");
    });

    it('maps the semantic-embedding backfill lock branch to restoreBlockedByBackfill', () => {
        const source = readFileSync(dbActionsPath, 'utf8');
        const semanticGetLockIdx = source.indexOf('[LOCK_SEMANTIC_EMBEDDING_BACKFILL]');
        const altTextGetLockIdx = source.indexOf('[LOCK_ALT_TEXT_BACKFILL]');

        expect(semanticGetLockIdx).toBeGreaterThan(-1);
        expect(altTextGetLockIdx).toBeGreaterThan(semanticGetLockIdx);

        const branchWindow = source.slice(semanticGetLockIdx, altTextGetLockIdx);
        expect(branchWindow).toContain('if (!isAdvisoryLockAcquired(semanticBackfillLockAcquired)) {');
        expect(branchWindow).toContain("t('restoreBlockedByBackfill')");
        expect(branchWindow).not.toContain("t('restoreInProgress')");
    });

    it('maps the alt-text backfill lock branch to restoreBlockedByBackfill', () => {
        const source = readFileSync(dbActionsPath, 'utf8');
        const altTextGetLockIdx = source.indexOf('[LOCK_ALT_TEXT_BACKFILL]');
        const maintenanceIdx = source.indexOf('restoreMaintenanceStarted = beginDurableRestoreMaintenance({ allowExisting: true })');

        expect(altTextGetLockIdx).toBeGreaterThan(-1);
        expect(maintenanceIdx).toBeGreaterThan(altTextGetLockIdx);

        const branchWindow = source.slice(altTextGetLockIdx, maintenanceIdx);
        expect(branchWindow).toContain('if (!isAdvisoryLockAcquired(altTextBackfillLockAcquired)) {');
        expect(branchWindow).toContain("t('restoreBlockedByBackfill')");
        expect(branchWindow).not.toContain("t('restoreInProgress')");
    });

    it('defines restoreBlockedByUpload and restoreBlockedByBackfill in both locales under serverActions', () => {
        expect(enMessages.serverActions).toHaveProperty('restoreBlockedByUpload');
        expect(enMessages.serverActions).toHaveProperty('restoreBlockedByBackfill');
        expect(koMessages.serverActions).toHaveProperty('restoreBlockedByUpload');
        expect(koMessages.serverActions).toHaveProperty('restoreBlockedByBackfill');

        expect(typeof enMessages.serverActions.restoreBlockedByUpload).toBe('string');
        expect(typeof enMessages.serverActions.restoreBlockedByBackfill).toBe('string');
        expect(typeof koMessages.serverActions.restoreBlockedByUpload).toBe('string');
        expect(typeof koMessages.serverActions.restoreBlockedByBackfill).toBe('string');

        // Distinct from the pre-existing restoreInProgress copy and from
        // each other, so operators actually see three different messages.
        expect(enMessages.serverActions.restoreBlockedByUpload)
            .not.toBe(enMessages.serverActions.restoreInProgress);
        expect(enMessages.serverActions.restoreBlockedByBackfill)
            .not.toBe(enMessages.serverActions.restoreInProgress);
        expect(enMessages.serverActions.restoreBlockedByUpload)
            .not.toBe(enMessages.serverActions.restoreBlockedByBackfill);
    });
});
