/**
 * clip-model-manifest.ts — SHA-256 manifest + verify/clean helpers for the
 * jinaai/jina-clip-v2 (int8) CLIP weights.
 *
 * Pure I/O helpers only (crypto + fs + path) — NO @huggingface/transformers
 * import — so they are unit-testable without the heavy native runtime.
 *
 * AGG-C10-05/10-10 (run-6 cycle-1): the download script must verify downloaded
 * artifacts against this manifest and DELETE any mismatching file before aborting,
 * so a poisoned/corrupt/partial weight file is never left on disk for the runtime
 * loader (clip-model.ts) to pick up unverified. Extracted from the inline logic in
 * download-clip-models.ts so the mismatch/abort path can be tested behaviorally.
 */

import { createHash } from 'crypto';
import { createReadStream, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * SHA-256 manifest for the key artifacts downloaded by Transformers.js, as cached
 * from the HF hub at the pinned revision (Task 1 spike, 2026-06-15). Only the large
 * binary artifacts that are expensive to re-download are checksum-pinned here;
 * config/tokenizer JSON files are small and self-describing, so they are integrity-
 * checked by existence+parse via LOADER_FATAL_FILES / verifyLoaderFatalFiles rather
 * than a pinned SHA. (A pinned SHA for the two config JSONs is the future hardening —
 * AGG-C9-01 layer 4 — but requires a known-good seeded cache at the pinned revision
 * to compute; do NOT invent a digest, a wrong SHA would wedge a valid seed.)
 */
export const CLIP_MODEL_MANIFEST: Record<string, string> = {
    'onnx/model_quantized.onnx':
        '65c6423fc82eecffb7f7f813730c6a6f0d28e2dc908e414250733b1416ed30bf',
    'tokenizer.json':
        '6601c4120779a1a3863897ba332fe3481d548e363bec2c91eba10ef8640a5e93',
};

/**
 * AGG-C9-01 (run-6 cycle-9): the full set of files the offline runtime loader
 * (clip-model.ts `from_pretrained` with `allowRemoteModels=false`) requires with
 * `fatal=true` — verified against the installed @huggingface/transformers v3.8.1:
 *   - onnx/model_quantized.onnx — the int8 ONNX weights (AutoModel)
 *   - tokenizer.json            — tokenizers.js:70  getModelJSON(..., true)
 *   - tokenizer_config.json     — tokenizers.js:71  getModelJSON(..., true)
 *   - config.json               — configs.js:54     getModelJSON(..., true)
 *
 * The CLIP_MODEL_MANIFEST above SHA-pins only the first two (the large/expensive
 * artifacts). The downloader idempotency fast-path historically verified only the
 * manifest set, so a partial seed missing config.json or tokenizer_config.json was
 * reported "already up to date" → first live query threw → loadPromise nulled →
 * indefinite 503 storm (the AGG-C8-02 failure class, narrowed to the two config
 * JSONs the manifest never covered). This constant is the source-of-truth for the
 * loader's fatal-required set; verifyLoaderFatalFiles() checks ALL of them so the
 * idempotency check can never green-light a seed the loader will reject.
 */
export const LOADER_FATAL_FILES: readonly string[] = [
    'onnx/model_quantized.onnx',
    'tokenizer.json',
    'tokenizer_config.json',
    'config.json',
] as const;

/** Compute the SHA-256 hex digest of a file by streaming it. */
export async function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

export interface ManifestVerifyResult {
    ok: boolean;
    /** Human-readable lines describing each entry's outcome, for logging. */
    log: string[];
    /** Relative paths whose checksum did NOT match (or were missing). */
    failures: string[];
    /** Relative paths whose mismatching on-disk file was deleted. */
    deleted: string[];
}

/**
 * Verify every manifest entry against the on-disk file in `modelCacheDir`, and
 * DELETE any file whose checksum does not match (a missing file is a failure but
 * has nothing to delete). Returns the aggregate result; the caller decides whether
 * to abort. Deleting the poisoned file ensures it is never trusted by a later run
 * or by the runtime loader, and forces a clean re-download.
 *
 * @param deleteOnMismatch when false, skips the rm (used to inspect without mutating).
 */
export async function verifyAndCleanArtifacts(
    modelCacheDir: string,
    manifest: Record<string, string> = CLIP_MODEL_MANIFEST,
    deleteOnMismatch = true,
): Promise<ManifestVerifyResult> {
    const log: string[] = [];
    const failures: string[] = [];
    const deleted: string[] = [];

    for (const [relativePath, expectedHash] of Object.entries(manifest)) {
        const filePath = join(modelCacheDir, relativePath);
        if (!existsSync(filePath)) {
            log.push(`MISSING ${relativePath}`);
            failures.push(relativePath);
            continue;
        }
        const actual = await sha256File(filePath);
        if (actual === expectedHash) {
            log.push(`OK   ${relativePath}`);
            continue;
        }
        log.push(`FAIL ${relativePath} (expected ${expectedHash}, actual ${actual})`);
        failures.push(relativePath);
        if (deleteOnMismatch) {
            try {
                rmSync(filePath, { force: true });
                deleted.push(relativePath);
                log.push(`DELETED poisoned ${relativePath}`);
            } catch (err) {
                log.push(`WARN could not delete ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    return { ok: failures.length === 0, log, failures, deleted };
}

/**
 * AGG-C9-01: verify every file the offline loader requires with `fatal=true`
 * (LOADER_FATAL_FILES) is present AND usable in `modelCacheDir`:
 *
 *   - Files that have a pinned SHA in `manifest` are verified by checksum (reusing
 *     verifyAndCleanArtifacts semantics; a mismatch is a failure).
 *   - Files NOT in the manifest (the small self-describing config JSONs) are checked
 *     for existence AND JSON-parseability — the two corruption modes that wedge the
 *     offline loader (missing file, or truncated/garbage JSON). A `.onnx` fatal file
 *     with no manifest SHA falls back to an existence check (it should always be in
 *     the manifest, but this stays correct if that ever changes).
 *
 * This NEVER mutates the cache (no delete) — it is the inspection the downloader
 * idempotency fast-path runs before short-circuiting "already up to date". The
 * post-download checksum verify (verifyAndCleanArtifacts, deleteOnMismatch=true)
 * still owns poisoned-file deletion.
 */
export async function verifyLoaderFatalFiles(
    modelCacheDir: string,
    manifest: Record<string, string> = CLIP_MODEL_MANIFEST,
    fatalFiles: readonly string[] = LOADER_FATAL_FILES,
): Promise<ManifestVerifyResult> {
    const log: string[] = [];
    const failures: string[] = [];

    for (const relativePath of fatalFiles) {
        const filePath = join(modelCacheDir, relativePath);
        if (!existsSync(filePath)) {
            log.push(`MISSING ${relativePath}`);
            failures.push(relativePath);
            continue;
        }

        const expectedHash = manifest[relativePath];
        if (expectedHash) {
            const actual = await sha256File(filePath);
            if (actual === expectedHash) {
                log.push(`OK   ${relativePath} (sha256)`);
            } else {
                log.push(`FAIL ${relativePath} (sha256 expected ${expectedHash}, actual ${actual})`);
                failures.push(relativePath);
            }
            continue;
        }

        // No pinned SHA: integrity-check small JSON config files by parse, others by
        // existence (already confirmed above).
        if (relativePath.endsWith('.json')) {
            try {
                JSON.parse(readFileSync(filePath, 'utf-8'));
                log.push(`OK   ${relativePath} (parse)`);
            } catch (err) {
                log.push(
                    `FAIL ${relativePath} (not valid JSON: ${err instanceof Error ? err.message : String(err)})`,
                );
                failures.push(relativePath);
            }
            continue;
        }

        log.push(`OK   ${relativePath} (exists)`);
    }

    // deleted is always empty: this helper never mutates the cache.
    return { ok: failures.length === 0, log, failures, deleted: [] };
}
