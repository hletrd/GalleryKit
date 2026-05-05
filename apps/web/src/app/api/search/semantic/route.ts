/**
 * US-P51: Public semantic search endpoint.
 *
 * POST /api/search/semantic
 *   Body: { query: string, topK?: number }
 *   - Requires same-origin (no admin auth)
 *   - Rate-limit: 30 requests / min / IP (in-memory, ResetAt pattern)
 *   - Embeds query via stub CLIP text encoder
 *   - Scans up to SEMANTIC_SCAN_LIMIT (5000) most-recent embeddings
 *   - Returns top-K image IDs with cosine score above COSINE_THRESHOLD (0.18)
 *
 * NOTE: The stub encoder produces deterministic but NOT semantically meaningful
 * embeddings. Enable semantic_search_enabled only after running the backfill
 * script and (in a future cycle) replacing the stub with real ONNX inference.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db, imageEmbeddings, images, topics } from '@/db';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { hasTrustedSameOrigin } from '@/lib/request-origin';
import { getClientIp } from '@/lib/rate-limit';
import { createResetAtBoundedMap } from '@/lib/bounded-map';
import {
    cosineSimilarity,
    bufferToEmbedding,
    topK,
    COSINE_THRESHOLD,
    SEMANTIC_TOP_K_DEFAULT,
    SEMANTIC_TOP_K_MAX,
    SEMANTIC_SCAN_LIMIT,
    EMBEDDING_BYTES,
} from '@/lib/clip-embeddings';
import { embedTextStub } from '@/lib/clip-inference';
import { getGalleryConfig } from '@/lib/gallery-config';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export const dynamic = 'force-dynamic';

// Per-IP rate-limit: 30 requests / minute
const SEMANTIC_RATE_LIMIT_MAX = 30;
const SEMANTIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SEMANTIC_RATE_LIMIT_MAX_KEYS = 2000;
const semanticRateLimit = createResetAtBoundedMap<string>(SEMANTIC_RATE_LIMIT_MAX_KEYS);

export function checkAndIncrementSemanticRateLimit(ip: string, now: number): boolean {
    semanticRateLimit.prune(now);
    const entry = semanticRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        semanticRateLimit.set(ip, { count: 1, resetAt: now + SEMANTIC_RATE_LIMIT_WINDOW_MS });
    } else {
        entry.count++;
    }
    return (semanticRateLimit.get(ip)?.count ?? 0) > SEMANTIC_RATE_LIMIT_MAX;
}

export function resetSemanticRateLimitForTests(): void {
    semanticRateLimit.clear();
}

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

export async function POST(request: NextRequest): Promise<Response> {
    // Same-origin check
    if (!hasTrustedSameOrigin(request.headers)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    if (isRestoreMaintenanceActive()) {
        return NextResponse.json({ error: 'Maintenance' }, { status: 503, headers: NO_STORE_HEADERS });
    }

    // Rate-limit
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    const overLimit = checkAndIncrementSemanticRateLimit(ip, now);
    if (overLimit) {
        return NextResponse.json(
            { error: 'Rate limited' },
            { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' } },
        );
    }

    // Check semantic search is enabled
    let semanticEnabled = false;
    try {
        const config = await getGalleryConfig();
        semanticEnabled = config.semanticSearchEnabled;
    } catch {
        // fail closed
    }
    if (!semanticEnabled) {
        return NextResponse.json({ error: 'Semantic search is not enabled' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    // Parse body
    let query: string;
    let topKParam: number;
    try {
        const body = await request.json() as unknown;
        if (
            typeof body !== 'object' ||
            body === null ||
            typeof (body as Record<string, unknown>).query !== 'string'
        ) {
            return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE_HEADERS });
        }
        const bodyObj = body as Record<string, unknown>;
        query = (bodyObj.query as string).trim();
        const topKRaw = bodyObj.topK !== undefined ? Number(bodyObj.topK) : SEMANTIC_TOP_K_DEFAULT;
        topKParam = Math.min(Math.max(Number.isFinite(topKRaw) ? Math.floor(topKRaw) : SEMANTIC_TOP_K_DEFAULT, 1), SEMANTIC_TOP_K_MAX);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (query.length < 3) {
        return NextResponse.json({ error: 'Query must be at least 3 characters' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Embed query
    const queryEmbedding = embedTextStub(query);

    // Scan up to SEMANTIC_SCAN_LIMIT most-recent embeddings (HARD cap)
    let rows: { imageId: number; embedding: string | null }[];
    try {
        rows = await db
            .select({ imageId: imageEmbeddings.imageId, embedding: imageEmbeddings.embedding })
            .from(imageEmbeddings)
            .orderBy(desc(imageEmbeddings.updatedAt))
            .limit(SEMANTIC_SCAN_LIMIT);
    } catch {
        return NextResponse.json({ error: 'Server error' }, { status: 500, headers: NO_STORE_HEADERS });
    }

    // Compute cosine similarity for all scanned embeddings
    const scored = rows
        .filter(row => row.embedding !== null && row.embedding.length > 0)
        .map((row) => {
            try {
                const buf = Buffer.from(row.embedding as string, 'base64');
                if (buf.length !== EMBEDDING_BYTES) return null;
                const imgEmbedding = bufferToEmbedding(buf);
                const score = cosineSimilarity(queryEmbedding, imgEmbedding);
                return { imageId: row.imageId, score };
            } catch {
                return null;
            }
        })
        .filter((m): m is { imageId: number; score: number } => m !== null);

    const results = topK(scored, topKParam, COSINE_THRESHOLD);

    // Enrich results with basic image metadata so the client can render
    // meaningful result cards (thumbnails, titles, topics) instead of
    // bare imageId+score pairs.
    let enrichedResults: Array<{ imageId: number; score: number; title: string | null; description: string | null; filename_jpeg: string; width: number; height: number; topic: string; topic_label: string | null; camera_model: string | null }> = [];
    if (results.length > 0) {
        const resultIds = results.map(r => r.imageId);
        const scoreMap = new Map(results.map(r => [r.imageId, r.score]));
        try {
            const imageRows = await db.select({
                id: images.id,
                title: images.title,
                description: images.description,
                filename_jpeg: images.filename_jpeg,
                width: images.width,
                height: images.height,
                topic: images.topic,
                topic_label: topics.label,
                camera_model: images.camera_model,
            })
            .from(images)
            .leftJoin(topics, eq(images.topic, topics.slug))
            .where(and(
                inArray(images.id, resultIds),
                eq(images.processed, true),
            ));

            enrichedResults = imageRows
                .map(row => ({
                    imageId: row.id,
                    score: scoreMap.get(row.id) ?? 0,
                    title: row.title,
                    description: row.description,
                    filename_jpeg: row.filename_jpeg,
                    width: row.width,
                    height: row.height,
                    topic: row.topic,
                    topic_label: row.topic_label,
                    camera_model: row.camera_model,
                }))
                .sort((a, b) => b.score - a.score);
        } catch {
            // Fallback to bare results if image fetch fails
            enrichedResults = results.map(r => ({
                imageId: r.imageId,
                score: r.score,
                title: null,
                description: null,
                filename_jpeg: '',
                width: 0,
                height: 0,
                topic: '',
                topic_label: null,
                camera_model: null,
            }));
        }
    }

    return NextResponse.json(
        { results: enrichedResults },
        { headers: NO_STORE_HEADERS },
    );
}
