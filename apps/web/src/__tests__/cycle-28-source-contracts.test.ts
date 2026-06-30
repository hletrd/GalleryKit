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
            'app/[locale]/(public)/page.tsx',
            'app/[locale]/(public)/[topic]/page.tsx',
            'app/[locale]/(public)/p/[id]/page.tsx',
            'app/[locale]/(public)/g/[key]/page.tsx',
            'app/[locale]/(public)/s/[key]/page.tsx',
            'app/[locale]/(public)/c/[slug]/page.tsx',
            'app/[locale]/(public)/map/page.tsx',
            'app/[locale]/(public)/timeline/page.tsx',
            'app/[locale]/(public)/year/[year]/page.tsx',
        ];

        for (const page of publicPages) {
            const source = readSrc(page);
            expect(source).toContain('isRestoreMaintenanceActive');
            expect(source).toContain('<PublicRestoreMaintenance');
        }
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
