/**
 * TEST-R5C1-05: Pin Argon2id work factors.
 * Asserts exact current values AND minimums for PASSWORD_HASH_OPTIONS.
 * Exact pin catches accidental weakening; minimum documents intent.
 */

import { describe, it, expect } from 'vitest';
import { PASSWORD_HASH_OPTIONS } from '@/lib/password-hashing';
import * as argon2 from 'argon2';

describe('PASSWORD_HASH_OPTIONS — exact current values', () => {
    it('type is argon2id', () => {
        expect(PASSWORD_HASH_OPTIONS.type).toBe(argon2.argon2id);
    });

    it('memoryCost is exactly 65_536 (64 MiB)', () => {
        expect(PASSWORD_HASH_OPTIONS.memoryCost).toBe(65_536);
    });

    it('timeCost is exactly 3 iterations', () => {
        expect(PASSWORD_HASH_OPTIONS.timeCost).toBe(3);
    });

    it('parallelism is exactly 4', () => {
        expect(PASSWORD_HASH_OPTIONS.parallelism).toBe(4);
    });
});

describe('PASSWORD_HASH_OPTIONS — minimum security floors', () => {
    it('memoryCost >= 65_536 (64 MiB minimum for Argon2id)', () => {
        expect(PASSWORD_HASH_OPTIONS.memoryCost).toBeGreaterThanOrEqual(65_536);
    });

    it('timeCost >= 3 (minimum 3 iterations)', () => {
        expect(PASSWORD_HASH_OPTIONS.timeCost).toBeGreaterThanOrEqual(3);
    });

    it('parallelism >= 1', () => {
        expect(PASSWORD_HASH_OPTIONS.parallelism).toBeGreaterThanOrEqual(1);
    });
});
