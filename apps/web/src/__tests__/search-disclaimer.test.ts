import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
describe('search disclaimer', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/search.tsx'), 'utf8');
  it('shows semanticExperimentalHint only in stub mode, not production', () => {
    expect(src).toMatch(/semanticSearchMode === 'stub'[\s\S]*semanticExperimentalHint/);
  });

  it('keeps the visible empty/error search status in the accessibility tree', () => {
    const statusBlock = src.match(
      /\) : trimmedQuery \? \([\s\S]{0,220}<div className="p-8 text-center text-muted-foreground text-sm"([^>]*)>/,
    );
    expect(statusBlock).not.toBeNull();
    expect(statusBlock?.[1] ?? '').not.toContain('aria-hidden');
    expect(statusBlock?.[1] ?? '').toContain('role="status"');
  });

  it('normalizes result labels through the shared photo-title helper', () => {
    const itemBody = src.slice(src.indexOf('function SearchResultItem'), src.indexOf('interface SearchResult {'));

    expect(src).toMatch(/import\s+\{\s*getPhotoResultLabel\s*\}\s+from '@\/lib\/photo-title'/);
    expect(itemBody).toContain('const label = getPhotoResultLabel(image, `${t(\'common.photo\')} ${image.id}`)');
    expect(itemBody).toContain('const resultLabel = `${label} #${image.id}`');
    expect(itemBody).toContain('aria-label={resultLabel}');
    expect(itemBody).toMatch(/<p className="font-medium text-sm truncate">\s*\{resultLabel\}\s*<\/p>/);
    expect(itemBody).not.toContain('image.title || image.description');
  });
});
