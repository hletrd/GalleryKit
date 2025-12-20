import { randomBytes } from 'crypto';

export const BASE56_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';

export function generateBase56(length: number): string {
    // Use cryptographically secure random bytes
    const bytes = randomBytes(length);
    let result = '';
    const charactersLength = BASE56_CHARS.length;
    for (let i = 0; i < length; i++) {
        // Use modulo with rejection sampling bias mitigation
        // Since 256 % 56 = 32, we reject values >= 224 to avoid bias
        let randomValue = bytes[i];
        while (randomValue >= 224) {
            randomValue = randomBytes(1)[0];
        }
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
    const regex = new RegExp(`^[${BASE56_CHARS}]+$`);
    return regex.test(str);
}
