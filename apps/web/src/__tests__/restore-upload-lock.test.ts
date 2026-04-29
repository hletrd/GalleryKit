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
});
