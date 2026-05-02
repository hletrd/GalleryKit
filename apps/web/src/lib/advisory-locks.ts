/**
 * Centralized registry for MySQL advisory lock names.
 *
 * C9-MED-03: Advisory lock names were previously scattered as inline string
 * literals across multiple files. Centralizing them reduces the risk of
 * accidental name collisions and improves auditability.
 *
 * IMPORTANT (C8R-RPL-06 / AGG8R-05): MySQL advisory lock names are scoped
 * to the MySQL SERVER, not to an individual database. Two GalleryKit instances
 * pointed at the same MySQL server share the same lock namespace and will
 * serialize each other's restores, upload-contract changes, topic renames,
 * admin-user deletes, and image-processing claims across tenants. Run one
 * GalleryKit per MySQL server — or prefix advisory-lock names with a
 * per-instance identifier if multi-tenant co-location is required.
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
