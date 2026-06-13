/**
 * Run-6 Cycle 1 AGG-4 — `sanitizeForOg` must replace-ALL Unicode formatting
 * chars, never just the first.
 *
 * Both the OG image route (`api/og/photo/[id]/route.tsx`) and the photo page
 * (`(public)/p/[id]/page.tsx`) scrub bidi/zero-width chars from values embedded
 * into the public OG card and the JSON-LD structured data. They previously used
 *   value.replace(UNICODE_FORMAT_CHARS, '')
 * but UNICODE_FORMAT_CHARS (validation.ts) carries no `/g` flag, so `.replace()`
 * strips only the FIRST match — a camera_model like "A<RLO><ZWSP>bc" leaked the
 * 2nd+ chars into public output (Trojan-Source visual-spoofing surface).
 *
 * The fix routes both through `stripUnicodeFormatting` (the global-flag twin).
 * AGG-R8-13 (run-8 c2): the OG ROUTE's local `sanitizeForOg` was extracted to
 * the shared `@/lib/og-sanitize` (so the home/site OG route shares one strip).
 * AGG-R8c3-02 (run-8 c3): the JSON-LD photo PAGE's local copy — which only
 * stripped Unicode-format chars, NOT C0 controls, while its docstring falsely
 * claimed to "match" the OG route — was also migrated to the shared helper, so
 * all three consuming files (both OG image routes + the JSON-LD page) now share
 * ONE sanitizer (Unicode-format + C0 strip). This fixture-style guard pins the
 * contract:
 *   1. behaviorally — the underlying global strip removes MULTIPLE occurrences;
 *   2. structurally — every consuming file imports the shared `sanitizeForOg`
 *      from `@/lib/og-sanitize`, and NONE reintroduces the non-global
 *      `.replace(UNICODE_FORMAT_CHARS` call form (only comments may mention it);
 *   3. the shared module itself uses the global `stripUnicodeFormatting`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripUnicodeFormatting } from '@/lib/validation';
import { sanitizeForOg } from '@/lib/og-sanitize';

const RLO = String.fromCharCode(0x202e); // right-to-left override
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const LRI = String.fromCharCode(0x2066); // left-to-right isolate

describe('AGG-4: sanitizeForOg strips ALL Unicode formatting chars', () => {
    it('global strip removes multiple bidi/zero-width occurrences (not just the first)', () => {
        const dangerous = `A${RLO}b${ZWSP}c${LRI}d`;
        const cleaned = stripUnicodeFormatting(dangerous);
        expect(cleaned).toBe('Abcd');
    });

    it('the shared sanitizeForOg removes multiple occurrences (global)', () => {
        const dangerous = `A${RLO}b${ZWSP}c${LRI}d`;
        expect(sanitizeForOg(dangerous)).toBe('Abcd');
    });

    it('the shared @/lib/og-sanitize module uses the global stripUnicodeFormatting', () => {
        const src = readFileSync(join(process.cwd(), 'src/lib/og-sanitize.ts'), 'utf8');
        expect(src).toContain('stripUnicodeFormatting');
        expect(src).not.toMatch(/\.replace\(\s*UNICODE_FORMAT_CHARS\s*,/);
    });

    it.each([
        // The OG route now consumes the shared helper; assert it imports
        // sanitizeForOg from og-sanitize (the global strip lives there).
        ['src/app/api/og/photo/[id]/route.tsx', /from\s+['"]@\/lib\/og-sanitize['"]/],
        // AGG-R8c3-02 (run-8 c3): the JSON-LD page also consumes the SHARED
        // sanitizer now (its old local copy stripped only Unicode-format chars,
        // not C0 controls, while claiming to "match" the OG route — false once
        // AGG-R8-13 added C0-stripping to the shared helper). Assert it imports
        // sanitizeForOg from og-sanitize so the JSON-LD path is C0-strip-locked.
        ['src/app/[locale]/(public)/p/[id]/page.tsx', /from\s+['"]@\/lib\/og-sanitize['"]/],
        // The home/site OG route also consumes the shared helper (AGG-R8-13).
        ['src/app/api/og/route.tsx', /from\s+['"]@\/lib\/og-sanitize['"]/],
    ] as const)('%s routes sanitizeForOg through the shared global strip', (rel, mustMatch) => {
        const src = readFileSync(join(process.cwd(), rel), 'utf8');
        expect(src).toMatch(mustMatch);
        // It must NOT call the non-global form (comments referencing the old
        // pattern are fine; an actual `.replace(UNICODE_FORMAT_CHARS<close-paren>`
        // call is the regression we forbid).
        expect(src).not.toMatch(/\.replace\(\s*UNICODE_FORMAT_CHARS\s*,/);
    });
});
