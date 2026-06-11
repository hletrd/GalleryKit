/**
 * COR-R4C14-01 / ARCH-R4C14-01: lock the wide-gamut predicate wiring in the
 * three viewer color surfaces.
 *
 * `lib/color-primaries.ts` owns the canonical `WIDE_GAMUT_PRIMARIES` set +
 * `isWideGamutPrimary` helper (C3-A1 / C3-ARCH-MED-2) precisely so that the
 * "is this photo wide gamut?" decision cannot fork across call sites. Two
 * surfaces added after the helper existed (R10-L19 / R13-L1) re-derived the
 * predicate locally as `color_primaries !== 'bt709'`, which silently treats
 * the `'unknown'` enum value — persisted for EVERY ICC-less upload via
 * `inferColorPrimaries(null)` → `images.ts` — as wide gamut. Consequences
 * before the fix: the Color Details accordion rendered the raw token
 * "Color: unknown" (EN) / "색상: unknown" (KO) as its headline and
 * auto-opened for untagged photos.
 *
 * This fixture asserts, per the project's source-inspection convention
 * (see `color-details-section-delivered.test.ts` header):
 *
 *   1. All three components import `isWideGamutPrimary` from
 *      `@/lib/color-primaries` (client-safe module — NOT from
 *      `@/lib/color-detection`, which would drag fs/sharp into the bundle).
 *   2. The accordion label gate and both `isNonTrivialColor` primaries-arms
 *      call the helper.
 *   3. ZERO ad-hoc `color_primaries !== 'bt709'` comparisons survive in any
 *      of the three files — the next viewer surface that needs the predicate
 *      must import the helper or fail this suite.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = {
    colorDetails: resolve(__dirname, '../components/color-details-section.tsx'),
    bottomSheet: resolve(__dirname, '../components/info-bottom-sheet.tsx'),
    lightboxPip: resolve(__dirname, '../components/lightbox-color-pip.tsx'),
} as const;

const SOURCES = Object.fromEntries(
    Object.entries(FILES).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
) as Record<keyof typeof FILES, string>;

const CANONICAL_IMPORT = /import\s*\{[^}]*\bisWideGamutPrimary\b[^}]*\}\s*from\s*'@\/lib\/color-primaries'/;

// Matches any ad-hoc inequality re-derivation of the wide-gamut predicate,
// e.g. `image.color_primaries !== 'bt709'` or `color_primaries !== "bt709"`.
const AD_HOC_BT709_COMPARISON = /color_primaries\s*!==?\s*['"]bt709['"]/;

describe('wide-gamut predicate wiring (COR-R4C14-01)', () => {
    it('color-details-section imports the canonical helper from the client-safe module', () => {
        expect(SOURCES.colorDetails).toMatch(CANONICAL_IMPORT);
    });

    it('info-bottom-sheet imports the canonical helper from the client-safe module', () => {
        expect(SOURCES.bottomSheet).toMatch(CANONICAL_IMPORT);
    });

    it('lightbox-color-pip imports the canonical helper from the client-safe module', () => {
        expect(SOURCES.lightboxPip).toMatch(CANONICAL_IMPORT);
    });

    it('accordion label gate uses isWideGamutPrimary (kills the raw "Color: unknown" headline)', () => {
        expect(SOURCES.colorDetails).toMatch(
            /const isWideGamut = isWideGamutPrimary\(image\.color_primaries\)/,
        );
    });

    it('color-details isNonTrivialColor primaries-arm uses isWideGamutPrimary', () => {
        expect(SOURCES.colorDetails).toMatch(
            /isNonTrivialColor = Boolean\(\s*isWideGamutPrimary\(image\.color_primaries\)/,
        );
    });

    it('info-bottom-sheet isNonTrivialColor primaries-arm uses isWideGamutPrimary', () => {
        expect(SOURCES.bottomSheet).toMatch(
            /isNonTrivialColor = Boolean\(\s*isWideGamutPrimary\(image\.color_primaries\)/,
        );
    });

    it.each(Object.entries(FILES).map(([key]) => [key] as [keyof typeof FILES]))(
        'no ad-hoc `color_primaries !== \'bt709\'` comparison survives in %s',
        (key) => {
            const source = SOURCES[key];
            const match = source.match(AD_HOC_BT709_COMPARISON);
            expect(
                match,
                match
                    ? `ad-hoc wide-gamut comparison found: \`${match[0]}\` — import isWideGamutPrimary from '@/lib/color-primaries' instead (it returns false for null/undefined/'unknown'/'bt709')`
                    : undefined,
            ).toBeNull();
        },
    );

    it('delivered-row decision derivations route through isWideGamutPrimary in both surfaces', () => {
        // The public-viewer fallback derivation (`color_pipeline_decision` is
        // admin-only) must classify via the canonical predicate, not local
        // string comparisons. Structure stays compatible with the C4-A5 lock
        // in color-details-section-delivered.test.ts.
        const derivation = /const decision = image\.color_pipeline_decision\s*\?\?\s*\(isWideGamutPrimary\(image\.color_primaries\)/;
        expect(SOURCES.colorDetails).toMatch(derivation);
        expect(SOURCES.lightboxPip).toMatch(derivation);
    });
});
