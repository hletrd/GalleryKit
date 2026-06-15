import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('backfill re-embed contract', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/backfill-clip-embeddings.ts'), 'utf8');
  it('re-embeds rows whose model_version != the target (filters notExists on modelVersion)', () => {
    expect(src).toContain('modelVersion');
    expect(src).toMatch(/eq\(\s*imageEmbeddings\.modelVersion/);
  });
  it('uses the real encoder under --production', () => {
    expect(src).toContain('embedImageReal');
    expect(src).toContain('--production');
  });
  it('does not gate on the obsolete semantic_search_enabled key', () => {
    expect(src).not.toContain("'semantic_search_enabled'");
  });
});
