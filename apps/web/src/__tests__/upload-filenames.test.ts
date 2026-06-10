/**
 * Run-4 cycle 1 (COR-R4C1-03): behavioral lock for the shared
 * getSafeUserFilename helper extracted from app/actions/images.ts so BOTH
 * ingest paths (browser action + Lightroom PAT route) share one sanitizer.
 * Mirrors the original C2L2-03 (UTF-8 byte budget) and C2L2-05 (single
 * trailing trim) contracts.
 *
 * All control / bidi / zero-width characters below use \uXXXX escape
 * sequences for editor-invariant readability (C18-LOW-01 convention).
 */

import { describe, it, expect } from 'vitest';
import { getSafeUserFilename, USER_FILENAME_MAX_BYTES } from '@/lib/upload-filenames';

describe('getSafeUserFilename', () => {
    it('passes ordinary filenames through unchanged', () => {
        expect(getSafeUserFilename('IMG_2041.jpg')).toBe('IMG_2041.jpg');
    });

    it('reduces path segments to the basename', () => {
        expect(getSafeUserFilename('../../etc/passwd')).toBe('passwd');
        expect(getSafeUserFilename('exports/2026/photo.jpg')).toBe('photo.jpg');
    });

    it('strips C0 control characters and trims the result', () => {
        expect(getSafeUserFilename('pho\u0001to.jpg')).toBe('photo.jpg');
        expect(getSafeUserFilename('photo.jpg\n')).toBe('photo.jpg');
        expect(getSafeUserFilename('  photo.jpg  ')).toBe('photo.jpg');
    });

    it('strips Unicode bidi / zero-width formatting characters', () => {
        expect(getSafeUserFilename('pho\u202Eto.jpg')).toBe('photo.jpg'); // RLO
        expect(getSafeUserFilename('pho\u200Bto.jpg')).toBe('photo.jpg'); // ZWSP
    });

    it('rejects names that are empty after sanitization', () => {
        expect(getSafeUserFilename('')).toBeNull();
        expect(getSafeUserFilename('\u0007\u0008')).toBeNull();
        expect(getSafeUserFilename('   ')).toBeNull();
    });

    it('rejects names exceeding the UTF-8 byte budget (C2L2-03)', () => {
        // 100 hangul syllables = 300 UTF-8 bytes > 255 — rejected even though
        // the UTF-16 length (100) is far below 255.
        const cjk = '한'.repeat(100) + '.jpg';
        expect(getSafeUserFilename(cjk)).toBeNull();
        // Exactly at the cap passes.
        const maxAscii = 'a'.repeat(USER_FILENAME_MAX_BYTES - 4) + '.jpg';
        expect(getSafeUserFilename(maxAscii)).toBe(maxAscii);
        // One byte over fails.
        const overAscii = 'a'.repeat(USER_FILENAME_MAX_BYTES - 3) + '.jpg';
        expect(getSafeUserFilename(overAscii)).toBeNull();
    });

    it('keeps CJK / emoji names within the byte budget intact', () => {
        expect(getSafeUserFilename('seoul_한글.jpg')).toBe('seoul_한글.jpg');
        expect(getSafeUserFilename('sunset_\u{1F305}.jpg')).toBe('sunset_\u{1F305}.jpg');
    });
});
