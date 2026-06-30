import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '..', '..');
const src = (relative: string) => readFileSync(path.join(appRoot, relative), 'utf8');

describe('cycle 29 restore-maintenance metadata guards', () => {
    const metadataRoutes = [
        'src/app/[locale]/(public)/page.tsx',
        'src/app/[locale]/(public)/[topic]/page.tsx',
        'src/app/[locale]/(public)/c/[slug]/page.tsx',
        'src/app/[locale]/(public)/g/[key]/page.tsx',
        'src/app/[locale]/(public)/map/page.tsx',
        'src/app/[locale]/(public)/p/[id]/page.tsx',
        'src/app/[locale]/(public)/s/[key]/page.tsx',
        'src/app/[locale]/(public)/timeline/page.tsx',
        'src/app/[locale]/(public)/year/[year]/page.tsx',
    ];

    it.each(metadataRoutes)('%s checks restore metadata before DB-backed reads', (routePath) => {
        const code = src(routePath);
        const metadataStart = code.indexOf('export async function generateMetadata');
        expect(metadataStart, `${routePath} should export generateMetadata`).toBeGreaterThanOrEqual(0);
        const metadataBody = code.slice(metadataStart, code.indexOf('export default', metadataStart));
        const guardIndex = metadataBody.indexOf('getPublicRestoreMaintenanceMetadata()');
        expect(guardIndex, `${routePath} should call getPublicRestoreMaintenanceMetadata`).toBeGreaterThanOrEqual(0);

        const dbReadMarkers = [
            'getSeoSettings()',
            'getImageCached(',
            'getTopicBySlugCached(',
            'getSmartCollectionBySlugCached(',
            'getLatestImageForOgCached(',
            'getTagsCached(',
        ];
        const firstDbRead = Math.min(
            ...dbReadMarkers
                .map((marker) => metadataBody.indexOf(marker))
                .filter((index) => index >= 0),
        );
        if (Number.isFinite(firstDbRead)) {
            expect(guardIndex, `${routePath} restore guard must precede first DB-backed metadata read`).toBeLessThan(firstDbRead);
        }
    });
});

describe('cycle 29 CLIP sidecar mode resolver', () => {
    it('uses shared semantic mode resolver in runtime and sidecar paths', () => {
        const shared = src('src/lib/gallery-config-shared.ts');
        const runtime = src('src/lib/gallery-config.ts');
        const sidecar = src('scripts/backfill-clip-embeddings.ts');

        expect(shared).toContain('export function resolveSemanticSearchMode');
        expect(runtime).toContain('resolveSemanticSearchMode(');
        expect(sidecar).toContain("import { resolveSemanticSearchMode } from '../src/lib/gallery-config-shared'");
        expect(sidecar).toContain('process.env.SEMANTIC_SEARCH_ALLOW_PRODUCTION === \'true\'');
    });
});

describe('cycle 29 UI safety contracts', () => {
    it('SimilarPhotos clears the fetch cache on retryable errors', () => {
        const code = src('src/components/similar-photos.tsx');
        expect(code).toMatch(/if \(!res\.ok\)[\s\S]*fetchedRef\.current = false/);
        expect(code).toMatch(/Network error[\s\S]*fetchedRef\.current = false/);
    });

    it('NavClient renders system theme until mounted', () => {
        const code = src('src/components/nav-client.tsx');
        expect(code).toContain('const [mounted, setMounted] = useState(false)');
        expect(code).toContain("const currentTheme = (mounted ? (theme ?? 'system') : 'system') as StoredTheme");
        expect(code).toContain('setMounted(true)');
    });

    it('TopicManager requires confirmation before publishing public GPS map visibility', () => {
        const code = src('src/app/[locale]/admin/(protected)/categories/topic-manager.tsx');
        expect(code).toContain('mapPublishCandidate');
        expect(code).toContain('mapPublishConfirmTitle');
        expect(code).toMatch(/if \(!topic\.map_visible\)[\s\S]*setMapPublishCandidate\(topic\)/);
        expect(code).toContain('await applyMapVisible(mapPublishCandidate.slug, true)');
    });

    it('admin e2e selectors target the current main-content landmark', () => {
        const adminSpec = src('e2e/admin.spec.ts');
        const helpers = src('e2e/helpers.ts');
        expect(adminSpec).not.toContain('#admin-content');
        expect(helpers).not.toContain('#admin-content');
        expect(adminSpec).toContain('#main-content');
        expect(helpers).toContain('#main-content');
    });
});
