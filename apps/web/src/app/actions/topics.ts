'use server';

import type { RowDataPacket } from 'mysql2/promise';

// AGG4R2-04: Proper error classes for topic mutation flow control.
// Replaces string-sentinel error matching (throw new TopicNotFoundError(),
// catch checking for that string) with typed error classes that are caught
// by type, eliminating the fragile string-comparison pattern.
class TopicNotFoundError extends Error {
    constructor() { super('Topic not found'); this.name = 'TopicNotFoundError'; }
}
class SlugConflictsWithRouteError extends Error {
    constructor() { super('Slug conflicts with existing route'); this.name = 'SlugConflictsWithRouteError'; }
}
class TopicRouteLockTimeoutError extends Error {
    constructor() { super('Topic route lock acquisition timed out'); this.name = 'TopicRouteLockTimeoutError'; }
}
class TopicHasImagesError extends Error {
    constructor() { super('Topic still has associated images'); this.name = 'TopicHasImagesError'; }
}
class TopicReferencedBySmartCollectionError extends Error {
    constructor() { super('Topic is referenced by smart collections'); this.name = 'TopicReferencedBySmartCollectionError'; }
}
class SmartCollectionQueryInvalidError extends Error {
    constructor() { super('Smart collection query is invalid'); this.name = 'SmartCollectionQueryInvalidError'; }
}

import { connection, db, images, topics, topicAliases, topicViews, smartCollections } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { deleteTopicImage, processTopicImage } from '@/lib/process-topic-image';
import { revalidateAllAppData } from '@/lib/revalidation';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isReservedTopicRouteSegment, isValidSlug, isValidTopicAlias, isMySQLError, hasMySQLErrorCode } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { parseSmartCollectionQuery, queryReferencesTopicSlug, remapTopicSlugInQuery } from '@/lib/smart-collections';
import { requireCleanInput, sanitizeAdminString } from '@/lib/sanitize';
import { countCodePoints } from '@/lib/utils';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { LOCK_TOPIC_ROUTE_SEGMENTS, isAdvisoryLockAcquired } from '@/lib/advisory-locks';
import { releasePooledAdvisoryLocks } from '@/lib/advisory-lock-release';

async function topicRouteSegmentExists(segment: string): Promise<boolean> {
    // C3L-CR-02: combined single query with UNION instead of two sequential
    // SELECTs. Both tables are checked in one round-trip to the database.
    const normalizedSegment = segment.trim();
    const result = await db.execute(sql`
        SELECT 1 AS found FROM ${topics} WHERE ${topics.slug} = ${normalizedSegment}
        UNION ALL
        SELECT 1 AS found FROM ${topicAliases} WHERE ${topicAliases.alias} = ${normalizedSegment}
        LIMIT 1
    `);
    // COR-R4C19-01: drizzle's raw `db.execute(sql)` on the mysql2 driver
    // returns the underlying mysql2 `[rows, fields]` TUPLE, not a rows array
    // (canonical in-repo documentation: scripts/backfill-color-pipeline.ts).
    // Checking `.length` on the tuple is always 2 > 0, which falsely reported
    // EVERY segment as existing — breaking topic create, slug rename, and
    // alias create with a bogus slugConflictsWithRoute error. Unwrap to the
    // actual rows array (same house pattern as lib/admin-tokens.ts and
    // lib/admin-backfill-runner.ts) before testing emptiness.
    const rows = (Array.isArray(result) && Array.isArray(result[0])
        ? result[0]
        : result) as unknown as Array<{ found: number }>;
    return rows.length > 0;
}

async function withTopicRouteMutationLock<T>(action: () => Promise<T>): Promise<T> {
    const conn = await connection.getConnection();
    let lockAcquired = false;

    try {
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number })[]>(
            "SELECT GET_LOCK(?, 5) AS acquired",
            [LOCK_TOPIC_ROUTE_SEGMENTS]
        );
        lockAcquired = isAdvisoryLockAcquired(lockRows[0]?.acquired);
        if (!lockAcquired) {
            throw new TopicRouteLockTimeoutError();
        }

        return await action();
    } finally {
        if (lockAcquired) {
            // C7-02 (run-10 cycle 7b): the destroy-don't-release pattern this
            // site pioneered (3acf638a) now lives in the shared helper so all
            // pooled advisory-lock sites behave identically. Never throws.
            await releasePooledAdvisoryLocks(conn, [LOCK_TOPIC_ROUTE_SEGMENTS], 'topic route segments');
        } else {
            conn.release();
        }
    }
}

export async function createTopic(formData: FormData) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // C7-AGG7R-03: sanitizeAdminString checks Unicode formatting BEFORE
    // stripping (stripControlChars now removes bidi/zero-width chars, so
    // calling containsUnicodeFormatting after requireCleanInput would always
    // pass). Replaces the separate requireCleanInput + containsUnicodeFormatting
    // pattern (C5L-SEC-01 / C6L-ARCH-01) with a single atomic helper.
    const { value: label, rejected: labelRejected } = sanitizeAdminString(formData.get('label')?.toString());
    const { value: slug, rejected: slugRejected } = requireCleanInput(formData.get('slug')?.toString());
    if (labelRejected) return { error: t('invalidLabel') };
    if (slugRejected) return { error: t('invalidSlug') };
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: t('labelSlugRequired') };

    // R21C21 T2 (DBG21-01): Number() not parseInt() — parseInt('1e3',10) stops
    // at 'e' and returns 1, silently mis-storing a scientific-notation order;
    // !Number.isFinite also rejects Infinity (Number.isNaN did not).
    let order = Number(orderStr);
    if (!Number.isFinite(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order)); // Limit to reasonable range

    if (!isValidSlug(slug)) {
        return { error: t('invalidSlugFormat') };
    }
    if (isReservedTopicRouteSegment(slug)) {
        return { error: t('reservedRouteSegment') };
    }
    // C8-AGG8R-02: use countCodePoints for MySQL-compatible varchar length
    // comparison so supplementary characters (emoji, rare CJK) count as
    // one character each, matching MySQL's utf8mb4 varchar semantics.
    if (countCodePoints(label) > 100) {
        return { error: t('labelTooLong') };
    }

    let imageFilename: string | null = null;
    let imageWarning: string | undefined;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.warn('Topic image processing failed, continuing without image:', e);
             imageWarning = t('topicImageProcessingWarning');
         }
    }

    try {
        return await withTopicRouteMutationLock(async () => {
            if (await topicRouteSegmentExists(slug)) {
                if (imageFilename) {
                    await deleteTopicImage(imageFilename);
                }
                return { error: t('slugConflictsWithRoute') };
            }

            // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
            await db.insert(topics).values({
                label,
                slug,
                order,
                image_filename: imageFilename,
            });

            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'topic_create', 'topic', slug).catch(console.debug);

            return imageWarning ? { success: true as const, warning: imageWarning } : { success: true as const };
        });
    } catch (e: unknown) {
        if (imageFilename) {
            await deleteTopicImage(imageFilename);
        }
        if (e instanceof TopicRouteLockTimeoutError) {
            return { error: t('failedToCreateTopic') };
        }
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: t('slugOrAliasExists') };
        }
        console.error('Failed to create topic', e);
        return { error: t('failedToCreateTopic') };
    } finally {
        // C2-F06: revalidateAllAppData() covers all locale variants and admin surfaces;
        // the preceding revalidateLocalizedPaths() was redundant. Run revalidation outside
        // the try/catch so a revalidation error never triggers the image cleanup in the
        // catch block (AGG-M1/M2).
        revalidateAllAppData();
    }
}

export async function updateTopic(currentSlug: string, formData: FormData) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and should not silently proceed (defense in
    // depth for destructive operations — matches deleteTopic pattern).
    const { value: cleanCurrentSlug, rejected: currentSlugRejected } = requireCleanInput(currentSlug);
    if (currentSlugRejected) {
        return { error: t('invalidCurrentSlug') };
    }
    if (!cleanCurrentSlug || !isValidSlug(cleanCurrentSlug)) {
        return { error: t('invalidCurrentSlug') };
    }

    // C7-AGG7R-03: sanitizeAdminString checks Unicode formatting BEFORE
    // stripping (replaces separate requireCleanInput + containsUnicodeFormatting
    // pattern that was silently passing after stripControlChars was extended).
    const { value: label, rejected: labelRejected } = sanitizeAdminString(formData.get('label')?.toString());
    const { value: slug, rejected: slugRejected } = requireCleanInput(formData.get('slug')?.toString());
    if (labelRejected) return { error: t('invalidLabel') };
    if (slugRejected) return { error: t('invalidSlug') };
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: t('labelSlugRequired') };

    // R21C21 T2 (DBG21-01): Number() not parseInt() — parseInt('1e3',10) stops
    // at 'e' and returns 1, silently mis-storing a scientific-notation order;
    // !Number.isFinite also rejects Infinity (Number.isNaN did not).
    let order = Number(orderStr);
    if (!Number.isFinite(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order));

    if (!isValidSlug(slug)) {
        return { error: t('invalidSlugFormat') };
    }
    if (isReservedTopicRouteSegment(slug)) {
        return { error: t('reservedRouteSegment') };
    }
    // C8-AGG8R-02: use countCodePoints for MySQL-compatible varchar length
    if (countCodePoints(label) > 100) {
        return { error: t('labelTooLong') };
    }

    const [currentTopic] = await db.select({ image_filename: topics.image_filename }).from(topics).where(eq(topics.slug, cleanCurrentSlug)).limit(1);
    if (!currentTopic) {
        return { error: t('topicNotFound') };
    }

    let imageFilename = undefined;
    let replacedImageFilename: string | null = null;
    let imageWarning: string | undefined;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.error("Failed to process topic image", e);
             imageWarning = t('topicImageProcessingWarning');
         }
    }

    try {
        await withTopicRouteMutationLock(async () => {
            if (slug !== cleanCurrentSlug && await topicRouteSegmentExists(slug)) {
                throw new SlugConflictsWithRouteError();
            }

            if (slug !== cleanCurrentSlug) {
                await db.transaction(async (tx) => {
                    // COR-R4C13-01: the "rename" is a recreate — every topics
                    // column NOT sourced from the form must be carried from
                    // the authoritative row, read under the route lock INSIDE
                    // the transaction (this also closes the pre-lock
                    // image_filename TOCTOU, COR-R4C13-02). map_visible is
                    // NOT NULL DEFAULT false, so omitting it silently reset
                    // the US-P21 public-map opt-in on every slug rename. The
                    // rename test pins the inserted VALUES — thread any
                    // future topics column through BOTH this select and the
                    // insert below.
                    const [transactionTopic] = await tx.select({
                        slug: topics.slug,
                        image_filename: topics.image_filename,
                        map_visible: topics.map_visible,
                    })
                        .from(topics)
                        .where(eq(topics.slug, cleanCurrentSlug))
                        .limit(1);

                    if (!transactionTopic) {
                        throw new TopicNotFoundError();
                    }

                    const nextImageFilename = imageFilename ?? transactionTopic.image_filename ?? null;
                    if (imageFilename && transactionTopic.image_filename !== imageFilename) {
                        replacedImageFilename = transactionTopic.image_filename ?? null;
                    }

                    await tx.insert(topics).values({
                        label,
                        slug,
                        order,
                        image_filename: nextImageFilename,
                        map_visible: transactionTopic.map_visible,
                    });
                    await tx.update(images).set({ topic: slug }).where(eq(images.topic, cleanCurrentSlug));
                    await tx.update(topicAliases).set({ topicSlug: slug }).where(eq(topicAliases.topicSlug, cleanCurrentSlug));
                    // DBG-16-01 (R16C16, data-loss): topic_views.topic → topics.slug
                    // has ON DELETE CASCADE. The rename is a recreate (delete old
                    // row below), so the analytics rows MUST be re-pointed first or
                    // the delete CASCADE-wipes up to VIEW_RETENTION_DAYS (395 d) of
                    // per-topic view history. The two FK children above were already
                    // re-pointed; topicViews is the later-added third child that was
                    // missed ("fix one sibling, miss the next").
                    await tx.update(topicViews).set({ topic: slug }).where(eq(topicViews.topic, cleanCurrentSlug));

                    // DBG-16-03 (R16C16): smart-collection rules that reference the
                    // OLD slug by exact identity (`topic eq <old>` / `topic in […]`)
                    // would silently stop matching after the rename. Re-point those
                    // exact references inside the same transaction. Malformed
                    // query_json is skipped defensively (it can only have come from
                    // a pre-validation row); only rows whose AST actually changed
                    // are written back.
                    const collections = await tx.select({
                        id: smartCollections.id,
                        query_json: smartCollections.query_json,
                    }).from(smartCollections);
                    for (const collection of collections) {
                        if (typeof collection.query_json !== 'string') continue;
                        let remapped: { ast: unknown; changed: boolean };
                        try {
                            const ast = parseSmartCollectionQuery(collection.query_json);
                            remapped = remapTopicSlugInQuery(ast, cleanCurrentSlug, slug);
                        } catch {
                            // R18C18 CR-18 (LOW): a corrupt query_json silently retains
                            // the now-deleted old slug → the collection produces zero
                            // results with no operator signal. Log at debug level so a
                            // post-rename "empty smart collection" is diagnosable; the
                            // skip-and-continue behavior is unchanged.
                            console.debug(
                                `[updateTopic] smart_collection ${collection.id} has unparseable query_json — skipping slug remap`,
                            );
                            continue;
                        }
                        if (remapped.changed) {
                            await tx.update(smartCollections)
                                .set({ query_json: JSON.stringify(remapped.ast) })
                                .where(eq(smartCollections.id, collection.id));
                        }
                    }

                    await tx.delete(topics)
                        .where(eq(topics.slug, cleanCurrentSlug));
                });
            } else {
                const [existingTopic] = await db.select({ slug: topics.slug })
                    .from(topics)
                    .where(eq(topics.slug, cleanCurrentSlug))
                    .limit(1);
                if (!existingTopic) {
                    throw new TopicNotFoundError();
                }

                const [topicBeforeUpdate] = await db.select({ image_filename: topics.image_filename })
                    .from(topics)
                    .where(eq(topics.slug, cleanCurrentSlug))
                    .limit(1);
                if (!topicBeforeUpdate) {
                    throw new TopicNotFoundError();
                }
                if (imageFilename && topicBeforeUpdate.image_filename !== imageFilename) {
                    replacedImageFilename = topicBeforeUpdate.image_filename ?? null;
                }

                const [updateResult] = await db.update(topics)
                    .set({
                        label,
                        order,
                        ...(imageFilename ? { image_filename: imageFilename } : {})
                    })
                    .where(eq(topics.slug, cleanCurrentSlug));
                if (updateResult.affectedRows === 0) {
                    throw new TopicNotFoundError();
                }
            }
        });

        if (replacedImageFilename) {
            try { await deleteTopicImage(replacedImageFilename); }
            catch (e) { console.error('Failed to delete previous topic image:', replacedImageFilename, e); }
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'topic_update', 'topic', slug).catch(console.debug);

        return imageWarning ? { success: true as const, warning: imageWarning } : { success: true as const };
    } catch (e: unknown) {
         if (imageFilename) {
             await deleteTopicImage(imageFilename);
         }
         if (e instanceof TopicNotFoundError) {
             return { error: t('topicNotFound') };
         }
         if (e instanceof SlugConflictsWithRouteError) {
             return { error: t('slugConflictsWithRoute') };
         }
         if (e instanceof TopicRouteLockTimeoutError) {
             return { error: t('failedToUpdateTopic') };
         }
         if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
             return { error: t('slugAlreadyExists') };
         }
         console.error('Failed to update topic', e);
         return { error: t('failedToUpdateTopic') };
    } finally {
        // C2-F06: revalidateAllAppData() covers all locale variants and admin surfaces.
        // Run revalidation outside the try/catch so a revalidation error never
        // triggers the image cleanup in the catch block (AGG-M1/M2).
        revalidateAllAppData();
    }
}

export async function deleteTopic(slug: string) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed on a
    // destructive operation (defense in depth — matches updateTopic pattern).
    const { value: cleanSlug, rejected: slugRejected } = requireCleanInput(slug);
    if (slugRejected) {
        return { error: t('invalidSlug') };
    }
    if (!cleanSlug || !isValidSlug(cleanSlug)) {
        return { error: t('invalidSlug') };
    }

    try {
        // Transaction prevents TOCTOU: image could be added between check and delete
        let deletedImageFilename: string | null = null;
        let deletedRows = 0;
        await withTopicRouteMutationLock(async () => {
            await db.transaction(async (tx) => {
                const headerImages = await tx.select({ id: images.id }).from(images).where(eq(images.topic, cleanSlug)).limit(1);
                if (headerImages.length > 0) {
                    throw new TopicHasImagesError();
                }
                const smartCollectionRows = await tx.select({
                    id: smartCollections.id,
                    query_json: smartCollections.query_json,
                }).from(smartCollections);
                for (const collection of smartCollectionRows) {
                    if (typeof collection.query_json !== 'string') continue;
                    try {
                        const ast = parseSmartCollectionQuery(collection.query_json);
                        if (queryReferencesTopicSlug(ast, cleanSlug)) {
                            throw new TopicReferencedBySmartCollectionError();
                        }
                    } catch (err) {
                        if (err instanceof TopicReferencedBySmartCollectionError) throw err;
                        console.warn(
                            `[deleteTopic] smart_collection ${collection.id} has unparseable query_json — blocking topic deletion`,
                            err,
                        );
                        throw new SmartCollectionQueryInvalidError();
                    }
                }
                const [topicRecord] = await tx.select({ image_filename: topics.image_filename }).from(topics).where(eq(topics.slug, cleanSlug)).limit(1);
                deletedImageFilename = topicRecord?.image_filename ?? null;
                const [delResult] = await tx.delete(topics).where(eq(topics.slug, cleanSlug));
                deletedRows = delResult.affectedRows;
            });
        });
        if (deletedRows === 0) {
            return { error: t('topicNotFound') };
        }
        if (deletedImageFilename) {
            try {
                await deleteTopicImage(deletedImageFilename);
            } catch (cleanupError) {
                console.warn('Topic deleted but topic image cleanup failed', cleanupError);
            }
        }
        // Log audit event — the early return above guarantees deletedRows >= 1 here.
        // C15-AGG-01: removed the redundant `if (deletedRows > 0)` guard which was
        // always true after the `deletedRows === 0` early return on line 346.
        {
            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'topic_delete', 'topic', cleanSlug).catch(console.debug);
        }

        // C2-F06: revalidateAllAppData() covers all locale variants and admin surfaces
        revalidateAllAppData();

        return { success: true };
    } catch (e) {
         if (e instanceof TopicHasImagesError) {
             return { error: t('cannotDeleteCategoryWithImages') };
         }
         if (e instanceof TopicReferencedBySmartCollectionError) {
             return { error: t('cannotDeleteCategoryReferencedByCollection') };
         }
         if (e instanceof SmartCollectionQueryInvalidError) {
             return { error: t('cannotDeleteCategoryDueToInvalidCollectionQuery') };
         }
         if (hasMySQLErrorCode(e, 'ER_ROW_IS_REFERENCED_2')) {
             return { error: t('cannotDeleteCategoryWithImages') };
         }
         if (e instanceof TopicRouteLockTimeoutError) {
             return { error: t('failedToDeleteTopic') };
         }
         console.error('Failed to delete topic', e);
         return { error: t('failedToDeleteTopic') };
    }
}

export async function createTopicAlias(topicSlug: string, alias: string) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // Sanitize before validation — reject malformed input: if sanitization
    // changes the value, the input contained control characters and must not
    // silently proceed (defense in depth — matches deleteTopicAlias pattern,
    // see C7R2-01).
    const { value: cleanTopicSlug, rejected: topicSlugRejected } = requireCleanInput(topicSlug);
    if (topicSlugRejected) {
        return { error: t('invalidTopicSlug') };
    }
    if (!cleanTopicSlug || !isValidSlug(cleanTopicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    // Sanitize alias before validation — reject malformed input (defense in
    // depth — matches deleteTopicAlias pattern, see C7R2-01).
    const { value: cleanAlias, rejected: aliasRejected } = requireCleanInput(alias);
    if (aliasRejected) {
        return { error: t('invalidAlias') };
    }
    if (!cleanAlias || !isValidTopicAlias(cleanAlias)) {
        return { error: t('invalidAliasFormat') };
    }
    if (isReservedTopicRouteSegment(cleanAlias)) {
        return { error: t('reservedRouteSegment') };
    }
    try {
        return await withTopicRouteMutationLock(async () => {
            if (await topicRouteSegmentExists(cleanAlias)) {
                return { error: t('slugConflictsWithRoute') };
            }

            // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
            await db.insert(topicAliases).values({
                alias: cleanAlias,
                topicSlug: cleanTopicSlug
            });

            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'topic_alias_create', 'topic', cleanTopicSlug, undefined, { alias: cleanAlias }).catch(console.debug);

            // C2-F06: revalidateAllAppData() covers all locale variants and admin surfaces
            revalidateAllAppData();
            return { success: true };
        });
    } catch (e: unknown) {
        if (e instanceof TopicRouteLockTimeoutError) {
            return { error: t('failedToCreateTopic') };
        }
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: t('aliasAlreadyExists') };
        }
        if (isMySQLError(e) && e.code === 'ER_NO_REFERENCED_ROW_2') {
            return { error: t('topicNotFound') };
        }
        console.error('Failed to create topic alias:', e);
        return { error: t('failedToCreateTopic') };
    }
}

export async function deleteTopicAlias(topicSlug: string, alias: string) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed on a
    // destructive operation (defense in depth — matches updateTopic/deleteTopic pattern).
    const { value: cleanTopicSlug, rejected: topicSlugRejected } = requireCleanInput(topicSlug);
    if (topicSlugRejected) {
        return { error: t('invalidTopicSlug') };
    }
    if (!cleanTopicSlug || !isValidSlug(cleanTopicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    // Sanitize before validation — reject malformed input (defense in depth)
    const { value: cleanAlias, rejected: aliasRejected } = requireCleanInput(alias);
    if (aliasRejected) {
        return { error: t('invalidAlias') };
    }
    // Permissive check to allow deleting legacy aliases that pre-date newer
    // routing constraints (for example dotted aliases).
    if (!cleanAlias || /[/\\\x00]/.test(cleanAlias)) {
        return { error: t('invalidAlias') };
    }

    try {
        const [delResult] = await db.delete(topicAliases).where(
            and(
                eq(topicAliases.alias, cleanAlias),
                eq(topicAliases.topicSlug, cleanTopicSlug)
            )
        );
        // Log audit event only when the alias was actually deleted — avoids
        // duplicate entries when concurrent deletion causes the delete to affect 0 rows.
        if (delResult.affectedRows > 0) {
            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'topic_alias_delete', 'topic', cleanTopicSlug, undefined, { alias: cleanAlias }).catch(console.debug);
        } else {
            return { error: t('aliasNotFound') };
        }
    } catch (e) {
        console.error('Failed to delete topic alias:', e);
        return { error: t('failedToDeleteAlias') };
    }

    // C2-F06: revalidateAllAppData() covers all locale variants and admin surfaces
    revalidateAllAppData();
    return { success: true };
}

// US-P21: toggle per-topic opt-in for the public /map GPS view.
export async function setTopicMapVisible(topicSlug: string, mapVisible: boolean) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    const { value: cleanSlug, rejected: slugRejected } = requireCleanInput(topicSlug);
    if (slugRejected || !cleanSlug || !isValidSlug(cleanSlug)) return { error: t('invalidSlug') };
    if (typeof mapVisible !== 'boolean') return { error: t('invalidInput') };

    const [result] = await db
        .update(topics)
        .set({ map_visible: mapVisible })
        .where(eq(topics.slug, cleanSlug));

    if (result.affectedRows === 0) return { error: t('topicNotFound') };

    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'topic_map_visible_set', 'topic', cleanSlug, undefined, { map_visible: mapVisible }).catch(console.debug);

    revalidateAllAppData();
    return { success: true };
}
