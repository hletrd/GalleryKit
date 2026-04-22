import { describe, it, expect } from 'vitest';
import { images } from '@/db/schema';
import { adminSelectFieldKeys, publicSelectFieldKeys } from '@/lib/data';

const SENSITIVE_KEYS = [
    'latitude',
    'longitude',
    'filename_original',
    'user_filename',
    'processed',
    'original_format',
    'original_file_size',
] as const;

describe('Privacy field separation', () => {
    it('sensitive fields exist in the images schema', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(images[key]).toBeDefined();
        }
    });

    it('admin select fields still contain the sensitive contract keys', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(adminSelectFieldKeys).toContain(key);
        }
    });

    it('public select fields omit the sensitive contract keys', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(publicSelectFieldKeys).not.toContain(key);
        }
    });

    it('public select fields still expose the intended safe keys', () => {
        expect(publicSelectFieldKeys).toContain('id');
        expect(publicSelectFieldKeys).toContain('title');
        expect(publicSelectFieldKeys).toContain('filename_jpeg');
    });
});
