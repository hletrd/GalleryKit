/**
 * Tests for US-P51 CLIP embedding helpers.
 *
 * Covers:
 *  - cosineSimilarity correctness (known vectors)
 *  - Buffer ↔ Float32Array roundtrip (embeddingToBuffer / bufferToEmbedding)
 *  - topK threshold filter
 *  - Stub encoder determinism
 */

import { describe, it, expect } from 'vitest';
import {
    cosineSimilarity,
    embeddingToBuffer,
    bufferToEmbedding,
    topK,
    EMBEDDING_DIM,
    EMBEDDING_BYTES,
    COSINE_THRESHOLD,
} from '../lib/clip-embeddings';
import { embedImageStub, embedTextStub } from '../lib/clip-inference';

describe('cosineSimilarity', () => {
    it('returns 1.0 for identical vectors', () => {
        const a = new Float32Array(EMBEDDING_DIM).fill(1);
        expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5);
    });

    it('returns 0.0 for orthogonal vectors', () => {
        const a = new Float32Array(EMBEDDING_DIM);
        const b = new Float32Array(EMBEDDING_DIM);
        // a has 1 at even indices, b has 1 at odd indices
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            if (i % 2 === 0) a[i] = 1;
            else b[i] = 1;
        }
        expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it('returns -1.0 for opposite unit vectors', () => {
        const a = new Float32Array(EMBEDDING_DIM).fill(1);
        const b = new Float32Array(EMBEDDING_DIM).fill(-1);
        expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it('returns 0 for zero vector', () => {
        const a = new Float32Array(EMBEDDING_DIM).fill(0);
        const b = new Float32Array(EMBEDDING_DIM).fill(1);
        expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('throws on dimension mismatch', () => {
        const a = new Float32Array(512);
        const b = new Float32Array(256);
        expect(() => cosineSimilarity(a, b)).toThrow('dimension mismatch');
    });

    it('returns a value for two known vectors (sanity check)', () => {
        const a = new Float32Array(4).fill(0);
        const b = new Float32Array(4).fill(0);
        a[0] = 1; a[1] = 0; a[2] = 0; a[3] = 0;
        b[0] = 0; b[1] = 1; b[2] = 0; b[3] = 0;
        // These are 4-dim vectors; pass correctly-sized versions
        const a512 = new Float32Array(EMBEDDING_DIM);
        const b512 = new Float32Array(EMBEDDING_DIM);
        a512[0] = 3; a512[1] = 4;
        b512[0] = 4; b512[1] = 3;
        // dot = 3*4 + 4*3 = 24, |a|=5, |b|=5, cos = 24/25
        expect(cosineSimilarity(a512, b512)).toBeCloseTo(24 / 25, 4);
    });
});

describe('embeddingToBuffer / bufferToEmbedding', () => {
    it('roundtrips a Float32Array correctly', () => {
        const original = new Float32Array(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            original[i] = Math.sin(i * 0.01); // deterministic values
        }
        const buf = embeddingToBuffer(original);
        expect(buf.length).toBe(EMBEDDING_BYTES);
        const restored = bufferToEmbedding(buf);
        expect(restored.length).toBe(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(restored[i]).toBeCloseTo(original[i], 5);
        }
    });

    it('throws on wrong dimension for embeddingToBuffer', () => {
        const bad = new Float32Array(256);
        expect(() => embeddingToBuffer(bad)).toThrow();
    });

    it('throws on wrong byte length for bufferToEmbedding', () => {
        const bad = Buffer.alloc(100);
        expect(() => bufferToEmbedding(bad)).toThrow();
    });
});

describe('topK', () => {
    it('returns top K results above threshold, sorted descending', () => {
        const matches = [
            { imageId: 1, score: 0.9 },
            { imageId: 2, score: 0.5 },
            { imageId: 3, score: 0.1 }, // below COSINE_THRESHOLD
            { imageId: 4, score: 0.8 },
            { imageId: 5, score: 0.3 },
        ];
        const results = topK(matches, 3, COSINE_THRESHOLD);
        expect(results).toHaveLength(3);
        expect(results[0].imageId).toBe(1);
        expect(results[1].imageId).toBe(4);
        expect(results[2].imageId).toBe(2);
        expect(results.every(r => r.score >= COSINE_THRESHOLD)).toBe(true);
    });

    it('returns empty array when no matches above threshold', () => {
        const matches = [{ imageId: 1, score: 0.05 }];
        expect(topK(matches, 10, COSINE_THRESHOLD)).toHaveLength(0);
    });

    it('respects K cap', () => {
        const matches = Array.from({ length: 10 }, (_, i) => ({
            imageId: i + 1,
            score: 0.9 - i * 0.05,
        }));
        const results = topK(matches, 3, 0);
        expect(results).toHaveLength(3);
    });

    it('does not mutate the input array', () => {
        const matches = [
            { imageId: 2, score: 0.5 },
            { imageId: 1, score: 0.9 },
        ];
        const copy = [...matches];
        topK(matches, 10, 0);
        expect(matches[0].imageId).toBe(copy[0].imageId);
        expect(matches[1].imageId).toBe(copy[1].imageId);
    });
});

describe('stub encoder determinism', () => {
    it('embedImageStub returns 512-dim Float32Array', () => {
        const emb = embedImageStub(42);
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(EMBEDDING_DIM);
    });

    it('embedImageStub is deterministic for same imageId', () => {
        const a = embedImageStub(123);
        const b = embedImageStub(123);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(a[i]).toBe(b[i]);
        }
    });

    it('embedImageStub produces different values for different imageIds', () => {
        const a = embedImageStub(1);
        const b = embedImageStub(2);
        let diffCount = 0;
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            if (a[i] !== b[i]) diffCount++;
        }
        expect(diffCount).toBeGreaterThan(0);
    });

    it('embedTextStub returns 512-dim Float32Array', () => {
        const emb = embedTextStub('cat on a beach');
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(EMBEDDING_DIM);
    });

    it('embedTextStub is deterministic for same query', () => {
        const a = embedTextStub('sunset over mountains');
        const b = embedTextStub('sunset over mountains');
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(a[i]).toBe(b[i]);
        }
    });

    it('stub similarity is NOT expected to be semantically meaningful', () => {
        // Stub embeddings are hash-based; similarity is arbitrary.
        // Just verify the cosine value is in [-1, 1] and does not throw.
        const imgEmb = embedImageStub(99);
        const textEmb = embedTextStub('beautiful landscape');
        const sim = cosineSimilarity(imgEmb, textEmb);
        expect(sim).toBeGreaterThanOrEqual(-1);
        expect(sim).toBeLessThanOrEqual(1);
    });
});
