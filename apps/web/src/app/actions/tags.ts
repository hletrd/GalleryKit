'use server';

import { db, tags, imageTags } from '@/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { isAdmin } from '@/app/actions/auth';
import { isValidSlug } from '@/lib/validation';

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
    if (name.length > 100) {
        return { error: 'Tag name too long (max 100 characters)' };
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        await db.update(tags)
            .set({ name: name.trim(), slug })
            .where(eq(tags.id, id));
        revalidatePath('/admin/tags');
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
        revalidatePath('/admin/tags');
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
    if (cleanName.length > 100) return { error: 'Tag name too long' };

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!isValidSlug(slug)) return { error: 'Invalid tag name format' };

    try {
        // Upsert tag
        await db.insert(tags).ignore().values({ name: cleanName, slug });

        // Get tag id (optimized select)
        const [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Failed to retrieve tag' };

        // US-002: Warn on tag slug collision
        if (tagRecord.name !== cleanName) {
            console.warn(`Tag slug collision: "${cleanName}" collides with existing "${tagRecord.name}" on slug "${slug}"`);
        }

        // Link tag to image
        await db.insert(imageTags).ignore().values({
            imageId,
            tagId: tagRecord.id
        });

        revalidatePath('/admin/dashboard');
        return { success: true };
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

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    try {
        const [tagRecord] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
        if (!tagRecord) return { error: 'Tag not found' };

        await db.delete(imageTags)
            .where(and(
                eq(imageTags.imageId, imageId),
                eq(imageTags.tagId, tagRecord.id)
            ));

        revalidatePath('/admin/dashboard');
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
    if (cleanName.length > 100) return { error: 'Tag name too long' };

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

        revalidatePath('/admin/dashboard');
        return { success: true };
    } catch (e) {
        console.error("Failed to batch add tags", e);
        return { error: 'Failed to batch add tags' };
    }
}
