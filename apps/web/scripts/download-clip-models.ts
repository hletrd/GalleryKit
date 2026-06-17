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
 *   - Verify the downloaded artifacts against a hard-coded SHA-256 manifest and
 *     DELETE any mismatching file before exiting non-zero (AGG-C10-10) so a
 *     poisoned/partial weight is never left on disk for the runtime loader to
 *     trust. The shared verify/clean helper lives in clip-model-manifest.ts.
 *   - Idempotent: if the file already exists and its SHA-256 matches, skip the
 *     download and report "already up to date".
 *
 * SECURITY: run this only from a trusted network. Transformers.js downloads AND
 * instantiates the ONNX session in one from_pretrained call, so the checksum gate
 * is a post-download integrity check (it deletes a bad file and aborts), not a
 * pre-parse trust boundary. The pinned immutable JINA_CLIP_REVISION + HTTPS are
 * the primary protections; the runtime never downloads (allowRemoteModels=false).
 *
 * Usage:
 *   CLIP_MODELS_ROOT=data/models/clip npx tsx scripts/download-clip-models.ts
 *
 * Environment variables:
 *   CLIP_MODELS_ROOT  Target cache directory (default: data/models/clip)
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { env, AutoModel, AutoTokenizer } from '@huggingface/transformers';
import { JINA_CLIP_MODEL_ID, JINA_CLIP_REVISION } from '../src/lib/clip-model-id';
import { resolveClipModelsRoot, clipModelArtifactDir } from '../src/lib/clip-paths';
import {
    CLIP_MODEL_MANIFEST,
    verifyAndCleanArtifacts,
    verifyLoaderFatalFiles,
} from './clip-model-manifest';

// Alias so the rest of the script is unchanged.
const MODEL_ID = JINA_CLIP_MODEL_ID;
const MANIFEST = CLIP_MODEL_MANIFEST;

async function main(): Promise<void> {
    // Resolve CLIP_MODELS_ROOT ABSOLUTE-AWARE and CONSISTENTLY with the runtime
    // loader (lib/clip-model.ts), via the shared lib/clip-paths.ts resolver. An
    // absolute value (the production bind-mount, e.g. /app/data/models/clip) is used
    // verbatim; a relative/unset value resolves against cwd (apps/web). The old
    // `join(process.cwd(), absolutePath)` produced the doubled `/app/apps/web/app/...`
    // path that dumped weights into the container's ephemeral fs.
    const resolvedRoot = resolveClipModelsRoot();

    // @huggingface/transformers v3 stores the pinned-revision artifacts UNDER a
    // <revision>/ subdir (verified against hub.js getModelFile + a live 3.8.1 download).
    // Verify the manifest there — that is exactly what the offline loader reads back —
    // so a real download is never falsely reported MISSING (the production abort).
    const modelCacheDir = clipModelArtifactDir(resolvedRoot);

    console.log(`[download-clip-models] CLIP_MODELS_ROOT (resolved): ${resolvedRoot}`);
    console.log(`[download-clip-models] Artifact dir (revision-pinned): ${modelCacheDir}`);
    console.log(`[download-clip-models] Model:  ${MODEL_ID} (int8 ONNX)`);

    // --- Idempotency check: skip download only if the FULL manifest verifies ---
    // AGG-C8-02 (run-6 cycle-8): the old fast-path verified ONLY
    // onnx/model_quantized.onnx, so a partial seed with a valid ONNX but a
    // missing/corrupt tokenizer.json was reported "already up to date" and the
    // script exited 0 — while the runtime offline tokenizer load
    // (allowRemoteModels=false) then threw, nulling loadPromise and wedging every
    // subsequent semantic/similar request at 503. Verify EVERY manifest entry (the
    // same set the runtime reads back) before short-circuiting; use
    // deleteOnMismatch=false here so the inspection never mutates a good file — the
    // post-download verify below owns delete-on-mismatch.
    const onnxPath = join(modelCacheDir, 'onnx', 'model_quantized.onnx');
    if (existsSync(onnxPath)) {
        console.log('[download-clip-models] Existing artifacts present — verifying full manifest...');
        const preCheck = await verifyAndCleanArtifacts(modelCacheDir, MANIFEST, /*deleteOnMismatch*/ false);
        for (const line of preCheck.log) console.log(`[download-clip-models] ${line}`);
        // AGG-C9-01 (run-6 cycle-9): the manifest SHA-pins only the large artifacts
        // (onnx + tokenizer.json). The offline loader ALSO fatal-requires config.json
        // and tokenizer_config.json. Verify the full loader-fatal set (existence +
        // JSON-parse for the un-pinned config JSONs) before short-circuiting, so a
        // partial seed missing/corrupt in a config JSON is no longer reported "up to
        // date" → it falls through to re-download instead of wedging the first live
        // query at 503. Inspection only (no mutation); the post-download verify owns
        // delete-on-mismatch.
        const fatalCheck = await verifyLoaderFatalFiles(modelCacheDir, MANIFEST);
        for (const line of fatalCheck.log) console.log(`[download-clip-models] ${line}`);
        if (preCheck.ok && fatalCheck.ok) {
            console.log('[download-clip-models] All artifacts present and verified — already up to date. Nothing to do.');
            return;
        }
        const missing = [...new Set([...preCheck.failures, ...fatalCheck.failures])];
        console.log(
            `[download-clip-models] Artifacts incomplete/mismatched (${missing.join(', ')}) — re-downloading...`,
        );
    }

    // --- Ensure cache dir exists ---
    mkdirSync(resolvedRoot, { recursive: true });

    // --- Point Transformers.js cache at the volume directory ---
    // env.cacheDir must be set BEFORE any from_pretrained call. This is the SAME
    // value the runtime loader assigns to env.cacheDir, so download + offline load
    // share one cache root.
    env.cacheDir = resolvedRoot;
    console.log(`[download-clip-models] env.cacheDir = ${env.cacheDir}`);

    // --- Download model + tokenizer (Transformers.js streams from HF hub) ---
    console.log('[download-clip-models] Downloading model (this may take several minutes on first run)...');
    const model = await AutoModel.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'cpu',
        revision: JINA_CLIP_REVISION,
    });

    console.log('[download-clip-models] Downloading tokenizer...');
    // The tokenizer is a plain JS object (no native handle); loading it is the
    // download side-effect we want. GC reclaims it — there is no dispose API.
    await AutoTokenizer.from_pretrained(MODEL_ID, { revision: JINA_CLIP_REVISION });

    // Release the ONNX session — we only needed the download side-effect.
    await model.dispose();

    // --- Verify manifest (delete any mismatching artifact before aborting) ---
    console.log('[download-clip-models] Verifying checksums...');
    const result = await verifyAndCleanArtifacts(modelCacheDir, MANIFEST);
    for (const line of result.log) console.log(`[download-clip-models] ${line}`);

    if (!result.ok) {
        console.error(
            `[download-clip-models] Checksum verification FAILED for: ${result.failures.join(', ')}.` +
            (result.deleted.length ? ` Deleted poisoned file(s): ${result.deleted.join(', ')}.` : '') +
            ' Aborting.'
        );
        process.exit(1);
    }

    console.log('[download-clip-models] All checksums verified. Model ready.');
    console.log(`[download-clip-models] Set CLIP_MODELS_ROOT=${resolvedRoot} in the app environment to use this cache.`);
}

main().catch((err) => {
    console.error('[download-clip-models] Fatal error:', err);
    process.exit(1);
});
