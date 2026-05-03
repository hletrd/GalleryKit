/**
 * US-P54: Single-use download token utilities.
 *
 * Token format: `dl_<base64url(32 random bytes)>` — 43 chars after prefix.
 * The token itself is never stored; only its SHA-256 hex digest is persisted
 * in entitlements.download_token_hash.
 *
 * Single-use enforcement:
 *   1. On download: check downloadedAt IS NULL and expiresAt > NOW().
 *   2. Atomic UPDATE sets downloadedAt = NOW() WHERE downloadedAt IS NULL.
 *   3. If UPDATE affected 0 rows → already used → 410 Gone.
 *
 * Verification uses a constant-time comparison via crypto.timingSafeEqual
 * to prevent timing-side-channel token enumeration.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Generate a new single-use download token. Returns { token, hash }. */
export function generateDownloadToken(): { token: string; hash: string } {
    const bytes = randomBytes(32);
    // base64url: replace +/ with -_ and strip trailing =
    const b64url = bytes.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const token = `dl_${b64url}`;
    const hash = hashToken(token);
    return { token, hash };
}

/** SHA-256 hex digest of a download token. */
export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of a provided token against a stored hash.
 * Returns true if the token's hash matches storedHash.
 */
export function verifyTokenAgainstHash(token: string, storedHash: string): boolean {
    if (!token.startsWith('dl_')) return false;
    const candidateHash = hashToken(token);
    // Both hex strings are 64 chars — same length, safe to compare
    try {
        const a = Buffer.from(candidateHash, 'hex');
        const b = Buffer.from(storedHash, 'hex');
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    } catch {
        return false;
    }
}
