import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { cache } from 'react';
import { db, adminSettings, sessions } from '@/db';
import { eq } from 'drizzle-orm';

export const COOKIE_NAME = 'admin_session';

/** Hash a session token for storage — so DB compromise doesn't yield usable cookies. */
export function hashSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

let cachedSessionSecret: string | null = null;
let sessionSecretPromise: Promise<string> | null = null;

export async function getSessionSecret(): Promise<string> {
    if (cachedSessionSecret) return cachedSessionSecret;

    // Prefer SESSION_SECRET env var (recommended for production)
    const envSecret = process.env.SESSION_SECRET?.trim();
    if (envSecret && envSecret.length >= 32) {
        cachedSessionSecret = envSecret;
        return envSecret;
    }

    // In production, refuse to fall back to a DB-stored secret. If an attacker
    // ever obtains the admin_settings row they would be able to forge valid
    // session tokens for any admin, so we want the signing key to live only in
    // the process env (and not in the same trust domain as user data).
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'SESSION_SECRET env var is required in production (min 32 chars). ' +
            'Refusing to fall back to a DB-stored secret to avoid forgery on DB compromise. ' +
            'Generate one with: openssl rand -hex 32'
        );
    }

    if (sessionSecretPromise) return sessionSecretPromise;

    // Dev-only fallback: fetch or generate from DB
    sessionSecretPromise = (async () => {
        try {
            if (cachedSessionSecret) return cachedSessionSecret;

            console.warn('[Security] SESSION_SECRET env var not set or too short (min 32 chars). Falling back to DB-stored secret. Set SESSION_SECRET for production use.');

            const setting = await db.query.adminSettings.findFirst({
                where: eq(adminSettings.key, 'session_secret')
            });

            if (setting?.value) {
                cachedSessionSecret = setting.value;
                return setting.value;
            }

            // Generate new secret and store in DB
            const newSecret = randomBytes(32).toString('hex');

            await db.insert(adminSettings).ignore().values({
                key: 'session_secret',
                value: newSecret
            });

            // Re-fetch to get the actual value (in case another process inserted first)
            const finalSetting = await db.query.adminSettings.findFirst({
                where: eq(adminSettings.key, 'session_secret')
            });

            if (!finalSetting?.value) {
                throw new Error('Session secret persistence failed — re-fetch returned null after INSERT IGNORE');
            }
            cachedSessionSecret = finalSetting.value;
            return cachedSessionSecret;
        } finally {
            sessionSecretPromise = null;
        }
    })();

    return sessionSecretPromise;
}

export async function generateSessionToken(secretOverride?: string): Promise<string> {
    const secret = secretOverride || await getSessionSecret();
    const timestamp = Date.now().toString();
    const random = randomBytes(16).toString('hex');
    const data = `${timestamp}:${random}`;
    const signature = createHmac('sha256', secret).update(data).digest('hex');
    return `${data}:${signature}`;
}

// Per-request deduplication: if the same token is verified multiple times
// within a single React server context (e.g. isAdmin() → getCurrentUser()),
// the DB query is only executed once.
export const verifySessionToken = cache(async function verifySessionToken(token: string): Promise<{ id: string; userId: number; expiresAt: Date } | null> {
    if (!token) {
        return null;
    }

    const parts = token.split(':');
    if (parts.length !== 3) {
        return null;
    }

    const [timestamp, random, signature] = parts;
    const data = `${timestamp}:${random}`;

    const secret = await getSessionSecret();
    const expectedSignature = createHmac('sha256', secret).update(data).digest('hex');

    const signatureBuffer = Buffer.from(signature);
    const expectedSignatureBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedSignatureBuffer.length) {
        return null;
    }

    if (!timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
        return null;
    }

    // Check token age (24 hours max)
    const tokenTimestamp = parseInt(timestamp, 10);
    if (!Number.isFinite(tokenTimestamp)) return null;
    const tokenAge = Date.now() - tokenTimestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    if (tokenAge > maxAge || tokenAge < 0) {
        return null;
    }

    const tokenHash = hashSessionToken(token);
    const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, tokenHash)
    });

    if (!session) {
        return null;
    }

    if (session.expiresAt < new Date()) {
        await db.delete(sessions).where(eq(sessions.id, tokenHash));
        return null;
    }

    return session;
});
