import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('upload embedding hook wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/image-queue.ts'), 'utf8');
  it('branches to embedImageReal in production', () => {
    expect(src).toContain('embedImageReal');
    expect(src).toContain("=== 'production'");
  });
  it('writes PRODUCTION_MODEL_VERSION for real embeddings', () => {
    expect(src).toContain('PRODUCTION_MODEL_VERSION');
  });
  it('keeps the stub path for stub mode', () => {
    expect(src).toContain('embedImageStub');
    expect(src).toContain('STUB_MODEL_VERSION');
  });
  it('stores the raw embedding buffer, not base64 (AGG-C10-01)', () => {
    // The write must NOT base64-encode the buffer (the read path round-trips raw bytes).
    expect(src).not.toMatch(/embedding:\s*base64/);
    expect(src).not.toContain("buf.toString('base64')");
    expect(src).toContain('embeddingToBuffer');
  });
});
