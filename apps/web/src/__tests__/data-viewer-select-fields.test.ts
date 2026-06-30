import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    dbSelectMock,
    selectCalls,
    selectLimitResults,
    makeTable,
} = vi.hoisted(() => {
    const selectCalls: Array<Record<string, unknown> | undefined> = [];
    const selectLimitResults: Array<unknown[]> = [];

    const makeTable = (name: string) => new Proxy({} as Record<string, string>, {
        get(target, prop) {
            if (typeof prop !== 'string') {
                return undefined;
            }
            target[prop] ??= `${name}.${prop}`;
            return target[prop];
        },
    });

    const makeQuery = () => {
        const query: Record<string, ReturnType<typeof vi.fn>> = {};
        query.from = vi.fn(() => query);
        query.leftJoin = vi.fn(() => query);
        query.innerJoin = vi.fn(() => query);
        query.where = vi.fn(() => query);
        query.groupBy = vi.fn(() => query);
        query.having = vi.fn(() => query);
        query.orderBy = vi.fn(() => query);
        query.offset = vi.fn(async () => selectLimitResults.shift() ?? []);
        query.limit = vi.fn(async () => selectLimitResults.shift() ?? []);
        return query;
    };

    const dbSelectMock = vi.fn((fields?: Record<string, unknown>) => {
        selectCalls.push(fields);
        return makeQuery();
    });

    return {
        dbSelectMock,
        selectCalls,
        selectLimitResults,
        makeTable,
    };
});

vi.mock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return {
        ...actual,
        cache: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
    };
});

vi.mock('@/db', () => ({
    db: {
        select: dbSelectMock,
    },
    images: makeTable('images'),
    topics: makeTable('topics'),
    topicAliases: makeTable('topicAliases'),
    tags: makeTable('tags'),
    imageTags: makeTable('imageTags'),
    sharedGroups: makeTable('sharedGroups'),
    sharedGroupImages: makeTable('sharedGroupImages'),
    adminSettings: makeTable('adminSettings'),
    smartCollections: makeTable('smartCollections'),
}));

vi.mock('drizzle-orm', () => {
    const clause = (...args: unknown[]) => ({ args });
    const sqlTag = Object.assign(
        (_strings: TemplateStringsArray, ...values: unknown[]) => ({ values }),
        { raw: vi.fn((value: string) => ({ raw: value })) },
    );

    return {
        sql: sqlTag,
        eq: vi.fn(clause),
        desc: vi.fn(clause),
        asc: vi.fn(clause),
        and: vi.fn(clause),
        gt: vi.fn(clause),
        lt: vi.fn(clause),
        or: vi.fn(clause),
        inArray: vi.fn(clause),
        notInArray: vi.fn(clause),
        isNull: vi.fn(clause),
        isNotNull: vi.fn(clause),
    };
});

import {
    adminSelectFieldKeys,
    getImageForViewer,
    publicSelectFieldKeys,
} from '@/lib/data';

describe('getImageForViewer select-field behavior', () => {
    beforeEach(() => {
        selectCalls.length = 0;
        selectLimitResults.length = 0;
        vi.clearAllMocks();
    });

    it('uses the public select shape for non-admin viewers', async () => {
        selectLimitResults.push([]);

        await expect(getImageForViewer(123, false)).resolves.toBeNull();

        const selectedKeys = Object.keys(selectCalls[0] ?? {});
        expect(selectedKeys).toContain('id');
        expect(selectedKeys).toContain('filename_jpeg');
        expect(selectedKeys).toContain('blur_data_url');
        expect(selectedKeys).toContain('topic_label');
        for (const key of publicSelectFieldKeys) {
            expect(selectedKeys).toContain(key);
        }
        for (const key of [
            'filename_original',
            'user_filename',
            'color_space',
            'icc_profile_name',
            'transfer_function',
            'is_hdr',
            'pipeline_version',
        ]) {
            expect(selectedKeys).not.toContain(key);
        }
    });

    it('uses the admin select shape when admin viewer fields are requested', async () => {
        selectLimitResults.push([]);

        await expect(getImageForViewer(123, true)).resolves.toBeNull();

        const selectedKeys = Object.keys(selectCalls[0] ?? {});
        for (const key of adminSelectFieldKeys) {
            expect(selectedKeys).toContain(key);
        }
        for (const key of [
            'filename_original',
            'user_filename',
            'color_space',
            'icc_profile_name',
            'transfer_function',
            'is_hdr',
            'pipeline_version',
        ]) {
            expect(selectedKeys).toContain(key);
        }
    });
});
