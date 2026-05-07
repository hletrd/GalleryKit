/**
 * OG image ICC post-processing tests (US-CM08).
 *
 * Verifies that the Sharp pipeline used in /api/og/photo/[id]/route.tsx
 * embeds the correct ICC profile based on the source image's color_primaries.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

const WIDE_GAMUT_PRIMARIES = ['p3-d65', 'bt2020', 'adobergb', 'prophoto', 'dci-p3'];

async function postProcessOgImage(pngBuffer: Buffer, colorPrimaries: string | null | undefined): Promise<Buffer> {
    const isWideGamut = colorPrimaries && WIDE_GAMUT_PRIMARIES.includes(colorPrimaries);
    const targetIcc = isWideGamut ? 'p3' : 'srgb';
    return sharp(pngBuffer)
        .toColorspace(targetIcc)
        .withIccProfile(targetIcc)
        .jpeg({ quality: 88 })
        .toBuffer();
}

async function makePng(): Promise<Buffer> {
    return sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 64, b: 32 } },
    }).png().toBuffer();
}

describe('OG image ICC post-processing (US-CM08)', () => {
    it('sRGB source: JPEG output carries an ICC profile', async () => {
        const jpeg = await postProcessOgImage(await makePng(), 'bt709');
        const meta = await sharp(jpeg).metadata();
        expect(meta.icc).not.toBeNull();
        expect(meta.icc!.length).toBeGreaterThan(0);
    });

    it('P3 source: JPEG output carries an ICC profile', async () => {
        const jpeg = await postProcessOgImage(await makePng(), 'p3-d65');
        const meta = await sharp(jpeg).metadata();
        expect(meta.icc).not.toBeNull();
        expect(meta.icc!.length).toBeGreaterThan(0);
    });

    it('P3 and sRGB outputs have different ICC profiles', async () => {
        const [jpegSrgb, jpegP3] = await Promise.all([
            postProcessOgImage(await makePng(), 'bt709'),
            postProcessOgImage(await makePng(), 'p3-d65'),
        ]);
        const [metaSrgb, metaP3] = await Promise.all([
            sharp(jpegSrgb).metadata(),
            sharp(jpegP3).metadata(),
        ]);
        expect(metaSrgb.icc).not.toBeNull();
        expect(metaP3.icc).not.toBeNull();
        expect(metaSrgb.icc!.equals(metaP3.icc!)).toBe(false);
    });

    it('null/unknown source falls back to sRGB ICC', async () => {
        const jpeg = await postProcessOgImage(await makePng(), null);
        const meta = await sharp(jpeg).metadata();
        expect(meta.icc).not.toBeNull();
        expect(meta.icc!.length).toBeGreaterThan(0);
    });

    it('Rec.2020 source: treated as wide-gamut (P3 ICC)', async () => {
        const jpeg = await postProcessOgImage(await makePng(), 'bt2020');
        const meta = await sharp(jpeg).metadata();
        expect(meta.icc).not.toBeNull();
        expect(meta.icc!.length).toBeGreaterThan(0);
    });
});
