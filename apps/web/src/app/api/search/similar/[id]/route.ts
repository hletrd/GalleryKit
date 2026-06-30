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
 *   4. Rate-limit pre-increment before DB-backed config work → 429 if over limit.
 *   5. Production-only mode gate: semanticSearchMode must be 'production' →
 *      503 else. Stub vectors are random, so "similar" would be
 *      meaningless in stub mode.
 *   6. Target embedding lookup for (id, PRODUCTION_MODEL_VERSION) → 404 if absent
 *      (no rollback; DB work was already consumed).
 *   7. Scan up to SEMANTIC_SCAN_LIMIT most-recent production embeddings, compute
 *      cosine vs target, exclude self, apply topK / PRODUCTION_COSINE_THRESHOLD.
 *   8. Enrich result ids with image metadata (same SELECT/JOIN as semantic route).
 *   9. Return { results: enriched } with NO_STORE_HEADERS.
 *
 * Rate-limit posture: Pattern 2 until protected DB work begins. Shares the
 * same `preIncrementSemanticAttempt` budget as the semantic text-search
 * endpoint — both are embedding-scan operations. Once this route reaches the
 * DB-backed mode lookup, failures stay charged to avoid turning disabled-mode
 * probes, missing/corrupt embeddings, or transient DB errors into free probes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, imageEmbeddings, images, topics } from '@/db';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { hasTrustedSameOrigin } from '@/lib/request-origin';
import { getClientIp, preIncrementSemanticAttempt } from '@/lib/rate-limit';
import {
    dotProduct,
    decodeEmbeddingColumn,
    topK,
    SEMANTIC_TOP_K_DEFAULT,
    SEMANTIC_SCAN_LIMIT,
    PRODUCTION_MODEL_VERSION,
    PRODUCTION_COSINE_THRESHOLD,
} from '@/lib/clip-embeddings';
import { searchEnrichmentSelectFields } from '@/lib/search-enrichment-fields';
import { getGalleryConfig } from '@/lib/gallery-config';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { parseSafePositiveInteger } from '@/lib/validation';

export const dynamic = 'force-dynamic';
// Pin to Node runtime: imports mysql2 (Node-only), Buffer, and in-process
// rate-limit Maps. Matches the convention of every other DB/rate-limit route.
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

function abortResponse() {
    return NextResponse.json({ error: 'Request aborted' }, { status: 499, headers: NO_STORE_HEADERS });
}

function isRequestAborted(request: NextRequest) {
    return request.signal?.aborted === true;
}

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

    if (isRequestAborted(request)) {
        return abortResponse();
    }

    // Gate 3: validate the id param as a positive integer.
    // Next.js 15/16 passes route params as a Promise.
    const { id: idStr } = await params;
    const id = parseSafePositiveInteger(idStr);
    if (id === null) {
        return NextResponse.json({ error: 'Invalid image ID' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (isRequestAborted(request)) {
        return abortResponse();
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
    // real CLIP encoder is active. The DB-backed config lookup is protected
    // work, so disabled/stub responses keep the pre-incremented budget.
    let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
    try {
        const config = await getGalleryConfig();
        semanticMode = config.semanticSearchMode;
    } catch {
        // fail closed — config unavailable means disabled
    }
    if (semanticMode !== 'production') {
        return NextResponse.json(
            { error: 'Similar photos requires production semantic search mode' },
            { status: 503, headers: NO_STORE_HEADERS },
        );
    }

    if (isRequestAborted(request)) {
        return abortResponse();
    }

    // Gate 6: load the target image's production embedding.
    let targetEmbedding: Float32Array;
    try {
        const targetRows = await db
            .select({ embedding: imageEmbeddings.embedding })
            .from(imageEmbeddings)
            .innerJoin(images, eq(imageEmbeddings.imageId, images.id))
            .where(and(
                eq(imageEmbeddings.imageId, id),
                eq(imageEmbeddings.modelVersion, PRODUCTION_MODEL_VERSION),
                eq(images.processed, true),
            ))
            .limit(1);

        if (targetRows.length === 0 || !targetRows[0].embedding) {
            return NextResponse.json({ error: 'No embedding found for this image' }, { status: 404, headers: NO_STORE_HEADERS });
        }

        // AGG-C10-01: decode the raw-Buffer (current) or legacy base64 column value.
        const decoded = decodeEmbeddingColumn(targetRows[0].embedding);
        if (decoded === null) {
            return NextResponse.json({ error: 'Embedding data is corrupt' }, { status: 404, headers: NO_STORE_HEADERS });
        }
        targetEmbedding = decoded;
    } catch {
        return NextResponse.json({ error: 'Server error' }, { status: 500, headers: NO_STORE_HEADERS });
    }

    if (isRequestAborted(request)) {
        return abortResponse();
    }

    // Step 7: scan up to SEMANTIC_SCAN_LIMIT most-recent production embeddings,
    // compute cosine vs target, exclude self, rank with topK.
    let rows: { imageId: number; embedding: string | null }[];
    try {
        rows = await db
            .select({ imageId: imageEmbeddings.imageId, embedding: imageEmbeddings.embedding })
            .from(imageEmbeddings)
            .innerJoin(images, eq(imageEmbeddings.imageId, images.id))
            .where(and(
                eq(imageEmbeddings.modelVersion, PRODUCTION_MODEL_VERSION),
                eq(images.processed, true),
            ))
            .orderBy(desc(imageEmbeddings.updatedAt))
            .limit(SEMANTIC_SCAN_LIMIT);
    } catch {
        return NextResponse.json({ error: 'Server error' }, { status: 500, headers: NO_STORE_HEADERS });
    }

    if (isRequestAborted(request)) {
        return abortResponse();
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

    if (isRequestAborted(request)) {
        return abortResponse();
    }

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
            // R19C19 A2/MAJOR-1: shared compile-guarded enrichment select (see
            // `searchEnrichmentSelectFields` in lib/search-enrichment-fields.ts)
            // — replaces the formerly hand-copied inline select so a PII column is
            // a tsc error. Kept in sync with the semantic route by sharing one
            // definition.
            const imageRows = await db
                .select(searchEnrichmentSelectFields)
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
        } catch (e) {
            console.error('[search/similar] result enrichment query failed', e);
            return NextResponse.json(
                { error: 'Similar photos could not be loaded' },
                { status: 503, headers: NO_STORE_HEADERS },
            );
        }
    }

    return NextResponse.json(
        { results: enrichedResults },
        { headers: NO_STORE_HEADERS },
    );
}
