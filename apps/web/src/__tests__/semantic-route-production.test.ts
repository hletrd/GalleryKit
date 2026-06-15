import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gallery-config', () => ({ getGalleryConfig: vi.fn() }));
vi.mock('@/lib/clip-model', () => ({ embedTextReal: vi.fn(async () => new Float32Array(512).fill(0.04419)) }));
vi.mock('@/lib/request-origin', () => ({ hasTrustedSameOrigin: () => true }));
vi.mock('@/lib/restore-maintenance', () => ({ isRestoreMaintenanceActive: () => false }));

const whereSpy = vi.fn();
vi.mock('@/db', () => {
  const chain = { select: () => chain, from: () => chain, leftJoin: () => chain, orderBy: () => chain, limit: () => Promise.resolve([]), where: (...a: unknown[]) => { whereSpy(...a); return chain; } };
  return { db: chain, imageEmbeddings: { imageId: 'image_id', embedding: 'embedding', modelVersion: 'model_version', updatedAt: 'updated_at' }, images: {}, topics: {} };
});

import { getGalleryConfig } from '@/lib/gallery-config';
import { embedTextReal } from '@/lib/clip-model';
import { POST } from '@/app/api/search/semantic/route';

function req(body: object) {
  return new Request('http://localhost/api/search/semantic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
}

describe('semantic route — production', () => {
  beforeEach(() => { whereSpy.mockClear(); vi.mocked(embedTextReal).mockClear(); });

  it('serves in production mode and embeds via the REAL encoder', async () => {
    vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'production' } as never);
    const res = await POST(req({ query: 'sunset over the sea' }));
    expect(res.status).toBe(200);
    expect(embedTextReal).toHaveBeenCalledOnce();
  });

  it('returns 503 when mode is disabled', async () => {
    vi.mocked(getGalleryConfig).mockResolvedValue({ semanticSearchMode: 'disabled' } as never);
    const res = await POST(req({ query: 'sunset over the sea' }));
    expect(res.status).toBe(503);
  });
});
