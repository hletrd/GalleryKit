import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoSrc = resolve(__dirname, '..');
const gridPictureSource = readFileSync(resolve(repoSrc, 'components/grid-picture.tsx'), 'utf8');
const boundarySource = readFileSync(resolve(repoSrc, 'components/grid-picture-fallback-boundary.tsx'), 'utf8');

describe('grid picture delegated fallback', () => {
    it('keeps GridPicture static instead of hydrating per-card state', () => {
        expect(gridPictureSource).not.toContain("'use client'");
        expect(gridPictureSource).not.toMatch(/useState|onError=/);
        expect(gridPictureSource).toContain('data-grid-picture');
        expect(gridPictureSource).toContain('data-fallback-src');
    });

    it('has one delegated error boundary that removes source rows before JPEG fallback', () => {
        expect(boundarySource).toContain("'use client'");
        expect(boundarySource).toContain('onErrorCapture');
        expect(boundarySource).toContain("picture.querySelectorAll('source').forEach");
        expect(boundarySource).toContain('target.src = fallbackSrc');
    });

    it('wraps every GridPicture grid surface with the delegated boundary', () => {
        for (const rel of [
            'components/home-client.tsx',
            'app/[locale]/(public)/g/[key]/page.tsx',
            'app/[locale]/(public)/timeline/page.tsx',
            'app/[locale]/(public)/year/[year]/page.tsx',
        ]) {
            const source = readFileSync(resolve(repoSrc, rel), 'utf8');
            expect(source).toContain('GridPictureFallbackBoundary');
        }
    });
});
