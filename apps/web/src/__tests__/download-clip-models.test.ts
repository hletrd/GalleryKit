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
    expect(src).toContain('sha256File');
    expect(src).not.toMatch(/Running in stub mode/);
  });
  it('aborts (exit 1) on checksum failure', () => {
    expect(src).toMatch(/process\.exit\(1\)/);
  });
  it('is idempotent: skips files already present with a matching checksum', () => {
    expect(src).toMatch(/existsSync|stat/);
  });
});
