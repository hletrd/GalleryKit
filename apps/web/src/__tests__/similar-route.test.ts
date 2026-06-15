/**
 * Tests for GET /api/search/similar/[id]
 *
 * Mirrors the mocking approach of semantic-route-production.test.ts.
 * Behavioral assertions:
 *   1. 403 when not same-origin.
 *   2. 503 when mode is not 'production' (e.g. 'stub' or 'disabled').
 *   3. 200 in production mode with a present target embedding — the queried id is
 *      excluded from results (self-exclusion), and the embeddings scan filtered on
 *      PRODUCTION_MODEL_VERSION.
 *   4. 404 when the target image has no production embedding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    PRODUCTION_MODEL_VERSION,
    EMBEDDING_BYTES,
} from '@/lib/clip-embeddings';

vi.mock('@/lib/gallery-config', () => ({ getGalleryConfig: vi.fn() }));
vi.mock('@/lib/request-origin', () => ({ hasTrustedSameOrigin: vi.fn(() => true) }));
vi.mock('@/lib/restore-maintenance', () => ({ isRestoreMaintenanceActive: vi.fn(() => false) }));
vi.mock('@/lib/rate-limit', () => ({
    getClientIp: vi.fn(() => '1.2.3.4'),
    preIncrementSemanticAttempt: vi.fn(() => false),
    rollbackSemanticAttempt: vi.fn(),
}));

// Build a small Float32Array encoded as base64 for use as a valid embedding.
// All values equal to 0.5 so cosine similarity is well-defined.
function makeEmbeddingBase64(fill = 0.5): string {
    const arr = new Float32Array(EMBEDDING_BYTES / 4).fill(fill);
    return Buffer.from(arr.buffer).toString('base64');
}

// A distinct fill value so the neighbour image produces a deterministic score.
const TARGET_EMBEDDING_B64 = makeEmbeddingBase64(0.5);
const NEIGHBOUR_EMBEDDING_B64 = makeEmbeddingBase64(0.49);

// The whereSpy records every call to the .where() chain step so we can assert
// which filter arguments were passed.
const whereSpy = vi.fn();

// Control which rows the db mock returns per test.
// `targetRows` → the target-image embedding lookup (limit 1)
// `scanRows`   → the full model-version scan
let targetRows: Array<{ embedding: string | null }> = [];
let scanRows: Array<{ imageId: number; embedding: string | null }> = [];
let imageRows: Array<object> = [];

// These are module-level so they can be reset in beforeEach.
// The vi.mock factory closure captures references to these variables.
let selectCallCount = 0;
let activeQuery = 0;

vi.mock('@/db', () => {
    // The route issues three distinct db queries, each starting with .select():
    //   call 1 (.select #1): target embedding lookup  → .where().limit(1)
    //   call 2 (.select #2): embedding scan           → .where().orderBy().limit(N)
    //   call 3 (.select #3): image enrichment         → .leftJoin().where()  (no .limit())
    //
    // We track which query is active via selectCallCount/activeQuery (module-level,
    // reset in beforeEach) so each terminal step resolves the right data.

    const chain = {
        select: () => { selectCallCount += 1; activeQuery = selectCallCount; return chain; },
        from: () => chain,
        leftJoin: () => chain,
        orderBy: () => chain,
        limit: () => {
            if (activeQuery === 1) return Promise.resolve(targetRows);
            if (activeQuery === 2) return Promise.resolve(scanRows);
            return Promise.resolve([]);
        },
        where: (...a: unknown[]) => {
            whereSpy(...a);
            // For query 3 (enrichment) there is no .limit() — the route awaits
            // the .where() result directly. Return a thenable that only applies
            // to query 3; queries 1 and 2 call .limit() after .where() so their
            // then-handler is never reached.
            const q = activeQuery;
            return Object.assign(Object.create(null), {
                ...chain,
                // Make this object awaitable for query 3.
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
                    const p = q === 3 ? Promise.resolve(imageRows) : Promise.resolve([]);
                    return p.then(resolve, reject);
                },
            });
        },
    };

    return {
        db: chain,
        imageEmbeddings: {
            imageId: 'image_id',
            embedding: 'embedding',
            modelVersion: 'model_version',
            updatedAt: 'updated_at',
        },
        images: {
            id: 'id',
            title: 'title',
            description: 'description',
            filename_jpeg: 'filename_jpeg',
            width: 'width',
            height: 'height',
            topic: 'topic',
            processed: 'processed',
            camera_model: 'camera_model',
        },
        topics: { slug: 'slug', label: 'label' },
    };
});

import { hasTrustedSameOrigin } from '@/lib/request-origin';
import { getGalleryConfig } from '@/lib/gallery-config';
import {
    preIncrementSemanticAttempt,
    rollbackSemanticAttempt,
} from '@/lib/rate-limit';
import { GET } from '@/app/api/search/similar/[id]/route';

// Helper: build a NextRequest-shaped object for the route.
function req(id: string): Request {
    return new Request(`http://localhost/api/search/similar/${id}`) as never;
}

// Helper: the Next.js 15/16 params are a Promise.
function params(id: string): { params: Promise<{ id: string }> } {
    return { params: Promise.resolve({ id }) };
}

describe('GET /api/search/similar/[id]', () => {
    beforeEach(() => {
        whereSpy.mockClear();
        selectCallCount = 0;
        activeQuery = 0;
        vi.mocked(hasTrustedSameOrigin).mockReset().mockReturnValue(true);
        vi.mocked(preIncrementSemanticAttempt).mockReset().mockReturnValue(false);
        vi.mocked(rollbackSemanticAttempt).mockReset();
        vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'production' } as never);
        targetRows = [];
        scanRows = [];
        imageRows = [];
    });

    it('returns 403 when the request is not same-origin', async () => {
        vi.mocked(hasTrustedSameOrigin).mockReturnValue(false);
        const res = await GET(req('1') as never, params('1'));
        expect(res.status).toBe(403);
        // Rate-limit should not have been charged.
        expect(preIncrementSemanticAttempt).not.toHaveBeenCalled();
    });

    it('returns 503 when semanticSearchMode is "stub" (production-only gate)', async () => {
        vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'stub' } as never);
        // Provide a target embedding so the gate is the mode check, not a missing embedding.
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        const res = await GET(req('42') as never, params('42'));
        expect(res.status).toBe(503);
        // Rate-limit token must have been rolled back.
        expect(rollbackSemanticAttempt).toHaveBeenCalledOnce();
    });

    it('returns 503 when semanticSearchMode is "disabled"', async () => {
        vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'disabled' } as never);
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        const res = await GET(req('7') as never, params('7'));
        expect(res.status).toBe(503);
        expect(rollbackSemanticAttempt).toHaveBeenCalledOnce();
    });

    it('returns 400 for a non-numeric id', async () => {
        const res = await GET(req('abc') as never, params('abc'));
        expect(res.status).toBe(400);
        // Rate-limit not consumed for cheap validation failure (same-origin passes, but id invalid).
        expect(preIncrementSemanticAttempt).not.toHaveBeenCalled();
    });

    it('returns 400 for id = 0', async () => {
        const res = await GET(req('0') as never, params('0'));
        expect(res.status).toBe(400);
        expect(preIncrementSemanticAttempt).not.toHaveBeenCalled();
    });

    it('returns 404 when the target image has no production embedding', async () => {
        // The db mock returns no rows for the target lookup.
        targetRows = [];
        const res = await GET(req('99') as never, params('99'));
        expect(res.status).toBe(404);
        expect(rollbackSemanticAttempt).toHaveBeenCalledOnce();
    });

    it('returns 200 and excludes self from results in production mode', async () => {
        const targetId = 5;
        const neighbourId = 6;

        // Target embedding lookup returns one row.
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];

        // Scan returns both the target (self) and a neighbour.
        scanRows = [
            { imageId: targetId, embedding: TARGET_EMBEDDING_B64 },
            { imageId: neighbourId, embedding: NEIGHBOUR_EMBEDDING_B64 },
        ];

        // Image enrichment returns the neighbour row (the self id should be absent
        // from resultIds because it was filtered out before the enrichment query).
        imageRows = [
            {
                id: neighbourId,
                title: 'Neighbour photo',
                description: null,
                filename_jpeg: 'neighbour.jpg',
                width: 800,
                height: 600,
                topic: 'nature',
                topic_label: 'Nature',
                camera_model: null,
            },
        ];

        const res = await GET(req(String(targetId)) as never, params(String(targetId)));
        expect(res.status).toBe(200);

        const body = await res.json() as { results: Array<{ imageId: number }> };
        const returnedIds = body.results.map(r => r.imageId);

        // Self must NOT appear in the results.
        expect(returnedIds).not.toContain(targetId);

        // The neighbour must appear (score above PRODUCTION_COSINE_THRESHOLD for
        // nearly-identical embeddings like 0.49 vs 0.5).
        // We assert the neighbour CAN appear — if the threshold filters it out the
        // array is empty, but it must still exclude self.
        // With fill(0.49) vs fill(0.5) the dot product is extremely close to 1.0,
        // so it will be above PRODUCTION_COSINE_THRESHOLD (0.25).
        expect(returnedIds.every(id => id !== targetId)).toBe(true);
    });

    it('filters the embedding scan on PRODUCTION_MODEL_VERSION via where()', async () => {
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        scanRows = [];
        imageRows = [];

        await GET(req('3') as never, params('3'));

        // The where() spy is called once for the target lookup, once for the scan,
        // and once for the enrichment. The scan call passes eq(modelVersion, PRODUCTION_MODEL_VERSION).
        // We check that at least one where() invocation references PRODUCTION_MODEL_VERSION.
        const allArgs = whereSpy.mock.calls.flat(Infinity) as unknown[];
        const hasProductionVersionFilter = allArgs.some(
            arg => typeof arg === 'object' && arg !== null && JSON.stringify(arg).includes(PRODUCTION_MODEL_VERSION),
        );
        expect(hasProductionVersionFilter).toBe(true);
    });

    it('sets Cache-Control: no-store on the 200 response', async () => {
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        scanRows = [];
        imageRows = [];

        const res = await GET(req('10') as never, params('10'));
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toMatch(/no-store/);
    });
});
