'use server';

import { db, images, topics, topicAliases } from '@/db';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { deleteTopicImage, processTopicImage } from '@/lib/process-topic-image';
import { revalidateAllAppData, revalidateLocalizedPaths } from '@/lib/revalidation';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isReservedTopicRouteSegment, isValidSlug, isValidTopicAlias, isMySQLError } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { stripControlChars } from '@/lib/sanitize';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';

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

export async function createTopic(formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed (defense in
    // depth — matches updateTopic/deleteTopic pattern, see C7R2-02).
    const rawLabel = formData.get('label')?.toString() ?? '';
    const rawSlug = formData.get('slug')?.toString() ?? '';
    const label = stripControlChars(rawLabel) ?? '';
    const slug = stripControlChars(rawSlug) ?? '';
    if (label !== rawLabel) return { error: t('invalidSlug') };
    if (slug !== rawSlug) return { error: t('invalidSlug') };
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
    if (await topicRouteSegmentExists(slug)) {
        return { error: t('slugConflictsWithRoute') };
    }

    if (label.length > 100) {
        return { error: t('labelTooLong') };
    }

    let imageFilename = null;
    let imageWarning: string | undefined;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.warn('Topic image processing failed, continuing without image:', e);
             imageWarning = t('topicImageProcessingWarning');
         }
    }

    // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
    try {
        await db.insert(topics).values({
            label,
            slug,
            order,
            image_filename: imageFilename,
        });

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'topic_create', 'topic', slug).catch(console.debug);

        revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', '/');
        revalidateAllAppData();
        return imageWarning ? { success: true as const, warning: imageWarning } : { success: true as const };
    } catch (e: unknown) {
        if (imageFilename) {
            await deleteTopicImage(imageFilename);
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
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and should not silently proceed (defense in
    // depth for destructive operations — matches deleteTopic pattern).
    const cleanCurrentSlug = stripControlChars(currentSlug) ?? '';
    if (cleanCurrentSlug !== currentSlug) {
        return { error: t('invalidCurrentSlug') };
    }
    if (!cleanCurrentSlug || !isValidSlug(cleanCurrentSlug)) {
        return { error: t('invalidCurrentSlug') };
    }

    // Reject malformed label/slug: if sanitization changes the value, the
    // input contained control characters and must not silently proceed
    // (defense in depth — matches createTopic pattern, see C7R2-02).
    const rawLabel = formData.get('label')?.toString() ?? '';
    const rawSlug = formData.get('slug')?.toString() ?? '';
    const label = stripControlChars(rawLabel) ?? '';
    const slug = stripControlChars(rawSlug) ?? '';
    if (label !== rawLabel) return { error: t('invalidSlug') };
    if (slug !== rawSlug) return { error: t('invalidSlug') };
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

    if (slug !== cleanCurrentSlug && await topicRouteSegmentExists(slug)) {
        return { error: t('slugConflictsWithRoute') };
    }

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
        let affectedRows = 0;

        if (slug !== cleanCurrentSlug) {
            const nextImageFilename = imageFilename ?? previousImageFilename ?? null;
            await db.transaction(async (tx) => {
                const [existingTopic] = await tx.select({ slug: topics.slug })
                    .from(topics)
                    .where(eq(topics.slug, cleanCurrentSlug))
                    .limit(1);

                if (!existingTopic) {
                    throw new Error('TOPIC_NOT_FOUND');
                }

                await tx.insert(topics).values({
                    label,
                    slug,
                    order,
                    image_filename: nextImageFilename,
                });
                await tx.update(images).set({ topic: slug }).where(eq(images.topic, cleanCurrentSlug));
                await tx.update(topicAliases).set({ topicSlug: slug }).where(eq(topicAliases.topicSlug, cleanCurrentSlug));

                const [deleteResult] = await tx.delete(topics)
                    .where(eq(topics.slug, cleanCurrentSlug));
                affectedRows = deleteResult.affectedRows;
            });
        } else {
            const [updateResult] = await db.update(topics)
                .set({
                    label,
                    order,
                    ...(imageFilename ? { image_filename: imageFilename } : {})
                })
                .where(eq(topics.slug, cleanCurrentSlug));
            affectedRows = updateResult.affectedRows;
        }

        if (affectedRows === 0) {
            if (imageFilename) {
                await deleteTopicImage(imageFilename);
            }
            return { error: t('topicNotFound') };
        }

        if (previousImageFilename && imageFilename && previousImageFilename !== imageFilename) {
            try { await deleteTopicImage(previousImageFilename); }
            catch (e) { console.error('Failed to delete previous topic image:', previousImageFilename, e); }
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'topic_update', 'topic', slug).catch(console.debug);

        revalidateLocalizedPaths('/admin/categories', '/admin/tags', '/', `/${slug}`, slug !== cleanCurrentSlug ? `/${cleanCurrentSlug}` : '');
        revalidateAllAppData();
        return imageWarning ? { success: true as const, warning: imageWarning } : { success: true as const };
    } catch (e: unknown) {
         if (imageFilename) {
             await deleteTopicImage(imageFilename);
         }
         if (e instanceof Error && e.message === 'TOPIC_NOT_FOUND') {
             return { error: t('topicNotFound') };
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
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed on a
    // destructive operation (defense in depth — matches updateTopic pattern).
    const cleanSlug = stripControlChars(slug) ?? '';
    if (cleanSlug !== slug) {
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
                throw new Error('HAS_IMAGES');
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

        revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', '/', `/${cleanSlug}`);
        revalidateAllAppData();

        return { success: true };
    } catch (e) {
         if (e instanceof Error && e.message === 'HAS_IMAGES') {
             return { error: t('cannotDeleteCategoryWithImages') };
         }
         console.error('Failed to delete topic', e);
         return { error: t('failedToDeleteTopic') };
    }
}

export async function createTopicAlias(topicSlug: string, alias: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // Sanitize before validation — reject malformed input: if sanitization
    // changes the value, the input contained control characters and must not
    // silently proceed (defense in depth — matches deleteTopicAlias pattern,
    // see C7R2-01).
    const cleanTopicSlug = stripControlChars(topicSlug) ?? '';
    if (cleanTopicSlug !== topicSlug) {
        return { error: t('invalidTopicSlug') };
    }
    if (!cleanTopicSlug || !isValidSlug(cleanTopicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    // Sanitize alias before validation — reject malformed input (defense in
    // depth — matches deleteTopicAlias pattern, see C7R2-01).
    const cleanAlias = stripControlChars(alias) ?? '';
    if (cleanAlias !== alias) {
        return { error: t('invalidAlias') };
    }
    if (!isValidTopicAlias(cleanAlias)) {
        return { error: t('invalidAliasFormat') };
    }
    if (isReservedTopicRouteSegment(cleanAlias)) {
        return { error: t('reservedRouteSegment') };
    }
    if (await topicRouteSegmentExists(cleanAlias)) {
        return { error: t('slugConflictsWithRoute') };
    }

    // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
    try {
        await db.insert(topicAliases).values({
            alias: cleanAlias,
            topicSlug: cleanTopicSlug
        });

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'topic_alias_create', 'topic', cleanTopicSlug, undefined, { alias: cleanAlias }).catch(console.debug);

        revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', `/${cleanAlias}`, `/${cleanTopicSlug}`);
        revalidateAllAppData();
        return { success: true };
    } catch (e: unknown) {
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
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed on a
    // destructive operation (defense in depth — matches updateTopic/deleteTopic pattern).
    const cleanTopicSlug = stripControlChars(topicSlug) ?? '';
    if (cleanTopicSlug !== topicSlug) {
        return { error: t('invalidTopicSlug') };
    }
    if (!cleanTopicSlug || !isValidSlug(cleanTopicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    // Sanitize before validation — reject malformed input (defense in depth)
    const cleanAlias = stripControlChars(alias) ?? '';
    if (cleanAlias !== alias) {
        return { error: t('invalidAlias') };
    }
    // Permissive check to allow deleting legacy aliases
    if (!cleanAlias || !isValidTopicAlias(cleanAlias)) {
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
        }
    } catch (e) {
        console.error('Failed to delete topic alias:', e);
        return { error: t('failedToDeleteAlias') };
    }

    revalidateLocalizedPaths('/admin/categories', '/admin/tags', '/admin/dashboard', `/${cleanAlias}`, `/${cleanTopicSlug}`);
    revalidateAllAppData();
    return { success: true };
}
