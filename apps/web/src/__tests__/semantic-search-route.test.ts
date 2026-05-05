import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
    hasTrustedSameOriginMock,
    isRestoreMaintenanceActiveMock,
    getGalleryConfigMock,
    embedTextStubMock,
    getClientIpMock,
    preIncrementSemanticAttemptMock,
    rollbackSemanticAttemptMock,
    dbSelectMock,
} = vi.hoisted(() => ({
    hasTrustedSameOriginMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    embedTextStubMock: vi.fn(),
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
    imageEmbeddings: { imageId: 'imageEmbeddings.imageId', embedding: 'imageEmbeddings.embedding', updatedAt: 'imageEmbeddings.updatedAt' },
    images: { id: 'images.id', title: 'images.title', description: 'images.description', filename_jpeg: 'images.filename_jpeg', width: 'images.width', height: 'images.height', topic: 'images.topic', processed: 'images.processed', camera_model: 'images.camera_model', lens_model: 'images.lens_model', capture_date: 'images.capture_date', created_at: 'images.created_at' },
    topics: { slug: 'topics.slug', label: 'topics.label' },
}));

import { POST } from '@/app/api/search/semantic/route';

function mockRequest(body: unknown, headersInit: Record<string, string> = {}): NextRequest {
    return {
        headers: new Headers({ 'content-type': 'application/json', ...headersInit }),
        text: async () => JSON.stringify(body),
    } as unknown as NextRequest;
}

describe('/api/search/semantic POST (C12-TE-01)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hasTrustedSameOriginMock.mockReturnValue(true);
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'production' });
        getClientIpMock.mockReturnValue('203.0.113.50');
        preIncrementSemanticAttemptMock.mockReturnValue(false);
        embedTextStubMock.mockReturnValue(new Float32Array(512).fill(0.1));

        // Default DB mock: empty embeddings, empty image enrichment
        const emptyChain = {
            from: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
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

    it('returns 400 for invalid JSON body', async () => {
        const req = {
            headers: new Headers({ 'content-type': 'application/json' }),
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

    it('returns 503 when semantic search is not in production mode', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'disabled' });

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Semantic search is not fully configured' });
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
            { id: 1, title: 'Mountain', description: 'A mountain', filename_jpeg: 'mountain.jpg', width: 1920, height: 1080, topic: 'nature', topic_label: 'Nature', camera_model: 'Sony A7IV' },
        ];

        // Build a chainable mock that returns embeddings first, then images
        let callCount = 0;
        dbSelectMock.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // Embedding query: db.select(...).from(imageEmbeddings).orderBy(...).limit(...)
                return {
                    from: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(mockEmbeddingRows),
                        }),
                    }),
                };
            }
            // Image enrichment query: db.select(...).from(images).leftJoin(...).where(...)
            return {
                from: vi.fn().mockReturnValue({
                    leftJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(mockImageRows),
                    }),
                }),
            };
        });

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
    });

    it('returns 500 and rolls back rate limit when embedding scan fails', async () => {
        dbSelectMock.mockReturnValue({
            from: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockRejectedValue(new Error('DB timeout')),
                }),
            }),
        });

        const response = await POST(mockRequest({ query: 'mountain landscape' }));

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: 'Server error' });
        expect(rollbackSemanticAttemptMock).toHaveBeenCalledWith('203.0.113.50');
    });
});
