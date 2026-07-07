/**
 * CRT-R5C1-02: [AUTO] stub prefix must never appear in public display titles.
 *
 * getConcisePhotoAltText (the visible-title fallback used in page <title>,
 * OG meta, and photo viewer) must strip the ALT_TEXT_STUB_PREFIX from
 * alt_text_suggested before returning. The raw value is still available to
 * callers that consume alt_text_suggested directly for the alt="" attribute.
 *
 * Extended in R5C2 to cover:
 *  - formatTitleAsTags empty-token fix (COR-R5C2-03)
 *  - stripStubPrefix unit cases (ARCH-R5C2-02)
 */

import { describe, it, expect } from 'vitest';
import { getConcisePhotoAltText, getPhotoDisplayTitle, getPhotoResultLabel } from '@/lib/photo-title';
import { ALT_TEXT_STUB_PREFIX, stripStubPrefix } from '@/lib/caption-constants';

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

// ---------------------------------------------------------------------------
// COR-R5C2-03: formatTitleAsTags must not produce bare '#' tokens
// ---------------------------------------------------------------------------

describe('getPhotoDisplayTitle — formatTitleAsTags empty-token fix (COR-R5C2-03)', () => {
    it('does not produce bare # tokens from a leading-space title', () => {
        const result = getPhotoDisplayTitle(
            { title: '  sunset ocean' },
            'fallback',
            { formatTitleAsTags: true },
        );
        expect(result).not.toContain('#  ');
        expect(result).not.toMatch(/(^|\s)#(\s|$)/);
        expect(result).toBe('#sunset #ocean');
    });

    it('does not produce bare # tokens from a trailing-space title', () => {
        const result = getPhotoDisplayTitle(
            { title: 'sunset ocean  ' },
            'fallback',
            { formatTitleAsTags: true },
        );
        expect(result).not.toMatch(/(^|\s)#(\s|$)/);
        expect(result).toBe('#sunset #ocean');
    });

    it('does not produce bare # tokens from a multiple-space title', () => {
        const result = getPhotoDisplayTitle(
            { title: 'sunset  ocean' },
            'fallback',
            { formatTitleAsTags: true },
        );
        expect(result).not.toMatch(/(^|\s)#(\s|$)/);
        expect(result).toBe('#sunset #ocean');
    });

    it('handles single-word title without bare # tokens', () => {
        const result = getPhotoDisplayTitle(
            { title: '  solo  ' },
            'fallback',
            { formatTitleAsTags: true },
        );
        expect(result).toBe('#solo');
        expect(result).not.toMatch(/(^|\s)#(\s|$)/);
    });
});

describe('getPhotoResultLabel — public search labels', () => {
    it('uses tag-derived display context before falling back to generic photo labels', () => {
        expect(getPhotoResultLabel(
            { title: null, description: null, tag_names: 'Color_in_Music_Festival,JIHOON' },
            'Photo 348',
        )).toBe('#Color in Music Festival #JIHOON');
    });

    it('keeps meaningful titles ahead of tag labels', () => {
        expect(getPhotoResultLabel(
            { title: 'Final edit', description: 'caption', tag_names: 'behind_the_scenes' },
            'Photo 12',
        )).toBe('Final edit');
    });
});

// ---------------------------------------------------------------------------
// ARCH-R5C2-02: stripStubPrefix unit cases
// ---------------------------------------------------------------------------

describe('stripStubPrefix (caption-constants)', () => {
    it('strips the exact prefix from a standard stub value', () => {
        expect(stripStubPrefix('[AUTO] Photo taken with Canon EOS R5')).toBe('Photo taken with Canon EOS R5');
    });

    it('strips the prefix even with extra trailing whitespace in prefix', () => {
        expect(stripStubPrefix('[AUTO]   Photo')).toBe('Photo');
    });

    it('returns empty string when prefix is the entire content', () => {
        expect(stripStubPrefix('[AUTO] ')).toBe('');
        expect(stripStubPrefix('[AUTO]')).toBe('');
    });

    it('does not strip mid-string occurrences', () => {
        expect(stripStubPrefix('Photo [AUTO] note')).toBe('Photo [AUTO] note');
    });

    it('is idempotent on a non-prefixed string', () => {
        expect(stripStubPrefix('normal title')).toBe('normal title');
    });

    it('applies only one stripping (not recursive)', () => {
        // Double prefix — only the first is stripped
        expect(stripStubPrefix('[AUTO] [AUTO] nested')).toBe('[AUTO] nested');
    });
});
