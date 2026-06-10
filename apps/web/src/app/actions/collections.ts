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
        // R4C5 I18N-R4C5-03: do NOT cross the action boundary with the raw
        // English parser message (same posture as C6-RPF-03 / R4C4-05) —
        // localized generic error to the client, detail to the server log.
        console.warn('Smart collection query rejected (create)', e);
        return { error: t('invalidCollectionQuery') };
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
        return { error: t('failedToCreateCollection') };
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
        // R4C5 I18N-R4C5-03: localized generic error across the boundary,
        // parser detail to the server log (C6-RPF-03 / R4C4-05 lineage).
        console.warn('Smart collection query rejected (update)', e);
        return { error: t('invalidCollectionQuery') };
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
        return { error: t('failedToUpdateCollection') };
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
        return { error: t('failedToDeleteCollection') };
    }
}

// R4C5 SEC-R4C5-02: the former `getSmartCollections` export was removed.
// On a 'use server' boundary every export registers an invokable endpoint;
// that getter was unauthenticated, un-rate-limited, and returned ALL rows
// (including `is_public = false` collections with their query_json ASTs)
// while having zero callers. If a listing getter is ever needed: the admin
// variant must gate on isAdmin(), and a public variant must filter
// `is_public = true` AND omit `query_json`.
