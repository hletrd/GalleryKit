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
 * Rate-limit posture: Pattern 2 (rollback on validation failure). The counter
 * is consumed AFTER cheap validation gates (same-origin, maintenance,
 * semantic-enabled, body shape, query length) and rolled back on any
 * early-return path before expensive embedding work begins.
 *
 * Serving gate: this endpoint SERVES requests in two modes:
 *   - 'stub'       — demo/experimental posture. Embeds via `embedTextStub` (sync,
 *                    random output). Scans only rows with model_version = CLIP_MODEL_VERSION.
 *                    The visitor-facing search toggle carries an explicit "experimental"
 *                    disclaimer (`search.semanticExperimentalHint`).
 *   - 'production' — real CLIP encoder (jina-clip-v2, async). Scans only rows with
 *                    model_version = PRODUCTION_MODEL_VERSION so stub rows never
 *                    pollute production results and vice-versa. Uses
 *                    PRODUCTION_COSINE_THRESHOLD (0.25) instead of COSINE_THRESHOLD (0.18).
 *
 * Every other mode returns 503:
 *   - 'disabled' (the default) → 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, imageEmbeddings, images, topics } from '@/db';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { hasTrustedSameOrigin } from '@/lib/request-origin';
import { getClientIp } from '@/lib/rate-limit';
import {
    preIncrementSemanticAttempt,
    rollbackSemanticAttempt,
} from '@/lib/rate-limit';
import {
    cosineSimilarity,
    bufferToEmbedding,
    topK,
    COSINE_THRESHOLD,
    SEMANTIC_TOP_K_DEFAULT,
    SEMANTIC_TOP_K_MAX,
    SEMANTIC_SCAN_LIMIT,
    EMBEDDING_BYTES,
    CLIP_MODEL_VERSION,
    PRODUCTION_MODEL_VERSION,
    PRODUCTION_COSINE_THRESHOLD,
} from '@/lib/clip-embeddings';
import { embedTextStub } from '@/lib/clip-inference';
import { embedTextReal } from '@/lib/clip-model';
import { getGalleryConfig } from '@/lib/gallery-config';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { countCodePoints } from '@/lib/utils';

export const dynamic = 'force-dynamic';
// R21-L1: pin to Node runtime explicitly. The route imports `db`
// (mysql2 — Node-only), `Buffer.from`, and the in-process rate-limit
// Map (relies on shared process state); none are Edge-compatible.
// Matches the convention established in /api/checkout/[imageId]
// (R20-L2) and every other paid-flow / public-API route in the repo.
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

/** Clamp the user-supplied topK parameter to the valid range [1, SEMANTIC_TOP_K_MAX].
 *  Falls back to SEMANTIC_TOP_K_DEFAULT for missing, non-finite, or non-numeric values.
 *
 *  COR-R5C2-06 / AGG-R5C2-33: reject non-number `raw` explicitly. `Number(true)`,
 *  `Number([])`, and `Number(['5'])` all coerce to finite numbers (1, 0, 5), so a
 *  bare `Number(raw)` would silently accept booleans / empty arrays / single-element
 *  arrays as a topK. Anything defined that is not already a `number` falls back to
 *  the default; `undefined` (omitted) also falls back.
 *
 *  AGG-R5C3-15 (COR-R5C3-06) — CALLER CONTRACT: `raw` MUST be a parsed-JSON
 *  number. A numeric STRING like `"5"` is `typeof 'string'` and therefore returns
 *  the DEFAULT by design (not 5). This route's only caller passes
 *  `bodyObj.topK` from `JSON.parse(...)`, so a JSON number arrives as a number.
 *  Any future query-string caller MUST pre-coerce (`Number(searchParams.get(...))`)
 *  before calling this — do NOT loosen the typeof guard to accept numeric strings,
 *  or the explicit non-number rejection above is defeated. */
export function clampSemanticTopK(raw: unknown): number {
    if (raw !== undefined && typeof raw !== 'number') return SEMANTIC_TOP_K_DEFAULT;
    const topKRaw = raw !== undefined ? raw : SEMANTIC_TOP_K_DEFAULT;
    return Math.min(Math.max(Number.isFinite(topKRaw) ? Math.floor(topKRaw) : SEMANTIC_TOP_K_DEFAULT, 1), SEMANTIC_TOP_K_MAX);
}

/** Maximum acceptable request body size in bytes. Semantic queries are short
 *  strings (< 200 code points), so a multi-KB body is always malicious. */
const MAX_SEMANTIC_BODY_BYTES = 8192;

export async function POST(request: NextRequest): Promise<Response> {
    // Same-origin check
    if (!hasTrustedSameOrigin(request.headers)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    if (isRestoreMaintenanceActive()) {
        return NextResponse.json({ error: 'Maintenance' }, { status: 503, headers: NO_STORE_HEADERS });
    }

    // Content-Type validation
    // R20-L4: tighten from `.includes('application/json')` to a prefix
    // check so JSON sub-types that don't belong on this endpoint (e.g.
    // `application/json-patch+json`, `application/ld+json`) are rejected.
    // The header is lower-cased to handle clients that send
    // `Application/JSON`. The optional `; charset=utf-8` and similar
    // parameters still pass because they appear after the media-type.
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
        return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    // Reject sub-types that incidentally share the `application/json` prefix
    // (e.g. `application/json-patch`). A valid media-type is followed by `;`,
    // whitespace, or end-of-string.
    const afterJson = contentType.slice('application/json'.length);
    if (afterJson.length > 0 && !/^[\s;]/.test(afterJson)) {
        return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Reject chunked transfer encoding — body size cannot be verified
    const transferEncoding = request.headers.get('transfer-encoding');
    if (transferEncoding?.includes('chunked')) {
        return NextResponse.json({ error: 'Chunked transfer encoding is not supported' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Body size guard — reject oversized payloads before parsing
    const contentLength = request.headers.get('content-length');
    if (contentLength) {
        const contentLengthNum = Number(contentLength);
        if (!Number.isFinite(contentLengthNum) || contentLengthNum < 0) {
            return NextResponse.json(
                { error: 'Invalid Content-Length' },
                { status: 400, headers: NO_STORE_HEADERS },
            );
        }
        if (contentLengthNum > MAX_SEMANTIC_BODY_BYTES) {
            return NextResponse.json(
                { error: 'Request body too large' },
                { status: 413, headers: NO_STORE_HEADERS },
            );
        }
    }

    // Parse body — read as text first with explicit size cap
    let rawBody: string;
    try {
        rawBody = await request.text();
    } catch {
        return NextResponse.json({ error: 'Failed to read request body' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (rawBody.length > MAX_SEMANTIC_BODY_BYTES) {
        return NextResponse.json(
            { error: 'Request body too large' },
            { status: 413, headers: NO_STORE_HEADERS },
        );
    }

    let query: string;
    let topKParam: number;
    try {
        const body = JSON.parse(rawBody) as unknown;
        if (
            typeof body !== 'object' ||
            body === null ||
            typeof (body as Record<string, unknown>).query !== 'string'
        ) {
            return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE_HEADERS });
        }
        const bodyObj = body as Record<string, unknown>;
        query = (bodyObj.query as string).trim();
        topKParam = clampSemanticTopK(bodyObj.topK);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // C18-MED-02: use countCodePoints for consistent codepoint-aware length
    // validation, matching the pattern used in public.ts and process-image.ts.
    if (countCodePoints(query) < 3) {
        return NextResponse.json({ error: 'Query must be at least 3 characters' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // CRT-R5C1-01: Capability gate — only 'stub' mode is the current encoder.
    // Any non-'stub' value (incl. a legacy 'production' string that healed to
    // 'disabled' in getGalleryConfig, or any stale DB value) yields a 503
    // (defense in depth — see the file docstring).
    // COR-R5C1-04: rate-limit pre-increment is placed BEFORE the config read
    // so the counter is consumed on every request that passes cheap validation,
    // preventing free config probing. Pattern 2: rollback on all subsequent
    // early-return paths before expensive work begins.
    //
    // AGG-R5C3-10 (BUG-R5C3-05): when TRUST_PROXY is unset, getClientIp returns
    // 'unknown' for EVERY client, so all anonymous callers collapse into ONE
    // shared 30/min bucket (rate-limit.ts emits a one-time [SECURITY] warning to
    // this effect). Unlike the checkout idempotency key — which can be safely
    // omitted on unknown IPs because its only cost is losing double-click dedup —
    // this rate limit is a SECURITY control and MUST stay applied even to the
    // shared 'unknown' bucket: a fail-open semantic endpoint would be a free DoS
    // amplifier. Operators behind a reverse proxy MUST set TRUST_PROXY=true so
    // per-client buckets are restored.
    const ip = getClientIp(request.headers);
    const now = Date.now();
    const overLimit = preIncrementSemanticAttempt(ip, now);
    if (overLimit) {
        return NextResponse.json(
            { error: 'Rate limited' },
            { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' } },
        );
    }

    // Check semantic search mode — 'stub' and 'production' serve public requests;
    // 'disabled' and any other value return 503. 'production' uses the real CLIP
    // encoder (embedTextReal) and scans only rows matching PRODUCTION_MODEL_VERSION.
    let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled';
    try {
        const config = await getGalleryConfig();
        semanticMode = config.semanticSearchMode;
    } catch {
        // fail closed — config unavailable means disabled
    }
    if (semanticMode !== 'stub' && semanticMode !== 'production') {
        rollbackSemanticAttempt(ip);
        return NextResponse.json(
            { error: 'Semantic search is not fully configured' },
            { status: 503, headers: NO_STORE_HEADERS },
        );
    }
    const isProd = semanticMode === 'production';
    const activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : CLIP_MODEL_VERSION;
    const activeThreshold = isProd ? PRODUCTION_COSINE_THRESHOLD : COSINE_THRESHOLD;

    // Embed query — production uses the real CLIP encoder (async); stub uses the sync stub.
    let queryEmbedding: Float32Array;
    try {
        queryEmbedding = isProd ? await embedTextReal(query) : embedTextStub(query);
    } catch {
        rollbackSemanticAttempt(ip);
        return NextResponse.json({ error: 'Server error' }, { status: 503, headers: NO_STORE_HEADERS });
    }

    // Scan up to SEMANTIC_SCAN_LIMIT most-recent embeddings for the active model (HARD cap).
    // The model_version filter ensures stub rows never appear in production results and vice-versa.
    let rows: { imageId: number; embedding: string | null }[];
    try {
        rows = await db
            .select({ imageId: imageEmbeddings.imageId, embedding: imageEmbeddings.embedding })
            .from(imageEmbeddings)
            .where(eq(imageEmbeddings.modelVersion, activeModelVersion))
            .orderBy(desc(imageEmbeddings.updatedAt))
            .limit(SEMANTIC_SCAN_LIMIT);
    } catch {
        rollbackSemanticAttempt(ip);
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

    const results = topK(scored, topKParam, activeThreshold);

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
            // Fallback to empty results if image enrichment query fails
            enrichedResults = [];
        }
    }

    return NextResponse.json(
        { results: enrichedResults },
        { headers: NO_STORE_HEADERS },
    );
}
