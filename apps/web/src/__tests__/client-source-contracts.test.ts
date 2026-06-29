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

  it('generates admin page metadata from localized admin-route helpers', () => {
    const helper = source('app/[locale]/admin/admin-metadata.ts');
    expect(helper).toContain("getTranslations('nav')");
    expect(helper).toContain("getTranslations('lrToken')");

    const routeContracts = [
      ['app/[locale]/admin/page.tsx', "adminRouteMetadata('admin')"],
      ['app/[locale]/admin/(protected)/analytics/page.tsx', "adminRouteMetadata('analytics')"],
      ['app/[locale]/admin/(protected)/categories/page.tsx', "adminRouteMetadata('categories')"],
      ['app/[locale]/admin/(protected)/dashboard/page.tsx', "adminRouteMetadata('dashboard')"],
      ['app/[locale]/admin/(protected)/db/layout.tsx', "adminRouteMetadata('db')"],
      ['app/[locale]/admin/(protected)/password/page.tsx', "adminRouteMetadata('password')"],
      ['app/[locale]/admin/(protected)/seo/page.tsx', "adminRouteMetadata('seo')"],
      ['app/[locale]/admin/(protected)/settings/page.tsx', "adminRouteMetadata('settings')"],
      ['app/[locale]/admin/(protected)/tags/page.tsx', "adminRouteMetadata('tags')"],
      ['app/[locale]/admin/(protected)/tokens/page.tsx', 'adminTokenRouteMetadata'],
      ['app/[locale]/admin/(protected)/users/page.tsx', "adminRouteMetadata('users')"],
    ] as const;

    for (const [path, contract] of routeContracts) {
      const code = source(path);
      expect(code, `${path} should export generateMetadata`).toContain('generateMetadata');
      expect(code, `${path} should use the localized metadata helper`).toContain(contract);
    }
  });

  it('timeline and year cards use localized photo labels and action aria names', () => {
    for (const path of [
      'app/[locale]/(public)/timeline/page.tsx',
      'app/[locale]/(public)/year/[year]/page.tsx',
    ]) {
      const code = source(path);
      expect(code, `${path} should load common translations`).toContain("getTranslations('common')");
      expect(code, `${path} should load aria translations`).toContain("getTranslations('aria')");
      expect(code, `${path} should use localized untitled fallback`).toContain("tCommon('untitled')");
      expect(code, `${path} should use localized photo fallback`).toContain("tCommon('photo')");
      expect(code, `${path} should use action-oriented photo link labels`).toContain("tAria('viewPhoto'");
      expect(code, `${path} should not hard-code English photo fallback for cards`).not.toContain("getPhotoDisplayTitleFromTagNames(photo, 'Photo')");
      expect(code, `${path} should not use bare title-only link labels`).not.toContain('aria-label={displayTitle}');
    }
  });

  it('timeline and year metadata include social previews and localized invalid-year copy', () => {
    const timeline = source('app/[locale]/(public)/timeline/page.tsx');
    expect(timeline).toContain('openGraph');
    expect(timeline).toContain('twitter');
    expect(timeline).toContain('getOpenGraphLocale');
    expect(timeline).toContain('getAlternateOpenGraphLocales');

    const year = source('app/[locale]/(public)/year/[year]/page.tsx');
    expect(year).toContain("getTranslations('topic')");
    expect(year).toContain("title: tTopic('notFoundTitle')");
    expect(year).not.toContain("title: 'Not Found'");
    expect(year).toContain('openGraph');
    expect(year).toContain('twitter');
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
