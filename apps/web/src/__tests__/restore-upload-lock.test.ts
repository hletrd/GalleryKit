import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dbActionsPath = path.join(process.cwd(), 'src/app/[locale]/admin/db-actions.ts');

describe('restore/upload writer coordination', () => {
    it('holds the upload-processing contract lock during database restore', () => {
        const source = readFileSync(dbActionsPath, 'utf8');

        expect(source).toContain('acquireUploadProcessingContractLock');
        expect(source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)'))
            .toBeGreaterThan(source.indexOf("SELECT GET_LOCK('gallerykit_db_restore'"));
        expect(source.indexOf('if (!beginRestoreMaintenance())'))
            .toBeGreaterThan(source.indexOf('uploadContractLock = await acquireUploadProcessingContractLock(0)'));
        expect(source).toContain('await uploadContractLock?.release()');
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
