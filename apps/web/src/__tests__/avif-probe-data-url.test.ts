import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { AVIF_PROBE_DATA_URL } from '@/lib/avif-support';

/**
 * R4C8 COR-R4C8-02.
 *
 * The AVIF decode-support probe constant shipped for months as
 * structurally invalid ISOBMFF (a bogus `pbal` box, no iloc / av1C /
 * mdat) — it failed to decode in EVERY browser, so
 * `getAvifSupportPromise()` permanently resolved `false` and the
 * wide-gamut AVIF histogram path was dead code on P3 displays. Nothing
 * validated the constant itself, which is how it survived 28 review
 * rounds.
 *
 * This suite decodes the actual literal: if anyone ever replaces it
 * with bytes a real AVIF decoder rejects, these tests fail.
 */

describe('AVIF probe data URL validity (R4C8 COR-R4C8-02)', () => {
    const prefix = 'data:image/avif;base64,';

    it('carries the data:image/avif;base64 envelope', () => {
        expect(AVIF_PROBE_DATA_URL.startsWith(prefix)).toBe(true);
    });

    it('is a real decodable AVIF (sharp metadata + full decode)', async () => {
        const buf = Buffer.from(AVIF_PROBE_DATA_URL.slice(prefix.length), 'base64');
        const meta = await sharp(buf).metadata();
        expect(meta.format).toBe('heif'); // sharp reports the HEIF family for AVIF
        expect(meta.compression).toBe('av1');
        expect(meta.width).toBe(1);
        expect(meta.height).toBe(1);

        // Full decode must succeed — metadata alone does not prove the
        // mdat payload is decodable.
        const raw = await sharp(buf).raw().toBuffer();
        expect(raw.length).toBeGreaterThan(0);
    });

    it('stays small enough to be a cheap probe (< 1 KB of base64)', () => {
        expect(AVIF_PROBE_DATA_URL.length).toBeLessThan(1024);
    });
});
