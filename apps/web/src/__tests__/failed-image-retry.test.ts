/**
 * R10-H2: Permanently failed images visible to admin with retry capability.
 *
 * Fixture-style test that verifies the source-level invariants of the
 * failure-persistence and retry flow. Mocking the full queue worker + DB
 + server action lifecycle is fragile; the regression risk is a refactor
 * that removes the processing_error persistence, the failed_at timestamp,
 * or the retry action's cleanup — exactly what fixture inspection catches.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const queuePath = path.join(__dirname, '..', 'lib', 'image-queue.ts');
const queueSource = fs.readFileSync(queuePath, 'utf8');

const dataPath = path.join(__dirname, '..', 'lib', 'data.ts');
const dataSource = fs.readFileSync(dataPath, 'utf8');

const actionsPath = path.join(__dirname, '..', 'app', 'actions', 'images.ts');
const actionsSource = fs.readFileSync(actionsPath, 'utf8');

describe('R10-H2: failed image persistence and retry', () => {
    describe('image-queue.ts failure persistence', () => {
        it('persists processing_error to DB when MAX_RETRIES exceeded', () => {
            // The failure path must update the images table with the error message.
            expect(queueSource).toMatch(/db\.update\s*\(\s*images\s*\)/);
            expect(queueSource).toMatch(/processing_error:\s*truncatedError/);
        });

        it('persists failed_at timestamp to DB when MAX_RETRIES exceeded', () => {
            // The failure path must record when the permanent failure occurred.
            // R4C2 COR-R4C2-01: the value MUST be a MySQL DATETIME literal via
            // toMySqlDateTime — the previous `new Date().toISOString()` form
            // (which this assertion used to pin) carries a trailing `Z` that
            // MySQL strict mode rejects with ER 1292, so the persistence this
            // suite exists to lock never actually happened in production.
            expect(queueSource).toMatch(/failed_at:\s*toMySqlDateTime\s*\(\s*new\s+Date\s*\(\s*\)\s*\)/);
            expect(queueSource).not.toMatch(/failed_at:\s*new\s+Date\(\)\s*\.toISOString\(\)/);
        });

        it('truncates processing_error to 512 chars before DB write', () => {
            // The schema defines processing_error as varchar(512).
            expect(queueSource).toMatch(/truncatedError\s*=\s*lastErrorMsg\.length\s*>\s*512/);
            expect(queueSource).toMatch(/lastErrorMsg\.slice\s*\(\s*0\s*,\s*512\s*\)/);
        });

        it('clears processing_error and failed_at on successful processing', () => {
            // Success path must null out any prior failure state.
            expect(queueSource).toMatch(/processing_error:\s*null/);
            expect(queueSource).toMatch(/failed_at:\s*null/);
        });
    });

    describe('data.ts failed image query', () => {
        it('exports getFailedImages function', () => {
            expect(dataSource).toMatch(/export\s+async\s+function\s+getFailedImages/);
        });

        it('queries for processed=false AND processing_error IS NOT NULL', () => {
            // Must only return images that are both unprocessed and have an error.
            expect(dataSource).toMatch(/eq\s*\(\s*images\.processed\s*,\s*false\s*\)/);
            expect(dataSource).toMatch(/isNotNull\s*\(\s*images\.processing_error\s*\)/);
        });

        it('orders by failed_at descending (newest first)', () => {
            expect(dataSource).toMatch(/orderBy\s*\(\s*desc\s*\(\s*images\.failed_at\s*\)\s*\)/);
        });
    });

    describe('actions/images.ts retry server action', () => {
        it('exports retryFailedImage server action', () => {
            expect(actionsSource).toMatch(/export\s+async\s+function\s+retryFailedImage/);
        });

        it('requires same-origin admin before proceeding', () => {
            // R10-H2: mutating server action must guard with requireSameOriginAdmin.
            expect(actionsSource).toMatch(/await\s+requireSameOriginAdmin\s*\(\s*\)/);
        });

        it('selects image with processed=false AND processing_error IS NOT NULL', () => {
            // Must only retry images in the failed state.
            expect(actionsSource).toMatch(/eq\s*\(\s*images\.processed\s*,\s*false\s*\)/);
            expect(actionsSource).toMatch(/isNotNull\s*\(\s*images\.processing_error\s*\)/);
        });

        it('rebuilds a fresh processing snapshot before re-enqueue', () => {
            expect(actionsSource).toContain('getGalleryConfigStrict');
            expect(actionsSource).toContain('createProcessingSettingsSnapshot(retryConfig)');
            expect(actionsSource).toContain('const serializedSnapshot = serializeProcessingSettingsSnapshot(processingSettingsSnapshot)');
            expect(actionsSource).toMatch(/processing_settings_json:\s*serializedSnapshot/);
        });

        it('removes ID from permanentlyFailedIds before re-enqueue', () => {
            // Must clear the in-memory exclusion so bootstrap finds the image.
            expect(actionsSource).toMatch(/state\.permanentlyFailedIds\.delete\s*\(\s*id\s*\)/);
        });

        it('calls enqueueImageProcessing with the full job payload', () => {
            expect(actionsSource).toMatch(/enqueueImageProcessing\s*\(\s*\{/);
            expect(actionsSource).toMatch(/filenameOriginal:\s*image\.filename_original/);
            expect(actionsSource).toMatch(/quality:\s*processingSettingsSnapshot\.quality/);
            expect(actionsSource).toMatch(/imageSizes:\s*processingSettingsSnapshot\.imageSizes/);
            expect(actionsSource).toMatch(/forceSrgbDerivatives:\s*processingSettingsSnapshot\.forceSrgbDerivatives/);
            expect(actionsSource).toMatch(/wideGamutJpegChroma:\s*processingSettingsSnapshot\.wideGamutJpegChroma/);
            expect(actionsSource).toMatch(/avifEffort:\s*processingSettingsSnapshot\.avifEffort/);
            expect(actionsSource).toMatch(/sdrJpegChroma:\s*processingSettingsSnapshot\.sdrJpegChroma/);
            expect(actionsSource).toMatch(/wideGamutMaxSourcePixels:\s*processingSettingsSnapshot\.wideGamutMaxSourcePixels/);
            expect(actionsSource).toMatch(/autoAltTextEnabled:\s*processingSettingsSnapshot\.autoAltTextEnabled/);
            expect(actionsSource).toMatch(/semanticSearchMode:\s*processingSettingsSnapshot\.semanticSearchMode/);
            expect(actionsSource).toMatch(/colorSignals:\s*\{/);
        });

        it('restores a visible failed state when the queue rejects the retry job', () => {
            expect(actionsSource).toContain('const enqueued = enqueueImageProcessing');
            expect(actionsSource).toMatch(/if\s*\(\s*!enqueued\s*\)\s*\{/);
            expect(actionsSource).toMatch(/processing_error:\s*retryError/);
            expect(actionsSource).toMatch(/failed_at:\s*toMySqlDateTime\s*\(\s*new\s+Date\s*\(\s*\)\s*\)/);
            expect(actionsSource).toMatch(/processing_settings_json:\s*null/);
            expect(actionsSource).toContain('state.permanentlyFailedIds.add(id)');
            expect(actionsSource).toContain("return { error: t('failedToRetryImage') }");
        });

        it('returns { success: true } on successful retry initiation', () => {
            expect(actionsSource).toMatch(/return\s*\{\s*success:\s*true\s+as\s+const\s*\}/);
        });
    });
});
