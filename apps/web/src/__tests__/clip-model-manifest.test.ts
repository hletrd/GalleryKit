/**
 * AGG-C10-10 / TASK-6 (run-6 cycle-1): behavioral coverage of the CLIP model
 * SHA-256 manifest verify/clean helpers used by download-clip-models.ts.
 *
 * The prior download-clip-models.test.ts only grepped the source for
 * `createHash('sha256')` — it never proved the mismatch path aborts or that a
 * poisoned file is deleted. These tests drive the real verifyAndCleanArtifacts()
 * against a temp dir: a matching file passes, a mismatching file is reported as a
 * failure AND deleted, and a missing file is a failure. This is what catches an
 * inverted comparison or a dropped delete/abort.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import {
    CLIP_MODEL_MANIFEST,
    sha256File,
    verifyAndCleanArtifacts,
} from '../../scripts/clip-model-manifest';

function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

describe('clip-model-manifest', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'clip-manifest-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('CLIP_MODEL_MANIFEST lists the onnx + tokenizer artifacts with 64-hex SHAs', () => {
        expect(Object.keys(CLIP_MODEL_MANIFEST)).toContain('onnx/model_quantized.onnx');
        expect(Object.keys(CLIP_MODEL_MANIFEST)).toContain('tokenizer.json');
        for (const hash of Object.values(CLIP_MODEL_MANIFEST)) {
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    it('sha256File computes the streaming digest of a file', async () => {
        const p = join(dir, 'f.bin');
        const bytes = Buffer.from('hello clip');
        writeFileSync(p, bytes);
        expect(await sha256File(p)).toBe(sha256(bytes));
    });

    it('passes (ok=true, nothing deleted) when every artifact matches', async () => {
        const content = Buffer.from('content');
        const manifest: Record<string, string> = { 'a.bin': sha256(content), 'sub/b.bin': sha256(content) };
        writeFileSync(join(dir, 'a.bin'), content);
        mkdirSync(join(dir, 'sub'), { recursive: true });
        writeFileSync(join(dir, 'sub', 'b.bin'), content);

        const res = await verifyAndCleanArtifacts(dir, manifest);
        expect(res.ok).toBe(true);
        expect(res.failures).toEqual([]);
        expect(res.deleted).toEqual([]);
        expect(existsSync(join(dir, 'a.bin'))).toBe(true);
    });

    it('FAILS and DELETES a mismatching artifact (the abort path)', async () => {
        const manifest: Record<string, string> = { 'model.onnx': sha256(Buffer.from('the-real-weights')) };
        // Write DIFFERENT (poisoned) bytes than the manifest expects.
        const poisoned = join(dir, 'model.onnx');
        writeFileSync(poisoned, Buffer.from('tampered-weights'));

        const res = await verifyAndCleanArtifacts(dir, manifest);
        expect(res.ok).toBe(false);
        expect(res.failures).toContain('model.onnx');
        expect(res.deleted).toContain('model.onnx');
        // The poisoned file must be gone so the runtime loader never trusts it.
        expect(existsSync(poisoned)).toBe(false);
    });

    it('does NOT delete the mismatching file when deleteOnMismatch=false', async () => {
        const manifest: Record<string, string> = { 'model.onnx': sha256(Buffer.from('real')) };
        const p = join(dir, 'model.onnx');
        writeFileSync(p, Buffer.from('tampered'));

        const res = await verifyAndCleanArtifacts(dir, manifest, false);
        expect(res.ok).toBe(false);
        expect(res.failures).toContain('model.onnx');
        expect(res.deleted).toEqual([]);
        expect(existsSync(p)).toBe(true);
    });

    it('reports a MISSING artifact as a failure (nothing to delete)', async () => {
        const manifest: Record<string, string> = { 'absent.onnx': sha256(Buffer.from('x')) };
        const res = await verifyAndCleanArtifacts(dir, manifest);
        expect(res.ok).toBe(false);
        expect(res.failures).toContain('absent.onnx');
        expect(res.deleted).toEqual([]);
    });
});
