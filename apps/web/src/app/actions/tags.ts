'use server';

import { db, tags, imageTags, images } from '@/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isValidSlug, isValidTagName } from '@/lib/validation';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit';
import { stripControlChars } from '@/lib/sanitize';

function getTagSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

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

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidTagId') };
    }

    if (!name || name.trim().length === 0) return { error: t('tagNameRequired') };

    // Validate name length
    if (!isValidTagName(name)) {
        return { error: t('invalidTagName') };
    }

    const trimmedName = stripControlChars(name.trim()) ?? '';
    const slug = getTagSlug(trimmedName);

    if (!isValidSlug(slug)) return { error: t('invalidTagFormat') };

    try {
        const [result] = await db.update(tags)
            .set({ name: trimmedName, slug })
            .where(eq(tags.id, id));
        if (result.affectedRows === 0) {
            return { error: t('tagNotFound') };
        }
        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tag_update', 'tag', String(id), undefined, { name: trimmedName, slug }).catch(console.debug);

        revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
        return { success: true };
    } catch {
        console.error("Failed to update tag");
        return { error: t('failedToUpdateTag') };
    }
}

export async function deleteTag(id: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

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
        // Log audit event only when the tag was actually deleted — avoids duplicate
        // entries when concurrent deletion causes the transaction to delete 0 rows.
        if (deletedRows > 0) {
            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'tag_delete', 'tag', String(id)).catch(console.debug);
        }

        revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
        return { success: true };
    } catch {
        console.error("Failed to delete tag");
        return { error: t('failedToDeleteTag') };
    }
}

export async function addTagToImage(imageId: number, tagName: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: t('invalidImageId') };
    const cleanName = tagName?.trim();
    if (!cleanName) return { error: t('tagNameRequired') };
    if (!isValidTagName(cleanName)) return { error: t('invalidTagName') };

    const slug = getTagSlug(cleanName);
    if (!isValidSlug(slug)) return { error: t('invalidTagFormat') };

    try {
        // Upsert tag
        await db.insert(tags).ignore().values({ name: cleanName, slug });

        // Look up by exact name first, then fall back to slug — avoids returning
        // the wrong tag when two different names produce the same slug (slug collision).
        // Same pattern as removeTagFromImage and batchUpdateImageTags remove path.
        let [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.name, cleanName));
        if (!tagRecord) {
            [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
        }
        if (!tagRecord) return { error: t('tagNotFound') };

        // Warn on tag slug collision
        if (tagRecord.name !== cleanName) {
            console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
        }

        // Link tag to image
        await db.insert(imageTags).ignore().values({
            imageId,
            tagId: tagRecord.id
        });

        // Fetch image topic for topic page revalidation
        const [img] = await db.select({ topic: images.topic }).from(images).where(eq(images.id, imageId));
        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tag_add', 'image', String(imageId), undefined, { tag: tagRecord.name }).catch(console.debug);
        revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
        return tagRecord.name !== cleanName
            ? { success: true as const, warning: t('tagSlugCollision', { newName: cleanName, existingName: tagRecord.name }) }
            : { success: true as const };
    } catch (e) {
        console.error("Failed to add tag", e);
        return { error: t('failedToAddTag') };
    }
}

export async function removeTagFromImage(imageId: number, tagName: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: t('invalidImageId') };
    const cleanName = tagName?.trim();
    if (!cleanName) return { error: t('tagNameRequired') };

    try {
        // Look up by exact name first to avoid removing the wrong tag when
        // two different names produce the same slug (slug collision).
        // Fall back to slug lookup only if no exact name match exists.
        let [tagRecord] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, cleanName));
        if (!tagRecord) {
            const slug = getTagSlug(cleanName);
            [tagRecord] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
        }
        if (!tagRecord) return { error: t('tagNotFound') };

        await db.delete(imageTags)
            .where(and(
                eq(imageTags.imageId, imageId),
                eq(imageTags.tagId, tagRecord.id)
            ));

        // Fetch image topic for topic page revalidation
        const [img] = await db.select({ topic: images.topic }).from(images).where(eq(images.id, imageId));
        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tag_remove', 'image', String(imageId), undefined, { tag: tagName }).catch(console.debug);
        revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
        return { success: true };
    } catch (e) {
        console.error("Failed to remove tag", e);
        return { error: t('failedToRemoveTag') };
    }
}

export async function batchAddTags(imageIds: number[], tagName: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Array.isArray(imageIds) || imageIds.length === 0) return { error: t('noImagesSelected') };
    // Limit batch size to prevent DoS
    if (imageIds.length > 100) {
        return { error: t('tooManyImages') };
    }

    // Validate ids
    for (const id of imageIds) {
        if (!Number.isInteger(id) || id <= 0) return { error: t('invalidImageId') };
    }

    const cleanName = tagName?.trim();
    if (!cleanName) return { error: t('tagNameRequired') };
    if (!isValidTagName(cleanName)) return { error: t('invalidTagName') };

    const slug = getTagSlug(cleanName);
    if (!isValidSlug(slug)) return { error: t('invalidTagFormat') };

    try {
        // Upsert tag
        await db.insert(tags).ignore().values({ name: cleanName, slug });
        // Look up by exact name first, then fall back to slug — avoids returning
        // the wrong tag when two different names produce the same slug (slug collision).
        // Same pattern as removeTagFromImage, addTagToImage, and batchUpdateImageTags.
        let [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.name, cleanName));
        if (!tagRecord) {
            [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
        }
        if (!tagRecord) return { error: t('tagNotFound') };

        // US-002: Warn on tag slug collision
        if (tagRecord.name !== cleanName) {
            console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
        }

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
            tagId: tagRecord.id
        }));

        await db.insert(imageTags).ignore().values(values);

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'tags_batch_add', 'image', undefined, undefined, { count: existingIds.size, tag: cleanName }).catch(console.debug);

        revalidateLocalizedPaths('/admin/dashboard', '/', '/admin/tags');

        // Build warnings for both slug collision and missing images
        const warnings: string[] = [];
        const missingCount = imageIds.length - existingIds.size;
        if (missingCount > 0) {
            warnings.push(t('someImagesNotFound', { count: missingCount }));
        }
        if (tagRecord.name !== cleanName) {
            warnings.push(t('tagSlugCollision', { newName: cleanName, existingName: tagRecord.name }));
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

    try {
        await db.transaction(async (tx) => {
            // Add tags
            for (const name of addTagNames) {
                const cleanName = name.trim();
                if (!cleanName) continue;
                if (!isValidTagName(cleanName)) {
                    warnings.push(t('invalidTagName') + `: "${cleanName}"`);
                    continue;
                }
                const slug = getTagSlug(cleanName);
                if (!isValidSlug(slug)) continue;
                // Ensure tag exists
                await tx.insert(tags).ignore().values({ name: cleanName, slug });
                // Look up by exact name first, then fall back to slug — same pattern
                // as addTagToImage and batchAddTags (see C3R-02).
                let [tagRecord] = await tx.select().from(tags).where(eq(tags.name, cleanName));
                if (!tagRecord) {
                    [tagRecord] = await tx.select().from(tags).where(eq(tags.slug, slug));
                }
                if (tagRecord) {
                    // Warn on tag slug collision (matching addTagToImage/batchAddTags pattern)
                    if (tagRecord.name !== cleanName) {
                        console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
                        warnings.push(t('tagSlugCollision', { newName: cleanName, existingName: tagRecord.name }));
                    }
                    const [tagInsertResult] = await tx.insert(imageTags).ignore().values({ imageId, tagId: tagRecord.id });
                    if (tagInsertResult.affectedRows > 0) added++;
                }
            }

            // Remove tags — look up by exact name first, then fall back to slug
            // to avoid removing the wrong tag when slug collisions exist (same
            // pattern as removeTagFromImage, see C38-01).
            for (const name of removeTagNames) {
                const cleanName = name.trim();
                if (!cleanName) continue;
                let [tagRecord] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.name, cleanName));
                if (!tagRecord) {
                    const slug = getTagSlug(cleanName);
                    [tagRecord] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
                }
                if (tagRecord) {
                    const [deleteResult] = await tx.delete(imageTags).where(and(eq(imageTags.imageId, imageId), eq(imageTags.tagId, tagRecord.id)));
                    if (deleteResult.affectedRows > 0) removed++;
                }
            }
        });
    } catch (err) {
        console.error('batchUpdateImageTags transaction failed:', err);
        return { success: false, added: 0, removed: 0, warnings: [t('failedToAddTag')] };
    }

    // Fetch image topic for topic page revalidation (matching addTagToImage/removeTagFromImage pattern)
    const [img] = await db.select({ topic: images.topic }).from(images).where(eq(images.id, imageId));
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'tags_batch_update', 'image', String(imageId), undefined, { added, removed }).catch(console.debug);
    revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
    return { success: true, added, removed, warnings };
}
