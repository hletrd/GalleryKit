import { describe, expect, it } from 'vitest';
import { clampSemanticTopK } from '@/app/api/search/semantic/route';
import { SEMANTIC_TOP_K_DEFAULT, SEMANTIC_TOP_K_MAX } from '@/lib/clip-embeddings';

describe('clampSemanticTopK (R2C11-LOW-03)', () => {
    it('returns SEMANTIC_TOP_K_DEFAULT when topK is missing (undefined)', () => {
        expect(clampSemanticTopK(undefined)).toBe(SEMANTIC_TOP_K_DEFAULT);
    });

    it('clamps null to 1 (Number(null) is 0)', () => {
        expect(clampSemanticTopK(null)).toBe(1);
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

    it('parses numeric strings and clamps the result', () => {
        expect(clampSemanticTopK('5')).toBe(5);
        expect(clampSemanticTopK('0')).toBe(1);
        expect(clampSemanticTopK('999')).toBe(SEMANTIC_TOP_K_MAX);
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
