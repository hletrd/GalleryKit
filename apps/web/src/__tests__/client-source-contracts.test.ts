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

function parseSingleQuotedArrayItems(sourceCode: string, pattern: RegExp): string[] {
  const body = pattern.exec(sourceCode)?.[1];
  expect(body).toBeTruthy();
  return Array.from(body!.matchAll(/'([^']+)'/g), (match) => match[1]).sort();
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

  it('mounts the service worker registration component from the root layout', () => {
    const layout = source('app/[locale]/layout.tsx');
    expect(layout).toContain("import { RegisterServiceWorker } from '@/components/register-service-worker'");
    expect(layout).toContain('<RegisterServiceWorker />');
  });

  it('keeps collapsed mobile nav focus order aligned with visual controls before menu', () => {
    const code = source('components/nav-client.tsx');
    expect(code.indexOf('id="primary-nav-controls"')).toBeLessThan(code.indexOf('Mobile Expand Toggle'));
    expect(code).toContain('collapsed controls so DOM focus order matches the visual');
    expect(code).not.toContain('order-last ml-1');
  });

  it('keeps nav search copy desktop-only even when production semantic search is active', () => {
    const code = source('components/search.tsx');
    expect(code).toContain("const showSearchLabel = semanticSearchMode === 'production' || showDesktopLabel");
    expect(code).toContain("size={showSearchLabel ? 'default' : 'icon'}");
    expect(code).toContain('className={showSearchLabel ? "h-11 min-w-11 gap-2 px-3" : "h-11 w-11"}');
    expect(code).toContain('showDesktopLabel ? "hidden lg:inline" : "inline"');
    expect(code).not.toContain("showDesktopLabel && semanticSearchMode !== 'production'");
    expect(code).toContain("{t('aria.searchPhotos')}</span>}");
  });

  it('keeps admin taxonomy and SEO save failures visible after toast dismissal', () => {
    const tags = source('app/[locale]/admin/(protected)/tags/tag-manager.tsx');
    const categories = source('app/[locale]/admin/(protected)/categories/topic-manager.tsx');
    const seo = source('app/[locale]/admin/(protected)/seo/seo-client.tsx');

    for (const code of [tags, categories, seo]) {
      expect(code).toContain('role="alert"');
      expect(code).toContain('tabIndex={-1}');
      expect(code).toContain('aria-invalid={!!');
    }
    expect(categories).toContain('id="create-topic-error"');
    expect(categories).toContain('id="edit-topic-error"');
    expect(categories).toContain('id="new-topic-alias-error"');
    expect(tags).toContain('id="edit-tag-error"');
    expect(seo).toContain('id="seo-form-error"');
  });

  it('names tag, category, and image delete targets in destructive confirmations', () => {
    const tags = source('app/[locale]/admin/(protected)/tags/tag-manager.tsx');
    const categories = source('app/[locale]/admin/(protected)/categories/topic-manager.tsx');
    const imageManager = source('components/image-manager.tsx');
    expect(tags).toContain('const deleteTarget = initialTags.find');
    expect(tags).toContain("t('tags.deleteConfirmTitle', { name: deleteTarget?.name ?? '' })");
    expect(tags).toContain("t('tags.deleteConfirm', { name: deleteTarget?.name ?? '' })");
    expect(categories).toContain('const deleteTopicTarget = initialTopics.find');
    expect(categories).toContain("t('categories.deleteConfirmTitle', { label: deleteTopicTarget?.label ?? '' })");
    expect(categories).toContain("t('categories.deleteConfirm', { label: deleteTopicTarget?.label ?? '' })");
    expect(imageManager).toContain('const deleteTargetTitle = image.title || image.user_filename || `#${image.id}`');
    expect(imageManager).toContain("t('imageManager.deleteImageConfirmTitle', { title: deleteTargetTitle })");
    expect(imageManager).toContain("t('imageManager.deleteImageConfirmDesc', { title: deleteTargetTitle })");
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

  it('upload picker advertises backend-supported first-class browser uploads', () => {
    const code = source('components/upload-dropzone.tsx');
    const acceptExtensions = parseSingleQuotedArrayItems(code, /'image\/\*':\s*\[([^\]]+)\]/);
    expect(acceptExtensions).toEqual(['.avif', '.bmp', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'].sort());
    for (const ext of ['.arw', '.cr2', '.nef']) {
      expect(acceptExtensions).not.toContain(ext);
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
      expect(code, `${path} should append stable ids to repeated archive link labels`).toContain('const accessibleTitle = `${displayTitle} #${photo.id}`');
      expect(code, `${path} should pass the stable id label to aria copy`).toContain("aria-label={tAria('viewPhoto', { title: accessibleTitle })}");
      expect(code, `${path} should use action-oriented photo link labels`).toContain("tAria('viewPhoto'");
      expect(code, `${path} should avoid detail-page viewport prefetch on archive grids`).toContain('prefetch={false}');
      expect(code, `${path} should not hard-code English photo fallback for cards`).not.toContain("getPhotoDisplayTitleFromTagNames(photo, 'Photo')");
      expect(code, `${path} should not use bare title-only link labels`).not.toContain('aria-label={displayTitle}');
    }
  });

  it('keeps the desktop photo-viewer info sidebar transition short', () => {
    const code = source('components/photo-viewer.tsx');
    expect(code).toContain('transition-[opacity,transform] duration-200');
    expect(code).not.toContain('transition-[opacity,transform] duration-500');
  });

  it('timeline and year metadata include social previews and localized invalid-year copy', () => {
    const timeline = source('app/[locale]/(public)/timeline/page.tsx');
    expect(timeline).toContain('openGraph');
    expect(timeline).toContain('twitter');
    expect(timeline).toContain('getOpenGraphLocale');
    expect(timeline).toContain('getAlternateOpenGraphLocales');

    const year = source('app/[locale]/(public)/year/[year]/page.tsx');
    // C2-04 (UX-03, run-10 c2): the invalid-year branch now throws
    // notFound() (status-bearing 404 via year/[year]/layout.tsx +
    // generateMetadata) instead of returning a translated notFoundTitle —
    // the not-found boundary supplies the localized copy.
    expect(year).toContain('notFound()');
    expect(year).not.toContain("title: 'Not Found'");
    expect(year).toContain('openGraph');
    expect(year).toContain('twitter');
    const yearLayout = source('app/[locale]/(public)/year/[year]/layout.tsx');
    expect(yearLayout).toContain('notFound()');
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
    expect(code).not.toContain('maxLength={128}');
    expect(code).toContain('maxLength={256}');
    expect(action).toContain("field?: 'label'");
    expect(action).toMatch(/return \{ error: t\('lrTokenInvalidLabel'\), field: 'label' \};/);
    expect(action).toContain('Do not mirror this with HTML maxLength={128}');
  });

  it('renders token-list load failures as a persistent retryable alert', () => {
    const code = source('app/[locale]/admin/(protected)/tokens/tokens-client.tsx');
    const action = source('app/actions/lr-tokens.ts');
    const tokenLib = source('lib/admin-tokens.ts');
    expect(code).toContain("const [loadError, setLoadError] = useState('')");
    expect(code).toContain("const loadErrorId = 'token-list-error'");
    expect(code).toMatch(/setLoading\(true\);[\s\S]{0,80}setLoadError\(''\);/);
    expect(code).toMatch(/setLoadError\(result\.error\);[\s\S]{0,80}toast\.error\(result\.error\);/);
    expect(code).toContain(') : loadError ? (');
    expect(code).toContain('id={loadErrorId} role="alert"');
    expect(code).toContain("t('common.tryAgain')");
    expect(code).toContain('onClick={fetchTokens}');
    expect(code).not.toMatch(/tokens\.length === 0[\s\S]{0,80}loadError/);
    expect(action).toMatch(/try \{[\s\S]*return await listTokensForUser\(user\.id\);[\s\S]*catch \(err: unknown\)/);
    expect(action).toContain("return { error: t('lrTokenListFailed') };");
    const listFunction = /export async function listTokensForUser[\s\S]*?\n}/.exec(tokenLib)?.[0] ?? '';
    expect(listFunction).toContain('ORDER BY created_at DESC');
    expect(listFunction).not.toContain('catch');
    expect(listFunction).not.toContain('return []');
  });

  it('keeps browser upload accept extensions aligned with backend-supported photo formats', () => {
    const dropzone = source('components/upload-dropzone.tsx');
    const processor = source('lib/process-image.ts');
    const acceptExtensions = parseSingleQuotedArrayItems(dropzone, /'image\/\*':\s*\[([^\]]+)\]/);
    const backendExtensions = parseSingleQuotedArrayItems(processor, /const ALLOWED_EXTENSIONS = new Set\(\[\s*([\s\S]*?)\s*\]\)/);
    expect(acceptExtensions).toEqual(backendExtensions);
  });
});
