/**
 * R20C20 designer findings — WCAG 2.4.7 / 2.4.11 focus-appearance regression
 * locks for the controls fixed this cycle (the recurring "fix one sibling, miss
 * the next" pattern: these are the `<Link>`/`<a>` siblings adjacent to controls
 * already hardened in cycles 17-19).
 *
 *  D20-01  nav-client topic pills + admin-nav section links had no
 *          focus-visible ring (their sibling buttons were fixed earlier).
 *  D20-02  lightbox-color-pip inner expanded-panel buttons used a flush
 *          `ring-white` with no ring-offset (WCAG 2.4.11 enclosing gap).
 *  D20-03  timeline year scrubber pills + the year-in-review link had no
 *          focus-visible ring.
 *  D20-04  g/[key] "View Gallery" back-link (both branches) had no
 *          focus-visible ring.
 *
 * Source-contract tests (mirrors focus-visible-rings-cycle19.test.ts): assert the
 * corrected class is present so a revert fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

const navClientSrc = read('../components/nav-client.tsx');
const adminNavSrc = read('../components/admin-nav.tsx');
const pipSrc = read('../components/lightbox-color-pip.tsx');
const timelineSrc = read('../app/[locale]/(public)/timeline/page.tsx');
const sharedGroupSrc = read('../app/[locale]/(public)/g/[key]/page.tsx');

describe('D20-01 nav Links carry a focus-visible ring', () => {
    it('nav-client topic pill uses the ring-ring token', () => {
        expect(navClientSrc).toContain('focus-visible:ring-ring');
        expect(navClientSrc).toContain('focus-visible:ring-offset-2');
    });
    it('admin-nav section link uses the ring-ring token', () => {
        expect(adminNavSrc).toContain('focus-visible:ring-ring');
        expect(adminNavSrc).toContain('focus-visible:ring-offset-2');
    });
});

describe('D20-02 lightbox-color-pip inner buttons have an enclosing ring offset', () => {
    it('both ring-white inner buttons now carry a ring offset (no flush ring)', () => {
        const offsets = pipSrc.match(/focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/g) ?? [];
        expect(offsets.length).toBeGreaterThanOrEqual(2);
        // No bare ring-white without an offset should remain.
        expect(pipSrc).not.toMatch(/focus-visible:ring-white(?!\s+focus-visible:ring-offset)/);
    });
});

describe('D20-03 timeline year navigation Links carry a focus-visible ring', () => {
    it('year scrubber pill + year-in-review link both use the ring-ring token', () => {
        const matches = timelineSrc.match(/focus-visible:ring-ring/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});

describe('D20-04 shared-group back-link carries a focus-visible ring', () => {
    it('the View Gallery back-link (both branches) uses the ring-ring token', () => {
        const matches = sharedGroupSrc.match(/focus-visible:ring-ring/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});
