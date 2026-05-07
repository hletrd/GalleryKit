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
    'color_pipeline_decision',
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

    /**
     * C6R-RPL-07 / AGG6R-07 — whitelist guard: the set difference between
     * the admin field set and the public field set must equal exactly the
     * SENSITIVE_KEYS contract. If a future schema migration adds a new
     * field to `adminSelectFields` without either (a) also adding it to
     * `publicSelectFields` or (b) adding it to SENSITIVE_KEYS, this test
     * will fail loudly — forcing the developer to make an explicit
     * decision about the new field's privacy disposition.
     *
     * The existing `_privacyGuard` at `data.ts:198-200` catches the case
     * where a KNOWN sensitive key leaks into `publicSelectFields`, but
     * does NOT catch a new unknown sensitive field. This test closes the
     * gap symmetrically.
     */
    it('admin-only keys form exactly the SENSITIVE_KEYS contract (symmetric privacy guard)', () => {
        const publicKeySet = new Set<string>(publicSelectFieldKeys);
        const adminOnlyKeys = [...adminSelectFieldKeys]
            .filter((key) => !publicKeySet.has(key))
            .sort();
        const sensitiveSorted = [...SENSITIVE_KEYS].sort();
        expect(adminOnlyKeys).toEqual(sensitiveSorted);
    });
});
