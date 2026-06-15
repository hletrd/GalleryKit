/**
 * clip-model-id.ts — shared model identity constants.
 *
 * No heavy imports, no server-only constraint — safe to import from both
 * the server-side clip-model.ts module and the tsx download script.
 *
 * Both the downloader (scripts/download-clip-models.ts) and the loader
 * (lib/clip-model.ts) MUST import from here so they always reference the
 * same pinned revision and never diverge.
 */

/** HuggingFace repo id for the multilingual CLIP encoder. */
export const JINA_CLIP_MODEL_ID = 'jinaai/jina-clip-v2';

/**
 * HF commit SHA pinned to the revision downloaded during the Task 1 spike
 * (2026-06-15). Verified via https://huggingface.co/api/models/jinaai/jina-clip-v2.
 *
 * The ONNX artifact (onnx/model_quantized.onnx) SHA-256 at this revision:
 *   65c6423fc82eecffb7f7f813730c6a6f0d28e2dc908e414250733b1416ed30bf
 *
 * Update this SHA together with the MANIFEST in download-clip-models.ts whenever
 * the model is upgraded to a new revision.
 */
export const JINA_CLIP_REVISION = 'e10d47f5691d0454a0fb5d13f46f2199b74cb436';
