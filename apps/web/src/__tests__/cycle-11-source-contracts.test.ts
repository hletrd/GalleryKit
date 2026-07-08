import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import ko from '../../messages/ko.json';

function src(path: string) {
    return readFileSync(resolve(__dirname, '..', path), 'utf8');
}

function webRoot(path: string) {
    return readFileSync(resolve(__dirname, '..', '..', path), 'utf8');
}

function repoRoot(path: string) {
    return readFileSync(resolve(__dirname, '..', '..', '..', '..', path), 'utf8');
}

describe('cycle 11 source contracts', () => {
    it('sidecar backfills use the shared bounded positive integer parser with an explicit cap', () => {
        for (const path of [
            'scripts/backfill-color-pipeline.ts',
            'scripts/backfill-cicp-recheck.ts',
        ]) {
            const code = webRoot(path);
            expect(code).toContain('parseBoundedPositiveInteger(process.env.BACKFILL_CONCURRENCY');
            expect(code).toContain('fallback: 2');
            expect(code).toContain('max: 8');
            expect(code).not.toContain('Math.max(1, Number(process.env.BACKFILL_CONCURRENCY) || 2)');
        }
    });

    it('LIKE search predicates emit a MariaDB-safe explicit ESCAPE clause', () => {
        const helper = src('lib/sql-like.ts');
        const data = src('lib/data.ts');
        const smartCollections = src('lib/smart-collections.ts');

        expect(helper).toContain("ESCAPE '!'");
        expect(helper).toContain("value.replace(/[!%_]/g, '!$&')");
        expect(data).toContain("import { containsLike } from './sql-like'");
        expect(smartCollections).toContain("import { containsLike } from '@/lib/sql-like'");
        expect(data).not.toContain('like(images.title');
        expect(smartCollections).not.toContain('like(col');
    });

    it('per-photo OG route uses the effective canonical BASE_URL for pre-SEO fallback and fetch origin', () => {
        const route = src('app/api/og/photo/[id]/route.tsx');
        expect(route).toContain("import { BASE_URL } from '@/lib/constants'");
        expect(route).toContain('buildFallbackResponse(BASE_URL, OG_ERROR_CACHE_CONTROL)');
        expect(route).toContain('fetchOrigin = new URL(BASE_URL).origin');
        expect(route).not.toContain('fetchOrigin = new URL(siteConfig.url).origin');
    });

    it('footer always renders the privacy link regardless of analytics configuration', () => {
        const footer = src('components/footer.tsx');
        expect(footer).toContain("import { getGalleryConfig } from '@/lib/gallery-config'");
        expect(footer).toContain('config.showTimelineNav ?');
        expect(footer).toContain('config.showMapNav ?');
        expect(footer).toContain("href={localizePath(locale, '/privacy')}");
        expect(footer).toContain("href={localizePath(locale, '/timeline')}");
        expect(footer).toContain("href={localizePath(locale, '/map')}");
        expect(footer).toContain('flex-wrap');
        expect(footer).not.toContain('hasGoogleAnalytics');
    });

    it('primary navigation exposes timeline and map as core browse links', () => {
        const nav = src('components/nav-client.tsx');
        expect(nav).toContain("href: localizePath(locale, '/timeline')");
        expect(nav).toContain("href: localizePath(locale, '/map')");
        expect(nav).toContain("t('footer.timeline')");
        expect(nav).toContain("t('footer.map')");
        expect(nav).toContain('showDesktopLabel');
    });

    it('timeline and year archive cards eager-load initial images and guard invalid geometry', () => {
        for (const path of [
            'app/[locale]/(public)/timeline/page.tsx',
            'app/[locale]/(public)/year/[year]/page.tsx',
        ]) {
            const code = src(path);
            expect(code).toContain('const eagerArchiveImageIds = new Set(galleryPhotos.slice(0, 6).map((photo) => photo.id))');
            expect(code).toContain('const shouldEagerLoad = eagerArchiveImageIds.has(photo.id)');
            expect(code).toContain("loading={shouldEagerLoad ? 'eager' : 'lazy'}");
            expect(code).toContain("fetchPriority={shouldEagerLoad ? 'high' : undefined}");
            expect(code).toContain("const aspectRatio = photo.width > 0 && photo.height > 0");
            expect(code).toContain(": '1 / 1'");
        }
    });

    it('mobile photo swipes are disabled while the info bottom sheet is open', () => {
        const viewer = src('components/photo-viewer.tsx');
        expect(viewer).toContain('disabled={showLightbox || showBottomSheet}');
    });

    it('public copy matches current privacy and EXIF-derived alt-text behavior', () => {
        expect(en.privacy.metadataBody).toContain('public map');
        expect(en.privacy.metadataBody).toContain('public-GPS visible');
        expect(en.privacy.mapTilesTitle).toContain('Map Tiles');
        expect(en.privacy.mapTilesBody).toContain('OpenStreetMap tile servers');
        expect(ko.privacy.metadataBody).toContain('공개 지도');
        expect(ko.privacy.metadataBody).toContain('공개 GPS 표시');
        expect(ko.privacy.mapTilesTitle).toContain('지도 타일');
        expect(ko.privacy.mapTilesBody).toContain('OpenStreetMap 타일 서버');
        expect(en.imageManager.bulkApplyAltSuggestedHint).toContain('EXIF-derived');
        expect(ko.imageManager.bulkApplyAltSuggestedHint).toContain('EXIF 기반');
        expect(en.viewer.shortcutsHint).toContain('in lightbox');
        expect(ko.viewer.shortcutsHint).toContain('라이트박스');
    });

    it('README scopes batch operations to metadata instead of photo editing', () => {
        const readme = repoRoot('README.md');
        expect(readme).toContain('batch metadata editing');
        expect(readme).toContain('not a photo editor, culler, or scoring tool');
    });
});
