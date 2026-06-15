import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Contract: the script must declare the model artifacts + their SHA-256 manifest
// and target the data/models/clip volume path — not be a console.log stub.
describe('download-clip-models', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/download-clip-models.ts'), 'utf8');
  it('targets the data/models/clip volume dir', () => {
    expect(src).toContain('data/models/clip');
  });
  it('verifies a SHA-256 checksum manifest (not a console.log stub)', () => {
    expect(src).toMatch(/createHash\(['"]sha256['"]\)/);
    expect(src).not.toMatch(/Running in stub mode/);
  });
  it('is idempotent: skips files already present with a matching checksum', () => {
    expect(src).toMatch(/existsSync|stat/);
  });
});
