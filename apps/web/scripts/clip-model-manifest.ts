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
import { createReadStream, existsSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * SHA-256 manifest for the key artifacts downloaded by Transformers.js, as cached
 * from the HF hub at the pinned revision (Task 1 spike, 2026-06-15). Only the large
 * binary artifacts that are expensive to re-download are verified; config/tokenizer
 * JSON files are small and self-describing.
 */
export const CLIP_MODEL_MANIFEST: Record<string, string> = {
    'onnx/model_quantized.onnx':
        '65c6423fc82eecffb7f7f813730c6a6f0d28e2dc908e414250733b1416ed30bf',
    'tokenizer.json':
        '6601c4120779a1a3863897ba332fe3481d548e363bec2c91eba10ef8640a5e93',
};

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
