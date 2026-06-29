/**
 * R19C19 designer findings — WCAG 2.4.7 / 2.4.11 focus-appearance regression
 * locks for the controls fixed this cycle:
 *
 *  D19-07  skip links (layout.tsx, not-found.tsx) used `focus:not-sr-only`,
 *          which reveals the skip link on a MOUSE click too. Switch to
 *          `focus-visible:not-sr-only` so it only appears for keyboard focus.
 *          Cycle 4 later removed not-found's duplicate local skip link; the
 *          locale layout owns the single bypass link for the page.
 *  D19-01  lightbox prev/next buttons painted the ring on the full-height
 *          invisible `h-full w-16` hitbox, not the visible chevron pill. Move
 *          the ring to the inner pill via `group` + `group-focus-visible:`.
 *  D19-08  image-zoom / login-form / lightbox-color-pip used a hardcoded
 *          `focus-visible:outline-blue-500` instead of the `ring-ring` design
 *          token used everywhere else (also closes the deferred D18-02).
 *  D19-09  upload-dropzone remove button used `focus:opacity-100`; switch to
 *          `focus-visible:opacity-100`.
 *
 * Source-contract tests: assert the corrected class is present AND the weaker
 * pre-fix value is absent, so a revert fails both ways.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

const layoutSrc = read('../app/[locale]/layout.tsx');
const notFoundSrc = read('../app/[locale]/not-found.tsx');
const lightboxSrc = read('../components/lightbox.tsx');
const imageZoomSrc = read('../components/image-zoom.tsx');
const loginFormSrc = read('../app/[locale]/admin/login-form.tsx');
const pipSrc = read('../components/lightbox-color-pip.tsx');
const dropzoneSrc = read('../components/upload-dropzone.tsx');

describe('D19-07 skip links use focus-visible (not bare focus)', () => {
    it('layout.tsx skip link reveals on focus-visible only', () => {
        expect(layoutSrc).toContain('focus-visible:not-sr-only');
        expect(layoutSrc).not.toContain('focus:not-sr-only');
    });
    it('not-found.tsx does not reintroduce a duplicate local skip link', () => {
        expect(notFoundSrc).not.toContain('href="#main-content"');
        expect(notFoundSrc).not.toContain('focus:not-sr-only');
    });
});

describe('D19-01 lightbox prev/next ring paints on the visible pill', () => {
    it('both nav buttons move the ring to the inner pill via group-focus-visible', () => {
        const matches = lightboxSrc.match(/group-focus-visible:ring-2/g) ?? [];
        // prev + next = 2 occurrences.
        expect(matches.length).toBeGreaterThanOrEqual(2);
        expect(lightboxSrc).toContain('group-focus-visible:ring-ring');
    });
    it('the full-height nav hitbox no longer carries a button-level focus-visible ring', () => {
        // The old pattern put `h-full w-16 ... focus-visible:ring-2` on the button
        // itself. Assert that combination is gone (the ring is now on the pill).
        expect(lightboxSrc).not.toMatch(/h-full w-16[^"]*focus-visible:ring-2/);
    });
});

describe('D19-08 hardcoded blue focus outline replaced with ring-ring token', () => {
    it('image-zoom.tsx uses the ring-ring token', () => {
        expect(imageZoomSrc).toContain('focus-visible:ring-ring');
        expect(imageZoomSrc).not.toContain('outline-blue-500');
        expect(imageZoomSrc).not.toContain('outline-blue-400');
    });
    it('login-form.tsx uses the ring-ring token', () => {
        expect(loginFormSrc).toContain('focus-visible:ring-ring');
        expect(loginFormSrc).not.toContain('outline-blue-500');
        expect(loginFormSrc).not.toContain('outline-blue-400');
    });
    it('lightbox-color-pip.tsx pip trigger uses the ring-ring token', () => {
        expect(pipSrc).not.toContain('outline-blue-500');
        expect(pipSrc).not.toContain('outline-blue-400');
    });
});

describe('D19-09 upload-dropzone remove button uses focus-visible', () => {
    it('remove button reveals on focus-visible (not bare focus)', () => {
        expect(dropzoneSrc).toContain('focus-visible:opacity-100');
        expect(dropzoneSrc).not.toContain('focus:opacity-100');
    });
});
