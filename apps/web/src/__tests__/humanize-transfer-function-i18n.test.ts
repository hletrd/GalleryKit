/**
 * C3-A2 / C3-COL-MED-1 / C3-UX-MED-3: lock the i18n contract for
 * humanizeTransferFunction so the lightbox color pip and Color Details
 * accordion display localized transfer text on Korean locales rather
 * than mixing English humanizer output with localized panel labels.
 *
 * Both locales must render every known transfer enum to a non-empty
 * string. Latinate technical names (sRGB, PQ, HLG) stay identical
 * across locales — they match SMPTE / ITU-T spec wording. Descriptive
 * names (Gamma 2.2, Linear) are translated.
 */
import { describe, it, expect } from 'vitest';
import { humanizeTransferFunction } from '@/components/color-details-section';

import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';

type FlatMessages = Record<string, string>;

function flatten(messages: unknown, prefix = ''): FlatMessages {
    const result: FlatMessages = {};
    if (messages && typeof messages === 'object') {
        for (const [key, value] of Object.entries(messages as Record<string, unknown>)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'string') {
                result[fullKey] = value;
            } else if (typeof value === 'object' && value !== null) {
                Object.assign(result, flatten(value, fullKey));
            }
        }
    }
    return result;
}

const en = flatten(enMessages);
const ko = flatten(koMessages);

function makeT(messages: FlatMessages): (key: string) => string {
    return (key: string) => messages[key] ?? key;
}

const TRANSFER_VALUES = ['srgb', 'gamma22', 'gamma18', 'pq', 'hlg', 'linear'] as const;

describe('humanizeTransferFunction — i18n contract', () => {
    describe('English locale', () => {
        const t = makeT(en);

        it.each(TRANSFER_VALUES)('renders %s to a non-empty string', (value) => {
            const result = humanizeTransferFunction(value, t);
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);
        });

        it('renders sRGB / PQ / HLG identically across locales (Latinate)', () => {
            expect(humanizeTransferFunction('srgb', t)).toBe('sRGB');
            expect(humanizeTransferFunction('pq', t)).toBe('PQ (ST 2084)');
            expect(humanizeTransferFunction('hlg', t)).toBe('HLG');
        });
    });

    describe('Korean locale', () => {
        const t = makeT(ko);

        it.each(TRANSFER_VALUES)('renders %s to a non-empty string', (value) => {
            const result = humanizeTransferFunction(value, t);
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);
        });

        it('renders Latinate names identically (sRGB / PQ / HLG)', () => {
            expect(humanizeTransferFunction('srgb', t)).toBe('sRGB');
            expect(humanizeTransferFunction('pq', t)).toBe('PQ (ST 2084)');
            expect(humanizeTransferFunction('hlg', t)).toBe('HLG');
        });

        it('translates descriptive names', () => {
            // Korean photographers see "감마 2.2" rather than "Gamma 2.2".
            expect(humanizeTransferFunction('gamma22', t)).toBe('감마 2.2');
            expect(humanizeTransferFunction('gamma18', t)).toBe('감마 1.8');
            expect(humanizeTransferFunction('linear', t)).toBe('리니어');
        });
    });

    describe('default / unknown', () => {
        const t = makeT(en);

        it('returns empty string for null', () => {
            expect(humanizeTransferFunction(null, t)).toBe('');
        });

        it('returns empty string for undefined', () => {
            expect(humanizeTransferFunction(undefined, t)).toBe('');
        });

        it('returns empty string for unknown enum', () => {
            expect(humanizeTransferFunction('unknown', t)).toBe('');
        });

        it('returns empty string for arbitrary string', () => {
            expect(humanizeTransferFunction('not-a-transfer', t)).toBe('');
        });
    });
});
