import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '..', 'app', 'actions', 'sharing.ts'), 'utf8');

describe('sharing action source contracts', () => {
    it('rolls back photo-share rate-limit counters when returning a concurrent winner key', () => {
        const branch = source.slice(
            source.indexOf('if (refreshedImage.share_key)'),
            source.indexOf('retries++;', source.indexOf('if (refreshedImage.share_key)')),
        );

        expect(branch).toContain("rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart)");
        expect(branch).toContain('return { success: true, key: refreshedImage.share_key }');
    });
});
