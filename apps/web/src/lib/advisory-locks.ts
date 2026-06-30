/**
 * Centralized registry for MySQL advisory lock names.
 *
 * C9-MED-03: Advisory lock names were previously scattered as inline string
 * literals across multiple files. Centralizing them reduces the risk of
 * accidental name collisions and improves auditability.
 *
 * IMPORTANT (C8R-RPL-06 / AGG8R-05; backfill added AGG-R8-12): MySQL advisory
 * lock names are scoped to the MySQL SERVER, not to an individual database. Two
 * GalleryKit instances pointed at the same MySQL server share the same lock
 * namespace and will serialize each other's restores, upload-contract changes,
 * topic renames, admin-user deletes, color-pipeline backfill runs, semantic
 * embedding backfill runs, and image-processing claims
 * across tenants. Run one GalleryKit per MySQL server — or prefix advisory-lock
 * names with a per-instance identifier if multi-tenant co-location is required.
 */

/** Lock serializes database restore operations (one restore at a time). */
export const LOCK_DB_RESTORE = 'gallerykit_db_restore';

/** Lock serializes upload-processing contract changes (image_sizes, strip_gps). */
export const LOCK_UPLOAD_PROCESSING_CONTRACT = 'gallerykit_upload_processing_contract';

/** Lock serializes topic slug/alias mutations to prevent route-segment races. */
export const LOCK_TOPIC_ROUTE_SEGMENTS = 'gallerykit_topic_route_segments';

/**
 * Lock serializes all admin-user deletions.
 *
 * The invariant being protected is table-wide: at least one admin account must
 * remain. Target-scoped locks let two concurrent deletes of different users
 * both observe "more than one admin" and delete the final two accounts.
 */
export const LOCK_ADMIN_DELETE = 'gallerykit_admin_delete';

/**
 * Lock serializes per-image processing claims so two queue workers
 * cannot both convert the same upload (C8R-RPL-06).
 */
export const getImageProcessingLockName = (jobId: number) =>
    `gallerykit:image-processing:${jobId}`;

/** Lock serializes color pipeline backfill operations (one backfill at a time). */
export const LOCK_COLOR_PIPELINE_BACKFILL = 'gallerykit_color_pipeline_backfill';

/** Lock serializes CLIP embedding backfill operations against database restore. */
export const LOCK_SEMANTIC_EMBEDDING_BACKFILL = 'gallerykit_semantic_embedding_backfill';

/**
 * mysql2 can surface MySQL integer scalar results as number, bigint, or string
 * depending on connection flags and server metadata. Treat only the exact
 * advisory-lock success value as acquired.
 */
export function isAdvisoryLockAcquired(value: unknown): boolean {
    return value === 1 || value === BigInt(1) || value === '1';
}
