import { describe, expect, it } from 'vitest';
import { clampSemanticTopK } from '@/app/api/search/semantic/route';
import { SEMANTIC_TOP_K_DEFAULT, SEMANTIC_TOP_K_MAX } from '@/lib/clip-embeddings';

describe('clampSemanticTopK (R2C11-LOW-03)', () => {
    it('returns SEMANTIC_TOP_K_DEFAULT when topK is missing (undefined)', () => {
        expect(clampSemanticTopK(undefined)).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('falls back to default for null (COR-R5C2-06: non-number rejected)', () => {
        // Pre-AGG-R5C2-33 this coerced via Number(null) === 0 and clamped to 1.
        // The hardened contract rejects any non-number value explicitly.
        expect(clampSemanticTopK(null)).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('clamps negative values to 1', () => {
        expect(clampSemanticTopK(-5)).toBe(1);
        expect(clampSemanticTopK(-1)).toBe(1);
    });

    it('clamps zero to 1', () => {
        expect(clampSemanticTopK(0)).toBe(1);
    });

    it('floors float values', () => {
        expect(clampSemanticTopK(3.7)).toBe(3);
        expect(clampSemanticTopK(10.99)).toBe(10);
    });

    it('returns valid integer values unchanged', () => {
        expect(clampSemanticTopK(1)).toBe(1);
        expect(clampSemanticTopK(5)).toBe(5);
        expect(clampSemanticTopK(SEMANTIC_TOP_K_MAX)).toBe(SEMANTIC_TOP_K_MAX);
    });

    it('clamps values above SEMANTIC_TOP_K_MAX', () => {
        expect(clampSemanticTopK(SEMANTIC_TOP_K_MAX + 1)).toBe(SEMANTIC_TOP_K_MAX);
        expect(clampSemanticTopK(1000)).toBe(SEMANTIC_TOP_K_MAX);
    });

    it('falls back to default for non-numeric strings', () => {
        expect(clampSemanticTopK('not a number')).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('falls back to default for numeric strings (COR-R5C2-06: non-number rejected)', () => {
        // Pre-AGG-R5C2-33 these were parsed via Number(...) and clamped. The
        // hardened contract treats a string topK as invalid input — only an
        // actual number is honored — so every string resolves to the default.
        expect(clampSemanticTopK('5')).toBe(SEMANTIC_TOP_K_DEFAULT);
        expect(clampSemanticTopK('0')).toBe(SEMANTIC_TOP_K_DEFAULT);
        expect(clampSemanticTopK('999')).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('falls back to default for boolean / array / object inputs (COR-R5C2-06)', () => {
        // Number(true) === 1, Number([]) === 0, Number(['5']) === 5 would all
        // have slipped through a bare Number() coercion. The explicit
        // typeof-number guard rejects them.
        expect(clampSemanticTopK(true)).toBe(SEMANTIC_TOP_K_DEFAULT);
        expect(clampSemanticTopK(false)).toBe(SEMANTIC_TOP_K_DEFAULT);
        expect(clampSemanticTopK([])).toBe(SEMANTIC_TOP_K_DEFAULT);
        expect(clampSemanticTopK([5])).toBe(SEMANTIC_TOP_K_DEFAULT);
        expect(clampSemanticTopK({})).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('falls back to default for NaN', () => {
        expect(clampSemanticTopK(NaN)).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('falls back to default for Infinity', () => {
        expect(clampSemanticTopK(Infinity)).toBe(SEMANTIC_TOP_K_DEFAULT);
        expect(clampSemanticTopK(-Infinity)).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('clamps extremely large finite numbers to SEMANTIC_TOP_K_MAX', () => {
        expect(clampSemanticTopK(Number.MAX_SAFE_INTEGER)).toBe(SEMANTIC_TOP_K_MAX);
    });
});
