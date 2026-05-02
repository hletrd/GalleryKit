/**
 * US-P15 — Accessibility pass (WCAG 2.2 AA)
 *
 * Source-level assertions that key accessibility contracts are present in
 * the component files. These are fixture-style tests that read the raw
 * TypeScript/TSX source and assert required attributes/patterns exist,
 * similar to the existing action-origin and api-auth lint tests.
 *
 * AC-6:  skip-to-main-content link in root layout (layout.tsx)
 * AC-3:  aria-roledescription="slide" on lightbox <picture> element
 * AC-7:  aria-live="polite" + aria-atomic="true" on load-more status region
 * AC-10: Play/Pause button in lightbox controls overlay
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const srcRoot = path.resolve(__dirname, '..');

function readSrc(relPath: string): string {
    return fs.readFileSync(path.resolve(srcRoot, relPath), 'utf8');
}

describe('US-P15 a11y contracts', () => {
    it('AC-6: root layout contains a skip-to-main-content link targeting #main-content', () => {
        const src = readSrc('app/[locale]/layout.tsx');
        // Must have an anchor targeting #main-content
        expect(src).toMatch(/href="#main-content"/);
        // Must be visually hidden by default (sr-only)
        expect(src).toMatch(/sr-only/);
    });

    it('AC-6: public sub-layout has <main id="main-content"> as skip link target', () => {
        const src = readSrc('app/[locale]/(public)/layout.tsx');
        expect(src).toMatch(/id="main-content"/);
        // tabIndex={-1} makes it programmatically focusable
        expect(src).toMatch(/tabIndex=\{-1\}/);
    });

    it('AC-3: lightbox image has aria-roledescription="slide"', () => {
        const src = readSrc('components/lightbox.tsx');
        expect(src).toMatch(/aria-roledescription="slide"/);
    });

    it('AC-3: lightbox image aria-label references currentIndex/totalCount', () => {
        const src = readSrc('components/lightbox.tsx');
        // The aria-label expression uses currentIndex and totalCount
        expect(src).toMatch(/currentIndex.*totalCount|totalCount.*currentIndex/s);
        // The formatted label is of the form "N / M"
        expect(src).toMatch(/currentIndex \+ 1.*totalCount|`\$\{currentIndex \+ 1\} \/ \$\{totalCount\}`/s);
    });

    it('AC-7: load-more has aria-live="polite" and aria-atomic="true" on status region', () => {
        const src = readSrc('components/load-more.tsx');
        expect(src).toMatch(/aria-live="polite"/);
        expect(src).toMatch(/aria-atomic="true"/);
    });

    it('AC-10: lightbox controls overlay has Play/Pause button with h-11 w-11', () => {
        const src = readSrc('components/lightbox.tsx');
        // Play and Pause icons imported from lucide-react
        expect(src).toMatch(/import.*\bPlay\b.*from 'lucide-react'|import.*\bPause\b.*from 'lucide-react'/);
        // aria-pressed on the toggle button
        expect(src).toMatch(/aria-pressed=\{isSlideshowActive\}/);
        // playSlideshow / pauseSlideshow translation keys used
        expect(src).toMatch(/aria\.playSlideshow/);
        expect(src).toMatch(/aria\.pauseSlideshow/);
        // Button meets 44px touch target
        expect(src).toMatch(/h-11 w-11/);
    });

    it('AC-2: photo-viewer AnimatePresence uses prefersReducedMotion for all motion.div', () => {
        const src = readSrc('components/photo-viewer.tsx');
        // useReducedMotion is imported and used
        expect(src).toMatch(/useReducedMotion/);
        // transition duration is 0 when reduced motion
        expect(src).toMatch(/prefersReducedMotion.*0|duration.*prefersReducedMotion/s);
    });

    it('AC-1: home-client masonry cards use getConcisePhotoAltText for alt text', () => {
        const src = readSrc('components/home-client.tsx');
        expect(src).toMatch(/getConcisePhotoAltText/);
        // The altText variable is used in the <img alt={altText}> attribute
        expect(src).toMatch(/alt=\{altText\}/);
    });
});
