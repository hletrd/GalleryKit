import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('cycle 56 source contracts', () => {
    it('keeps photo metadata and OG on public image data while admin viewer pages can fetch audit fields', () => {
        const dataSource = readSrc('lib/data.ts');
        const photoPage = readSrc('app/[locale]/(public)/p/[id]/page.tsx');
        const ogRoute = readSrc('app/api/og/photo/[id]/route.tsx');

        expect(dataSource).toContain('export async function getImageForViewer');
        expect(dataSource).toContain('includeAdminFields ? adminSelectFields : publicSelectFields');
        expect(dataSource).toContain('export const getImageCached = cache(getImage)');
        expect(dataSource).toContain('export const getImageForViewerCached = cache(getImageForViewer)');

        const metadataBlock = photoPage.slice(
            photoPage.indexOf('export async function generateMetadata'),
            photoPage.indexOf('export default async function PhotoPage'),
        );
        const pageBlock = photoPage.slice(photoPage.indexOf('export default async function PhotoPage'));

        expect(metadataBlock).toContain('getImageCached(imageId)');
        expect(metadataBlock).not.toContain('getImageForViewerCached');
        expect(ogRoute).toContain('getImageCached(imageId)');
        expect(pageBlock).toContain('isAdmin()');
        expect(pageBlock).toContain('getImageForViewerCached(imageId, isAdminUser)');
    });
});
