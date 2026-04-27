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

import { connection, db, images, topics, topicAliases } from '@/db';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { deleteTopicImage, processTopicImage } from '@/lib/process-topic-image';
import { revalidateAllAppData } from '@/lib/revalidation';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isReservedTopicRouteSegment, isValidSlug, isValidTopicAlias, isMySQLError, containsUnicodeFormatting } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { stripControlChars, requireCleanInput } from '@/lib/sanitize';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { requireSameOriginAdmin } from '@/lib/action-guards';

async function topicRouteSegmentExists(segment: string): Promise<boolean> {
    const normalizedSegment = segment.trim();
    const [topicMatch] = await db.select({ slug: topics.slug })
        .from(topics)
        .where(eq(topics.slug, normalizedSegment))
        .limit(1);

    if (topicMatch) {
        return true;
    }

    const [aliasMatch] = await db.select({ alias: topicAliases.alias })
        .from(topicAliases)
        .where(eq(topicAliases.alias, normalizedSegment))
        .limit(1);

    return !!aliasMatch;
}

async function withTopicRouteMutationLock<T>(action: () => Promise<T>): Promise<T> {
    const conn = await connection.getConnection();
    let lockAcquired = false;

    try {
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number })[]>(
            "SELECT GET_LOCK('gallerykit_topic_route_segments', 5) AS acquired"
        );
        lockAcquired = (lockRows[0]?.acquired ?? 0) === 1;
        if (!lockAcquired) {
            throw new TopicRouteLockTimeoutError();
        }

        return await action();
    } finally {
        if (lockAcquired) {
            await conn.query("SELECT RELEASE_LOCK('gallerykit_topic_route_segments')").catch(() => {});
        }
        conn.release();
    }
}

export async function createTopic(formData: FormData) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed (defense in
    // depth — matches updateTopic/deleteTopic pattern, see C7R2-02).
    const { value: label, rejected: labelRejected } = requireCleanInput(formData.get('label')?.toString());
    const { value: slug, rejected: slugRejected } = requireCleanInput(formData.get('slug')?.toString());
    if (labelRejected) return { error: t('invalidLabel') };
    if (slugRejected) return { error: t('invalidSlug') };
    // C5L-SEC-01 / C6L-ARCH-01: reject Unicode bidi/invisible formatting in
    // admin-controlled labels for parity with topic aliases (C3L-SEC-01) and
    // tag names (C4L-SEC-01). Labels render in admin tables, public navigation,
    // OG images, and SEO previews; React HTML-escapes special chars but does
    // not strip Unicode bidi/invisible chars, leaving a visual-spoofing
    // surface unless rejected here. Single canonical helper.
    if (containsUnicodeFormatting(label)) return { error: t('invalidLabel') };
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: t('labelSlugRequired') };

    let order = parseInt(orderStr, 10);
    if (Number.isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order)); // Limit to reasonable range

    if (!isValidSlug(slug)) {
        return { error: t('invalidSlugFormat') };
    }
    if (isReservedTopicRouteSegment(slug)) {
        return { error: t('reservedRouteSegment') };
    }
    if (label.length > 100) {
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
                    imageFilename = null;
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

            // C2-F06: revalidateAllAppData() already covers all locale variants
            // and admin surfaces; the preceding revalidateLocalizedPaths() was
            // redundant (revalidatePath('/', 'layout') invalidates the full tree).
            revalidateAllAppData();
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
    }
}

export async function updateTopic(currentSlug: string, formData: FormData) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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

    // Reject malformed label/slug: if sanitization changes the value, the
    // input contained control characters and must not silently proceed
    // (defense in depth — matches createTopic pattern, see C7R2-02).
    const { value: label, rejected: labelRejected } = requireCleanInput(formData.get('label')?.toString());
    const { value: slug, rejected: slugRejected } = requireCleanInput(formData.get('slug')?.toString());
    if (labelRejected) return { error: t('invalidLabel') };
    if (slugRejected) return { error: t('invalidSlug') };
    // C5L-SEC-01 / C6L-ARCH-01: reject Unicode bidi/invisible formatting in
    // updated labels (parity with createTopic). Single canonical helper.
    if (containsUnicodeFormatting(label)) return { error: t('invalidLabel') };
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: t('labelSlugRequired') };

    let order = parseInt(orderStr, 10);
    if (Number.isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order));

    if (!isValidSlug(slug)) {
        return { error: t('invalidSlugFormat') };
    }
    if (isReservedTopicRouteSegment(slug)) {
        return { error: t('reservedRouteSegment') };
    }
    if (label.length > 100) {
        return { error: t('labelTooLong') };
    }

    const [currentTopic] = await db.select({ image_filename: topics.image_filename }).from(topics).where(eq(topics.slug, cleanCurrentSlug)).limit(1);
    if (!currentTopic) {
        return { error: t('topicNotFound') };
    }
    const previousImageFilename = currentTopic?.image_filename ?? null;

    let imageFilename = undefined;
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
                const nextImageFilename = imageFilename ?? previousImageFilename ?? null;
                await db.transaction(async (tx) => {
                    const [transactionTopic] = await tx.select({ slug: topics.slug })
                        .from(topics)
                        .where(eq(topics.slug, cleanCurrentSlug))
                        .limit(1);

                    if (!transactionTopic) {
                        throw new TopicNotFoundError();
                    }

                    await tx.insert(topics).values({
                        label,
                        slug,
                        order,
                        image_filename: nextImageFilename,
                    });
                    await tx.update(images).set({ topic: slug }).where(eq(images.topic, cleanCurrentSlug));
                    await tx.update(topicAliases).set({ topicSlug: slug }).where(eq(topicAliases.topicSlug, cleanCurrentSlug));

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

        if (previousImageFilename && imageFilename && previousImageFilename !== imageFilename) {
            try { await deleteTopicImage(previousImageFilename); }
            catch (e) { console.error('Failed to delete previous topic image:', previousImageFilename, e); }
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'topic_update', 'topic', slug).catch(console.debug);

        // C2-F06: revalidateAllAppData() covers all locale variants and admin surfaces
        revalidateAllAppData();
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
    }
}

export async function deleteTopic(slug: string) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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
        await db.transaction(async (tx) => {
            const headerImages = await tx.select({ id: images.id }).from(images).where(eq(images.topic, cleanSlug)).limit(1);
            if (headerImages.length > 0) {
                throw new TopicHasImagesError();
            }
            const [topicRecord] = await tx.select({ image_filename: topics.image_filename }).from(topics).where(eq(topics.slug, cleanSlug)).limit(1);
            deletedImageFilename = topicRecord?.image_filename ?? null;
            const [delResult] = await tx.delete(topics).where(eq(topics.slug, cleanSlug));
            deletedRows = delResult.affectedRows;
        });
        if (deletedRows === 0) {
            return { error: t('topicNotFound') };
        }
        if (deletedImageFilename) {
            await deleteTopicImage(deletedImageFilename);
        }
        // Log audit event only when the topic was actually deleted — avoids duplicate
        // entries when concurrent deletion causes the transaction to delete 0 rows.
        if (deletedRows > 0) {
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
         console.error('Failed to delete topic', e);
         return { error: t('failedToDeleteTopic') };
    }
}

export async function createTopicAlias(topicSlug: string, alias: string) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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
    if (!isValidTopicAlias(cleanAlias)) {
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
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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
