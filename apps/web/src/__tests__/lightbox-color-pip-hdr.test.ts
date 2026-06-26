/**
 * C5-A2 / C5-COL-LOW-1 / C5-COL-MED-1: lock the lightbox color pip HDR
 * gating + single-render contract in the standalone
 * `lightbox-color-pip.tsx` (P4-C4 extracted from `lightbox.tsx`).
 * Source-inspection fixture (project convention — same pattern as
 * `color-details-section-delivered.test.ts`) over the
 * `LightboxColorPip` function.
 *
 * Locks two cross-cycle invariants:
 * 1. HDR badge is gated on `transfer_function === 'pq' || 'hlg'` rather
 *    than `image.is_hdr` — harmonized with the sidebar accordion gate
 *    (`color-details-section.tsx:88`) in cycle-4 commit `d093cd23`
 *    (C4-A3).
 * 2. The HDR badge renders exactly ONCE inside `LightboxColorPip` —
 *    inside the closed-pip chip button. The expanded panel must NOT
 *    contain a duplicate "label / value" row that re-renders the same
 *    HDR pill (cycle-5 commit C5-A1).
 *
 * Without these locks, a future refactor could regress to either the
 * pre-cycle-4 `is_hdr` gate (which would still work today thanks to the
 * schema invariant `is_hdr === transfer_function in ('pq', 'hlg')`, but
 * would silently misbehave when HDR10+ / Dolby Vision transfer values
 * are added to the schema), or the pre-cycle-5 doubled HDR row.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_PATH = resolve(__dirname, '../components/lightbox-color-pip.tsx');
const SOURCE = readFileSync(SRC_PATH, 'utf8');

/**
 * Extract the body of `function LightboxColorPip(...) { ... }` so the
 * assertions only inspect the pip and not unrelated parts of `lightbox.tsx`
 * (e.g. an unrelated future re-introduction of `image.is_hdr` in the
 * outer Lightbox component would not falsely fail this test).
 */
function getLightboxColorPipBody(source: string): string {
    const startMarker = 'function LightboxColorPip';
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) {
        throw new Error('LightboxColorPip declaration not found in lightbox.tsx');
    }
    // Skip past the `(...)` parameter list (which itself contains a
    // destructure pattern with `{...}` braces) before searching for the
    // body's `{`. Balance parens to locate the parameter-list close.
    const openParenIdx = source.indexOf('(', startIdx);
    if (openParenIdx === -1) {
        throw new Error('LightboxColorPip parameter-list open-paren not found');
    }
    let parenDepth = 0;
    let bodyOpenIdx = -1;
    for (let i = openParenIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        else if (ch === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                // After the close-paren we may have a `: ReturnType` annotation
                // before the body's `{`. Search forward for the next `{`.
                bodyOpenIdx = source.indexOf('{', i);
                break;
            }
        }
    }
    if (bodyOpenIdx === -1) {
        throw new Error('LightboxColorPip body open-brace not found after parameter list');
    }
    // Now balance braces from the body open to find its close.
    let depth = 0;
    for (let i = bodyOpenIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(bodyOpenIdx, i + 1);
            }
        }
    }
    throw new Error('LightboxColorPip body close-brace not found');
}

const PIP_BODY = getLightboxColorPipBody(SOURCE);

describe('LightboxColorPip — HDR gating + single-render (C5-A2)', () => {
    describe('HDR gate is transfer_function-driven (C4-A3 harmonization lock)', () => {
        it('uses image.transfer_function pq/hlg comparison', () => {
            // The cycle-4 C4-A3 commit harmonized the gate. Locking
            // against drift back to `image.is_hdr`.
            expect(PIP_BODY).toMatch(
                /image\.transfer_function\s*===\s*'pq'\s*\|\|\s*image\.transfer_function\s*===\s*'hlg'/,
            );
        });

        it('does NOT gate the HDR badge on image.is_hdr inside the pip', () => {
            // Search for `image.is_hdr` inside the pip body. Allowed if
            // future code uses it for non-HDR-badge purposes (none today),
            // so we only fail if it appears as a gate condition.
            // The pre-C4-A3 code shape was `if (image.is_hdr)`.
            const hasIsHdrGate =
                /\bimage\.is_hdr\b/.test(PIP_BODY) &&
                !/\/\/[^\n]*is_hdr/.test(PIP_BODY);
            expect(hasIsHdrGate).toBe(false);
        });

        it('gates the rendered HDR badge on `isAdmin && isHdr` (AGG-M3 honesty invariant)', () => {
            // AGG-M3 (run-6 cycle-2): the WI-09 honesty invariant ("the public
            // never sees an HDR badge whose bytes don't fulfill it") must be an
            // explicit isAdmin gate at the render point, not an indirect
            // transfer_function-nullness coincidence. Lock that the rendered
            // `hdr-badge` span is preceded by an `isAdmin && isHdr` condition.
            expect(PIP_BODY).toMatch(/isAdmin\s*&&\s*isHdr\s*&&[\s\S]{0,120}hdr-badge/);
        });
    });

    describe('HDR badge renders exactly once (C5-A1 single-render lock)', () => {
        it('contains exactly one `hdr-badge` className occurrence', () => {
            // Cycle-4 had two: one in the chip, one in the expanded panel.
            // Cycle-5 dropped the panel one. Lock the count at exactly 1.
            const matches = PIP_BODY.match(/hdr-badge/g) ?? [];
            expect(matches.length).toBe(1);
        });

        it('HDR badge is aria-hidden (R5-M4: info conveyed via button aria-label)', () => {
            // R5-M4 moved the accessible description from the badge's
            // standalone aria-label into the parent button's aria-label.
            // The badge itself is now aria-hidden so screen readers don't
            // encounter it as a separate img node.
            expect(PIP_BODY).toMatch(/hdr-badge[\s\S]{0,200}aria-hidden="true"/);
            expect(PIP_BODY).not.toMatch(/hdr-badge[\s\S]{0,200}aria-label=/);
        });

        it('button aria-label includes HDR status for screen readers (R5-M4)', () => {
            // The button aria-label must contain the HDR badge text so
            // screen reader users learn the photo is HDR-capable.
            expect(PIP_BODY).toMatch(
                /aria-label=\{`\$\{t\('aria\.toggleColorPip'\)\}:[\s\S]{0,400}viewer\.hdrBadge/,
            );
        });

        it('does NOT contain a panel-internal HDR label/value row', () => {
            // The cycle-4 pre-C5-A1 panel rendered a label/value row:
            //   <span className="opacity-70">{t('viewer.hdrBadge')}</span>
            //   <span className="hdr-badge ...">HDR</span>
            // Search for `viewer.hdrBadge` followed shortly by a `hdr-badge`
            // className. If present, the panel-internal row has crept back in.
            const panelRowPattern = /t\('viewer\.hdrBadge'\)[\s\S]{0,400}hdr-badge/;
            expect(panelRowPattern.test(PIP_BODY)).toBe(false);
        });
    });

    describe('R9-M8: DCI-P3 Bradford tooltip in expanded panel', () => {
        it('renders info button + tooltip when color_pipeline_decision is p3-from-dcip3', () => {
            expect(PIP_BODY).toContain("image.color_pipeline_decision === 'p3-from-dcip3'");
            expect(PIP_BODY).toContain("viewer.colorPipelineP3FromDcip3Tooltip");
            expect(PIP_BODY).toMatch(/<Info\s+className="h-3\s+w-3"\s*\/>/);
        });

        it('places the tooltip inside the colorPipelineDecision row', () => {
            // The tooltip trigger must be nested inside the pipeline-decision
            // value span, not as a standalone row.
            const pipelineRowIdx = PIP_BODY.indexOf("t('viewer.colorPipelineDecision')");
            const tooltipIdx = PIP_BODY.indexOf("image.color_pipeline_decision === 'p3-from-dcip3'");
            expect(pipelineRowIdx).toBeGreaterThan(-1);
            expect(tooltipIdx).toBeGreaterThan(-1);
            expect(tooltipIdx).toBeGreaterThan(pipelineRowIdx);
        });
    });

    describe('R10-L20: delivered bit depth + format chips in expanded panel', () => {
        it('renders delivered bit depth row gated on color_pipeline_decision or color_primaries', () => {
            expect(PIP_BODY).toContain("t('viewer.deliveredBitDepth')");
            expect(PIP_BODY).toMatch(/\(image\.color_pipeline_decision\s*\|\|\s*image\.color_primaries\)/);
        });

        it('renders delivered formats row gated on at least one filename', () => {
            expect(PIP_BODY).toContain("t('viewer.deliveredFormats')");
            expect(PIP_BODY).toMatch(/image\.filename_webp\s*\|\|\s*image\.filename_avif\s*\|\|\s*image\.filename_jpeg/);
        });

        it('branches delivered bit depth on isP3Pipeline and avif_10bit', () => {
            expect(PIP_BODY).toContain('isP3Pipeline(decision)');
            expect(PIP_BODY).toContain('image.avif_10bit === true');
            expect(PIP_BODY).toContain("t('viewer.deliveredBitDepthP3',");
            expect(PIP_BODY).toContain("t('viewer.deliveredBitDepthP3Fallback',");
            expect(PIP_BODY).toContain("t('viewer.deliveredBitDepthSrgb')");
        });

        it('renders format chips with conditional gamut annotations', () => {
            expect(PIP_BODY).toMatch(/name:\s*'WebP'/);
            expect(PIP_BODY).toMatch(/name:\s*'AVIF'/);
            expect(PIP_BODY).toMatch(/name:\s*'JPEG'/);
        });

        it('places delivered rows before the histogram in the panel', () => {
            const deliveredBitDepthIdx = PIP_BODY.indexOf("t('viewer.deliveredBitDepth')");
            const deliveredFormatsIdx = PIP_BODY.indexOf("t('viewer.deliveredFormats')");
            const histogramIdx = PIP_BODY.indexOf('<Histogram');
            expect(deliveredBitDepthIdx).toBeGreaterThan(-1);
            expect(deliveredFormatsIdx).toBeGreaterThan(-1);
            expect(histogramIdx).toBeGreaterThan(-1);
            expect(deliveredBitDepthIdx).toBeLessThan(histogramIdx);
            expect(deliveredFormatsIdx).toBeLessThan(histogramIdx);
        });
    });

    describe('hasData short-circuit (existing pip contract)', () => {
        it('returns null when no color signals are present, with admin-only fields isAdmin-gated (C14-02)', () => {
            // Lock the early return so a refactor cannot silently render
            // an empty pip on photos with no color metadata, AND lock the
            // C14-02 defense-in-depth gating: the admin-only `transfer_function`
            // / `color_pipeline_decision` terms must be wrapped in `isAdmin &&`
            // (matching the sibling color-details-section.tsx), so `hasData` is
            // driven only by the public `color_primaries` for non-admin viewers.
            expect(PIP_BODY).toMatch(
                /const\s+hasData\s*=\s*Boolean\s*\(\s*image\.color_primaries\s*\|\|\s*\(\s*isAdmin\s*&&\s*image\.transfer_function\s*\)\s*\|\|\s*\(\s*isAdmin\s*&&\s*image\.color_pipeline_decision\s*\)\s*\)/,
            );
            expect(PIP_BODY).toMatch(/if\s*\(\s*!hasData\s*\)\s*return\s+null/);
        });
    });
});
