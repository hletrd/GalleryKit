/**
 * clip-paths.ts — shared CLIP_MODELS_ROOT resolver + Transformers.js cache layout.
 *
 * No heavy imports (no @huggingface/transformers), no `server-only` constraint —
 * safe to import from BOTH the server-side loader (lib/clip-model.ts) and the tsx
 * download script (scripts/download-clip-models.ts). Keeping the path math in one
 * module is the whole point: the downloader and the offline loader MUST agree on
 *   (a) where env.cacheDir points, and
 *   (b) where on disk the verifiable artifacts actually land,
 * or the seed→offline-load contract silently breaks (the production "MISSING
 * onnx/model_quantized.onnx" abort + the doubled `/app/apps/web/app/...` path).
 *
 * Two facts this module encodes:
 *
 * 1. CLIP_MODELS_ROOT may be ABSOLUTE (the production bind-mount, e.g.
 *    `/app/data/models/clip`) or RELATIVE (the dev/default `data/models/clip`).
 *    `path.join(cwd, absolutePath)` is WRONG — node's join strips the leading
 *    slash of the 2nd arg and appends, yielding `/app/apps/web/app/data/...`
 *    (the doubled "app/" seen in production), so the weights download into the
 *    container's ephemeral fs instead of the mounted volume. resolveClipModelsRoot()
 *    uses path.isAbsolute() so an absolute value is used verbatim and a relative
 *    value is resolved against cwd — matching lib/clip-model.ts's historical
 *    `process.env.CLIP_MODELS_ROOT ?? join(cwd, 'data/models/clip')` for the
 *    relative/default case while finally honoring an absolute override.
 *
 * 2. @huggingface/transformers v3 (3.8.x), when a NON-`main` revision is pinned,
 *    keys its filesystem cache by `pathJoin(repoId, revision, filename)` — i.e. it
 *    writes (and on an offline `allowRemoteModels=false` load, reads back) the
 *    artifacts under a `<revision>/` SUBDIRECTORY:
 *        <cacheDir>/jinaai/jina-clip-v2/<revision>/onnx/model_quantized.onnx
 *        <cacheDir>/jinaai/jina-clip-v2/<revision>/tokenizer.json
 *    (verified empirically against hub.js `getModelFile` proposedCacheKey logic and
 *    a live download on transformers 3.8.1). Because the download write-key and the
 *    offline read-key are the SAME revision-subdir key, the seed→offline-load path
 *    round-trips NATIVELY with no manual symlinks — provided the checksum/idempotency
 *    verification looks in the revision subdir, NOT a flat `<repoId>/...` path. The
 *    old script verified the flat path, so a perfectly good download was reported as
 *    MISSING and aborted. clipModelArtifactDir() returns the revision-subdir so the
 *    downloader verifies exactly what transformers.js wrote and what the loader reads.
 */

import { isAbsolute, join } from 'path';
// Relative (not `@/`) so the tsx download script can import this module directly:
// the scripts run under tsx without the `@/` → `src/*` path-alias rewrite that the
// Next/vitest app build provides. clip-model-id.ts is a sibling in src/lib/.
import { JINA_CLIP_MODEL_ID, JINA_CLIP_REVISION } from './clip-model-id';

/** Default cache root (relative to cwd) when CLIP_MODELS_ROOT is unset. */
export const DEFAULT_CLIP_MODELS_ROOT = 'data/models/clip';

/**
 * Resolve the CLIP weights cache root to an absolute path, honoring an absolute
 * CLIP_MODELS_ROOT verbatim and resolving a relative one (or the default) against
 * `cwd`. This is the value assigned to `env.cacheDir` in BOTH the downloader and
 * the loader, so they never diverge.
 *
 * @param cwd Working directory for resolving a relative root. Defaults to process.cwd().
 * @param envValue Override for the CLIP_MODELS_ROOT env value (defaults to process.env).
 */
export function resolveClipModelsRoot(
    cwd: string = process.cwd(),
    envValue: string | undefined = process.env['CLIP_MODELS_ROOT'],
): string {
    const root = envValue && envValue.length > 0 ? envValue : DEFAULT_CLIP_MODELS_ROOT;
    return isAbsolute(root) ? root : join(cwd, root);
}

/**
 * Directory under the (already-resolved) cache root where @huggingface/transformers
 * v3 stores the artifacts for the pinned revision:
 *   <resolvedRoot>/jinaai/jina-clip-v2/<revision>
 *
 * The downloader verifies its SHA-256 manifest against files UNDER this directory,
 * and it is exactly where the offline `allowRemoteModels=false` loader reads them —
 * so verification proves the load will succeed without symlinks.
 */
export function clipModelArtifactDir(resolvedRoot: string): string {
    // JINA_CLIP_MODEL_ID is "<org>/<name>"; transformers nests cache as <org>/<name>/<revision>.
    return join(resolvedRoot, ...JINA_CLIP_MODEL_ID.split('/'), JINA_CLIP_REVISION);
}
