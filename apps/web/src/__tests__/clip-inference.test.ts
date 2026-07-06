/**
 * TEST3-04 / C3-18 (run-10 c3) — first direct coverage for the stub
 * embedding generator. Every consumer (image-queue, semantic route,
 * embeddings action) mocks this module away in its own tests, so its
 * documented invariants — determinism (idempotent backfill), value range,
 * dimension, and image/text seed-namespace separation — were entirely
 * unpinned. This is the one CLIP-adjacent module reachable in the default
 * dependency-free 'stub' mode (the real encoder is env-gated, TEST-06).
 */
import { describe, expect, it } from 'vitest';
import { embedImageStub, embedTextStub } from '@/lib/clip-inference';
import { EMBEDDING_DIM } from '@/lib/clip-embeddings';

describe('embedImageStub', () => {
    it('returns a 512-dim Float32Array with every value in [-1, 1]', () => {
        const vec = embedImageStub(42);
        expect(vec).toBeInstanceOf(Float32Array);
        expect(vec.length).toBe(EMBEDDING_DIM);
        for (const v of vec) {
            expect(v).toBeGreaterThanOrEqual(-1);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it('is deterministic — same id yields bit-identical output (idempotent backfill)', () => {
        expect(embedImageStub(7)).toEqual(embedImageStub(7));
    });

    it('distinct ids yield distinct embeddings', () => {
        expect(embedImageStub(1)).not.toEqual(embedImageStub(2));
    });

    it('fills the full vector (no zero tail from a digest-cycling off-by-one)', () => {
        const vec = embedImageStub(3);
        // A broken `remaining -= chunk` loop leaves a trailing run of exact
        // zeros; the odds of the LAST 8 derived floats all being exactly 0
        // are nil for a hash-derived vector.
        const tail = Array.from(vec.slice(EMBEDDING_DIM - 8));
        expect(tail.some((v) => v !== 0)).toBe(true);
    });
});

describe('embedTextStub', () => {
    it('returns a 512-dim Float32Array in range and is deterministic', () => {
        const a = embedTextStub('sunset over busan');
        expect(a.length).toBe(EMBEDDING_DIM);
        expect(a).toEqual(embedTextStub('sunset over busan'));
    });

    it('normalizes the query (trim + lowercase) before seeding', () => {
        expect(embedTextStub('  SUNSET Over Busan ')).toEqual(embedTextStub('sunset over busan'));
    });

    it('distinct queries yield distinct embeddings', () => {
        expect(embedTextStub('cat')).not.toEqual(embedTextStub('dog'));
    });
});

describe('seed-namespace separation', () => {
    it("embedImageStub(1) and embedTextStub('1') never collide (image:/text: prefixes)", () => {
        expect(embedImageStub(1)).not.toEqual(embedTextStub('1'));
    });
});
