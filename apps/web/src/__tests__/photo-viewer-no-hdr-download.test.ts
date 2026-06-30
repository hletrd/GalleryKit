/**
 * P3-1: Verify the desktop download dropdown does not offer HDR AVIF.
 *
 * HDR AVIF encoder (WI-09) is deferred; the _hdr.avif files do not exist.
 * Every click on the HDR menu item would 404. This test locks the removal.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

const PHOTO_VIEWER_PATH = '/Users/hletrd/flash-shared/gallery/apps/web/src/components/photo-viewer.tsx';

describe('photo-viewer download dropdown (P3-1)', () => {
    it('does not reference _hdr.avif in the download section', async () => {
        const source = await fs.readFile(PHOTO_VIEWER_PATH, 'utf-8');
        // Find the download dropdown section — now keyed by the delivery-aware
        // JPEG copy helper instead of a hard-coded sRGB label.
        const dropdownMatch = source.match(
            /jpegDownloadCopy[\s\S]*?DropdownMenuContent[\s\S]*?\/DropdownMenu>/
        );
        if (!dropdownMatch) {
            throw new Error('Could not locate download dropdown in photo-viewer.tsx');
        }
        const dropdownSection = dropdownMatch[0];
        expect(dropdownSection).not.toContain('_hdr.avif');
        expect(dropdownSection).not.toContain('hdrDownloadHref');
        expect(dropdownSection).not.toContain('downloadHdrAvif');
    });

    it('does not declare hdrDownloadHref or hdrAvifFilename in component body', async () => {
        const source = await fs.readFile(PHOTO_VIEWER_PATH, 'utf-8');
        expect(source).not.toContain('hdrAvifFilename');
        expect(source).not.toContain('hdrDownloadHref');
    });
});

describe('photo-viewer admin-only field gating (R16C16 DES-16-02 / C16-F2)', () => {
    it('gates the source bit_depth render on isAdmin', async () => {
        const source = await fs.readFile(PHOTO_VIEWER_PATH, 'utf-8');
        // bit_depth is admin-only (_PrivacySensitiveKeys). The render MUST carry
        // isAdmin && so it matches the sibling renders fixed in R15C15 SEC-15-01.
        expect(source).toMatch(/isAdmin\s*&&\s*hasExifData\(image\.bit_depth\)/);
        // No ungated JSX-open form `{hasExifData(image.bit_depth) &&` may remain.
        expect(source).not.toMatch(/\{\s*hasExifData\(image\.bit_depth\)\s*&&/);
    });

    it('does not use admin-only color_pipeline_decision for public download labels', async () => {
        const source = await fs.readFile(PHOTO_VIEWER_PATH, 'utf-8');
        expect(source).toContain('getJpegDownloadCopy({ isWideGamutSource, forceSrgbDerivatives })');
        expect(source).not.toContain('isP3Pipeline(image.color_pipeline_decision)');
    });
});

const INFO_BOTTOM_SHEET_PATH = '/Users/hletrd/flash-shared/gallery/apps/web/src/components/info-bottom-sheet.tsx';

describe('info-bottom-sheet admin-only field gating (R16C16 DES-16-02 / C16-F2)', () => {
    // Cycle-17 TE gap: DES-16-02 / C16-F2 added `{isAdmin && isP3Pipeline(...)}` to
    // BOTH photo-viewer.tsx (pinned above) AND info-bottom-sheet.tsx. The mobile bottom
    // sheet fix was NOT covered by any test — removing `isAdmin &&` from line 500 of
    // info-bottom-sheet.tsx would expose the admin-only color_pipeline_decision field
    // to public users on mobile without failing any prior test.
    it('does not use admin-only color_pipeline_decision for mobile public download labels', async () => {
        const source = await fs.readFile(INFO_BOTTOM_SHEET_PATH, 'utf-8');
        expect(source).toContain('getJpegDownloadCopy({ isWideGamutSource, forceSrgbDerivatives })');
        expect(source).not.toContain('isP3Pipeline(image.color_pipeline_decision)');
    });
});
