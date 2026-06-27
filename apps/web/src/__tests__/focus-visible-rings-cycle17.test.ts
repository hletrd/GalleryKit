/**
 * Cycle-17 designer fix: WCAG 2.4.11 Focus Appearance regression lock.
 *
 * Three components received focus-visible ring upgrades in R17C17 to meet
 * the WCAG 2.4.11 minimum (≥2 px, ≥3:1 contrast):
 *
 *  1. lightbox-color-pip.tsx — DCI-P3 tooltip trigger (line ~219):
 *       `ring-1 ring-white/50`  →  `ring-2 ring-white`
 *  2. lightbox-color-pip.tsx — copy-colour-metadata button (line ~301):
 *       `ring-1 ring-white/50`  →  `ring-2 ring-white`
 *  3. nav-client.tsx — mobile hamburger toggle (line ~96):
 *       no focus ring at all  →  `focus-visible:ring-2 focus-visible:ring-ring
 *                                  focus-visible:ring-offset-2`
 *  4. wide-gamut-hint.tsx — dismiss button (line ~203):
 *       `ring-amber-500/40`  →  `ring-amber-600`  (full-opacity, ≥3:1)
 *
 * None of these changes had a dedicated regression test, so a future
 * clean-up pass or className consolidation could silently revert them
 * without breaking any existing test (the prior `ring-1 ring-white/50`
 * values would re-emerge undetected).
 *
 * Strategy: source-contract tests that assert the correct post-cycle-17
 * class string is present AND that the weaker pre-cycle-17 value is
 * absent from the element's className, so a revert fails on both the
 * positive and the negative assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PIP_PATH = resolve(__dirname, '../components/lightbox-color-pip.tsx');
const NAV_PATH = resolve(__dirname, '../components/nav-client.tsx');
const WGH_PATH = resolve(__dirname, '../components/wide-gamut-hint.tsx');

const pipSrc = readFileSync(PIP_PATH, 'utf8');
const navSrc = readFileSync(NAV_PATH, 'utf8');
const wghSrc = readFileSync(WGH_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 1 + 2. lightbox-color-pip.tsx — two buttons share the same fix
// ---------------------------------------------------------------------------
describe('lightbox-color-pip.tsx focus-visible ring (R17C17 WCAG 2.4.11)', () => {
    it('DCI-P3 tooltip trigger uses ring-2 (≥2 px floor)', () => {
        // The tooltip trigger carries `colorPipelineP3FromDcip3Tooltip` in its
        // aria-label. Its className must have `focus-visible:ring-2` (not ring-1).
        // We find the aria-label string and then check that the nearest preceding
        // className on that element carries ring-2 rather than ring-1.
        const tooltipAnchor = 'colorPipelineP3FromDcip3Tooltip';
        const idx = pipSrc.indexOf(tooltipAnchor);
        expect(idx).toBeGreaterThan(-1);
        // The className appears before the aria-label in JSX attribute order.
        const surrounding = pipSrc.slice(Math.max(0, idx - 600), idx + 50);
        expect(surrounding).toContain('focus-visible:ring-2');
        expect(surrounding).toContain('focus-visible:ring-white');
        // Pre-cycle-17 values must be absent from this element block.
        expect(surrounding).not.toContain('ring-1');
        expect(surrounding).not.toContain('ring-white/50');
    });

    it('copy-colour-metadata button uses ring-2 (≥2 px floor)', () => {
        // The copy button's aria-label references the i18n key 'viewer.copyColorMetadata'.
        // Use that string as the anchor — it only appears in the JSX aria-label attribute,
        // not in the function definition that also uses the bare name 'copyColorMetadata'.
        // JSX attribute order is: onClick → className → aria-label, so the className
        // is ~1–2 lines BEFORE the anchor; a 400-char backward window captures it.
        const copyAnchor = "viewer.copyColorMetadata";
        const idx = pipSrc.indexOf(copyAnchor);
        expect(idx).toBeGreaterThan(-1);
        const surrounding = pipSrc.slice(Math.max(0, idx - 400), idx + 50);
        expect(surrounding).toContain('focus-visible:ring-2');
        expect(surrounding).toContain('focus-visible:ring-white');
        expect(surrounding).not.toContain('ring-1');
        expect(surrounding).not.toContain('ring-white/50');
    });

    it('the weaker ring-1 / ring-white/50 pair is absent from the entire file', () => {
        // Belt-and-braces: confirm no element in the file still uses the
        // pre-cycle-17 thin+translucent combination.
        expect(pipSrc).not.toMatch(/focus-visible:ring-1/);
        expect(pipSrc).not.toMatch(/focus-visible:ring-white\/50/);
    });
});

// ---------------------------------------------------------------------------
// 3. nav-client.tsx — mobile hamburger toggle
// ---------------------------------------------------------------------------
describe('nav-client.tsx mobile hamburger focus-visible ring (R17C17 WCAG 2.4.11)', () => {
    it('hamburger toggle button carries focus-visible:ring-2', () => {
        // The hamburger button has an `aria-expanded` attribute. Find its
        // className and assert focus-visible:ring-2 is present.
        const expandedAnchor = 'aria-expanded={isExpanded}';
        const idx = navSrc.indexOf(expandedAnchor);
        expect(idx).toBeGreaterThan(-1);
        // className is declared before aria-expanded.
        const surrounding = navSrc.slice(Math.max(0, idx - 800), idx + 50);
        expect(surrounding).toContain('focus-visible:ring-2');
    });

    it('hamburger toggle button uses the ring-ring design-token (consistent with design system)', () => {
        const expandedAnchor = 'aria-expanded={isExpanded}';
        const idx = navSrc.indexOf(expandedAnchor);
        const surrounding = navSrc.slice(Math.max(0, idx - 800), idx + 50);
        expect(surrounding).toContain('focus-visible:ring-ring');
    });

    it('hamburger toggle button carries focus-visible:ring-offset-2 for contrast against the nav surface', () => {
        const expandedAnchor = 'aria-expanded={isExpanded}';
        const idx = navSrc.indexOf(expandedAnchor);
        const surrounding = navSrc.slice(Math.max(0, idx - 800), idx + 50);
        expect(surrounding).toContain('focus-visible:ring-offset-2');
    });
});

// ---------------------------------------------------------------------------
// 3b. nav-client.tsx — theme toggle + locale switch (R18C18 CR-18-1 / D18-01)
//
// The cycle-17 fix added a focus-visible ring to the mobile hamburger only;
// the two sibling control buttons in #primary-nav-controls (theme toggle and
// locale switch) were missed and shipped with hover-only styles (no keyboard
// focus indicator, WCAG 2.4.7). Cycle-18 adds the same ring to both. These
// assertions fail if either ring is reverted.
// ---------------------------------------------------------------------------
describe('nav-client.tsx theme + locale focus-visible rings (R18C18 WCAG 2.4.7)', () => {
    it('theme toggle button carries the focus-visible ring-2 / ring-ring pair', () => {
        // className precedes aria-label={t('aria.toggleTheme')} in JSX order.
        const idx = navSrc.indexOf("aria.toggleTheme");
        expect(idx).toBeGreaterThan(-1);
        const surrounding = navSrc.slice(Math.max(0, idx - 400), idx + 50);
        expect(surrounding).toContain('focus-visible:ring-2');
        expect(surrounding).toContain('focus-visible:ring-ring');
        expect(surrounding).toContain('focus-visible:ring-offset-2');
    });

    it('locale switch button carries the focus-visible ring-2 / ring-ring pair', () => {
        // className precedes aria-label={t('aria.switchLocale', …)} in JSX order.
        const idx = navSrc.indexOf("aria.switchLocale");
        expect(idx).toBeGreaterThan(-1);
        const surrounding = navSrc.slice(Math.max(0, idx - 400), idx + 50);
        expect(surrounding).toContain('focus-visible:ring-2');
        expect(surrounding).toContain('focus-visible:ring-ring');
        expect(surrounding).toContain('focus-visible:ring-offset-2');
    });
});

// ---------------------------------------------------------------------------
// 4. wide-gamut-hint.tsx — dismiss button
// ---------------------------------------------------------------------------
describe('wide-gamut-hint.tsx dismiss button focus-visible ring (R17C17 WCAG 2.4.11)', () => {
    it('dismiss button uses ring-amber-600 (full opacity, ≥3:1 contrast)', () => {
        // The dismiss button's JSX attribute order is: type → onClick → aria-label → className.
        // The className appears on the line AFTER the aria-label anchor, so look FORWARD
        // from the anchor (idx to idx + 400 covers one long className line).
        const dismissAnchor = 'wideGamutHintDismiss';
        const idx = wghSrc.indexOf(dismissAnchor);
        expect(idx).toBeGreaterThan(-1);
        const surrounding = wghSrc.slice(idx, idx + 400);
        expect(surrounding).toContain('focus-visible:ring-amber-600');
    });

    it('dismiss button does NOT use the semi-transparent ring-amber-500/40 (below WCAG contrast floor)', () => {
        // ring-amber-500/40 is 40% opacity amber-on-amber — fails WCAG 2.4.11 3:1 ratio.
        const dismissAnchor = 'wideGamutHintDismiss';
        const idx = wghSrc.indexOf(dismissAnchor);
        const surrounding = wghSrc.slice(idx, idx + 400);
        expect(surrounding).not.toContain('ring-amber-500');
    });
});
