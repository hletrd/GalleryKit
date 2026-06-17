import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Contract: the script must target the data/models/clip volume path, verify the
// SHA-256 manifest (logic now lives in clip-model-manifest.ts — behaviorally tested
// in clip-model-manifest.test.ts, including the mismatch/abort + delete path), and
// not be a console.log stub.
describe('download-clip-models', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/download-clip-models.ts'), 'utf8');
  it('targets the data/models/clip volume dir', () => {
    expect(src).toContain('data/models/clip');
  });
  it('verifies the SHA-256 manifest via the shared helper (not a console.log stub)', () => {
    expect(src).toContain('verifyAndCleanArtifacts');
    expect(src).not.toMatch(/Running in stub mode/);
  });
  it('aborts (exit 1) on checksum failure', () => {
    expect(src).toMatch(/process\.exit\(1\)/);
  });
  it('is idempotent: skips files already present with a matching checksum', () => {
    expect(src).toMatch(/existsSync|stat/);
  });
  // AGG-C8-02 (run-6 cycle-8): the idempotency fast-path must verify the FULL
  // manifest before short-circuiting, NOT just onnx/model_quantized.onnx. The old
  // ONNX-only fast-path reported a partial seed (valid ONNX, missing/corrupt
  // tokenizer.json) as "already up to date" and exited 0, while the runtime offline
  // load then threw and wedged every search at 503. Pin the fix so it can't regress.
  it('idempotency fast-path verifies the full manifest (not ONNX-only)', () => {
    // The early-return path must call verifyAndCleanArtifacts with deleteOnMismatch=false
    // (an inspection that doesn't mutate a good file) BEFORE returning "up to date".
    expect(src).toMatch(/verifyAndCleanArtifacts\([^)]*MANIFEST[^)]*false/s);
    // The old ONNX-only single-file checksum short-circuit must be gone: there must be
    // no bare `actual === expected` comparison gating the early return on one file.
    expect(src).not.toMatch(/const expected = MANIFEST\['onnx\/model_quantized\.onnx'\]/);
  });
});
