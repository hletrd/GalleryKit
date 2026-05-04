/**
 * US-P54: Single-use download token utilities.
 *
 * Token format: `dl_<base64url(32 random bytes)>` — 43 chars after prefix.
 * The token itself is never stored; only its lowercase SHA-256 hex digest
 * (64 chars) is persisted in entitlements.download_token_hash.
 *
 * Single-use enforcement:
 *   1. On download: check downloadedAt IS NULL and expiresAt > NOW().
 *   2. Atomic UPDATE sets downloadedAt = NOW() WHERE downloadedAt IS NULL.
 *   3. If UPDATE affected 0 rows → already used → 410 Gone.
 *
 * Verification uses a constant-time comparison via crypto.timingSafeEqual
 * to prevent timing-side-channel token enumeration. The stored hash MUST
 * match `^[0-9a-f]{64}$` (lowercase hex); see `STORED_HASH_SHAPE` below.
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
 * Cycle 3 / D-101-05: structural validity check for a download token.
 * Tokens are `dl_<43-char base64url>` (32 random bytes encoded to 43
 * base64url chars + 3-char prefix = 46 chars total). A pre-DB shape
 * check rejects malformed inputs cheaply before they touch the indexed
 * `download_token_hash` column. Exported so the route can short-circuit.
 */
const TOKEN_SHAPE_RE = /^dl_[A-Za-z0-9_-]{43}$/;

export function isValidTokenShape(token: string | null | undefined): token is string {
    return typeof token === 'string' && TOKEN_SHAPE_RE.test(token);
}

/**
 * Cycle 2 RPF / P260-11 / C2-RPF-06: storedHash MUST be a 64-char
 * lowercase hex string (sha256). Validate shape before `Buffer.from`
 * so a corrupted/clipped DB value is distinguishable from an attacker
 * supplying a wrong token. `Buffer.from(s, 'hex')` silently truncates
 * at the first non-hex char, which would otherwise hide DB corruption
 * as a generic 403 with no log signal.
 */
const STORED_HASH_SHAPE = /^[0-9a-f]{64}$/;

/**
 * Constant-time comparison of a provided token against a stored hash.
 * Returns true if the token's hash matches storedHash.
 */
export function verifyTokenAgainstHash(token: string, storedHash: string): boolean {
    // D-101-05: enforce shape before doing any hashing.
    if (!isValidTokenShape(token)) return false;
    if (!STORED_HASH_SHAPE.test(storedHash)) {
        // Operational signal: the row's hash is malformed, not the user's
        // token. Worth a warn so ops can spot DB corruption / partial
        // migrations.
        console.warn('[download-tokens] storedHash malformed (expected 64-char lowercase hex)');
        return false;
    }
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
