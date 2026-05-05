'use server';

import { db, smartCollections } from '@/db';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { isAdmin } from '@/app/actions/auth';
import { requireCleanInput } from '@/lib/sanitize';
import { isValidSlug } from '@/lib/validation';
import { countCodePoints } from '@/lib/utils';
import { parseSmartCollectionQuery } from '@/lib/smart-collections';
import { revalidateAllAppData } from '@/lib/revalidation';
import { requireSameOriginAdmin } from '@/lib/action-guards';

export async function createSmartCollection(formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    const { value: slug, rejected: slugRejected } = requireCleanInput(formData.get('slug')?.toString());
    const { value: name, rejected: nameRejected } = requireCleanInput(formData.get('name')?.toString());
    if (slugRejected) return { error: t('invalidSlug') };
    if (nameRejected) return { error: t('invalidLabel') };

    if (!slug || !isValidSlug(slug)) return { error: t('invalidSlugFormat') };
    if (!name || name.trim().length === 0) return { error: t('labelSlugRequired') };
    if (countCodePoints(name) > 255) return { error: t('labelTooLong') };

    const queryJsonRaw = formData.get('query_json')?.toString() ?? '';
    try {
        parseSmartCollectionQuery(queryJsonRaw);
    } catch (e) {
        return { error: (e instanceof Error ? e.message : t('invalidInput')) };
    }

    const isPublic = formData.get('is_public') === 'true';

    try {
        await db.insert(smartCollections).values({
            slug,
            name: name.trim(),
            query_json: queryJsonRaw,
            is_public: isPublic,
        });
        revalidateAllAppData();
        return { success: true as const };
    } catch (e: unknown) {
        const err = e as { code?: string; cause?: { code?: string } };
        if (err.code === 'ER_DUP_ENTRY' || err.cause?.code === 'ER_DUP_ENTRY') {
            return { error: t('slugAlreadyExists') };
        }
        console.error('Failed to create smart collection', e);
        return { error: t('invalidInput') };
    }
}

export async function updateSmartCollection(id: number, formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    if (!Number.isInteger(id) || id <= 0) return { error: t('invalidInput') };

    const { value: slug, rejected: slugRejected } = requireCleanInput(formData.get('slug')?.toString());
    const { value: name, rejected: nameRejected } = requireCleanInput(formData.get('name')?.toString());
    if (slugRejected) return { error: t('invalidSlug') };
    if (nameRejected) return { error: t('invalidLabel') };

    if (!slug || !isValidSlug(slug)) return { error: t('invalidSlugFormat') };
    if (!name || name.trim().length === 0) return { error: t('labelSlugRequired') };
    if (countCodePoints(name) > 255) return { error: t('labelTooLong') };

    const queryJsonRaw = formData.get('query_json')?.toString() ?? '';
    try {
        parseSmartCollectionQuery(queryJsonRaw);
    } catch (e) {
        return { error: (e instanceof Error ? e.message : t('invalidInput')) };
    }

    const isPublic = formData.get('is_public') === 'true';

    try {
        const [result] = await db.update(smartCollections)
            .set({ slug, name: name.trim(), query_json: queryJsonRaw, is_public: isPublic })
            .where(eq(smartCollections.id, id));
        if (result.affectedRows === 0) return { error: t('invalidInput') };
        revalidateAllAppData();
        return { success: true as const };
    } catch (e: unknown) {
        const err = e as { code?: string; cause?: { code?: string } };
        if (err.code === 'ER_DUP_ENTRY' || err.cause?.code === 'ER_DUP_ENTRY') {
            return { error: t('slugAlreadyExists') };
        }
        console.error('Failed to update smart collection', e);
        return { error: t('invalidInput') };
    }
}

export async function deleteSmartCollection(id: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    if (!Number.isInteger(id) || id <= 0) return { error: t('invalidInput') };

    try {
        const [result] = await db.delete(smartCollections).where(eq(smartCollections.id, id));
        if (result.affectedRows === 0) return { error: t('invalidInput') };
        revalidateAllAppData();
        return { success: true as const };
    } catch (e) {
        console.error('Failed to delete smart collection', e);
        return { error: t('invalidInput') };
    }
}

/**
 * @action-origin-exempt: read-only — no mutation, no auth required for public listings
 */
export async function getSmartCollections() {
    return db.select().from(smartCollections).orderBy(smartCollections.name);
}
