/**
 * clip-offline-load.test.ts
 *
 * Activation proof: the REAL encoder (lib/clip-model.ts) loads jina-clip-v2 q8
 * OFFLINE (env.allowRemoteModels=false + the pinned revision) from a CLIP_MODELS_ROOT
 * that was populated BY scripts/download-clip-models.ts — with NO network and NO
 * manual symlinks — and both towers return 512-dim L2-normalized Float32Arrays.
 *
 * This is the exact seed→offline-load path production uses (sidecar seeds the
 * bind-mount volume; the web app + --production backfill load it offline). It pins
 * the fix for the two defects that blocked activation: the doubled `/app/apps/web/app/...`
 * download path, and the flat-vs-revision-subdir mismatch that made the offline load
 * fail to find the weights without Task-14-style symlinks.
 *
 * GATED — runs only when CLIP_OFFLINE_LOAD=1 AND CLIP_MODELS_ROOT points at a
 * directory already seeded by the download script (so default CI without weights
 * skips it). The runner must NOT pre-touch node_modules' cache; the whole point is
 * that the load resolves from CLIP_MODELS_ROOT.
 *
 *   CLIP_OFFLINE_LOAD=1 CLIP_MODELS_ROOT=/abs/seeded/dir \
 *     npx vitest run src/__tests__/clip-offline-load.test.ts
 *
 * Note (macOS): onnxruntime-node may abort the worker with code 134 during native
 * teardown AFTER inference completes — that is the known benign teardown crash, not
 * a test failure. The assertions and the printed dims/norm complete before teardown.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { existsSync } from 'fs';

const ROOT = process.env['CLIP_MODELS_ROOT'];
const SEEDED =
    process.env['CLIP_OFFLINE_LOAD'] === '1' &&
    !!ROOT &&
    // The seeded layout transformers.js v3 writes for the pinned revision.
    existsSync(
        join(ROOT, 'jinaai', 'jina-clip-v2', 'e10d47f5691d0454a0fb5d13f46f2199b74cb436', 'onnx', 'model_quantized.onnx'),
    );

const d = SEEDED ? describe : describe.skip;
const EMBEDDING_DIM = 512;

function assertUnit512(label: string, v: Float32Array): void {
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    console.log(`[clip-offline-load] ${label}: dims=${v.length} norm=${norm.toFixed(6)}`);
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(EMBEDDING_DIM);
    expect(norm).toBeCloseTo(1, 4);
}

d('CLIP offline activation load (from a download-script-seeded CLIP_MODELS_ROOT)', () => {
    it('embedTextReal loads offline and returns a 512-dim unit vector', async () => {
        const { embedTextReal } = await import('@/lib/clip-model');
        assertUnit512('embedTextReal', await embedTextReal('a red flower'));
    }, 120_000);

    it('embedImageReal loads offline and returns a 512-dim unit vector', async () => {
        const { embedImageReal } = await import('@/lib/clip-model');
        const fixture = join(process.cwd(), 'src/__tests__/fixtures/clip/red-flower.jpg');
        assertUnit512('embedImageReal', await embedImageReal(fixture));
    }, 120_000);
});
