/**
 * AGG-C10-01 regression lock (run-6 cycle-1): the `image_embeddings.embedding`
 * MEDIUMBLOB read contract.
 *
 * The bug: the column is physically MEDIUMBLOB, so mysql2 returns a Buffer for it
 * (binary charset 63 → readLengthCodedBuffer). The previous read sites stored the
 * vector as base64 and read it back with `Buffer.from(row.embedding as string,
 * 'base64')` — but Buffer.from(buffer, encoding) IGNORES the encoding for Buffer
 * input and copies verbatim. So a 2048-byte float32 vector, stored as a 2732-char
 * base64 string, came back as a 2732-byte Buffer, failed the `=== 2048` length
 * check, and was silently dropped. Every row vanished → empty semantic results /
 * 404 similar once the (dark) feature is enabled.
 *
 * The fix: store the RAW buffer and read via decodeEmbeddingColumn(), which handles
 * (1) the raw-Buffer write path, (2) legacy base64-string-in-Buffer rows, and
 * (3) a defensive plain base64 string. These tests assert the round-trip survives
 * AND demonstrate the old read path would have failed (so the test is non-vacuous).
 */

import { describe, it, expect } from 'vitest';
import {
    embeddingToBuffer,
    bufferToEmbedding,
    decodeEmbeddingColumn,
    dotProduct,
    cosineSimilarity,
    normalizeEmbedding,
    EMBEDDING_DIM,
    EMBEDDING_BYTES,
} from '../lib/clip-embeddings';

function sampleVector(): Float32Array {
    const v = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) v[i] = Math.sin(i * 0.013) * 0.5;
    return v;
}

describe('decodeEmbeddingColumn — MEDIUMBLOB read contract (AGG-C10-01)', () => {
    it('round-trips a RAW Buffer (current write path) the way mysql2 returns the blob', () => {
        const original = sampleVector();
        // Write path: store the raw 2048-byte buffer. mysql2 returns it verbatim as a Buffer.
        const stored = embeddingToBuffer(original);
        expect(stored.length).toBe(EMBEDDING_BYTES);
        const mysql2Value: unknown = Buffer.from(stored); // mysql2 hands back a Buffer
        const decoded = decodeEmbeddingColumn(mysql2Value);
        expect(decoded).not.toBeNull();
        expect(decoded!.length).toBe(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(decoded![i]).toBeCloseTo(original[i], 5);
        }
        // cosine(self, self) ≈ 1 proves a usable vector survived the round-trip.
        expect(cosineSimilarity(decoded!, decoded!)).toBeCloseTo(1, 5);
    });

    it('DEMONSTRATES the old base64 read would have DROPPED the row (non-vacuity guard)', () => {
        const original = sampleVector();
        const stored = embeddingToBuffer(original);
        // Old write stored base64 TEXT in the blob; mysql2 returns the ASCII as a Buffer:
        const legacyBase64Buffer = Buffer.from(stored.toString('base64'), 'latin1');
        // The OLD read did Buffer.from(value, 'base64') on that Buffer. Because the first
        // arg is a Buffer, Node IGNORES the encoding and copies verbatim — equivalent to
        // Buffer.from(buffer) (modelled here type-safely via the byte view). So the result
        // is the 2732-byte ASCII, NOT the 2048-byte vector → the length check dropped it.
        const oldRead = Buffer.from(new Uint8Array(legacyBase64Buffer));
        expect(oldRead.length).toBe(legacyBase64Buffer.length);
        expect(oldRead.length).not.toBe(EMBEDDING_BYTES); // 2732, not 2048 → would be dropped
        // The NEW decoder recovers the legacy base64-in-Buffer row correctly:
        const decoded = decodeEmbeddingColumn(legacyBase64Buffer);
        expect(decoded).not.toBeNull();
        expect(decoded!.length).toBe(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            expect(decoded![i]).toBeCloseTo(original[i], 5);
        }
    });

    it('decodes a defensive plain base64 string value', () => {
        const original = sampleVector();
        const b64 = embeddingToBuffer(original).toString('base64');
        const decoded = decodeEmbeddingColumn(b64);
        expect(decoded).not.toBeNull();
        expect(decoded!.length).toBe(EMBEDDING_DIM);
    });

    it('returns null for a wrong-length Buffer that is neither raw nor valid base64', () => {
        expect(decodeEmbeddingColumn(Buffer.alloc(100))).toBeNull();
    });

    it('returns null for null / non-buffer / non-string values', () => {
        expect(decodeEmbeddingColumn(null)).toBeNull();
        expect(decodeEmbeddingColumn(undefined)).toBeNull();
        expect(decodeEmbeddingColumn(12345)).toBeNull();
        expect(decodeEmbeddingColumn({})).toBeNull();
    });

    it('round-trips via bufferToEmbedding directly (sanity, raw path)', () => {
        const original = sampleVector();
        const restored = bufferToEmbedding(embeddingToBuffer(original));
        for (let i = 0; i < EMBEDDING_DIM; i++) expect(restored[i]).toBeCloseTo(original[i], 5);
    });
});

describe('dotProduct fast path (AGG-C10-11c)', () => {
    it('equals cosineSimilarity for two UNIT vectors', () => {
        const a = normalizeEmbedding(sampleVector());
        const b = normalizeEmbedding(Float32Array.from(sampleVector(), (x) => x + 0.1));
        expect(dotProduct(a, b)).toBeCloseTo(cosineSimilarity(a, b), 5);
    });

    it('returns 1 for a unit vector dotted with itself', () => {
        const a = normalizeEmbedding(sampleVector());
        expect(dotProduct(a, a)).toBeCloseTo(1, 5);
    });

    it('throws on dimension mismatch', () => {
        expect(() => dotProduct(new Float32Array(512), new Float32Array(256))).toThrow('dimension mismatch');
    });
});
