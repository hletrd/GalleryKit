/**
 * plan-315 item 19 / TEST-R5C1-09 (pulled forward this cycle as AGG-R5C3
 * escalation TEST-R5C3-03 + plan-322 rider): pin EVERY advisory-lock constant
 * and the per-image lock-name builder to its documented string.
 *
 * WHY ALL FIVE — the advisory-lock names are part of the CLAUDE.md cross-instance
 * contract ("Advisory-lock scope note"): they are scoped to the MySQL SERVER, so
 * a silent rename would break serialization between two GalleryKit instances (or
 * between the in-app backfill runner and the sidecar script) without any compile
 * error. Only LOCK_ADMIN_DELETE was previously pinned (via a source-scan in
 * admin-delete-lock-source.test.ts); the other four + getImageProcessingLockName
 * had no guard. This behavioral pin imports the real constants so a rename fails
 * the suite immediately.
 *
 * These strings are documented in CLAUDE.md (Race Condition Protections +
 * Migration runbook). Changing one here REQUIRES updating CLAUDE.md and every
 * acquire/release site in lock-step.
 */

import { describe, expect, it } from 'vitest';
import {
    LOCK_DB_RESTORE,
    LOCK_UPLOAD_PROCESSING_CONTRACT,
    LOCK_TOPIC_ROUTE_SEGMENTS,
    LOCK_ADMIN_DELETE,
    LOCK_COLOR_PIPELINE_BACKFILL,
    getImageProcessingLockName,
} from '@/lib/advisory-locks';

describe('advisory lock name contract', () => {
    it('pins all five global LOCK_* constants to their documented strings', () => {
        expect(LOCK_DB_RESTORE).toBe('gallerykit_db_restore');
        expect(LOCK_UPLOAD_PROCESSING_CONTRACT).toBe('gallerykit_upload_processing_contract');
        expect(LOCK_TOPIC_ROUTE_SEGMENTS).toBe('gallerykit_topic_route_segments');
        expect(LOCK_ADMIN_DELETE).toBe('gallerykit_admin_delete');
        expect(LOCK_COLOR_PIPELINE_BACKFILL).toBe('gallerykit_color_pipeline_backfill');
    });

    it('builds the per-image processing lock name as gallerykit:image-processing:{jobId}', () => {
        expect(getImageProcessingLockName(42)).toBe('gallerykit:image-processing:42');
        expect(getImageProcessingLockName(1)).toBe('gallerykit:image-processing:1');
        expect(getImageProcessingLockName(0)).toBe('gallerykit:image-processing:0');
    });

    it('keeps all global lock names distinct (no two operations share a lock)', () => {
        const names = [
            LOCK_DB_RESTORE,
            LOCK_UPLOAD_PROCESSING_CONTRACT,
            LOCK_TOPIC_ROUTE_SEGMENTS,
            LOCK_ADMIN_DELETE,
            LOCK_COLOR_PIPELINE_BACKFILL,
        ];
        expect(new Set(names).size).toBe(names.length);
    });

    it('namespaces the per-image lock distinctly from the global locks', () => {
        const perImage = getImageProcessingLockName(1);
        const globals = [
            LOCK_DB_RESTORE,
            LOCK_UPLOAD_PROCESSING_CONTRACT,
            LOCK_TOPIC_ROUTE_SEGMENTS,
            LOCK_ADMIN_DELETE,
            LOCK_COLOR_PIPELINE_BACKFILL,
        ];
        expect(globals).not.toContain(perImage);
    });
});
