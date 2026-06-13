import { describe, it, expect } from 'vitest';
import { generateBase56, isBase56, BASE56_CHARS } from '@/lib/base56';

describe('generateBase56', () => {
    it('produces a string of the requested length', () => {
        expect(generateBase56(8)).toHaveLength(8);
        expect(generateBase56(16)).toHaveLength(16);
        expect(generateBase56(1)).toHaveLength(1);
    });

    it('produces only valid Base56 characters', () => {
        const result = generateBase56(200);
        for (const ch of result) {
            expect(BASE56_CHARS).toContain(ch);
        }
    });

    it('produces different values on successive calls', () => {
        const a = generateBase56(16);
        const b = generateBase56(16);
        expect(a).not.toBe(b);
    });

    // AGG-C8-01 / TE8-01: lock the rejection-sampling uniformity.
    //
    // generateBase56 mints unguessable public share keys (photo shares
    // `/s/<key>` and group shares `/g/<key>`, see actions/sharing.ts). It
    // rejects random bytes >= 224 because 256 % 56 = 32 — without that
    // rejection, byte values [224,255] would map disproportionately onto the
    // first 32 of the 56 characters, biasing the distribution and weakening
    // key entropy.
    //
    // The length / charset / successive-differ tests above would ALL still
    // pass against a naive `randomBytes()[i] % 56` implementation that drops
    // the rejection loop. This test is the regression guard for the entropy
    // property itself: it asserts the per-character frequency is close to
    // uniform. Empirically (500k samples) the correct rejection-sampled code
    // yields a max/min char-frequency ratio of ~1.04-1.06 (tightly bounded by
    // the law of large numbers), while a naive `% 56` yields ~1.30. The 1.20
    // threshold sits safely between the two, so this is non-flaky on correct
    // code and goes RED if the rejection loop is ever removed.
    it('produces a near-uniform character distribution (rejection sampling, no modulo bias)', () => {
        const SAMPLE = 500_000;
        const sample = generateBase56(SAMPLE);
        expect(sample).toHaveLength(SAMPLE);

        const counts = new Map<string, number>();
        for (const ch of BASE56_CHARS) counts.set(ch, 0);
        for (const ch of sample) {
            counts.set(ch, (counts.get(ch) ?? 0) + 1);
        }

        // Every one of the 56 characters must appear at this sample size.
        for (const ch of BASE56_CHARS) {
            expect(counts.get(ch), `character ${ch} never appeared`).toBeGreaterThan(0);
        }

        const frequencies = [...counts.values()];
        const max = Math.max(...frequencies);
        const min = Math.min(...frequencies);
        const ratio = max / min;

        // Correct (rejection-sampled) code: ~1.04-1.06. Naive `% 56`: ~1.30.
        expect(ratio).toBeLessThan(1.2);
    });
});

describe('isBase56', () => {
    it('accepts valid Base56 strings', () => {
        expect(isBase56('abc23DEF')).toBe(true);
    });

    it('rejects empty string', () => {
        expect(isBase56('')).toBe(false);
    });

    it('rejects strings with excluded characters (0, 1, O, I, l)', () => {
        expect(isBase56('abc0')).toBe(false);
        expect(isBase56('abc1')).toBe(false);
        expect(isBase56('abcO')).toBe(false);
        expect(isBase56('abcI')).toBe(false);
        expect(isBase56('abcl')).toBe(false);
    });

    it('validates exact length when expectedLength is a number', () => {
        expect(isBase56('abcd', 4)).toBe(true);
        expect(isBase56('abcd', 5)).toBe(false);
    });

    it('validates length against array of allowed lengths', () => {
        expect(isBase56('abcd', [3, 4, 5])).toBe(true);
        expect(isBase56('abcd', [3, 5])).toBe(false);
    });

    it('rejects non-string input', () => {
        expect(isBase56(null as unknown as string)).toBe(false);
        expect(isBase56(undefined as unknown as string)).toBe(false);
    });
});
