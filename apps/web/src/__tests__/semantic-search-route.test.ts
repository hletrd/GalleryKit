import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const {
    hasTrustedSameOriginMock,
    isRestoreMaintenanceActiveMock,
    getGalleryConfigMock,
    embedTextStubMock,
    embedTextRealMock,
    getClientIpMock,
    preIncrementSemanticAttemptMock,
    rollbackSemanticAttemptMock,
    dbSelectMock,
} = vi.hoisted(() => ({
    hasTrustedSameOriginMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    embedTextStubMock: vi.fn(),
    embedTextRealMock: vi.fn(),
    getClientIpMock: vi.fn(),
    preIncrementSemanticAttemptMock: vi.fn(),
    rollbackSemanticAttemptMock: vi.fn(),
    dbSelectMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
    headers: vi.fn(async () => ({
        get: (name: string) => {
            if (name === 'x-forwarded-for') return '203.0.113.50';
            return null;
        },
    })),
}));

vi.mock('@/lib/request-origin', () => ({
    hasTrustedSameOrigin: hasTrustedSameOriginMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('@/lib/clip-inference', () => ({
    embedTextStub: embedTextStubMock,
}));

vi.mock('@/lib/clip-model', () => ({
    embedTextReal: embedTextRealMock,
}));

vi.mock('@/lib/rate-limit', async () => {
    const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
    return {
        ...actual,
        getClientIp: getClientIpMock,
        preIncrementSemanticAttempt: preIncrementSemanticAttemptMock,
        rollbackSemanticAttempt: rollbackSemanticAttemptMock,
    };
});

vi.mock('@/db', () => ({
    db: {
        select: dbSelectMock,
    },
    imageEmbeddings: { imageId: 'imageEmbeddings.imageId', embedding: 'imageEmbeddings.embedding', modelVersion: 'imageEmbeddings.modelVersion', updatedAt: 'imageEmbeddings.updatedAt' },
    images: { id: 'images.id', title: 'images.title', description: 'images.description', filename_jpeg: 'images.filename_jpeg', width: 'images.width', height: 'images.height', topic: 'images.topic', processed: 'images.processed', camera_model: 'images.camera_model', lens_model: 'images.lens_model', capture_date: 'images.capture_date', created_at: 'images.created_at' },
    topics: { slug: 'topics.slug', label: 'topics.label' },
}));

import { POST } from '@/app/api/search/semantic/route';

const semanticRouteSource = readFileSync(
    resolve(__dirname, '../app/api/search/semantic/route.ts'),
    'utf8',
);

function mockRequest(body: unknown, headersInit: Record<string, string> = {}): NextRequest {
    const rawBody = JSON.stringify(body);
    return {
        headers: new Headers({
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(rawBody, 'utf8')),
            ...headersInit,
        }),
        text: async () => rawBody,
    } as unknown as NextRequest;
}

function mockRawRequest(rawBody: string, headersInit: Record<string, string> = {}): NextRequest {
    return {
        headers: new Headers({
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(rawBody, 'utf8')),
            ...headersInit,
        }),
        text: async () => rawBody,
    } as unknown as NextRequest;
}

describe('/api/search/semantic POST (C12-TE-01)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hasTrustedSameOriginMock.mockReturnValue(true);
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        // Stub is the default test mode. Stub and operator-gated production
        // both serve public requests; disabled fails closed before body reads.
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'stub' });
        getClientIpMock.mockReturnValue('203.0.113.50');
        preIncrementSemanticAttemptMock.mockReturnValue(false);
        embedTextStubMock.mockReturnValue(new Float32Array(512).fill(0.1));
        embedTextRealMock.mockResolvedValue(new Float32Array(512).fill(0.1));

        // Default DB mock: empty embeddings, empty image enrichment.
        // The imageEmbeddings scan now has a .where() before .orderBy().
        const emptyChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
                leftJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        groupBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
            }),
        };
        dbSelectMock.mockReturnValue(emptyChain);
    });

    it('returns 403 when same-origin check fails', async () => {
        hasTrustedSameOriginMock.mockReturnValue(false);

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    });

    it('returns 503 when restore maintenance is active', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Maintenance' });
    });

    it('returns 400 for non-finite Content-Length (C12-LOW-02)', async () => {
        const response = await POST(mockRequest({ query: 'mountain landscape' }, {
            'content-length': 'NaN',
        }));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Invalid Content-Length' });
    });

    it('returns 413 when Content-Length exceeds MAX_SEMANTIC_BODY_BYTES', async () => {
        const response = await POST(mockRequest({ query: 'mountain landscape' }, {
            'content-length': '99999',
        }));

        expect(response.status).toBe(413);
        await expect(response.json()).resolves.toEqual({ error: 'Request body too large' });
    });

    it('returns 411 before charging when Content-Length is missing', async () => {
        const response = await POST(mockRequest({ query: 'mountain landscape' }, {
            'content-length': '',
        }));

        expect(response.status).toBe(411);
        await expect(response.json()).resolves.toEqual({ error: 'Content-Length is required' });
        expect(preIncrementSemanticAttemptMock).not.toHaveBeenCalled();
    });

    it('rejects mixed-case chunked transfer encoding', async () => {
        const response = await POST(mockRequest({ query: 'mountain landscape' }, {
            'transfer-encoding': 'gzip, Chunked',
        }));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Chunked transfer encoding is not supported' });
        expect(preIncrementSemanticAttemptMock).not.toHaveBeenCalled();
    });

    it('charges and rejects post-read bodies that exceed the byte cap with multibyte text', async () => {
        const oversizedJson = JSON.stringify({ query: '山'.repeat(3000) });
        expect(oversizedJson.length).toBeLessThan(8192);
        expect(Buffer.byteLength(oversizedJson, 'utf8')).toBeGreaterThan(8192);

        const response = await POST(mockRawRequest(oversizedJson, {
            'content-length': String(oversizedJson.length),
        }));

        expect(response.status).toBe(413);
        await expect(response.json()).resolves.toEqual({ error: 'Request body too large' });
        expect(preIncrementSemanticAttemptMock).toHaveBeenCalledOnce();
        expect(rollbackSemanticAttemptMock).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON body', async () => {
        const req = {
            headers: new Headers({ 'content-type': 'application/json', 'content-length': '16' }),
            text: async () => '{ invalid json }',
        } as unknown as NextRequest;

        const response = await POST(req);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' });
    });

    it('returns 400 for invalid body shape (missing query)', async () => {
        const response = await POST(mockRequest({ topK: 5 }));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Invalid request body' });
    });

    it('returns 400 for query shorter than 3 characters', async () => {
        const response = await POST(mockRequest({ query: 'ab' }));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Query must be at least 3 characters' });
    });

    it('returns 400 for query longer than 200 code points', async () => {
        const response = await POST(mockRequest({ query: '가'.repeat(201) }));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Query must be 200 characters or fewer' });
    });

    it('returns 503 when semantic search mode is disabled', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'disabled' });
        const textMock = vi.fn(async () => JSON.stringify({ query: 'mountain landscape' }));
        const request = {
            headers: new Headers({ 'content-type': 'application/json', 'content-length': '30' }),
            text: textMock,
        } as unknown as NextRequest;

        const response = await POST(request);

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Semantic search is not fully configured' });
        expect(textMock).not.toHaveBeenCalled();
        expect(preIncrementSemanticAttemptMock).not.toHaveBeenCalled();
        expect(rollbackSemanticAttemptMock).not.toHaveBeenCalled();
    });

    it('returns 499 for already-aborted serving-mode requests before charging rate limit', async () => {
        const textMock = vi.fn(async () => JSON.stringify({ query: 'mountain landscape' }));
        const request = {
            headers: new Headers({ 'content-type': 'application/json', 'content-length': '30' }),
            signal: { aborted: true },
            text: textMock,
        } as unknown as NextRequest;

        const response = await POST(request);

        expect(response.status).toBe(499);
        await expect(response.json()).resolves.toEqual({ error: 'Request aborted' });
        expect(textMock).not.toHaveBeenCalled();
        expect(preIncrementSemanticAttemptMock).not.toHaveBeenCalled();
        expect(rollbackSemanticAttemptMock).not.toHaveBeenCalled();
    });

    it('returns 503 in production mode when no production embeddings exist', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'production' });

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Semantic search is not fully configured' });
        expect(embedTextRealMock).toHaveBeenCalledOnce();
        expect(embedTextStubMock).not.toHaveBeenCalled();
        expect(rollbackSemanticAttemptMock).not.toHaveBeenCalled();
    });

    it('returns 429 when rate limit is exceeded', async () => {
        preIncrementSemanticAttemptMock.mockReturnValue(true);

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(429);
        const json = await response.json();
        expect(json.error).toBe('Rate limited');
        expect(response.headers.get('Retry-After')).toBe('60');
    });

    it('returns 200 with empty results when no embeddings match', async () => {
        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ results: [] });
    });

    it('returns 200 with enriched results on successful search', async () => {
        const mockEmbeddingRows = [
            { imageId: 1, embedding: 'c29tZV9iYXNlNjRfc3RyaW5nX3RoYXRfaXNfZW5jb3VnaF9sb25nX2Zvcg==' },
        ];
        const mockImageRows = [
            {
                id: 1,
                title: 'Mountain',
                description: 'A mountain',
                filename_jpeg: 'mountain.jpg',
                width: 1920,
                height: 1080,
                topic: 'nature',
                topic_label: 'Nature',
                camera_model: 'Sony A7IV',
                lens_model: 'FE 35mm f/1.4',
                capture_date: '2026-02-03 04:05:06',
            },
        ];

        // AGG-R5C3-07 (TEST-R5C3-07): table-keyed dispatch (mirrors the
        // checkout-route AGG-R5C2-53 fix) instead of a call-order counter. The
        // previous `callCount === 1 → embeddings` coupling silently broke if the
        // route ever reordered its two queries. Dispatch on which schema object
        // was passed to `.from()`: imageEmbeddings has the unique `embedding`
        // key; images does not.
        dbSelectMock.mockImplementation(() => ({
            from: (table: Record<string, unknown>) => {
                const isEmbeddingQuery = 'embedding' in table;
                if (isEmbeddingQuery) {
                    // db.select(...).from(imageEmbeddings).where(...).orderBy(...).limit(...)
                    return {
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue(mockEmbeddingRows),
                            }),
                        }),
                    };
                }
                // Image enrichment: db.select(...).from(images).leftJoin(...).where(...)
                return {
                    leftJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(mockImageRows),
                    }),
                };
            },
        }));

        // Provide a valid base64 embedding that decodes to EMBEDDING_BYTES.
        // Fill with 0.5 so cosine similarity with an identical query vector is 1.0.
        const validBuf = Buffer.alloc(2048);
        for (let i = 0; i < 512; i++) {
            validBuf.writeFloatLE(0.5, i * 4);
        }
        const validBase64 = validBuf.toString('base64');
        mockEmbeddingRows[0].embedding = validBase64;

        // Return an embedding identical to the image embedding → cosine similarity = 1.0
        embedTextStubMock.mockReturnValue(new Float32Array(512).fill(0.5));

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.results).toBeInstanceOf(Array);
        expect(json.results.length).toBeGreaterThan(0);
        expect(json.results[0].imageId).toBe(1);
        expect(json.results[0].filename_jpeg).toBe('mountain.jpg');
        expect(json.results[0]).toHaveProperty('lens_model', 'FE 35mm f/1.4');
        expect(json.results[0]).toHaveProperty('capture_date', '2026-02-03 04:05:06');
    });

    it('skips malformed scanned embedding rows without failing the whole query', async () => {
        const validBuf = Buffer.alloc(2048);
        for (let i = 0; i < 512; i++) {
            validBuf.writeFloatLE(0.5, i * 4);
        }
        const mockEmbeddingRows = [
            { imageId: 99, embedding: Buffer.from('not-a-valid-embedding') },
            { imageId: 1, embedding: validBuf },
        ];
        const mockImageRows = [
            { id: 1, title: 'Mountain', description: 'A mountain', filename_jpeg: 'mountain.jpg', width: 1920, height: 1080, topic: 'nature', topic_label: 'Nature', camera_model: 'Sony A7IV' },
        ];

        dbSelectMock.mockImplementation(() => ({
            from: (table: Record<string, unknown>) => {
                const isEmbeddingQuery = 'embedding' in table;
                if (isEmbeddingQuery) {
                    return {
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue(mockEmbeddingRows),
                            }),
                        }),
                    };
                }
                return {
                    leftJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(mockImageRows),
                    }),
                };
            },
        }));
        embedTextStubMock.mockReturnValue(new Float32Array(512).fill(0.5));

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.results.map((result: { imageId: number }) => result.imageId)).toEqual([1]);
    });

    it('returns 500 and keeps rate-limit budget when embedding scan fails (AGG-12)', async () => {
        dbSelectMock.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockRejectedValue(new Error('DB timeout')),
                    }),
                }),
            }),
        });

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: 'Server error' });
        // AGG-12: rate-limit budget is NOT refunded after expensive work begins
        expect(rollbackSemanticAttemptMock).not.toHaveBeenCalled();
    });

    it('filters scanned embeddings by the active model version', () => {
        expect(semanticRouteSource).toContain('const activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION');
        expect(semanticRouteSource).toContain('.where(eq(imageEmbeddings.modelVersion, activeModelVersion))');
        expect(semanticRouteSource.indexOf('const activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION'))
            .toBeLessThan(semanticRouteSource.indexOf('.where(eq(imageEmbeddings.modelVersion, activeModelVersion))'));
    });
});
