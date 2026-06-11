/**
 * CRT-R5C1-02: [AUTO] stub prefix must never appear in public display titles.
 *
 * getConcisePhotoAltText (the visible-title fallback used in page <title>,
 * OG meta, and photo viewer) must strip the ALT_TEXT_STUB_PREFIX from
 * alt_text_suggested before returning. The raw value is still available to
 * callers that consume alt_text_suggested directly for the alt="" attribute.
 */

import { describe, it, expect } from 'vitest';
import { getConcisePhotoAltText } from '@/lib/photo-title';
import { ALT_TEXT_STUB_PREFIX } from '@/lib/caption-generator';

const FALLBACK = 'Photo';

describe('getConcisePhotoAltText — [AUTO] prefix strip (CRT-R5C1-02)', () => {
    it('strips [AUTO] prefix from alt_text_suggested in display title', () => {
        const result = getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: '[AUTO] Photo taken with Canon EOS R5' },
            FALLBACK,
        );
        expect(result).toBe('Photo taken with Canon EOS R5');
        expect(result).not.toContain('[AUTO]');
    });

    it('strips [AUTO] prefix with various camera models', () => {
        const result = getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: '[AUTO] Photo taken with Sony A7R V' },
            FALLBACK,
        );
        expect(result).toBe('Photo taken with Sony A7R V');
        expect(result).not.toContain('[AUTO]');
    });

    it('falls through to generic fallback when stub produces only the prefix word "Photo"', () => {
        // [AUTO] Photo → strip prefix → "Photo" → non-empty, returned
        const result = getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: '[AUTO] Photo' },
            FALLBACK,
        );
        // "Photo" is non-empty after stripping — it is returned
        expect(result).toBe('Photo');
        expect(result).not.toContain('[AUTO]');
    });

    it('falls through to generic fallback when [AUTO] prefix is the only content', () => {
        // Edge case: "[AUTO] " with nothing after — stripped remainder is empty
        const result = getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: '[AUTO] ' },
            FALLBACK,
        );
        expect(result).toBe(FALLBACK);
    });

    it('ALT_TEXT_STUB_PREFIX itself never appears in any returned title', () => {
        const stubs = [
            `${ALT_TEXT_STUB_PREFIX}Photo taken with Canon EOS R5`,
            `${ALT_TEXT_STUB_PREFIX}Photo taken with Nikon Z9`,
            `${ALT_TEXT_STUB_PREFIX}Photo`,
            ALT_TEXT_STUB_PREFIX.trim(), // just "[AUTO]"
        ];
        for (const stub of stubs) {
            const result = getConcisePhotoAltText(
                { title: null, tag_names: null, alt_text_suggested: stub },
                FALLBACK,
            );
            expect(result, `stub: "${stub}"`).not.toContain('[AUTO]');
        }
    });

    it('does not strip non-prefix occurrences of [AUTO] mid-string', () => {
        // Only the leading prefix is stripped — mid-string is not photo-title concern
        // but confirm the regex is anchored at start
        const result = getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: 'Photo [AUTO] annotation' },
            FALLBACK,
        );
        // Not starting with [AUTO], so returned as-is
        expect(result).toBe('Photo [AUTO] annotation');
    });
});
