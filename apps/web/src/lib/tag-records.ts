import { eq } from 'drizzle-orm';

import { db, tags } from '@/db';

export function getTagSlug(name: string) {
    return name
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s_]+/gu, '-')
        .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/(^-|-$)/g, '');
}

type TagReader = Pick<typeof db, 'select'>;
type TagWriter = Pick<typeof db, 'select' | 'insert'>;

type TagRecord = {
    id: number;
    name: string;
    slug: string;
};

export type ResolvedTagRecord =
    | { kind: 'found'; tag: TagRecord }
    | { kind: 'collision'; existing: TagRecord; requestedName: string; slug: string }
    | { kind: 'missing'; requestedName: string; slug: string };

async function selectTagByNameOrSlug(reader: TagReader, cleanName: string, slug: string): Promise<ResolvedTagRecord> {
    const [exactMatch] = await reader.select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
    }).from(tags).where(eq(tags.name, cleanName));

    if (exactMatch) {
        return { kind: 'found', tag: exactMatch };
    }

    const [slugMatch] = await reader.select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
    }).from(tags).where(eq(tags.slug, slug));

    if (!slugMatch) {
        return { kind: 'missing', requestedName: cleanName, slug };
    }

    if (slugMatch.name !== cleanName) {
        return {
            kind: 'collision',
            existing: slugMatch,
            requestedName: cleanName,
            slug,
        };
    }

    return { kind: 'found', tag: slugMatch };
}

export async function findTagRecordByNameOrSlug(reader: TagReader, cleanName: string, slug = getTagSlug(cleanName)) {
    return selectTagByNameOrSlug(reader, cleanName, slug);
}

export async function ensureTagRecord(writer: TagWriter, cleanName: string, slug = getTagSlug(cleanName)) {
    await writer.insert(tags).ignore().values({ name: cleanName, slug });
    return selectTagByNameOrSlug(writer, cleanName, slug);
}
