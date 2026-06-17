/**
 * clip-paths.test.ts — regression coverage for the CLIP_MODELS_ROOT resolver and
 * the Transformers.js revision-subdir cache layout shared by the download script
 * (scripts/download-clip-models.ts) and the offline loader (lib/clip-model.ts).
 *
 * Pins the two defects that blocked the production CLIP activation:
 *
 *  1. PATH DOUBLING. The downloader computed its target as
 *     `join(process.cwd(), CLIP_MODELS_ROOT)` UNCONDITIONALLY. With cwd
 *     `/app/apps/web` and an ABSOLUTE bind-mount `CLIP_MODELS_ROOT=/app/data/models/clip`,
 *     node's `path.join` strips the leading slash of the 2nd arg and appends, yielding
 *     `/app/apps/web/app/data/models/clip` — the doubled "app/" seen in production —
 *     so weights landed in the container's ephemeral fs, never the mounted volume.
 *     Meanwhile clip-model.ts used an absolute env value DIRECTLY, so the two diverged.
 *     resolveClipModelsRoot() must honor an absolute value verbatim and resolve a
 *     relative/unset one against cwd, for BOTH consumers.
 *
 *  2. REVISION-SUBDIR LAYOUT. @huggingface/transformers v3, when a non-`main`
 *     revision is pinned, keys its filesystem cache by `<repoId>/<revision>/<file>`.
 *     The downloader's checksum/idempotency verification must look in that revision
 *     subdir — exactly where the offline `allowRemoteModels=false` loader reads back —
 *     or a perfectly good download is falsely reported MISSING and aborted (the
 *     production "MISSING onnx/model_quantized.onnx … Aborting." failure).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import {
    resolveClipModelsRoot,
    clipModelArtifactDir,
    DEFAULT_CLIP_MODELS_ROOT,
} from '@/lib/clip-paths';
import { JINA_CLIP_MODEL_ID, JINA_CLIP_REVISION } from '@/lib/clip-model-id';

describe('resolveClipModelsRoot — absolute-vs-relative CLIP_MODELS_ROOT', () => {
    // The 2-arg form passes the env value EXPLICITLY, so these cases are hermetic
    // regardless of the ambient CLIP_MODELS_ROOT in the test process.
    it('uses an ABSOLUTE CLIP_MODELS_ROOT verbatim — no cwd doubling', () => {
        // The exact production shape: absolute bind-mount, cwd nested under /app/apps/web.
        const out = resolveClipModelsRoot('/app/apps/web', '/app/data/models/clip');
        expect(out).toBe('/app/data/models/clip');
        // The historical bug signature must NOT reappear.
        expect(out).not.toContain('/app/apps/web/app/');
        expect(out).not.toContain('apps/web/app/data');
    });

    it('resolves a RELATIVE CLIP_MODELS_ROOT against cwd', () => {
        expect(resolveClipModelsRoot('/app/apps/web', 'data/models/clip')).toBe(
            join('/app/apps/web', 'data/models/clip'),
        );
    });

    it('treats an explicit empty string as unset → cwd-joined default', () => {
        expect(resolveClipModelsRoot('/app/apps/web', '')).toBe(
            join('/app/apps/web', DEFAULT_CLIP_MODELS_ROOT),
        );
    });

    it('always returns an absolute path', () => {
        expect(isAbsolute(resolveClipModelsRoot('/app/apps/web', '/abs/vol'))).toBe(true);
        expect(isAbsolute(resolveClipModelsRoot('/app/apps/web', 'rel/vol'))).toBe(true);
        expect(isAbsolute(resolveClipModelsRoot('/app/apps/web', ''))).toBe(true);
    });
});

describe('resolveClipModelsRoot — reads process.env when no override is passed', () => {
    const SAVED = process.env['CLIP_MODELS_ROOT'];
    afterEach(() => {
        // Restore the ambient env so we never leak state into sibling test files.
        if (SAVED === undefined) delete process.env['CLIP_MODELS_ROOT'];
        else process.env['CLIP_MODELS_ROOT'] = SAVED;
    });

    it('falls back to the cwd-joined default when CLIP_MODELS_ROOT is unset in the env', () => {
        delete process.env['CLIP_MODELS_ROOT'];
        expect(resolveClipModelsRoot('/app/apps/web')).toBe(
            join('/app/apps/web', DEFAULT_CLIP_MODELS_ROOT),
        );
    });

    it('honors an absolute CLIP_MODELS_ROOT from the env verbatim (production bind-mount)', () => {
        process.env['CLIP_MODELS_ROOT'] = '/app/data/models/clip';
        const out = resolveClipModelsRoot('/app/apps/web');
        expect(out).toBe('/app/data/models/clip');
        expect(out).not.toContain('apps/web/app/data');
    });
});

describe('clipModelArtifactDir — Transformers.js revision-subdir layout', () => {
    it('nests the artifacts under <root>/<org>/<name>/<revision>', () => {
        const root = '/app/data/models/clip';
        const dir = clipModelArtifactDir(root);
        const [org, name] = JINA_CLIP_MODEL_ID.split('/');
        expect(dir).toBe(join(root, org, name, JINA_CLIP_REVISION));
        // The verified artifacts live UNDER the revision subdir (the load+verify contract).
        expect(join(dir, 'onnx', 'model_quantized.onnx')).toBe(
            join(root, org, name, JINA_CLIP_REVISION, 'onnx', 'model_quantized.onnx'),
        );
    });

    it('the artifact dir is the FLAT path PLUS the revision segment (regression: not flat)', () => {
        const root = '/vol';
        const [org, name] = JINA_CLIP_MODEL_ID.split('/');
        const flat = join(root, org, name); // the old (wrong) verification dir
        const dir = clipModelArtifactDir(root);
        expect(dir).toBe(join(flat, JINA_CLIP_REVISION));
        expect(dir).not.toBe(flat);
    });
});

describe('download script + loader use the shared resolver (no drift)', () => {
    const scriptSrc = readFileSync(join(process.cwd(), 'scripts/download-clip-models.ts'), 'utf8');
    const loaderSrc = readFileSync(join(process.cwd(), 'src/lib/clip-model.ts'), 'utf8');

    it('the download script resolves the root via resolveClipModelsRoot + the revision-subdir artifact dir', () => {
        expect(scriptSrc).toContain('resolveClipModelsRoot');
        expect(scriptSrc).toContain('clipModelArtifactDir');
        // The doubling bug was `join(process.cwd(), clipModelsRoot)` — it must be gone.
        expect(scriptSrc).not.toMatch(/join\(\s*process\.cwd\(\)\s*,\s*clipModelsRoot/);
    });

    it('the runtime loader resolves CLIP_MODELS_ROOT via the same shared resolver', () => {
        expect(loaderSrc).toContain('resolveClipModelsRoot');
    });
});
