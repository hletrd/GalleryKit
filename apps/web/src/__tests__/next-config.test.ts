import { describe, expect, it } from 'vitest';

import { parseImageBaseUrl } from '../../next.config';

describe('parseImageBaseUrl', () => {
    it('rejects plaintext IMAGE_BASE_URL values in production', () => {
        expect(() => parseImageBaseUrl('http://cdn.example.com/gallery', 'production')).toThrow(
            'IMAGE_BASE_URL must use https in production'
        );
    });

    it('allows plaintext IMAGE_BASE_URL values in development', () => {
        expect(parseImageBaseUrl('http://cdn.example.com/gallery', 'development')?.origin).toBe('http://cdn.example.com');
    });
});
