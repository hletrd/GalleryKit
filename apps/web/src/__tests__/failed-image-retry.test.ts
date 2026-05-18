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
            expect(queueSource).toMatch(/failed_at:\s*new\s+Date\(\)\s*\.toISOString\(\)/);
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

        it('clears processing_error and failed_at in DB before re-enqueue', () => {
            expect(actionsSource).toMatch(/\.set\s*\(\s*\{\s*processing_error:\s*null\s*,\s*failed_at:\s*null\s*\}\s*\)/);
        });

        it('removes ID from permanentlyFailedIds before re-enqueue', () => {
            // Must clear the in-memory exclusion so bootstrap finds the image.
            expect(actionsSource).toMatch(/state\.permanentlyFailedIds\.delete\s*\(\s*id\s*\)/);
        });

        it('calls enqueueImageProcessing with the full job payload', () => {
            expect(actionsSource).toMatch(/enqueueImageProcessing\s*\(\s*\{/);
            expect(actionsSource).toMatch(/filenameOriginal:\s*image\.filename_original/);
            expect(actionsSource).toMatch(/colorSignals:\s*\{/);
        });

        it('returns { success: true } on successful retry initiation', () => {
            expect(actionsSource).toMatch(/return\s*\{\s*success:\s*true\s+as\s+const\s*\}/);
        });
    });
});
