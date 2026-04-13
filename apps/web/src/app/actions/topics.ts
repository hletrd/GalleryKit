'use server';

import { db, images, topics, topicAliases } from '@/db';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { processTopicImage } from '@/lib/process-topic-image';

import { isAdmin } from '@/app/actions/auth';
import { isValidSlug, isValidTopicAlias, isMySQLError } from '@/lib/validation';

export async function createTopic(formData: FormData) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    const label = formData.get('label')?.toString() ?? '';
    const slug = formData.get('slug')?.toString() ?? '';
    const orderStr = formData.get('order')?.toString() ?? '';
    const imageFile = (() => { const v = formData.get('image'); return v instanceof File ? v : null; })();

    if (!label || !slug) return { error: 'Label and Slug are required' };

    // Validate and sanitize order (default to 0, limit range)
    let order = parseInt(orderStr, 10);
    if (Number.isNaN(order)) order = 0;
    order = Math.max(-1000, Math.min(1000, order)); // Limit to reasonable range

    // Validate slug format
    if (!isValidSlug(slug)) {
        return { error: 'Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.' };
    }

    // Validate label length
    if (label.length > 100) {
        return { error: 'Label is too long (max 100 characters)' };
    }

    let imageFilename = null;
    if (imageFile && imageFile.size > 0 && imageFile.name !== 'undefined') {
         try {
             imageFilename = await processTopicImage(imageFile);
         } catch (e) {
             console.warn('Topic image processing failed, continuing without image:', e);
             // For now, fail safely without image
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

        revalidatePath('/admin/categories');
        revalidatePath('/');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: 'Topic slug already exists' };
        }
        console.error('Failed to create topic', e);
        return { error: 'Failed to create topic' };
    }
}

export async function updateTopic(currentSlug: string, formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // Validate currentSlug
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

        revalidatePath('/admin/categories');
        revalidatePath('/');
        return { success: true };
    } catch (e: unknown) {
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
        // Wrap check + delete in a transaction to prevent TOCTOU race
        // (image could be added between the check and delete otherwise)
        await db.transaction(async (tx) => {
            const headerImages = await tx.select({ id: images.id }).from(images).where(eq(images.topic, slug)).limit(1);
            if (headerImages.length > 0) {
                throw new Error('HAS_IMAGES');
            }
            await tx.delete(topics).where(eq(topics.slug, slug));
        });
        revalidatePath('/admin/categories');
        revalidatePath('/');

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

    // US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race
    try {
        await db.insert(topicAliases).values({
            alias,
            topicSlug
        });

        revalidatePath('/admin/categories');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY')) {
            return { error: t('aliasAlreadyExists') };
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

    // Use permissive check for delete too, ensuring we can delete legacy/weird aliases if they exist
    if (!alias || !isValidTopicAlias(alias)) {
        return { error: t('invalidAlias') };
    }

    await db.delete(topicAliases).where(
        and(
            eq(topicAliases.alias, alias),
            eq(topicAliases.topicSlug, topicSlug)
        )
    );

    revalidatePath('/admin/categories');
    return { success: true };
}
