/**
 * Tests for Display P3 ICC tagging on AVIF derivatives (US-P43).
 *
 * Fixtures are generated programmatically via Sharp so the repo stays lean and
 * the source ICC always matches expectations precisely. A 4×4 sRGB JPEG and a
 * 4×4 Display-P3 AVIF are written to a temp dir before each suite and removed
 * after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { resolveAvifIccProfile } from '@/lib/process-image';

// ---------------------------------------------------------------------------
// Helper — generate a tiny test image carrying a specific ICC profile.
// Sharp's toBuffer() will honour .withMetadata({ icc }) and embed the profile.
// ---------------------------------------------------------------------------

async function makeIccTestAvif(icc: 'srgb' | 'p3', destPath: string) {
    await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 64, b: 32 } },
    })
        .withMetadata({ icc })
        .avif({ quality: 50 })
        .toFile(destPath);
}

async function readIccFromFile(filePath: string): Promise<Buffer | null> {
    const meta = await sharp(filePath).metadata();
    return meta.icc ?? null;
}

// ---------------------------------------------------------------------------
// resolveAvifIccProfile — pure-function decision matrix
// ---------------------------------------------------------------------------

describe('resolveAvifIccProfile — ICC decision matrix', () => {
    // P3 sources → 'p3'
    it('returns p3 for Display P3', () => {
        expect(resolveAvifIccProfile('Display P3')).toBe('p3');
    });

    it('returns p3 for Display P3 - ACES variant', () => {
        expect(resolveAvifIccProfile('Display P3 - ACES')).toBe('p3');
    });

    it('returns p3 for DCI-P3', () => {
        expect(resolveAvifIccProfile('DCI-P3')).toBe('p3');
    });

    it('returns p3 for P3-D65', () => {
        expect(resolveAvifIccProfile('P3-D65')).toBe('p3');
    });

    // CM-CRIT-1 fix: wider-than-sRGB gamuts now return 'srgb' (not 'p3').
    // The encode chain converts these pixels to sRGB explicitly so the AVIF
    // ICC tag matches the actual pixel colorspace. Mapping them to 'p3'
    // without a pixel transform was the source of the colorimetric bug.
    it('returns srgb for Adobe RGB (1998) (CM-CRIT-1: pixels converted, not just relabelled)', () => {
        expect(resolveAvifIccProfile('Adobe RGB (1998)')).toBe('srgb');
    });

    it('returns srgb for AdobeRGB (CM-CRIT-1: pixels converted, not just relabelled)', () => {
        expect(resolveAvifIccProfile('AdobeRGB')).toBe('srgb');
    });

    it('returns srgb for ProPhoto RGB (CM-CRIT-1: pixels converted, not just relabelled)', () => {
        expect(resolveAvifIccProfile('ProPhoto RGB')).toBe('srgb');
    });

    it('returns srgb for ITU-R BT.2020 (CM-CRIT-1: pixels converted, not just relabelled)', () => {
        expect(resolveAvifIccProfile('ITU-R BT.2020')).toBe('srgb');
    });

    it('returns srgb for Rec.2020 (CM-CRIT-1: pixels converted, not just relabelled)', () => {
        expect(resolveAvifIccProfile('Rec.2020')).toBe('srgb');
    });

    // sRGB / unknown → 'srgb'
    it('returns srgb for sRGB IEC61966-2.1', () => {
        expect(resolveAvifIccProfile('sRGB IEC61966-2.1')).toBe('srgb');
    });

    it('returns srgb for null', () => {
        expect(resolveAvifIccProfile(null)).toBe('srgb');
    });

    it('returns srgb for undefined', () => {
        expect(resolveAvifIccProfile(undefined)).toBe('srgb');
    });

    it('returns srgb for empty string', () => {
        expect(resolveAvifIccProfile('')).toBe('srgb');
    });

    it('returns srgb for unknown profile name', () => {
        expect(resolveAvifIccProfile('Generic RGB')).toBe('srgb');
    });
});

// ---------------------------------------------------------------------------
// ICC round-trip — Sharp embeds the profile; reading it back confirms tagging
// ---------------------------------------------------------------------------

describe('AVIF ICC round-trip via Sharp', () => {
    let tmpDir: string;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gallerykit-p3-test-'));
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('AVIF written with icc=p3 carries an ICC profile buffer', async () => {
        const dest = path.join(tmpDir, 'p3-out.avif');
        await makeIccTestAvif('p3', dest);
        const icc = await readIccFromFile(dest);
        expect(icc).not.toBeNull();
        expect(icc!.length).toBeGreaterThan(0);
    });

    it('AVIF written with icc=srgb carries an ICC profile buffer', async () => {
        const dest = path.join(tmpDir, 'srgb-out.avif');
        await makeIccTestAvif('srgb', dest);
        const icc = await readIccFromFile(dest);
        expect(icc).not.toBeNull();
        expect(icc!.length).toBeGreaterThan(0);
    });

    it('P3-tagged AVIF has a different ICC profile than sRGB-tagged AVIF', async () => {
        const p3Path = path.join(tmpDir, 'p3-cmp.avif');
        const srgbPath = path.join(tmpDir, 'srgb-cmp.avif');
        await Promise.all([makeIccTestAvif('p3', p3Path), makeIccTestAvif('srgb', srgbPath)]);
        const [p3Icc, srgbIcc] = await Promise.all([readIccFromFile(p3Path), readIccFromFile(srgbPath)]);
        // Profiles must both exist but differ in content
        expect(p3Icc).not.toBeNull();
        expect(srgbIcc).not.toBeNull();
        expect(p3Icc!.equals(srgbIcc!)).toBe(false);
    });
});
