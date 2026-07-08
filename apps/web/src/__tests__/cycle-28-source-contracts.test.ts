import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

describe('cycle 28 source contracts', () => {
    it('uses an absolute restore-maintenance marker directory in production builds', () => {
        const source = readSrc('lib/restore-maintenance-durable.ts');

        expect(source).toContain("process.env.NODE_ENV === 'production' ? '/app/data' : 'data'");
        expect(source).toContain('turbopackIgnore');
        expect(source).not.toMatch(/const\s+dir\s*=\s*['"]data['"]/);
    });

    it('keeps production CLIP sidecars behind the explicit production env opt-in', () => {
        const script = readRoot('scripts/backfill-clip-embeddings.ts');
        const docs = readFileSync(resolve(__dirname, '..', '..', '..', '..', 'CLAUDE.md'), 'utf8');

        expect(script).toContain("PRODUCTION_FLAG && process.env.SEMANTIC_SEARCH_ALLOW_PRODUCTION !== 'true'");
        expect(script).toContain('-v .../apps/web/data:/app/data');
        expect(script).toContain('CLIP_MODELS_ROOT=/app/data/models/clip');
        expect(docs).toContain('-e SEMANTIC_SEARCH_ALLOW_PRODUCTION=true');
    });

    it('short-circuits DB-backed public pages while restore maintenance is active', () => {
        const publicPages = [
            { path: 'app/[locale]/(public)/page.tsx', firstWorkMarker: 'getSeoSettings()' },
            { path: 'app/[locale]/(public)/[topic]/page.tsx', firstWorkMarker: 'getTopicBySlugCached(topic)' },
            { path: 'app/[locale]/(public)/p/[id]/page.tsx', firstWorkMarker: 'getImageCached(imageId)' },
            { path: 'app/[locale]/(public)/g/[key]/page.tsx', firstWorkMarker: 'isShareLookupRateLimited()' },
            { path: 'app/[locale]/(public)/s/[key]/page.tsx', firstWorkMarker: 'isShareLookupRateLimited()' },
            { path: 'app/[locale]/(public)/c/[slug]/page.tsx', firstWorkMarker: 'getSmartCollectionBySlugCached(slug)' },
            { path: 'app/[locale]/(public)/map/page.tsx', firstWorkMarker: 'getMapImages()' },
            { path: 'app/[locale]/(public)/timeline/page.tsx', firstWorkMarker: 'getTimelineYears()' },
            { path: 'app/[locale]/(public)/year/[year]/page.tsx', firstWorkMarker: 'getYearInReviewImages(yearNum)' },
        ];

        for (const page of publicPages) {
            const source = readSrc(page.path);
            const body = source.slice(source.indexOf('export default'));
            const maintenanceIndex = body.indexOf('isRestoreMaintenanceActive()');
            const workIndex = body.indexOf(page.firstWorkMarker);
            expect(maintenanceIndex, page.path).toBeGreaterThanOrEqual(0);
            expect(body, page.path).toContain('<PublicRestoreMaintenance');
            expect(workIndex, `${page.path} should contain ${page.firstWorkMarker}`).toBeGreaterThanOrEqual(0);
            expect(maintenanceIndex, page.path).toBeLessThan(workIndex);
        }
    });

    it('keeps DB-backed public pages dynamically fresh', () => {
        for (const page of [
            'app/[locale]/(public)/page.tsx',
            'app/[locale]/(public)/[topic]/page.tsx',
            'app/[locale]/(public)/p/[id]/page.tsx',
            'app/[locale]/(public)/g/[key]/page.tsx',
            'app/[locale]/(public)/s/[key]/page.tsx',
            'app/[locale]/(public)/c/[slug]/page.tsx',
            'app/[locale]/(public)/map/page.tsx',
            'app/[locale]/(public)/timeline/page.tsx',
            'app/[locale]/(public)/year/[year]/page.tsx',
        ]) {
            expect(readSrc(page), page).toContain('export const revalidate = 0;');
        }
    });

    it('fails closed on unscanned top-level server action modules under app routes', () => {
        const scanner = readRoot('scripts/check-action-origin.ts');

        expect(scanner).toContain("path.join(REPO_SRC, 'app')");
        expect(scanner).toContain('UNSCANNED SERVER ACTION MODULE');
        expect(scanner).toContain('INLINE SERVER ACTION');
        expect(scanner).toContain('findUnscannedUseServerFiles(appDir, actionFiles)');
    });

    it('keeps dense admin image tables horizontally scrollable with stable columns', () => {
        const source = readSrc('components/image-manager.tsx');

        expect(source).toContain('overflow-x-auto');
        expect(source).toContain('min-w-[220px]');
    });

    it('validates slideshow interval with accessible field-level errors', () => {
        const source = readSrc('app/[locale]/admin/(protected)/settings/settings-client.tsx');

        expect(source).toContain("addRangeError('slideshow_interval_seconds'");
        expect(source).toContain('aria-invalid={!!fieldErrors.slideshow_interval_seconds}');
        expect(source).toContain('slideshow-interval-error slideshow-interval-help');
    });
});
