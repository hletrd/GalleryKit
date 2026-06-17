/**
 * clip-model.ts — lazy-singleton real CLIP encoder (server-only).
 *
 * Provides:
 *   embedTextReal(query)     → 512-dim unit Float32Array (Matryoshka-512)
 *   embedImageReal(imgPath)  → 512-dim unit Float32Array (Matryoshka-512)
 *
 * Runtime: @huggingface/transformers v3 (AutoModel + AutoTokenizer).
 * Model:   jinaai/jina-clip-v2 (int8 ONNX, q8), pinned to a specific HF revision.
 * Weights: read from the CLIP_MODELS_ROOT bind-mount volume (never baked into image).
 *
 * Spike result (2026-06-15): jina-clip-v2 loads correctly in Transformers.js v3
 * via AutoModel. l2norm_text_embeddings / l2norm_image_embeddings outputs are already
 * L2-normalized at native dim 1024; truncateAndNormalize() reduces to 512.
 */

import 'server-only';
import type * as Transformers from '@huggingface/transformers';
import sharp from 'sharp';
import { truncateAndNormalize, EMBEDDING_DIM } from '@/lib/clip-embeddings';
import { JINA_CLIP_MODEL_ID, JINA_CLIP_REVISION } from '@/lib/clip-model-id';
import { resolveClipModelsRoot } from '@/lib/clip-paths';

// AGG-C10-03 (run-6 cycle-1): `@huggingface/transformers` pulls native
// onnxruntime-node (+ a WASM backend). It is imported lazily INSIDE getModelBundle()
// — not at module top level — so the boot/upload graph (instrumentation -> image-queue
// -> clip-model) does NOT drag the native runtime into every request path. The native
// runtime resolves only when the (dark by default) real encoder is actually invoked.
// `@huggingface/transformers` is also listed in next.config.ts serverExternalPackages
// so the standalone build does not try to webpack-trace its native binaries.

// Re-export so callers can import identity constants from either file.
export { JINA_CLIP_MODEL_ID, JINA_CLIP_REVISION } from '@/lib/clip-model-id';

// ---------------------------------------------------------------------------
// CLIP image preprocessing constants (standard CLIP / OpenAI ViT normalization)
// ---------------------------------------------------------------------------

const CLIP_IMAGE_SIZE = 512;
const CLIP_MEANS = [0.48145466, 0.4578275, 0.40821073] as const;
const CLIP_STDS = [0.26862954, 0.26130258, 0.27577711] as const;

// ---------------------------------------------------------------------------
// Volume path
// ---------------------------------------------------------------------------

// Absolute-aware resolution shared with the download script (scripts/download-clip-models.ts)
// via lib/clip-paths.ts, so the seed target and the offline-load source can never drift:
// an absolute CLIP_MODELS_ROOT (the production bind-mount) is honored verbatim, an unset /
// relative value resolves against cwd (preserving the historical `join(cwd, 'data/models/clip')`
// default). This becomes env.cacheDir below.
const CLIP_MODELS_ROOT = resolveClipModelsRoot();

// ---------------------------------------------------------------------------
// Lazy singleton — cached Promise of { model, tokenizer }.
// On failure the promise is nulled so the next call retries the load.
// ---------------------------------------------------------------------------

type ModelBundle = {
    model: Awaited<ReturnType<typeof Transformers.AutoModel.from_pretrained>>;
    tokenizer: Awaited<ReturnType<typeof Transformers.AutoTokenizer.from_pretrained>>;
    // Carried so embedImageReal can build a Tensor without a second dynamic import.
    Tensor: typeof Transformers.Tensor;
};

let loadPromise: Promise<ModelBundle> | null = null;

function getModelBundle(): Promise<ModelBundle> {
    if (loadPromise !== null) return loadPromise;

    loadPromise = (async (): Promise<ModelBundle> => {
        // Lazy native-runtime import (AGG-C10-03). Resolved only on first real encode.
        const { env, AutoModel, AutoTokenizer, Tensor } = await import('@huggingface/transformers');

        // Must be set BEFORE any from_pretrained call.
        env.cacheDir = CLIP_MODELS_ROOT;
        // Offline: only read from the pre-seeded volume; never hit the network.
        env.allowRemoteModels = false;

        const model = await AutoModel.from_pretrained(JINA_CLIP_MODEL_ID, {
            dtype: 'q8',
            device: 'cpu',
            revision: JINA_CLIP_REVISION,
        });

        const tokenizer = await AutoTokenizer.from_pretrained(JINA_CLIP_MODEL_ID, {
            revision: JINA_CLIP_REVISION,
        });

        return { model, tokenizer, Tensor };
    })().catch((err) => {
        // Null the cached promise so the next call can retry.
        loadPromise = null;
        throw err;
    });

    return loadPromise;
}

// ---------------------------------------------------------------------------
// Text embedding
// ---------------------------------------------------------------------------

/**
 * Embed a text query using the jina-clip-v2 text tower.
 * Returns a 512-dim L2-normalized Float32Array (Matryoshka truncation of 1024).
 */
export async function embedTextReal(query: string): Promise<Float32Array> {
    const { model, tokenizer } = await getModelBundle();

    const inputs = await tokenizer(query, { padding: true, truncation: true });

    const out = (await model({
        input_ids: inputs['input_ids'],
        attention_mask: inputs['attention_mask'],
    })) as Record<string, { data: Float32Array }>;

    const embedding = out['l2norm_text_embeddings'];
    if (!embedding) {
        throw new Error('clip-model: l2norm_text_embeddings missing from model output');
    }
    const data = embedding.data;
    if (data.length < EMBEDDING_DIM) {
        throw new Error(
            `clip-model: text embedding dim ${data.length} < expected ${EMBEDDING_DIM}`
        );
    }

    return truncateAndNormalize(data);
}

// ---------------------------------------------------------------------------
// Image embedding
// ---------------------------------------------------------------------------

/**
 * Embed an image file using the jina-clip-v2 vision tower.
 * Decodes and preprocesses via Sharp, then runs the model.
 * Returns a 512-dim L2-normalized Float32Array (Matryoshka truncation of 1024).
 */
export async function embedImageReal(imagePath: string): Promise<Float32Array> {
    const { model, Tensor } = await getModelBundle();

    // Decode, resize to 512×512 (fill, no aspect preservation — matches CLIP convention),
    // and return raw HWC uint8 bytes.
    //   - autoOrient: bake EXIF Orientation pre-decode so a rotated portrait is
    //     embedded the way it is actually displayed (matches process-image.ts).
    //   - toColourspace('srgb'): force 3-channel sRGB so grayscale / CMYK sources
    //     don't yield a 1- or 4-channel buffer that breaks the CHW indexing below.
    //   - removeAlpha: drop any alpha channel so RGBA sources collapse to RGB.
    const { data: rawData, info } = await sharp(imagePath, { autoOrient: true })
        .resize(CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE, { fit: 'fill' })
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    if (info.channels !== 3) {
        throw new Error(`clip-model: expected 3-channel RGB, got ${info.channels}`);
    }

    const pixelCount = CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE;

    // Convert HWC uint8 → CHW float32, normalizing with CLIP means/stds.
    const pv = new Float32Array(3 * pixelCount);
    for (let c = 0; c < 3; c++) {
        const mean = CLIP_MEANS[c];
        const std = CLIP_STDS[c];
        for (let i = 0; i < pixelCount; i++) {
            pv[c * pixelCount + i] = (rawData[i * 3 + c] / 255 - mean) / std;
        }
    }

    const out = (await model({
        pixel_values: new Tensor('float32', pv, [1, 3, CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE]),
    })) as Record<string, { data: Float32Array }>;

    const embedding = out['l2norm_image_embeddings'];
    if (!embedding) {
        throw new Error('clip-model: l2norm_image_embeddings missing from model output');
    }
    const data = embedding.data;
    if (data.length < EMBEDDING_DIM) {
        throw new Error(
            `clip-model: image embedding dim ${data.length} < expected ${EMBEDDING_DIM}`
        );
    }

    return truncateAndNormalize(data);
}
