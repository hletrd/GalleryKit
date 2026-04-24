'use server';

import { db, tags, imageTags, images } from '@/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { ensureTagRecord, findTagRecordByNameOrSlug, getTagSlug } from '@/lib/tag-records';
import { isValidTagName, isValidTagSlug } from '@/lib/validation';
import { revalidateAllAppData, revalidateLocalizedPaths } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit';
import { stripControlChars } from '@/lib/sanitize';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { requireSameOriginAdmin } from '@/lib/action-guards';

// Tag Management

export async function getAdminTags() {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    try {
        const allTags = await db.select({
            id: tags.id,
            name: tags.name,
            slug: tags.slug,
            count: sql<number>`count(${imageTags.imageId})`
        })
        .from(tags)
        .leftJoin(imageTags, eq(tags.id, imageTags.tagId))
        .groupBy(tags.id)
        .orderBy(sql`count(${imageTags.imageId}) desc`);

        return { success: true, tags: allTags };
    } catch (err) {
        console.error("Failed to fetch tags", err);
        return { error: t('failedToFetchTags') };
    }
}

export async function updateTag(id: number, name: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidTagId') };
    }

    // Sanitize before validation so length/format checks operate on the same
    // value that will be stored. Without this, control characters pass
    // validation but are stripped later, causing a mismatch between validated
    // and persisted data (matches settings.ts/seo.ts pattern, see C29-09/C30-01).
    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed (defense in
    // depth — matches addTagToImage pattern, see C7R2-04).
    const rawName = name?.trim() ?? '';
    const trimmedName = stripControlChars(rawName) ?? '';
    if (trimmedName !== rawName) return { error: t('invalidTagName') };
    if (!trimmedName) return { error: t('tagNameRequired') };

    if (!isValidTagName(trimmedName)) {
        return { error: t('invalidTagName') };
    }
    const slug = getTagSlug(trimmedName);

    if (!isValidTagSlug(slug)) return { error: t('invalidTagFormat') };

    try {
        const [existingTag] = await db.select({ id: tags.id })
            .from(tags)
            .where(eq(tags.id, id));
        if (!existingTag) {
            return { error: t('tagNotFound') };
        }

        await db.update(tags)
            .set({ name: trimmedName, slug })
            .where(eq(tags.id, id));
        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tag_update', 'tag', String(id), undefined, { name: trimmedName, slug }).catch(console.debug);

        revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
        revalidateAllAppData();
        return { success: true };
    } catch {
        console.error("Failed to update tag");
        return { error: t('failedToUpdateTag') };
    }
}

export async function deleteTag(id: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidTagId') };
    }

    try {
        // Delete imageTags explicitly before tag (defense in depth alongside FK cascade)
        let deletedRows = 0;
        await db.transaction(async (tx) => {
            await tx.delete(imageTags).where(eq(imageTags.tagId, id));
            const [delResult] = await tx.delete(tags).where(eq(tags.id, id));
            deletedRows = delResult.affectedRows;
        });
        if (deletedRows === 0) {
            return { error: t('tagNotFound') };
        }
        // Log audit event only when the tag was actually deleted — avoids duplicate
        // entries when concurrent deletion causes the transaction to delete 0 rows.
        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tag_delete', 'tag', String(id)).catch(console.debug);

        revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
        revalidateAllAppData();
        return { success: true };
    } catch {
        console.error("Failed to delete tag");
        return { error: t('failedToDeleteTag') };
    }
}

export async function addTagToImage(imageId: number, tagName: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: t('invalidImageId') };
    // Sanitize before validation — matches updateTag pattern (C41-02)
    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed (defense in
    // depth for destructive operations — matches updateTopic/deleteTopic pattern).
    const trimmedTagName = tagName?.trim() ?? '';
    const cleanName = stripControlChars(trimmedTagName) ?? '';
    if (cleanName !== trimmedTagName) return { error: t('invalidTagName') };
    if (!cleanName) return { error: t('tagNameRequired') };
    if (!isValidTagName(cleanName)) return { error: t('invalidTagName') };

    const slug = getTagSlug(cleanName);
    if (!isValidTagSlug(slug)) return { error: t('invalidTagFormat') };

    try {
        const [imageRecord] = await db.select({ topic: images.topic })
            .from(images)
            .where(eq(images.id, imageId));
        if (!imageRecord) {
            return { error: t('imageNotFound') };
        }

        const resolvedTag = await ensureTagRecord(db, cleanName, slug);
        if (resolvedTag.kind === 'collision') {
            return { error: t('tagSlugCollision', { newName: cleanName, existingName: resolvedTag.existing.name }) };
        }
        if (resolvedTag.kind !== 'found') return { error: t('tagNotFound') };

        // Link tag to image
        const [linkResult] = await db.insert(imageTags).ignore().values({
            imageId,
            tagId: resolvedTag.tag.id
        });

        if (linkResult.affectedRows === 0) {
            const [stillExisting] = await db.select({ id: images.id })
                .from(images)
                .where(eq(images.id, imageId));
            if (!stillExisting) {
                return { error: t('imageNotFound') };
            }
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tag_add', 'image', String(imageId), undefined, { tag: resolvedTag.tag.name }).catch(console.debug);
        revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', imageRecord.topic ? `/${imageRecord.topic}` : '', '/admin/dashboard');
        revalidateAllAppData();
        return { success: true as const };
    } catch (e) {
        console.error("Failed to add tag", e);
        return { error: t('failedToAddTag') };
    }
}

export async function removeTagFromImage(imageId: number, tagName: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: t('invalidImageId') };
    // Sanitize before lookup — reject malformed input (defense in depth
    // for destructive operations — matches addTagToImage/updateTopic pattern).
    const trimmedTagName = tagName?.trim() ?? '';
    const cleanName = stripControlChars(trimmedTagName) ?? '';
    if (cleanName !== trimmedTagName) return { error: t('invalidTagName') };
    if (!cleanName) return { error: t('tagNameRequired') };

    try {
        const [imageRecord] = await db.select({ topic: images.topic })
            .from(images)
            .where(eq(images.id, imageId));
        if (!imageRecord) {
            return { error: t('imageNotFound') };
        }

        const resolvedTag = await findTagRecordByNameOrSlug(db, cleanName);
        if (resolvedTag.kind === 'collision') {
            return { error: t('tagSlugCollision', { newName: cleanName, existingName: resolvedTag.existing.name }) };
        }
        if (resolvedTag.kind !== 'found') return { error: t('tagNotFound') };

        const [deleteResult] = await db.delete(imageTags)
            .where(and(
                eq(imageTags.imageId, imageId),
                eq(imageTags.tagId, resolvedTag.tag.id)
            ));

        if (deleteResult.affectedRows === 0) {
            const [stillExisting] = await db.select({ id: images.id })
                .from(images)
                .where(eq(images.id, imageId));
            if (!stillExisting) {
                return { error: t('imageNotFound') };
            }
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tag_remove', 'image', String(imageId), undefined, { tag: cleanName }).catch(console.debug);
        revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', imageRecord.topic ? `/${imageRecord.topic}` : '', '/admin/dashboard');
        revalidateAllAppData();
        return { success: true };
    } catch (e) {
        console.error("Failed to remove tag", e);
        return { error: t('failedToRemoveTag') };
    }
}

export async function batchAddTags(imageIds: number[], tagName: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    if (!Array.isArray(imageIds) || imageIds.length === 0) return { error: t('noImagesSelected') };
    // Limit batch size to prevent DoS
    if (imageIds.length > 100) {
        return { error: t('tooManyImages') };
    }

    // Validate ids
    for (const id of imageIds) {
        if (!Number.isInteger(id) || id <= 0) return { error: t('invalidImageId') };
    }

    // Sanitize before validation — reject malformed input: if sanitization
    // changes the value, the input contained control characters and must not
    // silently proceed (defense in depth — matches addTagToImage pattern,
    // see C7R2-03).
    const rawTagName = tagName?.trim() ?? '';
    const cleanName = stripControlChars(rawTagName) ?? '';
    if (cleanName !== rawTagName) return { error: t('invalidTagName') };
    if (!cleanName) return { error: t('tagNameRequired') };
    if (!isValidTagName(cleanName)) return { error: t('invalidTagName') };

    const slug = getTagSlug(cleanName);
    if (!isValidTagSlug(slug)) return { error: t('invalidTagFormat') };

    try {
        const resolvedTag = await ensureTagRecord(db, cleanName, slug);
        if (resolvedTag.kind === 'collision') {
            return { error: t('tagSlugCollision', { newName: cleanName, existingName: resolvedTag.existing.name }) };
        }
        if (resolvedTag.kind !== 'found') return { error: t('tagNotFound') };

        // Verify which image IDs still exist before linking the tag.
        // Without this, INSERT IGNORE silently drops rows that fail FK constraints
        // (e.g., image deleted by another admin between validation and insertion),
        // and the function returns success with no tags actually linked.
        const existingImages = await db.select({ id: images.id })
            .from(images)
            .where(inArray(images.id, imageIds));
        const existingIds = new Set(existingImages.map(img => img.id));

        if (existingIds.size === 0) {
            return { error: t('noImagesSelected') };
        }

        const values = [...existingIds].map(imageId => ({
            imageId,
            tagId: resolvedTag.tag.id
        }));

        await db.insert(imageTags).ignore().values(values);

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tags_batch_add', 'image', undefined, undefined, { count: existingIds.size, tag: cleanName }).catch(console.debug);

        revalidateLocalizedPaths('/admin/dashboard', '/', '/admin/tags');
        revalidateAllAppData();

        // Build warnings for both slug collision and missing images
        const warnings: string[] = [];
        const missingCount = imageIds.length - existingIds.size;
        if (missingCount > 0) {
            warnings.push(t('someImagesNotFound', { count: missingCount }));
        }

        return warnings.length > 0
            ? { success: true as const, warning: warnings.join('; ') }
            : { success: true as const };
    } catch (e) {
        console.error("Failed to batch add tags", e);
        return { error: t('failedToAddTag') };
    }
}

export async function batchUpdateImageTags(
    imageId: number,
    addTagNames: string[],
    removeTagNames: string[],
): Promise<{ success: boolean; added: number; removed: number; warnings: string[] }> {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { success: false, added: 0, removed: 0, warnings: [t('unauthorized')] };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { success: false, added: 0, removed: 0, warnings: [originError] };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { success: false, added: 0, removed: 0, warnings: [maintenanceError] };

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { success: false, added: 0, removed: 0, warnings: [t('invalidImageId')] };
    }

    // Limit tag array sizes to prevent DoS (matching batchAddTags pattern)
    if (addTagNames.length > 100 || removeTagNames.length > 100) {
        return { success: false, added: 0, removed: 0, warnings: [t('tooManyTags')] };
    }

    const warnings: string[] = [];
    let added = 0;
    let removed = 0;
    let imageTopic: string | null = null;

    try {
        await db.transaction(async (tx) => {
            const [imageRecord] = await tx.select({ topic: images.topic })
                .from(images)
                .where(eq(images.id, imageId));
            if (!imageRecord) {
                throw new Error('IMAGE_NOT_FOUND');
            }
            imageTopic = imageRecord.topic;

            // Add tags
            for (const name of addTagNames) {
                const trimmedName = name.trim();
                const cleanName = stripControlChars(trimmedName) ?? '';
                // Reject malformed input: skip tag names that contained control
                // characters (defense in depth — matches addTagToImage pattern).
                if (cleanName !== trimmedName) continue;
                if (!cleanName) continue;
                if (!isValidTagName(cleanName)) {
                    warnings.push(t('invalidTagName') + `: "${cleanName}"`);
                    continue;
                }
                const slug = getTagSlug(cleanName);
                if (!isValidTagSlug(slug)) continue;
                const resolvedTag = await ensureTagRecord(tx, cleanName, slug);
                if (resolvedTag.kind === 'collision') {
                    warnings.push(t('tagSlugCollision', { newName: cleanName, existingName: resolvedTag.existing.name }));
                    continue;
                }
                if (resolvedTag.kind === 'found') {
                    const [tagInsertResult] = await tx.insert(imageTags).ignore().values({ imageId, tagId: resolvedTag.tag.id });
                    if (tagInsertResult.affectedRows > 0) added++;
                }
            }

            // Remove tags — look up by exact name first, then fall back to slug
            // to avoid removing the wrong tag when slug collisions exist (same
            // pattern as removeTagFromImage, see C38-01).
            for (const name of removeTagNames) {
                const trimmedName = name.trim();
                const cleanName = stripControlChars(trimmedName) ?? '';
                // Reject malformed input: skip tag names that contained control
                // characters (defense in depth — matches removeTagFromImage pattern).
                if (cleanName !== trimmedName) continue;
                if (!cleanName) continue;
                const resolvedTag = await findTagRecordByNameOrSlug(tx, cleanName);
                if (resolvedTag.kind === 'collision') {
                    warnings.push(t('tagSlugCollision', { newName: cleanName, existingName: resolvedTag.existing.name }));
                    continue;
                }
                if (resolvedTag.kind === 'found') {
                    const [deleteResult] = await tx.delete(imageTags).where(and(eq(imageTags.imageId, imageId), eq(imageTags.tagId, resolvedTag.tag.id)));
                    if (deleteResult.affectedRows > 0) removed++;
                }
            }
        });
    } catch (err) {
        if (err instanceof Error && err.message === 'IMAGE_NOT_FOUND') {
            return { success: false, added: 0, removed: 0, warnings: [t('imageNotFound')] };
        }
        console.error('batchUpdateImageTags transaction failed:', err);
        return { success: false, added: 0, removed: 0, warnings: [t('failedToAddTag')] };
    }

    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'tags_batch_update', 'image', String(imageId), undefined, { added, removed }).catch(console.debug);
    revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', imageTopic ? `/${imageTopic}` : '', '/admin/dashboard');
    revalidateAllAppData();
    return { success: true, added, removed, warnings };
}
