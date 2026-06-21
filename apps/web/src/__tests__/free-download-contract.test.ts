/**
 * Run-8 cycle-1 / FIND-R8C1-04: source-text contract for the UNCONDITIONAL
 * free-download path in the photo viewer + mobile bottom sheet.
 *
 * The Stripe paid-download feature was removed entirely (commits 6c5e0b61..
 * 47b1e21f): the api/download token-gated route, the entitlements table, and
 * the images.license_tier column are gone, and the in-app download button was
 * made UNCONDITIONAL (gated only on the derivative filename being non-null).
 * The ~17 deleted paid-download test files were the closest coverage of the
 * download anchors; nothing replaced them. This contract closes that gap with
 * three regression guards:
 *
 *  1. each component imports + calls buildDownloadFilename for the anchors, so
 *     downloads keep a human-readable name and a refactor that drops it turns
 *     a test RED;
 *  2. each derives downloadHref from filename_jpeg and avifDownloadHref from
 *     filename_avif (separate fields) pointing at the already-public
 *     /uploads/{jpeg,avif}/ derivative paths — the gamut-aware AVIF branch
 *     must keep using the AVIF field, not alias the JPEG one;
 *  3. NEITHER component conditions the download on any entitlement / license /
 *     downloadToken / isPaid / isUnlocked symbol — a hard guard that paid-
 *     gating cannot creep back into the now-free path.
 *
 * Source-contract tier (matching the repo's other *-wiring / *-contract tests):
 * a behavioral render test would need to mock next-intl, the display-capability
 * hook, and the Radix DropdownMenu portal — heavy and brittle. The realistic
 * regressions (license gate re-added, href field aliased, filename helper
 * dropped) are all caught by import + same-file string assertions below.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENTS: Record<string, string> = {
    'photo-viewer.tsx': fs.readFileSync(
        path.resolve(__dirname, '..', 'components', 'photo-viewer.tsx'),
        'utf8',
    ),
    'info-bottom-sheet.tsx': fs.readFileSync(
        path.resolve(__dirname, '..', 'components', 'info-bottom-sheet.tsx'),
        'utf8',
    ),
};

// Paid-gating symbols that must NEVER reappear on the free-download path.
const FORBIDDEN_PAID_SYMBOLS = [
    'entitlement',
    'licenseTier',
    'license_tier',
    'downloadToken',
    'isPaid',
    'isUnlocked',
    'checkout',
];

describe.each(Object.entries(COMPONENTS))(
    'free-download contract — %s (FIND-R8C1-04)',
    (_name, src) => {
        it('imports buildDownloadFilename from @/lib/download-filename', () => {
            expect(src).toMatch(
                /import\s*\{[^}]*\bbuildDownloadFilename\b[^}]*\}\s*from\s*['"]@\/lib\/download-filename['"]/,
            );
        });

        it('calls buildDownloadFilename for the download anchor name', () => {
            expect(src).toMatch(/buildDownloadFilename\(/);
        });

        it('derives downloadHref from filename_jpeg (public /uploads/jpeg/ path)', () => {
            // The JPEG href must come from the JPEG derivative field and point at
            // the already-public jpeg derivative directory.
            expect(src).toMatch(/filename_jpeg/);
            expect(src).toMatch(/\/uploads\/jpeg\//);
        });

        it('derives avifDownloadHref from filename_avif (separate field, /uploads/avif/ path)', () => {
            // The gamut-aware AVIF option must use the AVIF field — not alias the
            // JPEG one — and point at the public avif derivative directory.
            expect(src).toMatch(/avifDownloadHref/);
            expect(src).toMatch(/filename_avif/);
            expect(src).toMatch(/\/uploads\/avif\//);
        });

        it('does NOT gate the download on any paid/entitlement symbol', () => {
            for (const symbol of FORBIDDEN_PAID_SYMBOLS) {
                expect(
                    src.includes(symbol),
                    `free-download component must not reference paid-gating symbol "${symbol}"`,
                ).toBe(false);
            }
        });
    },
);
