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

    // C7R-RPL-01 / AGG7R-01 — leading-whitespace-before-formula bypass.
    // Before the fix, `\r\n=...` collapsed to ` =...` (leading space)
    // and the formula-start regex did not fire, so spreadsheet apps
    // could execute the formula after trimming leading whitespace.
    it('prefixes formula-injection when collapsed CRLF leaves leading space', () => {
        // Input has leading CRLF followed by formula char; after collapse
        // the value starts with a space, which previously escaped the
        // formula guard.
        expect(escapeCsvField('\r\n=HYPERLINK("evil")'))
            .toBe('"\' =HYPERLINK(""evil"")"');
        expect(escapeCsvField('\n=1+2'))
            .toBe('"\' =1+2"');
    });

    it('prefixes formula-injection when input begins with legacy whitespace', () => {
        // Direct whitespace-prefixed inputs (no CRLF) must also be
        // guarded — defense-in-depth regardless of collapse order.
        expect(escapeCsvField(' =SUM(A1)')).toBe('"\' =SUM(A1)"');
        expect(escapeCsvField('  +cmd')).toBe('"\'  +cmd"');
    });

    it('does not prefix benign leading whitespace without a formula char', () => {
        expect(escapeCsvField(' hello')).toBe('" hello"');
        expect(escapeCsvField('  normal text')).toBe('"  normal text"');
    });

    // C7R-RPL-11 / AGG7R-05 — Unicode bidi overrides stripped to
    // prevent Trojan-Source-style reordering in spreadsheet apps.
    it('strips Unicode bidi override & isolate characters', () => {
        // U+202E (RLO) — right-to-left override
        expect(escapeCsvField('ab‮cd')).toBe('"abcd"');
        // U+202D (LRO) — left-to-right override
        expect(escapeCsvField('a‭b')).toBe('"ab"');
        // U+2066 (LRI) — left-to-right isolate
        expect(escapeCsvField('a⁦b⁩c')).toBe('"abc"');
    });

    // C8R-RPL-01 / AGG8R-01 — zero-width / invisible format chars
    // must be stripped so they cannot bypass the formula-prefix guard.
    // JS regex `\s` does NOT match U+200B, so `​=...` would
    // previously escape the leading-whitespace tolerance.
    it('strips U+200B (ZWSP) and prefixes formula when adjacent', () => {
        expect(escapeCsvField('​=HYPERLINK("evil")')).toBe(
            '"\'=HYPERLINK(""evil"")"',
        );
    });

    it('strips U+FEFF (BOM) and prefixes formula when adjacent', () => {
        expect(escapeCsvField('﻿=SUM(A1)')).toBe('"\'=SUM(A1)"');
    });

    it('strips U+2060 (word joiner) and prefixes formula when adjacent', () => {
        expect(escapeCsvField('⁠=cmd')).toBe('"\'=cmd"');
    });

    it('strips U+200C / U+200D / U+200E / U+200F (ZWNJ/ZWJ/LRM/RLM)', () => {
        expect(escapeCsvField('a‌b')).toBe('"ab"');
        expect(escapeCsvField('a‍b')).toBe('"ab"');
        expect(escapeCsvField('a‎b')).toBe('"ab"');
        expect(escapeCsvField('a‏b')).toBe('"ab"');
    });

    it('strips U+180E (Mongolian vowel separator)', () => {
        expect(escapeCsvField('a᠎b')).toBe('"ab"');
    });

    it('strips benign zero-width chars without prefixing when no formula follows', () => {
        // ZWNJ between words — stripped, no formula prefix.
        expect(escapeCsvField('hello‌world')).toBe('"helloworld"');
    });
});
