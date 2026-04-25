import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * AGG2L-LOW-01 / plan-303-C — regression seatbelt for the
 * `humanizeTagLabel` consolidation.
 *
 * Plan-301-A intent: every consumer that renders a user-visible tag name
 * routes through `humanizeTagLabel` so a tag named `Music_Festival`
 * renders consistently as `Music Festival` (or `#Music Festival`)
 * everywhere. Cycle 2's review (AGG2L-LOW-01) caught two missed
 * consumers (`photo-viewer.tsx` desktop info-sidebar chip and
 * `info-bottom-sheet.tsx` mobile bottom-sheet chip) that bypassed the
 * helper and rendered `#{tag.name}` raw, re-introducing the inter-surface
 * label drift.
 *
 * This fixture scans the relevant chip-render files and asserts that the
 * raw `#{tag.name}` pattern is gone. If a future contributor pastes
 * `<Badge>#{tag.name}</Badge>` back in, this test fails before the chip
 * label drift can hit production again.
 *
 * NOTE: this is intentionally narrow — it does not ban `tag.name` in
 * places where the helper is already wrapped (e.g.
 * `humanizeTagLabel(tag.name)`) or in non-chip uses (data layer,
 * search filters, etc.). The check is a textual sanity test, not a full
 * AST analysis; the goal is to catch the specific regression class
 * (chip text rendering raw `tag.name`).
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

const CHIP_RENDER_FILES = [
    'src/components/photo-viewer.tsx',
    'src/components/info-bottom-sheet.tsx',
];

function readFileFromRepo(relPath: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

describe('tag-label consolidation (plan-303-C)', () => {
    it.each(CHIP_RENDER_FILES)('%s renders tag chips through humanizeTagLabel (no raw `#{tag.name}` text)', (file) => {
        const source = readFileFromRepo(file);
        // Reject `#{tag.name}` rendered as JSX text (e.g. `>#{tag.name}<` or
        // `>{tag.name}` after a `#` prefix). Allow `humanizeTagLabel(tag.name)`
        // and `tag.name` used inside attribute values, comments, or other
        // non-render-text contexts.
        const rawHashBracketTagName = /#\{tag\.name\}/g;
        const rawHashTagNameJsxText = />\s*#\{tag\.name\}\s*</g;

        // The "humanizeTagLabel(tag.name)" or "humanizeTagLabel(tag." pattern
        // is the allowed one. Both files must import + use the helper.
        expect(source, `${file} should import humanizeTagLabel from @/lib/photo-title`).toMatch(/import\s*\{[^}]*\bhumanizeTagLabel\b[^}]*\}\s*from\s*['"]@\/lib\/photo-title['"]/);

        // No raw `#{tag.name}` should remain anywhere in the file. If the
        // chip renders the prefix separately (e.g. `>#{humanizeTagLabel(tag.name)}<`),
        // the regex above does not match it because it requires `tag.name`
        // unwrapped between the `{` and `}`.
        const rawMatchesAll = source.match(rawHashBracketTagName);
        const rawMatchesText = source.match(rawHashTagNameJsxText);
        expect(rawMatchesAll, `${file}: found raw \`#{tag.name}\` — wrap with humanizeTagLabel(tag.name) instead`).toBeNull();
        expect(rawMatchesText, `${file}: found raw \`#{tag.name}\` in JSX text — wrap with humanizeTagLabel(tag.name) instead`).toBeNull();
    });

    it('home-client uses humanizeTagLabel for tag chip-style rendering', () => {
        // Sanity: home-client.tsx already used humanizeTagLabel post plan-301-A;
        // this assertion locks it in.
        const source = readFileFromRepo('src/components/home-client.tsx');
        expect(source).toMatch(/humanizeTagLabel\s*\(/);
    });

    it('tag-filter uses humanizeTagLabel for pill rendering', () => {
        const source = readFileFromRepo('src/components/tag-filter.tsx');
        expect(source).toMatch(/humanizeTagLabel/);
    });
});

/**
 * AGG2L-LOW-02 / plan-303-C — regression seatbelt for the
 * `buildHreflangAlternates` consolidation.
 *
 * Plan-301-C intent: every emitter of `Metadata.alternates.languages`
 * uses the `buildHreflangAlternates` helper so a new locale added to
 * `LOCALES` automatically extends every alternate-language map. Cycle
 * 2's review (AGG2L-LOW-02) caught the root layout (`[locale]/layout.tsx`)
 * still inlining `{ 'en': ..., 'ko': ..., 'x-default': ... }`.
 *
 * This fixture scans the metadata-emitting files (root layout + public
 * pages) and asserts no inline `'en':` / `'ko':` literals remain inside
 * a `languages: { ... }` block. The home / topic / photo / share pages
 * should already be clean post plan-301-C; this catches a future
 * regression at any of them.
 */

const HREFLANG_EMITTER_FILES = [
    'src/app/[locale]/layout.tsx',
    'src/app/[locale]/(public)/page.tsx',
    'src/app/[locale]/(public)/[topic]/page.tsx',
    'src/app/[locale]/(public)/p/[id]/page.tsx',
];

describe('buildHreflangAlternates consolidation (plan-303-C)', () => {
    it.each(HREFLANG_EMITTER_FILES)('%s does not inline `languages: { en: ..., ko: ... }`', (file) => {
        const source = readFileFromRepo(file);
        // Reject `languages: {` followed by a hardcoded `'en':` or `"en":`
        // literal at any indentation. Allow `languages: buildHreflangAlternates(...)`.
        // The pattern is permissive about whitespace and looks across at
        // most a few hundred chars to avoid runaway false positives in
        // unrelated `{ ... }` blocks.
        const inlineLanguagesMap = /languages\s*:\s*\{[\s\S]{0,400}?(['"])(?:en|ko|x-default)\1\s*:/;
        const match = inlineLanguagesMap.exec(source);
        expect(
            match,
            `${file}: inline locale literal inside \`languages: { ... }\`. Use buildHreflangAlternates(seo.url, '<path>') instead.`,
        ).toBeNull();
    });

    it('all public-page emitters import buildHreflangAlternates', () => {
        for (const file of HREFLANG_EMITTER_FILES) {
            const source = readFileFromRepo(file);
            expect(
                source,
                `${file} should import buildHreflangAlternates from @/lib/locale-path`,
            ).toMatch(/import\s*\{[^}]*\bbuildHreflangAlternates\b[^}]*\}\s*from\s*['"]@\/lib\/locale-path['"]/);
        }
    });
});
