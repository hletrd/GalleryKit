/**
 * Run-6 Cycle 1 AGG-4 — `sanitizeForOg` must replace-ALL Unicode formatting
 * chars, never just the first.
 *
 * Both the OG image route (`api/og/photo/[id]/route.tsx`) and the photo page
 * (`(public)/p/[id]/page.tsx`) define a local `sanitizeForOg` that scrubs
 * bidi/zero-width chars from values embedded into the public OG card and the
 * JSON-LD structured data. They previously used
 *   value.replace(UNICODE_FORMAT_CHARS, '')
 * but UNICODE_FORMAT_CHARS (validation.ts) carries no `/g` flag, so `.replace()`
 * strips only the FIRST match — a camera_model like "A<RLO><ZWSP>bc" leaked the
 * 2nd+ chars into public output (Trojan-Source visual-spoofing surface).
 *
 * The fix routes both through `stripUnicodeFormatting` (the global-flag twin).
 * This fixture-style guard pins the contract two ways:
 *   1. behaviorally — the underlying global strip removes MULTIPLE occurrences;
 *   2. structurally — neither route/page file may reintroduce the non-global
 *      `.replace(UNICODE_FORMAT_CHARS` call form (only comments may mention it).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripUnicodeFormatting } from '@/lib/validation';

const RLO = String.fromCharCode(0x202e); // right-to-left override
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const LRI = String.fromCharCode(0x2066); // left-to-right isolate

describe('AGG-4: sanitizeForOg strips ALL Unicode formatting chars', () => {
    it('global strip removes multiple bidi/zero-width occurrences (not just the first)', () => {
        const dangerous = `A${RLO}b${ZWSP}c${LRI}d`;
        const cleaned = stripUnicodeFormatting(dangerous);
        expect(cleaned).toBe('Abcd');
    });

    it.each([
        'src/app/api/og/photo/[id]/route.tsx',
        'src/app/[locale]/(public)/p/[id]/page.tsx',
    ])('%s routes sanitizeForOg through the global stripUnicodeFormatting', (rel) => {
        const src = readFileSync(join(process.cwd(), rel), 'utf8');
        // It must import + use the global-strip helper.
        expect(src).toContain('stripUnicodeFormatting');
        // It must NOT call the non-global form (comments referencing the old
        // pattern are fine; an actual `.replace(UNICODE_FORMAT_CHARS<close-paren>`
        // call is the regression we forbid).
        expect(src).not.toMatch(/\.replace\(\s*UNICODE_FORMAT_CHARS\s*,/);
    });
});
