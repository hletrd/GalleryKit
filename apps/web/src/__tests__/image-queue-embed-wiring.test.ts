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
    expect(src).toContain('CLIP_MODEL_VERSION');
  });
});
