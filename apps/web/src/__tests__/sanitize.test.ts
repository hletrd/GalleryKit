import { describe, it, expect } from 'vitest';
import { stripControlChars } from '@/lib/sanitize';

describe('stripControlChars', () => {
    it('should return null for null input', () => {
        expect(stripControlChars(null)).toBeNull();
    });

    it('should return null for undefined-ish empty input', () => {
        // The function signature accepts string | null, but test edge cases
        expect(stripControlChars(null)).toBeNull();
    });

    it('should return empty string for empty string input', () => {
        expect(stripControlChars('')).toBe('');
    });

    it('should pass through normal strings unchanged', () => {
        expect(stripControlChars('hello world')).toBe('hello world');
        expect(stripControlChars('admin')).toBe('admin');
        expect(stripControlChars('Test-123_abc')).toBe('Test-123_abc');
    });

    it('should strip null bytes (0x00)', () => {
        expect(stripControlChars('admin\x00')).toBe('admin');
        expect(stripControlChars('\x00hello')).toBe('hello');
        expect(stripControlChars('a\x00b\x00c')).toBe('abc');
    });

    it('should strip tab characters (0x09)', () => {
        expect(stripControlChars('hello\tworld')).toBe('helloworld');
        expect(stripControlChars('\tindented')).toBe('indented');
    });

    it('should strip newline characters (0x0A)', () => {
        expect(stripControlChars('line1\nline2')).toBe('line1line2');
        expect(stripControlChars('\nstart')).toBe('start');
    });

    it('should strip carriage return characters (0x0D)', () => {
        expect(stripControlChars('line1\r\nline2')).toBe('line1line2');
        expect(stripControlChars('\rend')).toBe('end');
    });

    it('should strip DEL character (0x7F)', () => {
        expect(stripControlChars('text\x7F')).toBe('text');
        expect(stripControlChars('\x7Fstart')).toBe('start');
    });

    it('should strip mixed C0 control characters', () => {
        expect(stripControlChars('\x00\x01\x02\x03text')).toBe('text');
        expect(stripControlChars('a\x00b\x01c\x7Fd')).toBe('abcd');
    });

    it('should return empty string for string of only control characters', () => {
        expect(stripControlChars('\x00\x01\x02\x03\x7F')).toBe('');
        expect(stripControlChars('\t\n\r')).toBe('');
    });

    it('should preserve spaces (0x20) which are NOT control characters', () => {
        expect(stripControlChars('hello world')).toBe('hello world');
        expect(stripControlChars('  spaced  ')).toBe('  spaced  ');
    });

    it('should handle CJK and emoji characters', () => {
        expect(stripControlChars('안녕하세요')).toBe('안녕하세요');
        expect(stripControlChars('🎉party')).toBe('🎉party');
    });

    it('should handle string with embedded control chars between normal text', () => {
        expect(stripControlChars('hel\x00lo\x01wo\x7Frld')).toBe('helloworld');
    });
});
