import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('search disclaimer', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/search.tsx'), 'utf8');
  it('shows semanticExperimentalHint only in stub mode, not production', () => {
    expect(src).toMatch(/semanticSearchMode === 'stub'[\s\S]*semanticExperimentalHint/);
  });
});
