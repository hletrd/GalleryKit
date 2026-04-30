/**
 * Test: normalizeStringRecord rejects Unicode bidi/formatting characters.
 *
 * C2-MED-01 / A2-MED-01: normalizeStringRecord must reject inputs containing
 * Unicode bidi overrides and zero-width/invisible formatting characters,
 * matching the sanitizeAdminString rejection policy (C7R-RPL-11 / C3L-SEC-01).
 *
 * Before this fix, normalizeStringRecord silently stripped these characters
 * without rejecting them, creating a gap in the defense-in-depth chain
 * for admin SEO settings.
 */
import { describe, it, expect } from 'vitest';
import { normalizeStringRecord } from '@/lib/sanitize';

describe('normalizeStringRecord Unicode formatting rejection', () => {
    it('should reject input containing left-to-right override (U+202D LRO)', () => {
        const result = normalizeStringRecord({
            seo_title: 'Hello‭World',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe('invalidInput');
        }
    });

    it('should reject input containing right-to-left override (U+202E RLO)', () => {
        const result = normalizeStringRecord({
            seo_title: 'Hello‮World',
        });
        expect(result.ok).toBe(false);
    });

    it('should reject input containing zero-width space (U+200B)', () => {
        const result = normalizeStringRecord({
            seo_title: 'Hello​World',
        });
        expect(result.ok).toBe(false);
    });

    it('should reject input containing zero-width joiner (U+200D)', () => {
        const result = normalizeStringRecord({
            seo_title: 'Hello‍World',
        });
        expect(result.ok).toBe(false);
    });

    it('should reject input containing BOM (U+FEFF)', () => {
        const result = normalizeStringRecord({
            seo_title: '﻿Hello',
        });
        expect(result.ok).toBe(false);
    });

    it('should accept clean input without formatting characters', () => {
        const result = normalizeStringRecord({
            seo_title: 'My Gallery',
            seo_description: 'A beautiful photo gallery',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.record.seo_title).toBe('My Gallery');
            expect(result.record.seo_description).toBe('A beautiful photo gallery');
        }
    });

    it('should accept input with CJK characters (not formatting)', () => {
        const result = normalizeStringRecord({
            seo_title: '私のギャラリー',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.record.seo_title).toBe('私のギャラリー');
        }
    });

    it('should accept input with emoji (not formatting)', () => {
        const result = normalizeStringRecord({
            seo_title: 'Photos 📸',
        });
        expect(result.ok).toBe(true);
    });

    it('should reject if any value in the record contains formatting chars', () => {
        const result = normalizeStringRecord({
            seo_title: 'Clean Title',
            seo_description: 'Bad‮description',
        });
        expect(result.ok).toBe(false);
    });

    it('should accept input with allowed keys', () => {
        const result = normalizeStringRecord(
            { seo_title: 'My Gallery' },
            new Set(['seo_title']),
        );
        expect(result.ok).toBe(true);
    });

    it('should still reject non-string values', () => {
        const result = normalizeStringRecord({
            seo_title: 123,
        });
        expect(result.ok).toBe(false);
    });

    it('should still reject disallowed keys', () => {
        const result = normalizeStringRecord(
            { evil_key: 'value' },
            new Set(['seo_title']),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe('invalidSettingKey');
        }
    });
});
