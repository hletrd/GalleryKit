import { describe, expect, it } from 'vitest';
import { sanitizeAdminString } from '@/lib/sanitize';

describe('sanitizeAdminString', () => {
    it('returns rejected: false for a normal string', () => {
        const result = sanitizeAdminString('Hello World');
        expect(result.value).toBe('Hello World');
        expect(result.rejected).toBe(false);
    });

    it('returns rejected: true for a string with a bidi override (U+202A LRE)', () => {
        const result = sanitizeAdminString('hello‪world');
        expect(result.rejected).toBe(true);
        // C1F-CR-08: value is null when rejected=true to prevent accidental
        // persistence of a stripped value that looks visually identical.
        expect(result.value).toBeNull();
    });

    it('returns rejected: true for a string with zero-width space (U+200B)', () => {
        const result = sanitizeAdminString('hello​world');
        expect(result.rejected).toBe(true);
        // C1F-CR-08: value is null when rejected=true
        expect(result.value).toBeNull();
    });

    // C8-AGG8R-01: The critical test — calling sanitizeAdminString twice
    // on the same input must consistently return rejected: true. The /g
    // flag bug caused .test() to alternate between true and false.
    it('consistently rejects the same bidi-override string on repeated calls', () => {
        const input = 'hello‪world';
        const result1 = sanitizeAdminString(input);
        const result2 = sanitizeAdminString(input);
        const result3 = sanitizeAdminString(input);
        expect(result1.rejected).toBe(true);
        expect(result2.rejected).toBe(true);
        expect(result3.rejected).toBe(true);
    });

    it('consistently rejects the same zero-width string on repeated calls', () => {
        const input = 'test​string';
        const result1 = sanitizeAdminString(input);
        const result2 = sanitizeAdminString(input);
        expect(result1.rejected).toBe(true);
        expect(result2.rejected).toBe(true);
    });

    it('returns rejected: false for null input', () => {
        const result = sanitizeAdminString(null);
        expect(result.value).toBeNull();
        expect(result.rejected).toBe(false);
    });

    it('returns rejected: false for undefined input', () => {
        const result = sanitizeAdminString(undefined);
        expect(result.value).toBeNull();
        expect(result.rejected).toBe(false);
    });

    it('returns rejected: true for string with C0 control characters only', () => {
        const result = sanitizeAdminString('hello\x01world');
        expect(result.rejected).toBe(true);
        // C13-MED-01: value is null when rejected=true (matches Unicode formatting
        // path). C0 control characters also produce visually-identical stripped
        // strings, so the null contract applies consistently.
        expect(result.value).toBeNull();
    });

    it('returns rejected: true for string with BOM (U+FEFF)', () => {
        const result = sanitizeAdminString('hello﻿world');
        expect(result.rejected).toBe(true);
        // C1F-CR-08: value is null when rejected=true
        expect(result.value).toBeNull();
    });

    it('returns rejected: false for empty string after trim', () => {
        const result = sanitizeAdminString('   ');
        expect(result.value).toBe('');
        expect(result.rejected).toBe(false);
    });

    it('trims whitespace by default', () => {
        const result = sanitizeAdminString('  hello  ');
        expect(result.value).toBe('hello');
        expect(result.rejected).toBe(false);
    });

    it('does not trim when trim=false', () => {
        const result = sanitizeAdminString('  hello  ', false);
        expect(result.value).toBe('  hello  ');
        expect(result.rejected).toBe(false);
    });
});
