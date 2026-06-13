/**
 * AGG-R7-03 / AGG-R7-05 (run-7 c1): pin the error-shell heading treatment.
 *
 * History: AGG-9 split the big faint `text-muted-foreground/30` (~1.5:1
 * contrast) error title into an `aria-hidden` decorative glyph + an `sr-only`
 * <h1>. That fixed the accessibility TREE (sr-only text has no contrast floor)
 * but left SIGHTED users with only a faint, illegible title and no real
 * visible heading — inconsistent with not-found.tsx, which renders a visible
 * readable <h1>. AGG-R7-03 promoted the <h1> to a single VISIBLE legible
 * heading carrying the accessible name.
 *
 * This is a source-fixture test (the error boundaries are trivial `'use
 * client'` components whose heading shape is the contract; rendering them
 * needs the i18n provider, so a structural source assertion is the right tool
 * — same approach the touch-target audit uses). It pins:
 *   1. each error shell has a VISIBLE <h1> (NOT `sr-only`) carrying
 *      `t('error.title')`;
 *   2. no faint `text-muted-foreground/30` element serves as the title (a
 *      revert to the AGG-9 sr-only-only + /30-glyph shape FAILS this);
 *   3. the <h1> id still matches the section's `aria-labelledby`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SHELLS = [
    {
        name: 'public error.tsx',
        file: 'src/app/[locale]/error.tsx',
        labelledById: 'route-error-title',
    },
    {
        name: 'admin error.tsx',
        file: 'src/app/[locale]/admin/(protected)/error.tsx',
        labelledById: 'admin-route-error-title',
    },
] as const;

const repoRoot = path.resolve(__dirname, '..', '..');

function read(file: string): string {
    return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

describe('error-shell heading (AGG-R7-03)', () => {
    for (const shell of SHELLS) {
        describe(shell.name, () => {
            const src = read(shell.file);

            it('renders a VISIBLE <h1> carrying the error title (not sr-only)', () => {
                // Find the <h1 ...>{t('error.title')}</h1> opening tag.
                const h1Match = src.match(/<h1\b[^>]*>\s*\{t\('error\.title'\)\}\s*<\/h1>/);
                expect(h1Match, 'expected an <h1> wrapping {t(\'error.title\')}').not.toBeNull();
                const h1Tag = h1Match![0];
                // The visible-heading contract: the h1 must NOT be sr-only.
                expect(h1Tag, 'the error-title <h1> must be visible, not sr-only').not.toMatch(/\bsr-only\b/);
            });

            it('carries the matching id for aria-labelledby', () => {
                expect(src).toContain(`id="${shell.labelledById}"`);
                expect(src).toContain(`aria-labelledby="${shell.labelledById}"`);
            });

            it('does not render the error title as a faint /30 heading glyph', () => {
                // The AGG-9 regression shape was a `text-muted-foreground/30`
                // span carrying the title. No such faint element may carry the
                // title text any more (a /30 fill is ~1.5:1, far below WCAG AA).
                expect(src).not.toMatch(/text-muted-foreground\/30[^>]*>\s*\{t\('error\.title'\)\}/);
            });
        });
    }
});
