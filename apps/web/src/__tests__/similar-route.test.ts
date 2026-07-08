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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    PRODUCTION_MODEL_VERSION,
    EMBEDDING_BYTES,
    SEMANTIC_SCAN_LIMIT,
} from '@/lib/clip-embeddings';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

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
const limitSpy = vi.fn();

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
        innerJoin: () => chain,
        leftJoin: () => chain,
        orderBy: () => chain,
        limit: (...args: unknown[]) => {
            limitSpy(...args);
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
            // AGG-C10-02 (run-6 cycle-10): the route SELECTs these two fields
            // (AGG-C8-10 parity) and SimilarResult requires them (AGG-C9-04);
            // the mock schema must declare them so the 200-path test can assert
            // they survive in the response and a future SELECT-drop fails loudly.
            lens_model: 'lens_model',
            capture_date: 'capture_date',
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

function abortedReq(id: string): Request {
    const controller = new AbortController();
    controller.abort();
    return new Request(`http://localhost/api/search/similar/${id}`, { signal: controller.signal }) as never;
}

// Helper: the Next.js 15/16 params are a Promise.
function params(id: string): { params: Promise<{ id: string }> } {
    return { params: Promise.resolve({ id }) };
}

describe('GET /api/search/similar/[id]', () => {
    beforeEach(() => {
        whereSpy.mockClear();
        limitSpy.mockClear();
        selectCallCount = 0;
        activeQuery = 0;
        vi.mocked(hasTrustedSameOrigin).mockReset().mockReturnValue(true);
        vi.mocked(isRestoreMaintenanceActive).mockReset().mockReturnValue(false);
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
        expect(preIncrementSemanticAttempt).toHaveBeenCalledOnce();
        expect(rollbackSemanticAttempt).not.toHaveBeenCalled();
    });

    it('returns 503 when semanticSearchMode is "disabled"', async () => {
        vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'disabled' } as never);
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        const res = await GET(req('7') as never, params('7'));
        expect(res.status).toBe(503);
        expect(preIncrementSemanticAttempt).toHaveBeenCalledOnce();
        expect(rollbackSemanticAttempt).not.toHaveBeenCalled();
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

    it('returns 499 for an already-aborted request before charging the semantic limiter', async () => {
        const res = await GET(abortedReq('42') as never, params('42'));
        expect(res.status).toBe(499);
        expect(preIncrementSemanticAttempt).not.toHaveBeenCalled();
        expect(rollbackSemanticAttempt).not.toHaveBeenCalled();
    });

    it('returns 404 when the target image has no production embedding', async () => {
        // The db mock returns no rows for the target lookup.
        targetRows = [];
        const res = await GET(req('99') as never, params('99'));
        expect(res.status).toBe(404);
        // Once target lookup DB work has been consumed, failures stay charged so
        // missing embeddings cannot be probed for free.
        expect(rollbackSemanticAttempt).not.toHaveBeenCalled();
    });

    // --- AGG-C9-03 (run-6 cycle-9): the three failure modes the sibling
    // semantic-search-route.test.ts already covers but similar-route omitted. ---

    it('returns 503 when restore-maintenance is active (before rate-limit is charged)', async () => {
        // Gate 2 (maintenance) fires before the rate-limit pre-increment, so no token
        // is consumed and nothing is rolled back.
        vi.mocked(isRestoreMaintenanceActive).mockReturnValue(true);
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        const res = await GET(req('42') as never, params('42'));
        expect(res.status).toBe(503);
        expect(preIncrementSemanticAttempt).not.toHaveBeenCalled();
        expect(rollbackSemanticAttempt).not.toHaveBeenCalled();
    });

    it('returns 429 when the per-IP semantic rate limit is exceeded', async () => {
        // preIncrementSemanticAttempt returning true means "over limit"; the route must
        // 429 without consuming DB work, and must NOT roll back (the increment stands).
        vi.mocked(preIncrementSemanticAttempt).mockReturnValue(true);
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        const res = await GET(req('42') as never, params('42'));
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBeTruthy();
        expect(rollbackSemanticAttempt).not.toHaveBeenCalled();
    });

    it('returns 404 when the target embedding row is present but corrupt', async () => {
        // A non-empty row whose base64 decodes to the wrong byte length: real
        // decodeEmbeddingColumn (NOT mocked) returns null → the corrupt-embedding 404
        // path, distinct from the missing-row 404 above. The rate-limit token is
        // not rolled back because target lookup DB work was already consumed.
        const corruptB64 = Buffer.from('not-a-512-dim-vector').toString('base64');
        // Sanity: this is intentionally NOT EMBEDDING_BYTES long once decoded.
        expect(Buffer.from(corruptB64, 'base64').length).not.toBe(EMBEDDING_BYTES);
        targetRows = [{ embedding: corruptB64 }];
        const res = await GET(req('42') as never, params('42'));
        expect(res.status).toBe(404);
        expect(rollbackSemanticAttempt).not.toHaveBeenCalled();
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
                // AGG-C10-02: exercise the lens/date enrichment fields so the
                // assertions below can confirm they reach the response body.
                lens_model: 'EF 50mm f/1.8',
                capture_date: '2026-01-02 03:04:05',
            },
        ];

        const res = await GET(req(String(targetId)) as never, params(String(targetId)));
        expect(res.status).toBe(200);

        const body = await res.json() as {
            results: Array<{ imageId: number; lens_model: string | null; capture_date: string | null }>;
        };
        const returnedIds = body.results.map(r => r.imageId);

        // Self must NOT appear in the results.
        expect(returnedIds).not.toContain(targetId);

        // AGG-C10-02: the route SELECTs lens_model + capture_date and maps them
        // into each result (AGG-C8-10 parity with the semantic route). Pin them
        // so a future SELECT-drop regression — which would re-blank the lens/date
        // on similar-photo cards — fails this test instead of passing silently.
        const neighbour = body.results.find(r => r.imageId === neighbourId);
        expect(neighbour).toBeDefined();
        expect(neighbour).toHaveProperty('lens_model', 'EF 50mm f/1.8');
        expect(neighbour).toHaveProperty('capture_date', '2026-01-02 03:04:05');
        expect(neighbour).not.toHaveProperty('score');

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

    it('applies the semantic scan cap to the executed embedding scan query', async () => {
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        scanRows = [];
        imageRows = [];

        const res = await GET(req('3') as never, params('3'));

        expect(res.status).toBe(200);
        expect(limitSpy).toHaveBeenCalledWith(1);
        expect(limitSpy).toHaveBeenCalledWith(SEMANTIC_SCAN_LIMIT);
    });

    it('sets Cache-Control: no-store on the 200 response', async () => {
        targetRows = [{ embedding: TARGET_EMBEDDING_B64 }];
        scanRows = [];
        imageRows = [];

        const res = await GET(req('10') as never, params('10'));
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toMatch(/no-store/);
    });

    it('source-locks target and scan queries to processed images only', () => {
        const source = readFileSync(resolve(__dirname, '../app/api/search/similar/[id]/route.ts'), 'utf8');

        expect(source.match(/\.innerJoin\(images,\s*eq\(imageEmbeddings\.imageId,\s*images\.id\)\)/g)?.length).toBeGreaterThanOrEqual(2);
        expect(source.match(/eq\(images\.processed,\s*true\)/g)?.length).toBeGreaterThanOrEqual(3);
    });
});
