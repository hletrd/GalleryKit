/**
 * R4C6 lightbox interaction cluster — source contracts.
 *
 * UX-R4C6-03: the hide timer must consult `:focus-visible` (keyboard
 * modality) instead of the always-true `contains(document.activeElement)`
 * keepalive that made auto-hide dead, and must blur a pointer-focused
 * control before hiding. C32-A11Y keeps essential controls in the
 * accessibility tree while the visual overlay is idle-hidden.
 * A11Y-R4C6-04: the lightbox <img> must NOT carry an aria-label — it
 * would win accessible-name computation over the descriptive alt text.
 * COR-R4C6-12: the Space branch must consult isEditableTarget BEFORE
 * preventDefault.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
    resolve(__dirname, '../components/lightbox.tsx'),
    'utf-8',
);
const PIP_SRC = readFileSync(
    resolve(__dirname, '../components/lightbox-color-pip.tsx'),
    'utf-8',
);

describe('lightbox hide-timer focus modality (UX-R4C6-03)', () => {
    it('consults :focus-visible in the shared hide terminal', () => {
        expect(SRC).toMatch(/active\.matches\(':focus-visible'\)/);
    });

    it('blurs a pointer-focused control before hiding (WCAG 4.1.2)', () => {
        const matchesIdx = SRC.indexOf(":focus-visible'");
        const blurIdx = SRC.indexOf('active.blur()');
        expect(matchesIdx).toBeGreaterThan(-1);
        expect(blurIdx).toBeGreaterThan(matchesIdx);
    });

    it('no hide timer keeps controls via the bare contains(activeElement) keepalive', () => {
        // The dead-auto-hide shape: contains(document.activeElement)
        // immediately deciding to keep controls visible. The only allowed
        // contains() use is inside hideControlsRespectingFocus where it
        // feeds the :focus-visible decision.
        const containsUses = SRC.match(/contains\(document\.activeElement\)/g) ?? [];
        expect(containsUses.length).toBeLessThanOrEqual(1);
        const timerArms = SRC.match(/setTimeout\(hideControlsRespectingFocus, 3000\)/g) ?? [];
        expect(timerArms.length).toBe(2);
    });

    it('closes and removes the color pip from tab order when controls auto-hide', () => {
        expect(SRC).toContain('setColorPipOpen(false)');
        expect(SRC).toContain('interactive={controlsVisible}');
    });

    it('disables color-pip pointer and click handling when controls auto-hide', () => {
        expect(PIP_SRC).toContain("interactive ? 'pointer-events-auto' : 'pointer-events-none'");
        expect(PIP_SRC).toContain('onClick={interactive ? onToggle : undefined}');
        expect(PIP_SRC).toContain('aria-hidden={!interactive}');
    });

    it('does not remove essential controls from the accessibility tree during idle visual hide', () => {
        expect(SRC).toContain('const controlVisibilityProps = {};');
        expect(SRC).not.toContain("'aria-hidden': true as const");
        expect(SRC).not.toContain('tabIndex: -1,');
    });
});

describe('lightbox <img> accessible name (A11Y-R4C6-04)', () => {
    it('the slide <img> carries alt but no aria-label', () => {
        // Isolate the <img ...> opening tag inside the <picture> block.
        const pictureIdx = SRC.indexOf('<picture');
        const imgIdx = SRC.indexOf('<img', pictureIdx);
        const imgEnd = SRC.indexOf('/>', imgIdx);
        const imgTag = SRC.slice(imgIdx, imgEnd);
        expect(imgTag).toMatch(/alt=\{getConcisePhotoAltText/);
        expect(imgTag).not.toMatch(/aria-label/);
    });
});

describe('lightbox Space branch ordering (COR-R4C6-12)', () => {
    it('ignores repeated shortcut keydown events before toggling or navigating', () => {
        const handlerIdx = SRC.indexOf('const handleKeyDown = (e: KeyboardEvent) => {');
        expect(handlerIdx).toBeGreaterThan(-1);
        const handler = SRC.slice(handlerIdx, handlerIdx + 2600);
        const repeatIdx = handler.indexOf('if (e.repeat) return;');
        expect(repeatIdx).toBeGreaterThan(-1);
        expect(repeatIdx).toBeLessThan(handler.indexOf("e.key === ' '"));
        expect(repeatIdx).toBeLessThan(handler.indexOf("e.key === 'ArrowLeft'"));
        expect(repeatIdx).toBeLessThan(handler.indexOf("e.key === 'ArrowRight'"));
    });

    it('isEditableTarget precedes preventDefault in the Space branch', () => {
        const spaceIdx = SRC.indexOf("e.key === ' '");
        expect(spaceIdx).toBeGreaterThan(-1);
        const branch = SRC.slice(spaceIdx, spaceIdx + 600);
        const guardIdx = branch.indexOf('isEditableTarget(e)');
        const preventIdx = branch.indexOf('e.preventDefault()');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(preventIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(preventIdx);
    });
});
