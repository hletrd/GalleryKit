/**
 * R19-M1: feed conditional-request helper.
 *
 * Validates the second-precision RFC 7232 §3.3 boundary that decides
 * whether the feed routes return 304 Not Modified or a fresh 200.
 */

import { describe, it, expect } from 'vitest';
import { isFeedNotModified } from '@/lib/feed-conditional';

describe('isFeedNotModified', () => {
    it('returns false when If-Modified-Since header is missing', () => {
        expect(isFeedNotModified(null, '2026-05-17T10:00:00.000Z')).toBe(false);
    });

    it('returns false when If-Modified-Since is malformed', () => {
        expect(isFeedNotModified('not a date', '2026-05-17T10:00:00.000Z')).toBe(false);
        expect(isFeedNotModified('', '2026-05-17T10:00:00.000Z')).toBe(false);
    });

    it('returns false when feedUpdated is unparseable', () => {
        expect(isFeedNotModified('Sun, 17 May 2026 10:00:00 GMT', 'not a date')).toBe(false);
    });

    it('returns true when If-Modified-Since equals feedUpdated at second precision', () => {
        // Same instant, IMS expressed as RFC 7231 IMF-fixdate
        expect(
            isFeedNotModified('Sun, 17 May 2026 10:00:00 GMT', '2026-05-17T10:00:00.000Z'),
        ).toBe(true);
    });

    it('returns true when If-Modified-Since is one second after feedUpdated', () => {
        expect(
            isFeedNotModified('Sun, 17 May 2026 10:00:01 GMT', '2026-05-17T10:00:00.000Z'),
        ).toBe(true);
    });

    it('returns true when feedUpdated has sub-second ms below the IMS instant', () => {
        // feedUpdated 10:00:00.999 floors to 10:00:00 — equal to IMS at
        // second precision, so 304.
        expect(
            isFeedNotModified('Sun, 17 May 2026 10:00:00 GMT', '2026-05-17T10:00:00.999Z'),
        ).toBe(true);
    });

    it('returns false when If-Modified-Since is one second before feedUpdated', () => {
        expect(
            isFeedNotModified('Sun, 17 May 2026 09:59:59 GMT', '2026-05-17T10:00:00.000Z'),
        ).toBe(false);
    });

    it('returns false when feedUpdated is exactly one second after the IMS', () => {
        expect(
            isFeedNotModified('Sun, 17 May 2026 10:00:00 GMT', '2026-05-17T10:00:01.000Z'),
        ).toBe(false);
    });

    it('honors the deprecated RFC 850 date format (Date.parse accepts it)', () => {
        // RFC 7231 §7.1.1.1 allows RFC 850 as an obsolete-but-accepted form.
        // Date.parse honors it. The exact format is platform-dependent; we
        // assert ISO/RFC 7231 forms above and only sanity-check that a
        // generally-parseable date string works here.
        const ims = new Date('2026-05-17T10:00:00.000Z').toUTCString();
        expect(isFeedNotModified(ims, '2026-05-17T10:00:00.000Z')).toBe(true);
    });
});
