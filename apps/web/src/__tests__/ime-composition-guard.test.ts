/**
 * R4C6 COR-R4C6-01: IME composition guards.
 *
 * Unit half: the two helper shapes (native + React-synthetic).
 * Contract half: every Enter/Arrow text-input handler surface consults
 * the guard BEFORE acting, so a future edit cannot silently reintroduce
 * the composition-commit-submits bug for Korean (and any CJK) input.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isImeComposingNativeEvent, isImeComposingReactEvent } from '@/lib/ime';

const read = (rel: string) =>
    readFileSync(resolve(__dirname, '..', rel), 'utf-8');

describe('isImeComposingNativeEvent (unit)', () => {
    it('true while composing (isComposing flag)', () => {
        expect(isImeComposingNativeEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    });

    it('true for the legacy keyCode 229 signal (Safari commit Enter)', () => {
        expect(isImeComposingNativeEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    });

    it('false for a plain Enter outside composition', () => {
        expect(isImeComposingNativeEvent({ isComposing: false, keyCode: 13 })).toBe(false);
    });

    it('false for a plain arrow key outside composition', () => {
        expect(isImeComposingNativeEvent({ isComposing: false, keyCode: 40 })).toBe(false);
    });
});

describe('isImeComposingReactEvent (unit)', () => {
    it('delegates to nativeEvent (composing)', () => {
        expect(isImeComposingReactEvent({ nativeEvent: { isComposing: true, keyCode: 13 } })).toBe(true);
    });

    it('delegates to nativeEvent (keyCode 229)', () => {
        expect(isImeComposingReactEvent({ nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(true);
    });

    it('false for a settled keydown', () => {
        expect(isImeComposingReactEvent({ nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false);
    });
});

/**
 * Source contracts: the guard must be consulted BEFORE the first key
 * branch in each handler. We pin "guard call index < first key-check
 * index" within the relevant handler region rather than full AST
 * analysis — cheap, and any reordering or removal fails loud.
 */
describe('IME guard source contracts (R4C6 COR-R4C6-01)', () => {
    const surfaces: Array<{ file: string; guard: RegExp; firstAction: RegExp }> = [
        {
            file: 'components/tag-input.tsx',
            guard: /if \(isImeComposingReactEvent\(e\)\) return;/,
            firstAction: /e\.key === 'Backspace'/,
        },
        {
            file: 'components/search.tsx',
            guard: /if \(isImeComposingReactEvent\(e\)\) return;/,
            firstAction: /e\.key === 'ArrowDown'/,
        },
        {
            file: 'components/image-manager.tsx',
            guard: /if \(isImeComposingReactEvent\(e\)\) return;/,
            firstAction: /void handleBatchAddTag\(\)/,
        },
        {
            file: 'app/[locale]/admin/(protected)/categories/topic-manager.tsx',
            guard: /if \(isImeComposingReactEvent\(e\)\) return;/,
            firstAction: /handleAddAlias\(editingTopic\.slug\)/,
        },
        {
            file: 'app/[locale]/admin/(protected)/tokens/tokens-client.tsx',
            guard: /if \(isImeComposingReactEvent\(e\)\) return;/,
            firstAction: /handleCreate\(\);/,
        },
    ];

    for (const { file, guard, firstAction } of surfaces) {
        it(`${file} consults the React guard before acting`, () => {
            const src = read(file);
            const guardIdx = src.search(guard);
            const actionIdx = src.search(firstAction);
            expect(guardIdx, `guard missing in ${file}`).toBeGreaterThan(-1);
            expect(actionIdx, `expected action anchor missing in ${file}`).toBeGreaterThan(-1);
            expect(guardIdx, `guard must precede the key handling in ${file}`).toBeLessThan(actionIdx);
        });
    }

    it('search.tsx window keydown (⌘K / Escape) consults the NATIVE guard first', () => {
        const src = read('components/search.tsx');
        const guardIdx = src.search(/if \(isImeComposingNativeEvent\(e\)\) return;/);
        const cmdKIdx = src.search(/e\.metaKey \|\| e\.ctrlKey/);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(cmdKIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(cmdKIdx);
    });
});
