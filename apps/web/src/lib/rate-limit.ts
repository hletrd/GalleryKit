import { createHash } from 'crypto';
import { isIP } from 'net';
import { db, rateLimitBuckets } from '@/db';
import { and, eq, lt, sql } from 'drizzle-orm';
import { createResetAtBoundedMap, createWindowBoundedMap, type WindowEntry } from '@/lib/bounded-map';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_MAX_KEYS = 5000;

export const SEARCH_WINDOW_MS = 60 * 1000; // 1 minute
export const SEARCH_MAX_REQUESTS = 30;
export const SEARCH_RATE_LIMIT_MAX_KEYS = 2000;

// AGG8F-01 / plan-233: in-memory rate-limit for the public unauthenticated
// `/api/og` endpoint. The route runs a CPU-bound React-tree → SVG → PNG
// pipeline (~200-400ms per call) and was previously the only public surface
// in the repo with no rate-limit budget. The budget here — 30 requests
// per minute per IP — is well above natural per-IP usage from social-share
// unfurls but small enough that a scripted abuser cannot pin Node CPU.
export const OG_WINDOW_MS = 60 * 1000;
export const OG_MAX_REQUESTS = 30;
export const OG_RATE_LIMIT_MAX_KEYS = 2000;
export const ogRateLimit = createResetAtBoundedMap<string>(OG_RATE_LIMIT_MAX_KEYS);

// In-memory rate limit for public share-key lookup routes (/s/[key] and /g/[key]).
// These routes are unauthenticated and each lookup hits the DB. Without rate
// limiting, bots can probe random share keys causing unnecessary DB pressure.
// Budget: 60 requests per minute per IP — generous for legitimate browsing,
// restrictive enough to throttle automated key enumeration.
export const SHARE_WINDOW_MS = 60 * 1000;
export const SHARE_MAX_REQUESTS = 60;
export const SHARE_RATE_LIMIT_MAX_KEYS = 2000;
export const shareRateLimit = createResetAtBoundedMap<string>(SHARE_RATE_LIMIT_MAX_KEYS);

// Re-export RateLimitEntry from bounded-map for backward compatibility
export type RateLimitEntry = WindowEntry;

export type HeaderLike = { get(name: string): string | null };

const RATE_LIMIT_BUCKET_KEY_MAX_LENGTH = 45;
const ACCOUNT_RATE_LIMIT_PREFIX = 'acct:';
const ACCOUNT_RATE_LIMIT_HASH_LENGTH = RATE_LIMIT_BUCKET_KEY_MAX_LENGTH - ACCOUNT_RATE_LIMIT_PREFIX.length;
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

// In-memory Maps kept as fast-path cache. On restart they are empty;
// the DB is the source of truth.
export const loginRateLimit = createWindowBoundedMap<string>(LOGIN_RATE_LIMIT_MAX_KEYS, LOGIN_WINDOW_MS);

export const searchRateLimit = createResetAtBoundedMap<string>(SEARCH_RATE_LIMIT_MAX_KEYS);
const SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS = 1000;
let lastSearchRateLimitPruneAt = 0;
let warnedMissingTrustProxy = false;

export function normalizeIp(value: string | null): string | null {
    if (!value) return null;
    let candidate = value.trim();
    if (!candidate) return null;

    // Handle bracketed IPv6 like: [2001:db8::1]:1234
    const bracketMatch = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
    if (bracketMatch?.[1]) {
        candidate = bracketMatch[1];
    } else {
        // Handle IPv4 with port like: 203.0.113.1:1234
        const ipv4PortMatch = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(candidate);
        if (ipv4PortMatch?.[1]) {
            candidate = ipv4PortMatch[1];
        }
    }

    return isIP(candidate) ? candidate : null;
}

export function isRateLimitExceeded(count: number, maxRequests: number, includesCurrentRequest: boolean = false) {
    return includesCurrentRequest ? count > maxRequests : count >= maxRequests;
}

export function buildAccountRateLimitKey(username: string): string {
    const normalizedUsername = username.trim().toLowerCase();
    const digest = createHash('sha256').update(normalizedUsername).digest('hex');
    return `${ACCOUNT_RATE_LIMIT_PREFIX}${digest.slice(0, ACCOUNT_RATE_LIMIT_HASH_LENGTH)}`;
}

export function getTrustedProxyHopCount(value: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
    if (!value) return DEFAULT_TRUSTED_PROXY_HOPS;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_TRUSTED_PROXY_HOPS;
    return parsed;
}

export function getClientIp(headerStore: HeaderLike): string {
    // Only trust proxy headers when TRUST_PROXY is explicitly set.
    // Without it, an attacker can spoof X-Forwarded-For to bypass rate limits.
    if (process.env.TRUST_PROXY === 'true') {
        const xForwardedFor = headerStore.get('x-forwarded-for');
        if (xForwardedFor && xForwardedFor.length <= 512) {
            const parts = xForwardedFor.split(',').map(p => p.trim()).filter(Boolean);
            // Select the client immediately before the trusted proxy suffix.
            // For example, with "client, cdn, nginx" and
            // TRUSTED_PROXY_HOPS=2, the trusted suffix is "cdn, nginx" and
            // the client is the address just before it. Do not trust a chain
            // that is shorter than or equal to the configured trusted suffix:
            // there is no untrusted client slot to select.
            const validParts = parts.map((part) => normalizeIp(part)).filter((part): part is string => Boolean(part));
            const hopCount = getTrustedProxyHopCount();
            const clientIndex = validParts.length - hopCount - 1;
            if (clientIndex >= 0) {
                return validParts[clientIndex];
            }
        }

        const xRealIp = normalizeIp(headerStore.get('x-real-ip'));
        if (xRealIp) return xRealIp;
    }

    const ip = 'unknown';
    if (shouldWarnMissingTrustProxy(process.env.NODE_ENV, process.env.TRUST_PROXY, headerStore) && !warnedMissingTrustProxy) {
        warnedMissingTrustProxy = true;
        console.warn('[rate-limit] Proxy headers are present but TRUST_PROXY is not set — rate limiting uses "unknown" IP. Set TRUST_PROXY=true if behind a reverse proxy.');
    }
    return ip;
}

export function shouldWarnMissingTrustProxy(
    nodeEnv: string | undefined,
    trustProxy: string | undefined,
    headerStore: HeaderLike,
) {
    if (nodeEnv !== 'production' || trustProxy === 'true') {
        return false;
    }

    return Boolean(headerStore.get('x-forwarded-for') || headerStore.get('x-real-ip'));
}

export function pruneLoginRateLimit(now: number) {
    loginRateLimit.prune(now);
}

export function pruneSearchRateLimit(now: number, options?: { force?: boolean }) {
    const shouldPrune =
        options?.force
        || searchRateLimit.size > SEARCH_RATE_LIMIT_MAX_KEYS
        || now - lastSearchRateLimitPruneAt >= SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS;

    if (!shouldPrune) {
        return false;
    }

    lastSearchRateLimitPruneAt = now;
    searchRateLimit.prune(now);
    return true;
}

export function resetSearchRateLimitPruneStateForTests() {
    lastSearchRateLimitPruneAt = 0;
}

// AGG8F-01 / plan-233: pre-increment-then-check helpers for `/api/og`.
// Uses the same pattern as `loadMoreImages` in actions/public.ts so the
// public-unauthenticated rate-limit posture is uniform across surfaces.
export function pruneOgRateLimit(now: number) {
    ogRateLimit.prune(now);
}

/** Returns `true` when the (pre-incremented) bucket is over the limit. */
export function preIncrementOgAttempt(ip: string, now: number): boolean {
    pruneOgRateLimit(now);
    const entry = ogRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        ogRateLimit.set(ip, { count: 1, resetAt: now + OG_WINDOW_MS });
    } else {
        entry.count++;
    }
    return (ogRateLimit.get(ip)?.count ?? 0) > OG_MAX_REQUESTS;
}

export function resetOgRateLimitForTests() {
    ogRateLimit.clear();
}

// ── Share-key rate-limit helpers ────────────────────────────────────

export function pruneShareRateLimit(now: number) {
    shareRateLimit.prune(now);
}

/** Returns `true` when the (pre-incremented) bucket is over the limit. */
export function preIncrementShareAttempt(ip: string, now: number = Date.now()): boolean {
    pruneShareRateLimit(now);
    const entry = shareRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        shareRateLimit.set(ip, { count: 1, resetAt: now + SHARE_WINDOW_MS });
    } else {
        entry.count++;
    }
    return (shareRateLimit.get(ip)?.count ?? 0) > SHARE_MAX_REQUESTS;
}

export function resetShareRateLimitForTests() {
    shareRateLimit.clear();
}

// ── MySQL-backed persistent rate limiting ──────────────────────────────

/**
 * Align a timestamp to the start of its rate-limit window.
 * Returns unix seconds (not ms) aligned to the window boundary.
 */
export function getRateLimitBucketStart(nowMs: number, windowMs: number): number {
    const windowSec = Math.floor(windowMs / 1000);
    const nowSec = Math.floor(nowMs / 1000);
    return nowSec - (nowSec % windowSec);
}

/**
 * Check the current count for an IP in the given bucket type.
 * Returns the count within the current window.
 */
export async function checkRateLimit(
    ip: string,
    type: string,
    maxRequests: number,
    windowMs: number,
    bucketStart: number = getRateLimitBucketStart(Date.now(), windowMs),
): Promise<{ limited: boolean; count: number }> {
    const start = bucketStart;

    const rows = await db
        .select({ count: rateLimitBuckets.count })
        .from(rateLimitBuckets)
        .where(
            and(
                eq(rateLimitBuckets.ip, ip),
                eq(rateLimitBuckets.bucketType, type),
                eq(rateLimitBuckets.bucketStart, start),
            ),
        )
        .limit(1);

    const count = rows[0]?.count ?? 0;
    return { limited: isRateLimitExceeded(count, maxRequests), count };
}

/**
 * Increment the counter for an IP in the current window.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE for atomic upsert.
 */
export async function incrementRateLimit(
    ip: string,
    type: string,
    windowMs: number,
    bucketStart: number = getRateLimitBucketStart(Date.now(), windowMs),
): Promise<void> {
    const start = bucketStart;

    await db.insert(rateLimitBuckets).values({
        ip,
        bucketType: type,
        bucketStart: start,
        count: 1,
    }).onDuplicateKeyUpdate({
        set: { count: sql`${rateLimitBuckets.count} + 1` },
    });
}

export async function resetRateLimit(
    ip: string,
    type: string,
    windowMs: number,
    bucketStart: number = getRateLimitBucketStart(Date.now(), windowMs),
): Promise<void> {
    const start = bucketStart;

    await db.delete(rateLimitBuckets).where(
        and(
            eq(rateLimitBuckets.ip, ip),
            eq(rateLimitBuckets.bucketType, type),
            eq(rateLimitBuckets.bucketStart, start),
        ),
    );
}

/**
 * Decrement the rate limit counter for an IP in the current window.
 * Unlike resetRateLimit (which deletes the whole entry), this atomically
 * reduces the count by 1 so concurrent rollbacks don't lose counts.
 * If the count would drop to 0 or below, the row is deleted instead.
 */
export async function decrementRateLimit(
    ip: string,
    type: string,
    windowMs: number,
    bucketStart: number = getRateLimitBucketStart(Date.now(), windowMs),
): Promise<void> {
    const start = bucketStart;

    // Atomically decrement; if count drops to 0 or below, delete the row
    await db.update(rateLimitBuckets)
        .set({ count: sql`GREATEST(${rateLimitBuckets.count} - 1, 0)` })
        .where(
            and(
                eq(rateLimitBuckets.ip, ip),
                eq(rateLimitBuckets.bucketType, type),
                eq(rateLimitBuckets.bucketStart, start),
            ),
        );

    // Clean up zero-count rows to avoid accumulation
    await db.delete(rateLimitBuckets).where(
        and(
            eq(rateLimitBuckets.ip, ip),
            eq(rateLimitBuckets.bucketType, type),
            eq(rateLimitBuckets.bucketStart, start),
            sql`${rateLimitBuckets.count} <= 0`,
        ),
    );
}

/**
 * Remove expired buckets from the database.
 * Call periodically (e.g., from the existing hourly GC interval).
 */
export async function purgeOldBuckets(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoffSec = Math.floor((Date.now() - maxAgeMs) / 1000);
    await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.bucketStart, cutoffSec));
}
