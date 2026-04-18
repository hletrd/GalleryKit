'use server';

import { db, tags, imageTags, images } from '@/db';
import { eq, and, sql } from 'drizzle-orm';

import { isAdmin } from '@/app/actions/auth';
import { isValidSlug, isValidTagName } from '@/lib/validation';
import { revalidateLocalizedPaths } from '@/lib/revalidation';

function getTagSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Tag Management

export async function getAdminTags() {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

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
        return { error: 'Failed to fetch tags' };
    }
}

export async function updateTag(id: number, name: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid tag ID' };
    }

    if (!name || name.trim().length === 0) return { error: 'Name is required' };

    // Validate name length
    if (!isValidTagName(name)) {
        return { error: 'Tag names must be 1-100 characters and cannot contain commas' };
    }

    const trimmedName = name.trim();
    const slug = getTagSlug(trimmedName);

    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        const [result] = await db.update(tags)
            .set({ name: trimmedName, slug })
            .where(eq(tags.id, id));
        if (result.affectedRows === 0) {
            return { error: 'Tag not found' };
        }
        revalidateLocalizedPaths('/admin/tags', '/');
        return { success: true };
    } catch {
        console.error("Failed to update tag");
        return { error: 'Failed to update tag (Name might be taken)' };
    }
}

export async function deleteTag(id: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid tag ID' };
    }

    try {
        await db.delete(tags).where(eq(tags.id, id));
        revalidateLocalizedPaths('/admin/tags', '/');
        return { success: true };
    } catch {
        console.error("Failed to delete tag");
        return { error: 'Failed to delete tag' };
    }
}

export async function addTagToImage(imageId: number, tagName: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: 'Invalid image ID' };
    const cleanName = tagName?.trim();
    if (!cleanName) return { error: 'Tag name required' };
    if (!isValidTagName(cleanName)) return { error: 'Tag names must be 1-100 characters and cannot contain commas' };

    const slug = getTagSlug(cleanName);
    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        // Upsert tag
        await db.insert(tags).ignore().values({ name: cleanName, slug });

        // Get tag id (optimized select)
        const [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Failed to retrieve tag' };

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
        revalidateLocalizedPaths(`/p/${imageId}`, '/', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
        return tagRecord.name !== cleanName
            ? { success: true as const, warning: `Tag "${cleanName}" was mapped to existing "${tagRecord.name}" (same slug)` }
            : { success: true as const };
    } catch (e) {
        console.error("Failed to add tag", e);
        return { error: 'Failed to add tag' };
    }
}

export async function removeTagFromImage(imageId: number, tagName: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(imageId) || imageId <= 0) return { error: 'Invalid image ID' };
    const cleanName = tagName?.trim();
    if (!cleanName) return { error: 'Tag name required' };

    const slug = getTagSlug(cleanName);

    try {
        const [tagRecord] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Tag not found' };

        await db.delete(imageTags)
            .where(and(
                eq(imageTags.imageId, imageId),
                eq(imageTags.tagId, tagRecord.id)
            ));

        // Fetch image topic for topic page revalidation
        const [img] = await db.select({ topic: images.topic }).from(images).where(eq(images.id, imageId));
        revalidateLocalizedPaths(`/p/${imageId}`, '/', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
        return { success: true };
    } catch (e) {
        console.error("Failed to remove tag", e);
        return { error: 'Failed to remove tag' };
    }
}

export async function batchAddTags(imageIds: number[], tagName: string) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Array.isArray(imageIds) || imageIds.length === 0) return { error: 'No images selected' };
    // Limit batch size to prevent DoS
    if (imageIds.length > 100) {
        return { error: 'Too many images selected (max 100)' };
    }

    // Validate ids
    for (const id of imageIds) {
        if (!Number.isInteger(id) || id <= 0) return { error: 'Invalid image ID' };
    }

    const cleanName = tagName?.trim();
    if (!cleanName) return { error: 'Tag name required' };
    if (!isValidTagName(cleanName)) return { error: 'Tag names must be 1-100 characters and cannot contain commas' };

    const slug = getTagSlug(cleanName);
    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        // Upsert tag
        await db.insert(tags).ignore().values({ name: cleanName, slug });
        const [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Failed to retrieve tag' };

        // US-002: Warn on tag slug collision
        if (tagRecord.name !== cleanName) {
            console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
        }

        // Batch insert
        const values = imageIds.map(imageId => ({
            imageId,
            tagId: tagRecord.id
        }));

        await db.insert(imageTags).ignore().values(values);

        revalidateLocalizedPaths('/admin/dashboard', '/');
        return tagRecord.name !== cleanName
            ? { success: true as const, warning: `Tag "${cleanName}" was mapped to existing "${tagRecord.name}" (same slug)` }
            : { success: true as const };
    } catch (e) {
        console.error("Failed to batch add tags", e);
        return { error: 'Failed to batch add tags' };
    }
}

export async function batchUpdateImageTags(
    imageId: number,
    addTagNames: string[],
    removeTagNames: string[],
): Promise<{ success: boolean; added: number; removed: number; warnings: string[] }> {
    if (!(await isAdmin())) return { success: false, added: 0, removed: 0, warnings: ['Unauthorized'] };

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { success: false, added: 0, removed: 0, warnings: ['Invalid image ID'] };
    }

    const warnings: string[] = [];
    let added = 0;
    let removed = 0;

    try {
        await db.transaction(async (tx) => {
            // Add tags
            for (const name of addTagNames) {
                const cleanName = name.trim();
                if (!cleanName || !isValidTagName(cleanName)) continue;
                const slug = getTagSlug(cleanName);
                if (!isValidSlug(slug)) continue;
                // Ensure tag exists
                await tx.insert(tags).ignore().values({ name: cleanName, slug });
                const [tagRecord] = await tx.select().from(tags).where(eq(tags.slug, slug));
                if (tagRecord) {
                    await tx.insert(imageTags).ignore().values({ imageId, tagId: tagRecord.id });
                    added++;
                }
            }

            // Remove tags
            for (const name of removeTagNames) {
                const cleanName = name.trim();
                if (!cleanName) continue;
                const slug = getTagSlug(cleanName);
                const [tagRecord] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
                if (tagRecord) {
                    await tx.delete(imageTags).where(and(eq(imageTags.imageId, imageId), eq(imageTags.tagId, tagRecord.id)));
                    removed++;
                }
            }
        });
    } catch (err) {
        console.error('batchUpdateImageTags transaction failed:', err);
        return { success: false, added: 0, removed: 0, warnings: ['Failed to update tags — all changes rolled back'] };
    }

    revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/dashboard');
    return { success: true, added, removed, warnings };
}
