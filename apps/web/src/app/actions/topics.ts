'use server';

import { db, images, topics, topicAliases } from '@/db';
import { eq, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { deleteTopicImage, processTopicImage } from '@/lib/process-topic-image';
import { revalidateLocalizedPaths } from '@/lib/revalidation';

import { isAdmin } from '@/app/actions/auth';
import { isReservedTopicRouteSegment, isValidSlug, isValidTopicAlias, isMySQLError } from '@/lib/validation';

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
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    const label = formData.get('label')?.toString() ?? '';
    const slug = formData.get('slug')?.toString() ?? '';
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: 'Label and Slug are required' };

    let order = parseInt(orderStr, 10);
    if (Number.isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order)); // Limit to reasonable range

    if (!isValidSlug(slug)) {
        return { error: 'Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.' };
    }
    if (isReservedTopicRouteSegment(slug)) {
        return { error: 'This slug is reserved for an application route' };
    }

    if (label.length > 100) {
        return { error: 'Label is too long (max 100 characters)' };
    }

    if (await topicRouteSegmentExists(slug)) {
        return { error: 'Topic slug already conflicts with an existing topic route' };
    }

    let imageFilename = null;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.warn('Topic image processing failed, continuing without image:', e);
             // Fail safely without image
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

        revalidateLocalizedPaths('/admin/categories', '/');
        return { success: true };
    } catch (e: unknown) {
        if (imageFilename) {
            await deleteTopicImage(imageFilename);
        }
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: 'Topic slug or alias already exists' };
        }
        console.error('Failed to create topic', e);
        return { error: 'Failed to create topic' };
    }
}

export async function updateTopic(currentSlug: string, formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!currentSlug || !isValidSlug(currentSlug)) {
        return { error: t('invalidCurrentSlug') };
    }

    const label = formData.get('label')?.toString() ?? '';
    const slug = formData.get('slug')?.toString() ?? '';
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
        return { error: 'This slug is reserved for an application route' };
    }

    const [currentTopic] = await db.select({ image_filename: topics.image_filename }).from(topics).where(eq(topics.slug, currentSlug)).limit(1);
    const previousImageFilename = currentTopic?.image_filename ?? null;

    if (slug !== currentSlug && await topicRouteSegmentExists(slug)) {
        return { error: 'Topic slug already conflicts with an existing topic route' };
    }

    let imageFilename = undefined;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.error("Failed to process topic image", e);
         }
    }

    try {

        if (slug !== currentSlug) {
            // Cascade slug change in a transaction: update references first (while old FK target exists), then rename the PK
            await db.transaction(async (tx) => {
                await tx.update(images).set({ topic: slug }).where(eq(images.topic, currentSlug));
                await tx.update(topicAliases).set({ topicSlug: slug }).where(eq(topicAliases.topicSlug, currentSlug));
                await tx.update(topics)
                    .set({
                        label,
                        slug,
                        order,
                        ...(imageFilename ? { image_filename: imageFilename } : {})
                    })
                    .where(eq(topics.slug, currentSlug));
            });
        } else {
            await db.update(topics)
                .set({
                    label,
                    order,
                    ...(imageFilename ? { image_filename: imageFilename } : {})
                })
                .where(eq(topics.slug, currentSlug));
        }

        if (previousImageFilename && imageFilename && previousImageFilename !== imageFilename) {
            await deleteTopicImage(previousImageFilename);
        }

        revalidateLocalizedPaths('/admin/categories', '/');
        return { success: true };
    } catch (e: unknown) {
         if (imageFilename) {
             await deleteTopicImage(imageFilename);
         }
         if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('Duplicate entry'))) {
             return { error: 'Topic slug already exists' };
         }
         console.error('Failed to update topic', e);
         return { error: 'Failed to update topic' };
    }
}

export async function deleteTopic(slug: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!slug || !isValidSlug(slug)) {
        return { error: t('invalidSlug') };
    }

    try {
        // Transaction prevents TOCTOU: image could be added between check and delete
        let deletedImageFilename: string | null = null;
        await db.transaction(async (tx) => {
            const headerImages = await tx.select({ id: images.id }).from(images).where(eq(images.topic, slug)).limit(1);
            if (headerImages.length > 0) {
                throw new Error('HAS_IMAGES');
            }
            const [topicRecord] = await tx.select({ image_filename: topics.image_filename }).from(topics).where(eq(topics.slug, slug)).limit(1);
            deletedImageFilename = topicRecord?.image_filename ?? null;
            await tx.delete(topics).where(eq(topics.slug, slug));
        });
        if (deletedImageFilename) {
            await deleteTopicImage(deletedImageFilename);
        }
        revalidateLocalizedPaths('/admin/categories', '/');

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

    if (!topicSlug || !isValidSlug(topicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    if (!isValidTopicAlias(alias)) {
        return { error: t('invalidAliasFormat') };
    }
    if (isReservedTopicRouteSegment(alias)) {
        return { error: 'This alias is reserved for an application route' };
    }
    if (await topicRouteSegmentExists(alias)) {
        return { error: 'Alias already conflicts with an existing topic or alias' };
    }

    // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
    try {
        await db.insert(topicAliases).values({
            alias,
            topicSlug
        });

        revalidateLocalizedPaths('/admin/categories');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: t('aliasAlreadyExists') };
        }
        if (isMySQLError(e) && e.code === 'ER_NO_REFERENCED_ROW_2') {
            return { error: t('topicNotFound') };
        }
        return { error: t('invalidAliasFormat') };
    }
}

export async function deleteTopicAlias(topicSlug: string, alias: string) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!topicSlug || !isValidSlug(topicSlug)) {
        return { error: t('invalidTopicSlug') };
    }

    // Permissive check to allow deleting legacy aliases
    if (!alias || !isValidTopicAlias(alias)) {
        return { error: t('invalidAlias') };
    }

    await db.delete(topicAliases).where(
        and(
            eq(topicAliases.alias, alias),
            eq(topicAliases.topicSlug, topicSlug)
        )
    );

    revalidateLocalizedPaths('/admin/categories');
    return { success: true };
}
