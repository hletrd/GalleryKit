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

    it('delegates default environment handling to the shared CSP parser', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'next.config.ts'), 'utf8');

        expect(source).toContain('export function parseImageBaseUrl(rawValue: string | undefined, environment?: string)');
        expect(source).toContain('return parseCspImageBaseUrl(rawValue, environment)');
        expect(source).not.toContain("environment: string = process.env.NODE_ENV || 'development'");
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
