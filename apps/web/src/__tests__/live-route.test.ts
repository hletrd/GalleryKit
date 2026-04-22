import { describe, expect, it } from 'vitest';

import { GET } from '@/app/api/live/route';

describe('/api/live', () => {
    it('returns a simple liveness response', async () => {
        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });
});
