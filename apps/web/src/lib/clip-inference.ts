/**
 * CLIP inference stubs for US-P51 (CLIP semantic search).
 *
 * STUB IMPLEMENTATION: Real ONNX inference is deferred because:
 *   1. onnxruntime-node adds ~750 MB of native binaries + CLIP ViT-B/32 weights.
 *   2. Zero-dep stub exercises every code path (schema, hook, search route, UI)
 *      end-to-end without the heavyweight dependency.
 *
 * TODO(US-P51): Replace stubs with real ONNX inference once:
 *   - `onnxruntime-node` is added as a dependency
 *   - CLIP ViT-B/32 ONNX weights are downloaded to data/models/clip/
 *   - scripts/download-clip-models.ts downloads the model files
 *
 * Both functions are pure and deterministic: the same input always produces
 * the same 512-dim Float32Array. This is intentional for stub mode so that
 * backfill is idempotent and tests are reproducible.
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
 * Real ONNX inference (CLIP ViT-B/32 image encoder) replaces this in a future cycle.
 * The stub uses the image ID string as the SHA-256 seed so embeddings are stable
 * across restarts and backfill runs are idempotent.
 */
export function embedImageStub(imageId: number): Float32Array {
    return deterministicEmbedding(`image:${imageId}`);
}

/**
 * STUB: Generate a deterministic 512-dim embedding for a text query.
 *
 * Real ONNX inference (CLIP ViT-B/32 text encoder) replaces this in a future cycle.
 * The stub uses the normalized query string as the SHA-256 seed.
 * NOTE: stub embeddings are NOT semantically meaningful — cosine similarity
 * between a query and an image embedding is essentially random.
 */
export function embedTextStub(query: string): Float32Array {
    return deterministicEmbedding(`text:${query.trim().toLowerCase()}`);
}
