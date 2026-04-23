import { describe, it, expect } from 'vitest';
import { safeJsonLd } from '@/lib/safe-json-ld';

const LS = '\u2028';
const PS = '\u2029';

describe('safeJsonLd', () => {
    it('escapes < to prevent </script> XSS vectors', () => {
        const result = safeJsonLd({ x: '</script>' });
        expect(result).toContain('\\u003c');
        expect(result).not.toContain('<');
    });

    it('escapes U+2028 (LINE SEPARATOR) to \\u2028', () => {
        const result = safeJsonLd({ x: `before${LS}after` });
        expect(result).toContain('\\u2028');
        expect(result).not.toContain(LS);
    });

    it('escapes U+2029 (PARAGRAPH SEPARATOR) to \\u2029', () => {
        const result = safeJsonLd({ x: `before${PS}after` });
        expect(result).toContain('\\u2029');
        expect(result).not.toContain(PS);
    });

    it('escapes all three characters in the same payload', () => {
        const result = safeJsonLd({ x: `<${LS}${PS}` });
        expect(result).toContain('\\u003c');
        expect(result).toContain('\\u2028');
        expect(result).toContain('\\u2029');
        expect(result).not.toContain('<');
        expect(result).not.toContain(LS);
        expect(result).not.toContain(PS);
    });

    it('passes plain strings through without modification', () => {
        const result = safeJsonLd({ x: 'hello world' });
        expect(result).toBe('{"x":"hello world"}');
    });

    it('preserves Unicode characters that are not line terminators', () => {
        const result = safeJsonLd({ x: '\uc548\ub155\ud558\uc138\uc694 \ud83c\udf89' });
        expect(JSON.parse(result)).toEqual({ x: '\uc548\ub155\ud558\uc138\uc694 \ud83c\udf89' });
    });

    it('handles nested objects and arrays', () => {
        const result = safeJsonLd({
            a: [1, 2, { b: '</script>' }],
            c: null,
        });
        expect(result).toContain('\\u003c');
        expect(JSON.parse(result.replace(/\\u003c/g, '<'))).toEqual({
            a: [1, 2, { b: '</script>' }],
            c: null,
        });
    });
});
