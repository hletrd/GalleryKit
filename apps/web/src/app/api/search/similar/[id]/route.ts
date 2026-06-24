/**
 * GET /api/search/similar/[id]
 *
 * Public image-to-image "similar photos" endpoint (Spec §6 / Task-10).
 *
 * Returns the top-K most similar images to the given image id, ranked by
 * cosine similarity of their stored CLIP embeddings.
 *
 * Gates (in order):
 *   1. Same-origin check (hasTrustedSameOrigin) → 403 else.
 *   2. Restore-maintenance guard → 503 else.
 *   3. Positive-integer id validation → 400 else.
 *   4. Rate-limit pre-increment (Pattern 2 — rolled back on every early-return
 *      before expensive DB work begins) → 429 if over limit.
 *   5. Production-only mode gate: semanticSearchMode must be 'production' →
 *      503 else (rollback). Stub vectors are random, so "similar" would be
 *      meaningless in stub mode.
 *   6. Target embedding lookup for (id, PRODUCTION_MODEL_VERSION) → 404 if absent
 *      (rollback).
 *   7. Scan up to SEMANTIC_SCAN_LIMIT most-recent production embeddings, compute
 *      cosine vs target, exclude self, apply topK / PRODUCTION_COSINE_THRESHOLD.
 *   8. Enrich result ids with image metadata (same SELECT/JOIN as semantic route).
 *   9. Return { results: enriched } with NO_STORE_HEADERS.
 *
 * Rate-limit posture: Pattern 2 (rollback on validation failure). Shares the
 * same `preIncrementSemanticAttempt` / `rollbackSemanticAttempt` budget as the
 * semantic text-search endpoint — both are embedding-scan operations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, imageEmbeddings, images, topics } from '@/db';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { hasTrustedSameOrigin } from '@/lib/request-origin';
import { getClientIp, preIncrementSemanticAttempt, rollbackSemanticAttempt } from '@/lib/rate-limit';
import {
    dotProduct,
    decodeEmbeddingColumn,
    topK,
    SEMANTIC_TOP_K_DEFAULT,
    SEMANTIC_SCAN_LIMIT,
    PRODUCTION_MODEL_VERSION,
    PRODUCTION_COSINE_THRESHOLD,
} from '@/lib/clip-embeddings';
import { getGalleryConfig } from '@/lib/gallery-config';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

export const dynamic = 'force-dynamic';
// Pin to Node runtime: imports mysql2 (Node-only), Buffer, and in-process
// rate-limit Maps. Matches the convention of every other DB/rate-limit route.
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
    // Gate 1: same-origin check.
    if (!hasTrustedSameOrigin(request.headers)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    // Gate 2: restore-maintenance guard.
    if (isRestoreMaintenanceActive()) {
        return NextResponse.json({ error: 'Maintenance' }, { status: 503, headers: NO_STORE_HEADERS });
    }

    // Gate 3: validate the id param as a positive integer.
    // Next.js 15/16 passes route params as a Promise.
    const { id: idStr } = await params;
    if (!/^\d+$/.test(idStr)) {
        return NextResponse.json({ error: 'Invalid image ID' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ error: 'Invalid image ID' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Gate 4: rate-limit pre-increment (Pattern 2 — rollback on all subsequent
    // early-return paths before expensive embedding/DB work begins).
    const ip = getClientIp(request.headers);
    const now = Date.now();
    const overLimit = preIncrementSemanticAttempt(ip, now);
    if (overLimit) {
        return NextResponse.json(
            { error: 'Rate limited' },
            { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' } },
        );
    }

    // Gate 5: production-only mode gate. Stub vectors are random; cosine
    // similarity over random vectors is meaningless, so we serve only when the
    // real CLIP encoder is active.
    let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
    try {
        const config = await getGalleryConfig();
        semanticMode = config.semanticSearchMode;
    } catch {
        // fail closed — config unavailable means disabled
    }
    if (semanticMode !== 'production') {
        rollbackSemanticAttempt(ip);
        return NextResponse.json(
            { error: 'Similar photos requires production semantic search mode' },
            { status: 503, headers: NO_STORE_HEADERS },
        );
    }

    // Gate 6: load the target image's production embedding.
    let targetEmbedding: Float32Array;
    try {
        const targetRows = await db
            .select({ embedding: imageEmbeddings.embedding })
            .from(imageEmbeddings)
            .where(and(
                eq(imageEmbeddings.imageId, id),
                eq(imageEmbeddings.modelVersion, PRODUCTION_MODEL_VERSION),
            ))
            .limit(1);

        if (targetRows.length === 0 || !targetRows[0].embedding) {
            rollbackSemanticAttempt(ip);
            return NextResponse.json({ error: 'No embedding found for this image' }, { status: 404, headers: NO_STORE_HEADERS });
        }

        // AGG-C10-01: decode the raw-Buffer (current) or legacy base64 column value.
        const decoded = decodeEmbeddingColumn(targetRows[0].embedding);
        if (decoded === null) {
            rollbackSemanticAttempt(ip);
            return NextResponse.json({ error: 'Embedding data is corrupt' }, { status: 404, headers: NO_STORE_HEADERS });
        }
        targetEmbedding = decoded;
    } catch {
        rollbackSemanticAttempt(ip);
        return NextResponse.json({ error: 'Server error' }, { status: 500, headers: NO_STORE_HEADERS });
    }

    // Step 7: scan up to SEMANTIC_SCAN_LIMIT most-recent production embeddings,
    // compute cosine vs target, exclude self, rank with topK.
    let rows: { imageId: number; embedding: string | null }[];
    try {
        rows = await db
            .select({ imageId: imageEmbeddings.imageId, embedding: imageEmbeddings.embedding })
            .from(imageEmbeddings)
            .where(eq(imageEmbeddings.modelVersion, PRODUCTION_MODEL_VERSION))
            .orderBy(desc(imageEmbeddings.updatedAt))
            .limit(SEMANTIC_SCAN_LIMIT);
    } catch {
        rollbackSemanticAttempt(ip);
        return NextResponse.json({ error: 'Server error' }, { status: 500, headers: NO_STORE_HEADERS });
    }

    // AGG-C8-09 (run-6 cycle-8): this route is production-only (Gate 5 returns 503 for
    // any non-production mode), so every scanned vector AND the target are L2-normalized
    // (truncateAndNormalize). dotProduct === cosine for unit vectors but skips the two
    // per-row norm recomputations + sqrts. No stub fallback needed here (unlike the
    // semantic route) because stub mode can never reach this scan.
    const scored = rows
        .filter(row => row.imageId !== id)
        .map((row) => {
            const imgEmbedding = decodeEmbeddingColumn(row.embedding);
            if (imgEmbedding === null) return null;
            const score = dotProduct(targetEmbedding, imgEmbedding);
            return { imageId: row.imageId, score };
        })
        .filter((m): m is { imageId: number; score: number } => m !== null);

    const results = topK(scored, SEMANTIC_TOP_K_DEFAULT, PRODUCTION_COSINE_THRESHOLD);

    // Step 8: enrich results with image metadata using the same SELECT/JOIN
    // shape as the semantic route so result cards render consistently.
    let enrichedResults: Array<{
        imageId: number;
        score: number;
        title: string | null;
        description: string | null;
        filename_jpeg: string;
        width: number;
        height: number;
        topic: string;
        topic_label: string | null;
        camera_model: string | null;
        lens_model: string | null;
        capture_date: string | null;
    }> = [];

    if (results.length > 0) {
        const resultIds = results.map(r => r.imageId);
        const scoreMap = new Map(results.map(r => [r.imageId, r.score]));
        try {
            const imageRows = await db
                .select({
                    id: images.id,
                    title: images.title,
                    description: images.description,
                    filename_jpeg: images.filename_jpeg,
                    width: images.width,
                    height: images.height,
                    topic: images.topic,
                    topic_label: topics.label,
                    camera_model: images.camera_model,
                    // AGG-C8-10 (run-6 cycle-8): parity with the semantic route's
                    // enrichment (AGG-C10-11a) — without these, similar-result cards
                    // rendered with the shared component show blank lens/date.
                    lens_model: images.lens_model,
                    capture_date: images.capture_date,
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
                    lens_model: row.lens_model,
                    capture_date: row.capture_date,
                }))
                .sort((a, b) => b.score - a.score);
        } catch {
            // Fallback to empty results if image enrichment query fails.
            enrichedResults = [];
        }
    }

    return NextResponse.json(
        { results: enrichedResults },
        { headers: NO_STORE_HEADERS },
    );
}
