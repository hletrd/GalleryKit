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
    expect(code).toMatch(/<FocusTrap\s+active={isOpen}/);
    expect(code).toContain('aria-modal="true"');
    expect(code).not.toContain("aria-modal={sheetState === 'expanded'");
  });

  it('generates password page metadata from localized nav messages', () => {
    const code = source('app/[locale]/admin/(protected)/password/page.tsx');
    expect(code).toContain("getTranslations('nav')");
    expect(code).toContain("`${t('password')} | ${t('admin')}`");
  });

  // R4C4 UX-R4C4-04 / TEST-R4C4-13: the token-create Enter path must respect
  // the pending state. The Create button disables on isPending, but Enter in
  // the label input calls handleCreate directly — without the guard,
  // key-repeat while the server action is in flight mints multiple live
  // tokens whose plaintext is never shown (only the last one is displayed).
  // Mirrors the sibling pattern in image-manager.tsx / topic-manager.tsx.
  it('guards token creation against Enter-key double-submit while pending', () => {
    const code = source('app/[locale]/admin/(protected)/tokens/tokens-client.tsx');
    // handleCreate must early-return on isPending BEFORE any work.
    const handler = /const handleCreate = \(\) => \{[\s\S]*?if \(isPending\) return;[\s\S]*?startTransition/.exec(code);
    expect(handler).not.toBeNull();
    // The Enter handler must preventDefault and route through handleCreate.
    expect(code).toMatch(/e\.key === 'Enter'\)\s*\{\s*e\.preventDefault\(\);\s*handleCreate\(\);/);
  });
});
