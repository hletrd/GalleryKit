#!/usr/bin/env tsx
/**
 * scripts/download-clip-models.ts
 *
 * Pre-warms the Transformers.js model cache for jinaai/jina-clip-v2 (int8)
 * into the bind-mount volume at CLIP_MODELS_ROOT (default: data/models/clip).
 *
 * Strategy (Transformers.js v3 path, decided in Task 1 spike):
 *   - Set env.cacheDir to the volume path before any model load so Transformers.js
 *     stores / reads weights from the persistent volume rather than node_modules.
 *   - Load the model + tokenizer once (downloads if absent, no-ops if cached).
 *   - After download, verify the key artifact (onnx/model_quantized.onnx) against
 *     a hard-coded SHA-256 manifest — exits non-zero on checksum mismatch.
 *   - Idempotent: if the file already exists and its SHA-256 matches, skip the
 *     download and report "already up to date".
 *
 * Usage:
 *   CLIP_MODELS_ROOT=data/models/clip npx tsx scripts/download-clip-models.ts
 *
 * Environment variables:
 *   CLIP_MODELS_ROOT  Target cache directory (default: data/models/clip)
 */

import { createHash } from 'crypto';
import { existsSync, createReadStream, mkdirSync } from 'fs';
import { join } from 'path';
import { env, AutoModel, AutoTokenizer } from '@huggingface/transformers';

const MODEL_ID = 'jinaai/jina-clip-v2';

/**
 * SHA-256 manifest for the key artifacts downloaded by Transformers.js.
 * These are the checksums of the files as cached from the HF hub at the
 * revision used during the Task 1 spike (2026-06-15).
 *
 * Only the large binary artifacts that are expensive to re-download are
 * verified here. Config/tokenizer JSON files are small and self-describing.
 */
const MANIFEST: Record<string, string> = {
    'onnx/model_quantized.onnx':
        '65c6423fc82eecffb7f7f813730c6a6f0d28e2dc908e414250733b1416ed30bf',
    'tokenizer.json':
        '6601c4120779a1a3863897ba332fe3481d548e363bec2c91eba10ef8640a5e93',
};

/**
 * Compute the SHA-256 hex digest of a file by streaming it.
 */
async function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function main(): Promise<void> {
    const clipModelsRoot =
        process.env['CLIP_MODELS_ROOT'] ?? 'data/models/clip';

    // Resolve relative to cwd (the apps/web directory when called from the plan).
    const modelCacheDir = join(process.cwd(), clipModelsRoot, 'jinaai', 'jina-clip-v2');

    console.log(`[download-clip-models] Target: ${join(process.cwd(), clipModelsRoot)}`);
    console.log(`[download-clip-models] Model:  ${MODEL_ID} (int8 ONNX)`);

    // --- Idempotency check: if key artifact exists and matches, skip download ---
    const onnxPath = join(modelCacheDir, 'onnx', 'model_quantized.onnx');
    if (existsSync(onnxPath)) {
        console.log('[download-clip-models] ONNX artifact already present — verifying checksum...');
        const actual = await sha256File(onnxPath);
        const expected = MANIFEST['onnx/model_quantized.onnx'];
        if (actual === expected) {
            console.log('[download-clip-models] Checksum OK — already up to date. Nothing to do.');
            return;
        }
        console.log(`[download-clip-models] Checksum MISMATCH on existing file:`);
        console.log(`  expected: ${expected}`);
        console.log(`  actual:   ${actual}`);
        console.log('[download-clip-models] Re-downloading...');
    }

    // --- Ensure cache dir exists ---
    mkdirSync(join(process.cwd(), clipModelsRoot), { recursive: true });

    // --- Point Transformers.js cache at the volume directory ---
    // env.cacheDir must be set BEFORE any from_pretrained call.
    env.cacheDir = join(process.cwd(), clipModelsRoot);
    console.log(`[download-clip-models] env.cacheDir = ${env.cacheDir}`);

    // --- Download model + tokenizer (Transformers.js streams from HF hub) ---
    console.log('[download-clip-models] Downloading model (this may take several minutes on first run)...');
    const model = await AutoModel.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'cpu',
    });

    console.log('[download-clip-models] Downloading tokenizer...');
    // The tokenizer is a plain JS object (no native handle); loading it is the
    // download side-effect we want. GC reclaims it — there is no dispose API.
    await AutoTokenizer.from_pretrained(MODEL_ID);

    // Release the ONNX session — we only needed the download side-effect.
    await model.dispose();

    // --- Verify manifest ---
    console.log('[download-clip-models] Verifying checksums...');
    let allOk = true;
    for (const [relativePath, expectedHash] of Object.entries(MANIFEST)) {
        const filePath = join(modelCacheDir, relativePath);
        if (!existsSync(filePath)) {
            console.error(`[download-clip-models] MISSING: ${relativePath}`);
            allOk = false;
            continue;
        }
        const actual = await sha256File(filePath);
        if (actual === expectedHash) {
            console.log(`[download-clip-models] OK  ${relativePath}`);
        } else {
            console.error(`[download-clip-models] FAIL ${relativePath}`);
            console.error(`  expected: ${expectedHash}`);
            console.error(`  actual:   ${actual}`);
            allOk = false;
        }
    }

    if (!allOk) {
        console.error('[download-clip-models] One or more checksum failures. Aborting.');
        process.exit(1);
    }

    console.log('[download-clip-models] All checksums verified. Model ready.');
    console.log(`[download-clip-models] Set CLIP_MODELS_ROOT=${clipModelsRoot} in the app environment to use this cache.`);
}

main().catch((err) => {
    console.error('[download-clip-models] Fatal error:', err);
    process.exit(1);
});
