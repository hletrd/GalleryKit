/**
 * CLIP inference STUBS for US-P51 (CLIP semantic search) — stub mode only.
 *
 * The REAL encoder shipped in lib/clip-model.ts (jinaai/jina-clip-v2, int8 ONNX
 * via @huggingface/transformers, 1024→512 Matryoshka). These stub functions are
 * still used by the 'stub' semantic_search_mode: they produce deterministic,
 * hash-based 512-dim vectors that are NOT semantically meaningful — they exercise
 * the schema / hook / search route / UI end-to-end without loading the real model.
 * Stub rows are tagged STUB_MODEL_VERSION so they are never co-ranked with
 * production rows.
 *
 * Both functions are pure and deterministic: the same input always produces the
 * same 512-dim Float32Array, so backfill is idempotent and tests are reproducible.
 */

import { createHash } from 'crypto';
import { EMBEDDING_DIM } from './clip-embeddings';

/**
 * Derive a deterministic 512-dim Float32Array from a SHA-256 digest.
 * Each 4-byte chunk of the 64-byte digest seeds a float in [-1, 1].
 * The 512 values are derived by cycling through repeated hashing of the seed.
 */
function deterministicEmbedding(seed: string): Float32Array {
    const arr = new Float32Array(EMBEDDING_DIM);
    let remaining = EMBEDDING_DIM;
    let offset = 0;
    let hashInput = seed;

    while (remaining > 0) {
        const digest = createHash('sha256').update(hashInput).digest();
        // Each SHA-256 digest is 32 bytes → 8 × 4-byte floats
        const chunk = Math.min(8, remaining);
        for (let i = 0; i < chunk; i++) {
            // Map 4-byte uint32 to float in [-1, 1]
            const uint32 =
                (digest[i * 4] << 24) |
                (digest[i * 4 + 1] << 16) |
                (digest[i * 4 + 2] << 8) |
                digest[i * 4 + 3];
            arr[offset + i] = (uint32 >>> 0) / 2147483648 - 1; // [0, 4294967295] → [-1, 1]
        }
        offset += chunk;
        remaining -= chunk;
        // Next round uses hash of the current digest to produce distinct values
        hashInput = digest.toString('hex');
    }

    return arr;
}

/**
 * STUB: Generate a deterministic 512-dim embedding for an image by image ID.
 *
 * The real image encoder lives in lib/clip-model.ts (jina-clip-v2); this stub is
 * used only in 'stub' mode. It uses the image ID string as the SHA-256 seed so
 * embeddings are stable across restarts and backfill runs are idempotent.
 */
export function embedImageStub(imageId: number): Float32Array {
    return deterministicEmbedding(`image:${imageId}`);
}

/**
 * STUB: Generate a deterministic 512-dim embedding for a text query.
 *
 * The real text encoder lives in lib/clip-model.ts (jina-clip-v2); this stub is
 * used only in 'stub' mode. It uses the normalized query string as the SHA-256 seed.
 * NOTE: stub embeddings are NOT semantically meaningful — cosine similarity
 * between a query and an image embedding is essentially random.
 */
export function embedTextStub(query: string): Float32Array {
    return deterministicEmbedding(`text:${query.trim().toLowerCase()}`);
}
