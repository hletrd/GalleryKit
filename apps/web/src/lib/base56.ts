import { randomBytes } from 'crypto';

export const BASE56_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const BASE56_REGEX = new RegExp(`^[${BASE56_CHARS}]+$`);

export function generateBase56(length: number): string {
    // Pre-generate a larger buffer to minimize syscalls during rejection sampling.
    // Since ~12.5% of bytes are rejected (256-224)/256, 2x is ample headroom.
    let pool = randomBytes(length * 2);
    let poolIdx = 0;
    let result = '';
    const charactersLength = BASE56_CHARS.length;
    for (let i = 0; i < length; i++) {
        // Rejection sampling: reject values >= 224 to avoid modulo bias (256 % 56 = 32)
        let randomValue: number;
        let attempts = 0;
        do {
            if (poolIdx >= pool.length) {
                pool = randomBytes(length * 2);
                poolIdx = 0;
            }
            randomValue = pool[poolIdx++];
            if (++attempts > 1000) throw new Error('RNG failure: too many rejections');
        } while (randomValue >= 224);
        result += BASE56_CHARS.charAt(randomValue % charactersLength);
    }
    return result;
}

// Validate if a string is Base56 with optional length constraint
export function isBase56(str: string, expectedLength?: number | number[]): boolean {
    if (!str || typeof str !== 'string') return false;
    if (expectedLength !== undefined) {
        if (Array.isArray(expectedLength)) {
            if (!expectedLength.includes(str.length)) return false;
        } else if (str.length !== expectedLength) {
            return false;
        }
    }
    return BASE56_REGEX.test(str);
}
