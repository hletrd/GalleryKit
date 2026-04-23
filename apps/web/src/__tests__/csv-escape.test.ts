import { describe, expect, it } from 'vitest';

import { escapeCsvField } from '@/lib/csv-escape';

/**
 * C6R-RPL-06 / AGG6R-11 — dedicated unit tests for `escapeCsvField`.
 * Previously tested only via integration; this file locks in:
 * - CRLF collapse into a single space (the fix).
 * - Control-char stripping.
 * - Formula-injection prefixing.
 * - Embedded quote doubling.
 */

describe('escapeCsvField', () => {
    it('wraps plain ASCII values in double quotes', () => {
        expect(escapeCsvField('hello')).toBe('"hello"');
    });

    it('doubles embedded double quotes', () => {
        expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    });

    it('strips null bytes and other C0 control characters', () => {
        expect(escapeCsvField('a\x00b\x01c')).toBe('"abc"');
    });

    it('strips C1 (0x7F-0x9F) control characters', () => {
        expect(escapeCsvField('a\x7Fb\x9Fc')).toBe('"abc"');
    });

    it('collapses CRLF into a single space (not two spaces) — C6R-RPL-06 fix', () => {
        expect(escapeCsvField('title\r\nfoo')).toBe('"title foo"');
    });

    it('collapses consecutive CR/LF into a single space', () => {
        expect(escapeCsvField('a\n\nb')).toBe('"a b"');
        expect(escapeCsvField('a\r\r\nb')).toBe('"a b"');
    });

    it('prefixes formula-injection characters with a single quote', () => {
        expect(escapeCsvField('=SUM(A1)')).toBe('"\'=SUM(A1)"');
        expect(escapeCsvField('+cmd')).toBe('"\'+cmd"');
        expect(escapeCsvField('-cmd')).toBe('"\'-cmd"');
        expect(escapeCsvField('@cmd')).toBe('"\'@cmd"');
    });

    it('strips tab characters (they cause column misalignment in strict parsers)', () => {
        // Tab (0x09) is stripped by the control-char pass. Even though \t is
        // in the formula-prefix check, it never reaches that branch because
        // the strip runs first.
        expect(escapeCsvField('a\tb')).toBe('"ab"');
    });

    it('passes through safe ASCII unchanged', () => {
        expect(escapeCsvField('normal text 123')).toBe('"normal text 123"');
    });

    it('handles empty strings', () => {
        expect(escapeCsvField('')).toBe('""');
    });
});
