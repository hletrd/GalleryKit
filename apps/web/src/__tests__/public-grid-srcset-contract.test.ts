import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd(), 'src');

function readSource(relativePath: string): string {
    return readFileSync(resolve(APP_ROOT, relativePath), 'utf8');
}

describe('public grid configured-derivative source-set contract', () => {
    const consumers = [
        'components/masonry-card.tsx',
        'app/[locale]/(public)/timeline/page.tsx',
        'app/[locale]/(public)/year/[year]/page.tsx',
        'app/[locale]/(public)/g/[key]/page.tsx',
    ];

    it.each(consumers)('%s emits the complete configured ladder for AVIF, WebP, and JPEG', (relativePath) => {
        const source = readSource(relativePath);
        expect(source).toContain('sizedImageSrcSet');
        expect(source.match(/srcSet:\s*sizedImageSrcSet\(/g)).toHaveLength(3);
    });

    it.each(consumers)('%s does not truncate the ladder through a positional second size', (relativePath) => {
        const source = readSource(relativePath);
        expect(source).not.toMatch(/(?:imageSizes|gridImageSizes)\s*\[1\]/);
    });
});
