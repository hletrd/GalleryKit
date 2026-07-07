import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewerSource = readFileSync(resolve(__dirname, '../components/photo-viewer.tsx'), 'utf8');
const loadingSource = readFileSync(resolve(__dirname, '../app/[locale]/(public)/p/[id]/loading.tsx'), 'utf8');

describe('photo viewer auto-lightbox hydration contract', () => {
    it('renders deterministic lightbox state before mount and restores sessionStorage after hydration', () => {
        expect(viewerSource).toContain('const [showLightbox, setShowLightbox] = useState(false)');
        expect(viewerSource).toContain('autoLightboxRestoredRef');
        expect(viewerSource).toContain("sessionStorage.getItem('gallery_auto_lightbox') === 'true'");
        expect(viewerSource.indexOf('const [showLightbox, setShowLightbox] = useState(false)'))
            .toBeLessThan(viewerSource.indexOf("sessionStorage.getItem('gallery_auto_lightbox') === 'true'"));
    });

    it('keeps the route loading fallback free of first-render sessionStorage reads', () => {
        expect(loadingSource).not.toContain('sessionStorage');
        expect(loadingSource).not.toContain('useState(readLightboxFlag)');
        expect(loadingSource).toContain('PhotoViewerLoading');
    });
});
