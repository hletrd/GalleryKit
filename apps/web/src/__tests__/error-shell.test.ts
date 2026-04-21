import { describe, expect, it } from 'vitest';

import { resolveErrorShellBrand } from '@/lib/error-shell';

describe('resolveErrorShellBrand', () => {
    it('prefers the live root-layout dataset brand', () => {
        expect(resolveErrorShellBrand({
            title: 'Photo 42 | Legacy Gallery',
            documentElement: {
                dataset: {
                    galleryNavTitle: 'Live Nav',
                    galleryTitle: 'Live Gallery',
                },
            },
        }, 'Static Nav', 'Static Gallery')).toBe('Live Nav');
    });

    it('falls back to the live document title when dataset values are absent', () => {
        expect(resolveErrorShellBrand({
            title: 'Photo 42 | Live Gallery',
            documentElement: { dataset: {} },
        }, 'Static Nav', 'Static Gallery')).toBe('Live Gallery');
    });

    it('falls back to static branding when no live document metadata exists', () => {
        expect(resolveErrorShellBrand(null, 'Static Nav', 'Static Gallery')).toBe('Static Nav');
        expect(resolveErrorShellBrand({
            title: '',
            documentElement: { dataset: {} },
        }, '', 'Static Gallery')).toBe('Static Gallery');
    });
});
