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

// C2-14 (run-10 c2): bufferToEmbedding now takes a zero-copy Float32Array view
// (or a single bulk-copy fallback when misaligned) instead of a 512-call
// readFloatLE loop. These tests pin value-equivalence against a reference
// per-element readFloatLE decode, cover a misaligned input Buffer, and cover
// NaN/Infinity bit patterns.
describe('bufferToEmbedding — zero-copy decode (C2-14)', () => {
    /** Reference decode: the old per-element readFloatLE loop. */
    function referenceDecode(buf: Buffer): Float32Array {
        const arr = new Float32Array(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            arr[i] = buf.readFloatLE(i * 4);
        }
        return arr;
    }

    it('matches the reference readFloatLE decode for random vectors', () => {
        const original = new Float32Array(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            original[i] = Math.random() * 2 - 1;
        }
        const buf = embeddingToBuffer(original);
        const expected = referenceDecode(buf);
        const actual = bufferToEmbedding(buf);
        expect(actual.length).toBe(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(actual[i]).toBe(expected[i]);
        }
    });

    it('decodes a 4-byte-aligned Buffer via the zero-copy view path', () => {
        // embeddingToBuffer uses Buffer.allocUnsafe, which for a 2048-byte
        // allocation is pool-backed and 8-byte (so also 4-byte) aligned —
        // this exercises the zero-copy `new Float32Array(buf.buffer, ...)` branch.
        const original = new Float32Array(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) original[i] = Math.sin(i * 0.02);
        const buf = embeddingToBuffer(original);
        expect(buf.byteOffset % 4).toBe(0);
        const decoded = bufferToEmbedding(buf);
        const expected = referenceDecode(buf);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(decoded[i]).toBe(expected[i]);
        }
    });

    it('decodes a misaligned-offset Buffer identically (bulk-copy fallback path)', () => {
        const original = new Float32Array(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            original[i] = Math.cos(i * 0.03) * 100;
        }
        const sourceBuf = embeddingToBuffer(original);

        // Build a larger backing ArrayBuffer and place the embedding bytes at a
        // byte offset that is NOT a multiple of 4 (offset 2), forcing
        // bufferToEmbedding's misaligned-copy branch.
        const misalignedOffset = 2;
        const backing = new ArrayBuffer(misalignedOffset + EMBEDDING_BYTES + 2);
        const misalignedBuf = Buffer.from(backing, misalignedOffset, EMBEDDING_BYTES);
        sourceBuf.copy(misalignedBuf);
        expect(misalignedBuf.byteOffset % 4).not.toBe(0);

        const decoded = bufferToEmbedding(misalignedBuf);
        const expected = referenceDecode(misalignedBuf);
        expect(decoded.length).toBe(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(decoded[i]).toBe(expected[i]);
        }
    });

    it('preserves NaN and Infinity bit patterns through zero-copy decode', () => {
        const buf = Buffer.alloc(EMBEDDING_BYTES);
        buf.writeFloatLE(NaN, 0);
        buf.writeFloatLE(Infinity, 4);
        buf.writeFloatLE(-Infinity, 8);
        buf.writeFloatLE(-0, 12);
        for (let i = 4; i < EMBEDDING_DIM; i++) {
            buf.writeFloatLE(i * 0.001, i * 4);
        }
        const decoded = bufferToEmbedding(buf);
        expect(Number.isNaN(decoded[0])).toBe(true);
        expect(decoded[1]).toBe(Infinity);
        expect(decoded[2]).toBe(-Infinity);
        expect(Object.is(decoded[3], -0)).toBe(true);
    });

    it('preserves NaN/Infinity bit patterns through the misaligned bulk-copy path too', () => {
        const sourceBuf = Buffer.alloc(EMBEDDING_BYTES);
        sourceBuf.writeFloatLE(NaN, 0);
        sourceBuf.writeFloatLE(Infinity, 4);
        sourceBuf.writeFloatLE(-Infinity, 8);
        for (let i = 3; i < EMBEDDING_DIM; i++) {
            sourceBuf.writeFloatLE(i * 0.001, i * 4);
        }
        const misalignedOffset = 1;
        const backing = new ArrayBuffer(misalignedOffset + EMBEDDING_BYTES + 3);
        const misalignedBuf = Buffer.from(backing, misalignedOffset, EMBEDDING_BYTES);
        sourceBuf.copy(misalignedBuf);
        expect(misalignedBuf.byteOffset % 4).not.toBe(0);

        const decoded = bufferToEmbedding(misalignedBuf);
        expect(Number.isNaN(decoded[0])).toBe(true);
        expect(decoded[1]).toBe(Infinity);
        expect(decoded[2]).toBe(-Infinity);
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

    it('keeps only bounded winners when high scores arrive late', () => {
        const matches = [
            { imageId: 1, score: 0.21 },
            { imageId: 2, score: 0.22 },
            { imageId: 3, score: 0.23 },
            { imageId: 4, score: 0.99 },
            { imageId: 5, score: 0.98 },
        ];

        expect(topK(matches, 2, 0.2)).toEqual([
            { imageId: 4, score: 0.99 },
            { imageId: 5, score: 0.98 },
        ]);
    });

    it('returns empty for non-positive K', () => {
        expect(topK([{ imageId: 1, score: 1 }], 0, 0)).toEqual([]);
        expect(topK([{ imageId: 1, score: 1 }], -1, 0)).toEqual([]);
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
