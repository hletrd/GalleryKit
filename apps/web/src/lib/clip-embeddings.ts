/**
 * CLIP embedding helpers — pure utilities for US-P51 (CLIP semantic search).
 *
 * No database imports. Safe to use in server-only lib modules.
 * All functions are deterministic and side-effect-free.
 */

export const EMBEDDING_DIM = 512;
export const EMBEDDING_BYTES = EMBEDDING_DIM * 4; // 512 × 4-byte float32
export const CLIP_MODEL_VERSION = 'stub-sha256-v1';
export const COSINE_THRESHOLD = 0.18;
export const SEMANTIC_TOP_K_DEFAULT = 20;
export const SEMANTIC_TOP_K_MAX = 50;
export const SEMANTIC_SCAN_LIMIT = 5000;

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
    if (denom === 0) return 0;
    return dot / denom;
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
