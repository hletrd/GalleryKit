import { afterEach, describe, expect, it, vi } from 'vitest';

const orm = vi.hoisted(() => ({
    eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
    desc: vi.fn((...args: unknown[]) => ({ op: 'desc', args })),
    asc: vi.fn((...args: unknown[]) => ({ op: 'asc', args })),
    and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
    gt: vi.fn((...args: unknown[]) => ({ op: 'gt', args })),
    lt: vi.fn((...args: unknown[]) => ({ op: 'lt', args })),
    or: vi.fn((...args: unknown[]) => ({ op: 'or', args })),
    inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
    notInArray: vi.fn((...args: unknown[]) => ({ op: 'notInArray', args })),
    isNull: vi.fn((...args: unknown[]) => ({ op: 'isNull', args })),
    isNotNull: vi.fn((...args: unknown[]) => ({ op: 'isNotNull', args })),
}));

function tableProxy(table: string): Record<string, string> {
    return new Proxy({}, {
        get: (_target, prop) => `${table}.${String(prop)}`,
    }) as Record<string, string>;
}

function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
    return { op: 'sql', strings, values };
}

Object.assign(sqlTag, {
    raw: vi.fn((value: string) => ({ op: 'sql.raw', value })),
});

async function loadGetMapImages(rows: unknown[]) {
    vi.resetModules();
    vi.clearAllMocks();

    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));

    vi.doMock('drizzle-orm', () => ({
        ...orm,
        sql: sqlTag,
    }));

    vi.doMock('@/db', () => ({
        db: { select },
        images: tableProxy('images'),
        topics: tableProxy('topics'),
        topicAliases: tableProxy('topic_aliases'),
        tags: tableProxy('tags'),
        imageTags: tableProxy('image_tags'),
        sharedGroups: tableProxy('shared_groups'),
        sharedGroupImages: tableProxy('shared_group_images'),
        adminSettings: tableProxy('admin_settings'),
        smartCollections: tableProxy('smart_collections'),
    }));

    const dataModule = await import('@/lib/data');

    return {
        getMapImages: dataModule.getMapImages,
        select,
        from,
        innerJoin,
        where,
        orderBy,
        limit,
    };
}

describe('getMapImages behavior', () => {
    afterEach(() => {
        vi.doUnmock('@/db');
        vi.doUnmock('drizzle-orm');
        vi.resetModules();
    });

    it('executes the map-visible query before returning GPS rows', async () => {
        const row = {
            id: 123,
            filename_avif: 'photo.avif',
            filename_webp: 'photo.webp',
            filename_jpeg: 'photo.jpg',
            width: 1200,
            height: 800,
            title: 'Visible photo',
            description: null,
            topic: 'public',
            capture_date: null,
            created_at: new Date('2026-06-30T00:00:00Z'),
            updated_at: new Date('2026-06-30T00:00:00Z'),
            latitude: 37.5,
            longitude: 127.0,
            topic_label: 'Public',
            topic_map_visible: true,
        };
        const { getMapImages, select, innerJoin, where, limit } = await loadGetMapImages([row]);

        await expect(getMapImages()).resolves.toEqual([row]);

        expect(select).toHaveBeenCalledOnce();
        expect(innerJoin).toHaveBeenCalledOnce();
        const innerJoinCall = innerJoin.mock.calls[0] as unknown[] | undefined;
        expect(innerJoinCall?.[1]).toEqual({ op: 'eq', args: ['images.topic', 'topics.slug'] });
        expect(where).toHaveBeenCalledWith({
            op: 'and',
            args: [
                { op: 'eq', args: ['images.processed', true] },
                { op: 'eq', args: ['topics.map_visible', true] },
                { op: 'isNotNull', args: ['images.latitude'] },
                { op: 'isNotNull', args: ['images.longitude'] },
            ],
        });
        expect(limit).toHaveBeenCalledWith(10000);
    });

    it('throws before returning a GPS row if the DB violates map visibility', async () => {
        const { getMapImages } = await loadGetMapImages([
            {
                id: 321,
                latitude: 37.5,
                longitude: 127.0,
                topic_map_visible: false,
            },
        ]);

        await expect(getMapImages()).rejects.toThrow(/GPS leak guard: image 321/);
    });
});
