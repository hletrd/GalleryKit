import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(__dirname, '..', path), 'utf8');
}

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function hasMetadataProvider(path: string): boolean {
  const code = readFileSync(path, 'utf8');
  return code.includes('generateMetadata') && (
    code.includes('adminRouteMetadata(') ||
    code.includes('adminTokenRouteMetadata')
  );
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

    const adminRoot = resolve(__dirname, '../app/[locale]/admin');
    const routeFiles = walkFiles(adminRoot)
      .filter((path) => path.endsWith('/page.tsx'))
      .map((path) => relative(resolve(__dirname, '..'), path));

    for (const routeFile of routeFiles) {
      let current = resolve(__dirname, '..', routeFile);
      let covered = hasMetadataProvider(current);
      while (!covered && dirname(current).startsWith(adminRoot)) {
        current = join(dirname(current), 'layout.tsx');
        if (statSync(current, { throwIfNoEntry: false })?.isFile()) {
          covered = hasMetadataProvider(current);
        }
        const parent = dirname(dirname(current));
        if (dirname(current) === adminRoot || parent.length >= dirname(current).length) break;
        current = parent;
      }
      expect(covered, `${routeFile} should have page or ancestor admin metadata coverage`).toBe(true);
    }
  });

  it('upload picker only advertises formats accepted as first-class browser uploads', () => {
    const code = source('components/upload-dropzone.tsx');
    const acceptList = /'image\/\*':\s*\[([^\]]+)\]/.exec(code)?.[1] ?? '';
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif', '.gif']) {
      expect(acceptList).toContain(`'${ext}'`);
    }
    for (const ext of ['.arw', '.heic', '.heif', '.bmp']) {
      expect(acceptList).not.toContain(`'${ext}'`);
    }
  });

  it('templated public route metadata returns bare titles for archive/map/year pages', () => {
    expect(source('app/[locale]/(public)/timeline/page.tsx')).toContain("title: t('title'),");
    expect(source('app/[locale]/(public)/map/page.tsx')).toContain("title: t('title'),");
    expect(source('app/[locale]/(public)/year/[year]/page.tsx')).toContain("const title = t('yearInReview'");
  });

  it('theme toggle announces current and next theme state', () => {
    const code = source('components/nav-client.tsx');
    expect(code).toContain('const currentTheme');
    expect(code).toContain('const nextThemeValue');
    expect(code).toContain("t('aria.cycleTheme'");
    expect(code).toContain('aria-label={themeAriaLabel}');
    expect(code).not.toContain("aria-label={t('aria.toggleTheme')}");
  });

  it('search imports semantic request defaults from the client-safe constant module', () => {
    const code = source('components/search.tsx');
    expect(code).toContain("from '@/lib/clip-embedding-constants'");
    expect(code).not.toContain("from '@/lib/clip-embeddings'");
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

  it('associates token label validation with the label input', () => {
    const code = source('app/[locale]/admin/(protected)/tokens/tokens-client.tsx');
    const action = source('app/actions/lr-tokens.ts');
    expect(code).toContain("const [labelError, setLabelError] = useState('')");
    expect(code).toContain("const labelErrorId = 'token-label-error'");
    expect(code).toContain('aria-invalid={!!labelError}');
    expect(code).toContain('aria-describedby={labelError ? labelErrorId : undefined}');
    expect(code).toContain('<p id={labelErrorId} role="alert"');
    expect(code).toMatch(/onOpenChange=\{\(open\) => \{[\s\S]{0,120}if \(!open\) setLabelError\(''\);/);
    expect(code).toMatch(/onChange=\{\(e\) => \{[\s\S]{0,120}if \(labelError\) setLabelError\(''\);/);
    expect(code).toMatch(/if \(result\.field === 'label'\) \{[\s\S]{0,80}setLabelError\(result\.error\);/);
    expect(action).toContain("field?: 'label'");
    expect(action).toMatch(/return \{ error: t\('lrTokenInvalidLabel'\), field: 'label' \};/);
  });

  it('renders token-list load failures as a persistent retryable alert', () => {
    const code = source('app/[locale]/admin/(protected)/tokens/tokens-client.tsx');
    expect(code).toContain("const [loadError, setLoadError] = useState('')");
    expect(code).toContain("const loadErrorId = 'token-list-error'");
    expect(code).toMatch(/setLoading\(true\);[\s\S]{0,80}setLoadError\(''\);/);
    expect(code).toMatch(/setLoadError\(result\.error\);[\s\S]{0,80}toast\.error\(result\.error\);/);
    expect(code).toContain(') : loadError ? (');
    expect(code).toContain('id={loadErrorId} role="alert"');
    expect(code).toContain("t('common.tryAgain')");
    expect(code).toContain('onClick={fetchTokens}');
    expect(code).not.toMatch(/tokens\.length === 0[\s\S]{0,80}loadError/);
  });
});
