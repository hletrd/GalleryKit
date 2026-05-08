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
        // Find the download dropdown section — between downloadSrgbJpeg and DropdownMenuContent close
        const dropdownMatch = source.match(
            /downloadSrgbJpeg[\s\S]*?DropdownMenuContent[\s\S]*?\/DropdownMenu>/
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
