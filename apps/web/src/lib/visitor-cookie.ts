/**
 * US-P31: Anonymous visitor identification via HMAC-SHA256-signed cookie.
 *
 * Cookie name: `gk_visitor`
 * Cookie value: `<base64url(uuid:YYYY-MM-DD)>.<base64url(hmac-sha256)>`
 *
 * Daily rotation: the YYYY-MM-DD date is included in the signed payload.
 * When the date changes the HMAC fails verification, triggering a new cookie.
 *
 * visitor_id_hash stored in DB: SHA-256(uuid + YYYY-MM-DD) — no PII.
 *
 * Cookie attributes:
 *   httpOnly: false  (client reads it to know its own visitor_id for optimistic UI)
 *   secure: true in production
 *   sameSite: 'lax'
 *   path: '/'
 */

import { createHmac, createHash, randomUUID } from 'crypto';
import { getSessionSecret } from '@/lib/session';

export const VISITOR_COOKIE_NAME = 'gk_visitor';

/** Today's date as YYYY-MM-DD (UTC). */
function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

function toBase64Url(buf: Buffer): string {
    return buf.toString('base64url');
}

function fromBase64Url(str: string): string {
    return Buffer.from(str, 'base64url').toString('utf8');
}

/**
 * Sign a visitor UUID for today's date.
 * Returns the full cookie value: `<base64url(uuid:date)>.<base64url(hmac)>`
 */
export async function signVisitorCookie(uuid: string): Promise<string> {
    const secret = await getSessionSecret();
    const date = todayUtc();
    const payload = `${uuid}:${date}`;
    const payloadB64 = toBase64Url(Buffer.from(payload, 'utf8'));
    const hmac = createHmac('sha256', secret).update(payload).digest();
    const sigB64 = toBase64Url(hmac);
    return `${payloadB64}.${sigB64}`;
}

/**
 * Verify and parse a visitor cookie value.
 * Returns `{ uuid, date }` if valid, or `null` if tampered/expired.
 * A cookie is valid only for today's date (UTC).
 */
export async function verifyVisitorCookie(cookieValue: string): Promise<{ uuid: string; date: string } | null> {
    const dotIndex = cookieValue.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const payloadB64 = cookieValue.slice(0, dotIndex);
    const sigB64 = cookieValue.slice(dotIndex + 1);

    let payload: string;
    try {
        payload = fromBase64Url(payloadB64);
    } catch {
        return null;
    }

    // payload must be `uuid:YYYY-MM-DD`
    const colonIndex = payload.indexOf(':');
    if (colonIndex === -1) return null;
    const uuid = payload.slice(0, colonIndex);
    const date = payload.slice(colonIndex + 1);

    // Must match today (daily rotation)
    if (date !== todayUtc()) return null;

    // Verify UUID format (basic sanity)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return null;

    // Recompute HMAC and compare
    const secret = await getSessionSecret();
    const expectedHmac = createHmac('sha256', secret).update(payload).digest();
    let presentedHmac: Buffer;
    try {
        presentedHmac = Buffer.from(sigB64, 'base64url');
    } catch {
        return null;
    }

    if (expectedHmac.length !== presentedHmac.length) return null;

    // Constant-time comparison
    const { timingSafeEqual } = await import('crypto');
    if (!timingSafeEqual(expectedHmac, presentedHmac)) return null;

    return { uuid, date };
}

/**
 * Create a fresh visitor cookie value for a new UUID.
 */
export async function createVisitorCookie(): Promise<{ uuid: string; cookieValue: string }> {
    const uuid = randomUUID();
    const cookieValue = await signVisitorCookie(uuid);
    return { uuid, cookieValue };
}

/**
 * Compute the visitor_id_hash for DB storage.
 * hash = SHA-256(uuid + date)
 */
export function computeVisitorIdHash(uuid: string, date: string): string {
    return createHash('sha256').update(`${uuid}${date}`).digest('hex');
}

/**
 * Get cookie set-cookie options appropriate for the environment.
 */
export function visitorCookieOptions() {
    return {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        // No explicit maxAge — session cookie (cleared when browser closes).
        // Daily rotation via HMAC means the cookie is re-issued each day anyway.
    };
}
