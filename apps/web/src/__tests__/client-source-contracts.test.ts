import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(__dirname, '..', path), 'utf8');
}

describe('client component source contracts', () => {
  it('refreshes the dashboard after partial-success uploads', () => {
    const code = source('components/upload-dropzone.tsx');
    const partialBranch = /toast\.warning\(t\('upload\.partialSuccess'[\s\S]*?if \(successCount > 0\) \{[\s\S]*?router\.refresh\(\);[\s\S]*?\}/.exec(code);
    expect(partialBranch).not.toBeNull();
  });

  it('reconnects the load-more IntersectionObserver through a callback ref', () => {
    const code = source('components/load-more.tsx');
    expect(code).toContain('const setSentinelRef = useCallback');
    expect(code).toContain('observerRef.current?.disconnect()');
    expect(code).toContain('ref={setSentinelRef}');
  });

  it('keeps the mobile info bottom sheet modal while it is open', () => {
    const code = source('components/info-bottom-sheet.tsx');
    expect(code).toContain('<FocusTrap active={isOpen}');
    expect(code).toContain('aria-modal="true"');
    expect(code).not.toContain("aria-modal={sheetState === 'expanded'");
  });

  it('generates password page metadata from localized nav messages', () => {
    const code = source('app/[locale]/admin/(protected)/password/page.tsx');
    expect(code).toContain("getTranslations('nav')");
    expect(code).toContain("`${t('password')} | ${t('admin')}`");
  });
});
