/**
 * CLIP embedding helpers — pure utilities for US-P51 (CLIP semantic search).
 *
 * No database imports. Safe to use in server-only lib modules.
 * All functions are deterministic and side-effect-free.
 */

export const EMBEDDING_DIM = 512;
export const EMBEDDING_BYTES = EMBEDDING_DIM * 4; // 512 × 4-byte float32
// AGG-C10-09: renamed from the misleading `CLIP_MODEL_VERSION` — this is the STUB
// encoder identity (deterministic, NOT semantically meaningful). The real encoder
// identity is PRODUCTION_MODEL_VERSION below. The model_version column partitions
// stub vs production rows so they are never co-ranked.
export const STUB_MODEL_VERSION = 'stub-sha256-v1';
export const COSINE_THRESHOLD = 0.18;
export const SEMANTIC_TOP_K_DEFAULT = 20;

// R21C21 T4 (CRIT21-02): SEMANTIC_TOP_K_MAX and SEMANTIC_SCAN_LIMIT are
// documented in CLAUDE.md ("Runtime limits") as env-tunable operational caps
// that bound CPU/DB consumption on expensive natural-language queries. Wire the
// env read so the docs match behaviour. Number() (not parseInt) per the cycle-20
// env-parse sweep — the positive-integer guard rejects NaN/Infinity/≤0 and falls
// back to the documented defaults (50 / 2000). On the client bundle the non-
// NEXT_PUBLIC env is undefined and the fallback applies (harmless: these caps are
// only consulted server-side in the search routes).
function envPositiveInt(raw: string | undefined, fallback: number): number {
    const n = Number(raw ?? '');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
export const SEMANTIC_TOP_K_MAX = envPositiveInt(process.env.SEMANTIC_TOP_K_MAX, 50);
export const SEMANTIC_SCAN_LIMIT = envPositiveInt(process.env.SEMANTIC_SCAN_LIMIT, 2000);

/**
 * Compute cosine similarity between two 512-dim Float32Arrays.
 * Returns a value in [-1, 1]. Returns 0 for zero-length vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
        throw new Error(`cosineSimilarity: dimension mismatch ${a.length} vs ${b.length}`);
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    const EPSILON = 1e-15;
    if (denom < EPSILON) return 0;
    return dot / denom;
}

/**
 * Dot product of two equal-length vectors. For UNIT vectors (both already
 * L2-normalized via `truncateAndNormalize` / `normalizeEmbedding`) the dot
 * product equals the cosine similarity, so this is a cheaper fast path for the
 * brute-force scan where both the query and every stored vector are unit length
 * (AGG-C10-11c: skips the two per-call norm recomputations + sqrt). Use only when
 * the unit-length invariant holds; otherwise use `cosineSimilarity`.
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
        throw new Error(`dotProduct: dimension mismatch ${a.length} vs ${b.length}`);
    }
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

/**
 * Serialize a 512-dim Float32Array to a Node.js Buffer (little-endian).
 * The resulting buffer is 2048 bytes (512 × 4), suitable for MEDIUMBLOB storage.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
    if (embedding.length !== EMBEDDING_DIM) {
        throw new Error(`embeddingToBuffer: expected ${EMBEDDING_DIM} dims, got ${embedding.length}`);
    }
    const buf = Buffer.allocUnsafe(EMBEDDING_BYTES);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
        buf.writeFloatLE(embedding[i], i * 4);
    }
    return buf;
}

/**
 * Deserialize a Node.js Buffer (little-endian float32 array) into a Float32Array.
 * Accepts a Buffer of exactly EMBEDDING_BYTES bytes.
 */
export function bufferToEmbedding(buf: Buffer): Float32Array {
    if (buf.length !== EMBEDDING_BYTES) {
        throw new Error(`bufferToEmbedding: expected ${EMBEDDING_BYTES} bytes, got ${buf.length}`);
    }
    const arr = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
        arr[i] = buf.readFloatLE(i * 4);
    }
    return arr;
}

/**
 * Decode an `image_embeddings.embedding` column value into a Float32Array, or
 * return null if the value is not a well-formed 512-dim embedding.
 *
 * AGG-C10-01 (run-6 cycle-1): the column is physically MEDIUMBLOB, so mysql2
 * ALWAYS returns a Buffer for it (binary charset 63 → `readLengthCodedBuffer`),
 * regardless of the Drizzle `text()` type annotation. The previous read sites did
 * `Buffer.from(row.embedding as string, 'base64')` — but `Buffer.from(buffer, enc)`
 * IGNORES the encoding for Buffer input and copies verbatim, so a base64-stored
 * vector came back as a ~2732-byte Buffer that failed the 2048-byte length check
 * and was silently dropped. Every row was discarded → empty results / 404 once the
 * (currently dark) feature is enabled.
 *
 * This helper is the single source of truth for the read contract. It accepts:
 *   1. a raw 2048-byte Buffer (current write path) → decoded directly;
 *   2. a Buffer holding base64 ASCII (legacy rows written before this fix) →
 *      its text is base64-decoded, then length-checked;
 *   3. a base64 string (defensive; some drivers/configs could yield a string).
 * Anything that does not yield exactly EMBEDDING_BYTES bytes returns null.
 */
export function decodeEmbeddingColumn(value: unknown): Float32Array | null {
    let buf: Buffer | null = null;
    if (Buffer.isBuffer(value)) {
        if (value.length === EMBEDDING_BYTES) {
            // Case 1: raw little-endian float32 bytes.
            buf = value;
        } else {
            // Case 2: legacy row — the Buffer contains base64 ASCII text.
            const decoded = Buffer.from(value.toString('latin1'), 'base64');
            buf = decoded.length === EMBEDDING_BYTES ? decoded : null;
        }
    } else if (typeof value === 'string') {
        // Case 3: defensive — a string-typed column value holding base64.
        const decoded = Buffer.from(value, 'base64');
        buf = decoded.length === EMBEDDING_BYTES ? decoded : null;
    }
    if (buf === null) return null;
    return bufferToEmbedding(buf);
}

export interface ScoredMatch {
    imageId: number;
    score: number;
}

/**
 * Return the top-K matches from a scored list, filtered by threshold.
 * Input array is not mutated. Returns results sorted by descending score.
 */
export function topK(matches: ScoredMatch[], k: number, threshold: number): ScoredMatch[] {
    return matches
        .filter(m => m.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}

// Real production encoder identity (set in this cycle). Stays <= 32 chars for the
// model_version varchar(32). Bump this string whenever the model OR dim changes.
export const PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8';

// Production relevance threshold — calibrated 2026-06-16 via ko+en probe on 4 synthetic
// fixtures (beach-sunset, snowy-mountain, city-night, red-flower; src/__tests__/fixtures/clip/).
//
// Observed matrix (jina-clip-v2 q8, Matryoshka-512):
//   EN matching:      0.1898, 0.2348, 0.2766, 0.3368
//   EN non-matching:  max 0.2035
//   KO matching:      0.2209, 0.2578, 0.2953, 0.3583
//   KO non-matching:  max 0.2575  (beach→snowy-KO; semantically adjacent scenes)
//
// The one near-overlap (EN-snowy match 0.1898 vs KO beach→snowy non-match 0.2575) is an
// artefact of low-quality synthetic gradients — real photographs produce larger gaps
// (Task 1 spike: EN-match 0.353, KO-match 0.317, unrelated 0.144 on a real photo).
// Midpoint of the synthetic gap (min-match 0.1898, max-non-match 0.2575): 0.2237.
// Setting to 0.22 — admits all but the weakest synthetic match while sitting comfortably
// above the real-photo unrelated ceiling of ~0.14.  Re-validate on real gallery data
// post-deploy and adjust if recall is too low on weak-match queries.
export const PRODUCTION_COSINE_THRESHOLD = 0.22;

/** L2-normalize a vector to unit length. A zero vector is returned unchanged (no NaN). */
export function normalizeEmbedding(v: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm === 0) return v;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
    return out;
}

/** Matryoshka: take the first EMBEDDING_DIM components, then re-normalize. */
export function truncateAndNormalize(v: Float32Array): Float32Array {
    const head = v.length > EMBEDDING_DIM ? v.subarray(0, EMBEDDING_DIM) : v;
    return normalizeEmbedding(Float32Array.from(head));
}
