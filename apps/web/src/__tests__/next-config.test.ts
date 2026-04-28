import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

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

describe('Next image localPatterns', () => {
    it('does not allow site-wide local image optimization', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'next.config.ts'), 'utf8');

        expect(source).toContain("pathname: '/uploads/**'");
        expect(source).toContain("pathname: '/resources/**'");
        expect(source).not.toContain("pathname: '/**'");
    });
});
