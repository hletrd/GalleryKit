import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath: string): string {
    return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

describe('cycle 24 source contracts', () => {
    it('keeps localized structured-data and feed photo fallbacks out of English-only copy', () => {
        const localizedPaths = [
            'src/app/[locale]/(public)/page.tsx',
            'src/app/[locale]/(public)/[topic]/page.tsx',
            'src/app/[locale]/(public)/c/[slug]/page.tsx',
            'src/app/[locale]/(public)/[topic]/feed.xml/route.ts',
        ];

        for (const relativePath of localizedPaths) {
            const source = readRepoFile(relativePath);

            expect(source, `${relativePath} should load common translations`).toMatch(/getTranslations\((?:'common'|\{\s*locale,\s*namespace: 'common'\s*\})\)/);
            expect(source, `${relativePath} should not use an English-only fallback`).not.toContain('`Photo ${img.id}`');
            expect(source, `${relativePath} should use the localized photo label`).toContain("`${tCommon('photo')} ${img.id}`");
        }
    });

    it('keeps external public links explicit about opening a new window', () => {
        const footer = readRepoFile('src/components/footer.tsx');
        const viewer = readRepoFile('src/components/photo-viewer.tsx');
        const sheet = readRepoFile('src/components/info-bottom-sheet.tsx');

        expect(footer).toContain('aria-label={`GitHub ${t(\'opensInNewWindow\')}`}');
        expect(footer).toContain('rel="noopener noreferrer"');
        expect(viewer).toContain("t('common.opensInNewWindow')");
        expect(sheet).toContain("t('common.opensInNewWindow')");
    });

    it('keeps the mobile viewer description separate from desktop keyboard shortcuts', () => {
        const viewer = readRepoFile('src/components/photo-viewer.tsx');

        expect(viewer).toContain('aria-describedby="photo-viewer-description"');
        expect(viewer).toContain("id=\"photo-viewer-description\">{t('viewer.viewerDescription')}");
        expect(viewer).toContain('id="photo-viewer-shortcuts"');
        expect(viewer).toContain('hidden text-xs text-muted-foreground md:block');
    });

    it('keeps active auto-alt source comments scoped to EXIF-derived hints', () => {
        const activeSources = [
            'src/lib/caption-generator.ts',
            'src/lib/gallery-config-shared.ts',
            'src/lib/photo-title.ts',
            'src/lib/caption-constants.ts',
        ];

        for (const relativePath of activeSources) {
            const source = readRepoFile(relativePath);

            expect(source, `${relativePath} should mention EXIF-derived behavior`).toContain('EXIF-derived');
            expect(source, `${relativePath} should not imply current AI generation`).not.toMatch(/AI-generated|Auto alt-text via local Florence-2/);
        }
    });
});
