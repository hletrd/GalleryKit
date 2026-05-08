/**
 * Color fixture wiring tests (P4-B2 / R4-M4).
 *
 * Loads the synthetic ICC profiles from `__test_fixtures__/color/` and
 * runs them through the chromaticity-based gamut detector. The fixtures
 * are byte-stable (regenerable via
 * `apps/web/scripts/build-color-fixtures.ts`) and are checked into the
 * repository so the test suite has real on-disk inputs without requiring
 * `avifenc` / `heif-convert` in the contributor's environment.
 *
 * The fixture inventory + reproduction recipe live in
 * `apps/web/__test_fixtures__/color/README.md`. The fixtures intentionally
 * cover the gamut detection path; HEIF / AVIF NCLX fixtures are gated on
 * an avifenc tool that is not bundled with the repo, see the README.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { detectGamutFromIccChromaticity } from '@/lib/icc-chromaticity';

const FIXTURES_DIR = path.join(
    process.cwd(),
    '__test_fixtures__',
    'color',
);

function loadFixture(name: string): Buffer {
    return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

describe('color fixtures — chromaticity detection', () => {
    it('synth-srgb-chromaticities.icc → srgb (high confidence)', () => {
        const icc = loadFixture('synth-srgb-chromaticities.icc');
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('srgb');
        expect(result!.confidence).toBe('high');
    });

    it('synth-p3-chromaticities.icc → p3-d65 (high confidence)', () => {
        const icc = loadFixture('synth-p3-chromaticities.icc');
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('p3-d65');
        expect(result!.confidence).toBe('high');
    });

    it('synth-adobergb-flavored.icc (CG2700X-like drift) → adobergb', () => {
        const icc = loadFixture('synth-adobergb-flavored.icc');
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('adobergb');
        expect(['high', 'medium']).toContain(result!.confidence);
    });

    it('synth-prophoto-chromaticities.icc (D50 white) → prophoto', () => {
        const icc = loadFixture('synth-prophoto-chromaticities.icc');
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('prophoto');
        expect(result!.confidence).toBe('high');
    });

    it('synth-bt2020-chromaticities.icc → bt2020 (high confidence)', () => {
        const icc = loadFixture('synth-bt2020-chromaticities.icc');
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('bt2020');
        expect(result!.confidence).toBe('high');
    });
});
