/**
 * Client-safe CLIP/semantic-search constants.
 *
 * Keep this module free of runtime globals, database, filesystem, and native
 * model imports so client components can consume display/request constants
 * without pulling in server-only embedding helpers.
 */

export const EMBEDDING_DIM = 512;
export const EMBEDDING_BYTES = EMBEDDING_DIM * 4; // 512 x 4-byte float32
export const STUB_MODEL_VERSION = 'stub-sha256-v1';
export const COSINE_THRESHOLD = 0.18;
export const SEMANTIC_TOP_K_DEFAULT = 20;
