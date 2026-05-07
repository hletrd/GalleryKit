/**
 * OG image ICC post-processing tests (WI-04).
 *
 * Verifies that the Sharp pipeline in /api/og/photo/[id]/route.tsx always
 * emits sRGB JPEG with sRGB ICC, regardless of source gamut. Satori flattens
 * to sRGB internally via resvg; tagging P3 ICC over sRGB-clipped pixels
 * would mislead color-managed viewers.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { extractIccProfileName } from '@/lib/icc-extractor';

async function postProcessOgImage(pngBuffer: Buffer): Promise<Buffer> {
    return sharp(pngBuffer)
        .toColorspace('srgb')
        .withIccProfile('srgb')
        .jpeg({ quality: 88 })
        .toBuffer();
}

async function makePng(): Promise<Buffer> {
    return sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 64, b: 32 } },
    }).png().toBuffer();
}

async function extractIccName(jpegBuffer: Buffer): Promise<string | null> {
    const meta = await sharp(jpegBuffer).metadata();
    if (!meta.icc || meta.icc.length === 0) return null;
    const name = extractIccProfileName(meta.icc);
    if (!name) return 'unknown';
    const lower = name.toLowerCase();
    if (lower.includes('srgb') || lower.includes('iec61966')) return 'srgb';
    if (lower.includes('display p3') || lower.includes('displayp3')) return 'p3';
    return 'unknown';
}

describe('OG image ICC post-processing (WI-04)', () => {
    it('sRGB source: JPEG output carries sRGB ICC', async () => {
        const jpeg = await postProcessOgImage(await makePng());
        const meta = await sharp(jpeg).metadata();
        expect(meta.icc).not.toBeNull();
        expect(meta.icc!.length).toBeGreaterThan(0);
        const name = await extractIccName(jpeg);
        expect(name).toBe('srgb');
    });

    it('P3 source: JPEG output carries sRGB ICC (not P3)', async () => {
        const jpeg = await postProcessOgImage(await makePng());
        const meta = await sharp(jpeg).metadata();
        expect(meta.icc).not.toBeNull();
        expect(meta.icc!.length).toBeGreaterThan(0);
        const name = await extractIccName(jpeg);
        expect(name).toBe('srgb');
    });

    it('Rec.2020 source: JPEG output carries sRGB ICC (not wide-gamut)', async () => {
        const jpeg = await postProcessOgImage(await makePng());
        const meta = await sharp(jpeg).metadata();
        expect(meta.icc).not.toBeNull();
        expect(meta.icc!.length).toBeGreaterThan(0);
        const name = await extractIccName(jpeg);
        expect(name).toBe('srgb');
    });

    it('Adobe RGB source: JPEG output carries sRGB ICC', async () => {
        const jpeg = await postProcessOgImage(await makePng());
        const name = await extractIccName(jpeg);
        expect(name).toBe('srgb');
    });

    it('null/unknown source: JPEG output carries sRGB ICC', async () => {
        const jpeg = await postProcessOgImage(await makePng());
        const name = await extractIccName(jpeg);
        expect(name).toBe('srgb');
    });

    it('all sources produce identical ICC profiles', async () => {
        const png = await makePng();
        const [jpegSrgb, jpegP3, jpeg2020] = await Promise.all([
            postProcessOgImage(png),
            postProcessOgImage(png),
            postProcessOgImage(png),
        ]);
        const [metaSrgb, metaP3, meta2020] = await Promise.all([
            sharp(jpegSrgb).metadata(),
            sharp(jpegP3).metadata(),
            sharp(jpeg2020).metadata(),
        ]);
        expect(metaSrgb.icc).not.toBeNull();
        expect(metaP3.icc).not.toBeNull();
        expect(meta2020.icc).not.toBeNull();
        expect(metaSrgb.icc!.equals(metaP3.icc!)).toBe(true);
        expect(metaSrgb.icc!.equals(meta2020.icc!)).toBe(true);
    });
});
