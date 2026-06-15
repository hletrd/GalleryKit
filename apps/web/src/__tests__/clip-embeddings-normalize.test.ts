import { describe, it, expect } from 'vitest';
import { normalizeEmbedding, truncateAndNormalize, EMBEDDING_DIM, PRODUCTION_MODEL_VERSION } from '@/lib/clip-embeddings';

describe('normalizeEmbedding', () => {
  it('returns a unit-length vector', () => {
    const v = normalizeEmbedding(Float32Array.from([3, 4]));
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(0.6, 6);
  });
  it('leaves a zero vector as zeros (no NaN)', () => {
    const v = normalizeEmbedding(new Float32Array(4));
    expect(v.every(x => x === 0)).toBe(true);
  });
});

describe('truncateAndNormalize (Matryoshka 1024 -> 512)', () => {
  it('truncates to EMBEDDING_DIM then re-normalizes to unit length', () => {
    const src = Float32Array.from({ length: 1024 }, (_, i) => i + 1);
    const out = truncateAndNormalize(src);
    expect(out.length).toBe(EMBEDDING_DIM);
    expect(Math.hypot(...out)).toBeCloseTo(1, 5);
  });
});

describe('PRODUCTION_MODEL_VERSION', () => {
  it('is a real id, not the stub', () => {
    expect(PRODUCTION_MODEL_VERSION).not.toBe('stub-sha256-v1');
    expect(PRODUCTION_MODEL_VERSION.length).toBeLessThanOrEqual(32); // model_version varchar(32)
  });
});
