/**
 * Cycle 1 (2026-07-06) WP7 — a11y fixes from the designer review
 * (.context/reviews/cycle-1-2026-07-06/designer.md DES-01/DES-02/DES-03).
 *
 *  C1-08  six admin/auth forms disable their submit control while
 *         `isPending`, which drops keyboard focus to `<body>` and never
 *         restores it. Fixed with a shared `useRestoreFocusAfterPending`
 *         hook wired into each form's submit control(s).
 *  C1-09  the Timeline and Year-in-Review month headings concatenated the
 *         month/year text directly against the photo-count span with no
 *         text-node separator, producing a run-on accessible name (e.g.
 *         "January 20252 photos"). Fixed by adding an explicit `{' · '}`
 *         text node between the two.
 *  C1-10  the Tokens admin page had zero heading elements, and the Users
 *         admin page started at `<h2>` with no `<h1>` above it, breaking
 *         the per-page `h1 = page name` convention every sibling admin page
 *         follows. Fixed by adding a page-level `<h1>`.
 *
 * These are source-contract tests (mirrors the established pattern in
 * `data-tag-names-sql.test.ts` / `focus-visible-rings-cycle20.test.ts`):
 * they assert the fix is present in the committed source so a revert or a
 * copy-paste regression on a sibling file fails the suite.
 *
 * Hook behavior note: the repo's vitest config runs under the default
 * `node` environment with no `jsdom`/`happy-dom` and no
 * `@testing-library/react` dependency (checked: neither appears in
 * apps/web/package.json, and no test file carries a
 * `@vitest-environment` docblock override). `useRestoreFocusAfterPending`
 * calls `useEffect`/`useRef` (invalid outside a React render) and reads
 * `document.activeElement`/`document.body` (undefined in a `node`
 * environment), so it cannot be exercised as a real behavior test without
 * adding a new test dependency. Per the task spec's fallback, the hook is
 * covered by source-contract assertions only (below) — not a DOM-driven
 * behavior test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

const hookSrc = read('../lib/use-restore-focus-after-pending.ts');
const loginFormSrc = read('../app/[locale]/admin/login-form.tsx');
const passwordFormSrc = read('../app/[locale]/admin/(protected)/password/password-form.tsx');
const settingsClientSrc = read('../app/[locale]/admin/(protected)/settings/settings-client.tsx');
const seoClientSrc = read('../app/[locale]/admin/(protected)/seo/seo-client.tsx');
const tokensClientSrc = read('../app/[locale]/admin/(protected)/tokens/tokens-client.tsx');
const dbPageSrc = read('../app/[locale]/admin/(protected)/db/page.tsx');

const timelineSrc = read('../app/[locale]/(public)/timeline/page.tsx');
const yearPageSrc = read('../app/[locale]/(public)/year/[year]/page.tsx');

const tokensPageSrc = read('../app/[locale]/admin/(protected)/tokens/page.tsx');
const usersPageSrc = read('../app/[locale]/admin/(protected)/users/page.tsx');

const IMPORT_RE = /useRestoreFocusAfterPending/;
const CALL_RE = /useRestoreFocusAfterPending\(/;

describe('C1-08 shared focus-restore hook exists with the documented contract', () => {
    it('exports useRestoreFocusAfterPending accepting a ref and isPending', () => {
        expect(hookSrc).toMatch(/export function useRestoreFocusAfterPending/);
        expect(hookSrc).toContain('RefObject<HTMLElement | null>');
        expect(hookSrc).toContain('isPending: boolean');
    });

    it('only restores focus on a true -> false transition', () => {
        // The effect must diff against the previous isPending value rather
        // than firing on every render (including the initial one, and
        // every re-render while still pending).
        expect(hookSrc).toMatch(/wasPendingRef/);
        expect(hookSrc).toMatch(/if \(!wasPending \|\| isPending\) return;/);
    });

    it('never steals focus the user moved on purpose', () => {
        expect(hookSrc).toMatch(/document\.activeElement/);
        expect(hookSrc).toMatch(/active === document\.body \|\| active === null/);
    });
});

describe('C1-08 the six admin/auth forms wire the shared hook to their submit control(s)', () => {
    const forms: Array<[string, string]> = [
        ['login-form.tsx', loginFormSrc],
        ['password-form.tsx', passwordFormSrc],
        ['settings-client.tsx', settingsClientSrc],
        ['seo-client.tsx', seoClientSrc],
        ['tokens-client.tsx', tokensClientSrc],
        ['db/page.tsx', dbPageSrc],
    ];

    it.each(forms)('%s imports and calls useRestoreFocusAfterPending, and attaches a ref to a submit control', (_name, src) => {
        expect(src).toMatch(IMPORT_RE);
        expect(src).toMatch(CALL_RE);
        // At least one submit control forwards a ref for the hook to target.
        expect(src).toMatch(/ref={\w+ButtonRef}/);
    });
});

describe('C1-09 Timeline and Year-in-Review month headings carry a real text separator', () => {
    it('timeline/page.tsx inserts a literal separator text node before the photo-count span', () => {
        const idx = timelineSrc.indexOf("{' · '}");
        const countIdx = timelineSrc.indexOf('photosCount');
        expect(idx).toBeGreaterThan(-1);
        expect(countIdx).toBeGreaterThan(-1);
        expect(idx).toBeLessThan(countIdx);
    });

    it('year/[year]/page.tsx inserts a literal separator text node before the photo-count span', () => {
        const idx = yearPageSrc.indexOf("{' · '}");
        const countIdx = yearPageSrc.indexOf('photosCount');
        expect(idx).toBeGreaterThan(-1);
        expect(countIdx).toBeGreaterThan(-1);
        expect(idx).toBeLessThan(countIdx);
    });
});

describe('C1-10 Tokens and Users admin pages render a page-level <h1>', () => {
    it('tokens/page.tsx has an <h1>', () => {
        expect(tokensPageSrc).toMatch(/<h1[\s>]/);
    });

    it('users/page.tsx has an <h1>', () => {
        expect(usersPageSrc).toMatch(/<h1[\s>]/);
    });
});
