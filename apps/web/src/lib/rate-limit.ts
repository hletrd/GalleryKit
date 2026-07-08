/**
 * Rate Limiting — patterns and conventions
 *
 * Four rollback patterns are used across the codebase, each with distinct
 * security/reliability tradeoffs. When adding a new rate-limited action,
 * choose the appropriate pattern:
 *
 * 1. **No rollback on infrastructure error** (auth.ts login/updatePassword):
 *    The pre-incremented rate-limit counter is NOT rolled back when an
 *    unexpected infrastructure error occurs (e.g., DB connection dropped
 *    during Argon2 verify). Rationale: the server cannot distinguish an
 *    attacker-triggered infrastructure error from a genuine failure, so
 *    rolling back gives the attacker extra attempts. The user can simply
 *    retry — the 15-minute window is generous.
 *    Use for: security-critical write paths (auth, credential changes).
 *
 * 2. **Rollback on infrastructure error** (public.ts loadMore/search):
 *    The pre-incremented counter IS rolled back when the underlying
 *    operation throws. Rationale: the user should not be penalized for
 *    server errors on public read paths.
 *    Use for: public read paths whose limiter is not guarding a specific
 *    expensive downstream CPU/API stage.
 *
 * 2b. **No rollback after semantic body admission** (/api/search/semantic
 *    and /api/search/similar/[id]):
 *    The routes perform cheap origin/header/config/param checks first, then
 *    pre-increment before admitting protected work. After the DB-backed mode
 *    lookup is reached, disabled-mode responses, invalid query lengths,
 *    malformed bodies, encoder failures, DB failures, empty production
 *    embeddings, and similar target/scan lookups stay charged. Rationale:
 *    once request-body memory, config DB work, embedding CPU, or bounded
 *    embedding scans are admitted, refunding lets a client amplify the
 *    protected cost.
 *    Use for: public read paths whose protected resource is expensive
 *    per admitted request.
 *
 * 3. **Rollback on over-limit / FK violation only** (sharing.ts):
 *    The counter is rolled back when the action did NOT execute (e.g.,
 *    rate limit exceeded before the action ran, or FK violation means the
 *    target was deleted). Infrastructure errors during the action itself
 *    are also rolled back because admin share operations are low-risk.
 *    Use for: admin write paths where legitimate user errors (duplicate
 *    key, already-exists) should not consume rate-limit budget.
 *
 * 4. **Charged post-validation** (/api/og and /api/og/photo/[id] —
 *    AGG8F-01 / SEC-R4C17-01):
 *    Rollback ONLY for syntactic pre-DB rejections (malformed params
 *    bounced before any DB lookup or CPU). EVERYTHING after validation
 *    stays charged — nonexistent topics/photos, missing derivatives,
 *    render errors, and infrastructure errors alike. Rationale: the
 *    guarded resource here is the route's OWN DB/CPU work, which those
 *    branches have already consumed; refunding them turns the limiter
 *    into a free enumeration oracle with unmetered DB/CPU consumption.
 *    Both OG buckets are source-locked to this contract
 *    (og-route-source-contracts.test.ts — zero rollbacks;
 *    og-photo-fallback.test.ts — exactly one, pre-DB).
 *    Use for: unauthenticated CPU/DB-expensive GET surfaces where
 *    failure responses are themselves attacker-probeable.
 */
import { createHash } from 'crypto';
import { isIP } from 'net';
import { db, rateLimitBuckets } from '@/db';
import { and, eq, sql } from 'drizzle-orm';
import { createResetAtBoundedMap, createWindowBoundedMap, type WindowEntry } from '@/lib/bounded-map';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_MAX_KEYS = 5000;

export const SEARCH_WINDOW_MS = 60 * 1000; // 1 minute
export const SEARCH_MAX_REQUESTS = 30;
export const SEARCH_RATE_LIMIT_MAX_KEYS = 2000;

export const ADMIN_TOKEN_AUTH_WINDOW_MS = 60 * 1000;
export const ADMIN_TOKEN_AUTH_MAX_REQUESTS = 120;
export const ADMIN_TOKEN_AUTH_RATE_LIMIT_MAX_KEYS = 2000;

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
const OG_RATE_LIMIT_PRUNE_INTERVAL_MS = 60 * 1000; // 1 minute
let lastOgRateLimitPruneAt = 0;

// In-memory rate limit for public share-key lookup routes (/s/[key] and /g/[key]).
// These routes are unauthenticated and each lookup hits the DB. Without rate
// limiting, bots can probe random share keys causing unnecessary DB pressure.
// Budget: 60 requests per minute per IP — generous for legitimate browsing,
// restrictive enough to throttle automated key enumeration.
export const SHARE_WINDOW_MS = 60 * 1000;
export const SHARE_MAX_REQUESTS = 60;
export const SHARE_RATE_LIMIT_MAX_KEYS = 2000;
export const shareRateLimit = createResetAtBoundedMap<string>(SHARE_RATE_LIMIT_MAX_KEYS);
const SHARE_RATE_LIMIT_PRUNE_INTERVAL_MS = 60 * 1000; // 1 minute
let lastShareRateLimitPruneAt = 0;

// In-memory rate limit for public per-topic Atom feed lookups. Successful feed
// responses remain publicly cacheable, but topic-miss probes still hit DB.
export const FEED_WINDOW_MS = 60 * 1000;
export const FEED_MAX_REQUESTS = 60;
export const FEED_RATE_LIMIT_MAX_KEYS = 2000;
export const feedRateLimit = createResetAtBoundedMap<string>(FEED_RATE_LIMIT_MAX_KEYS);
const FEED_RATE_LIMIT_PRUNE_INTERVAL_MS = 60 * 1000;
let lastFeedRateLimitPruneAt = 0;

// Re-export RateLimitEntry from bounded-map for backward compatibility
export type RateLimitEntry = WindowEntry;

export type HeaderLike = { get(name: string): string | null };

const RATE_LIMIT_BUCKET_KEY_MAX_LENGTH = 45;
const ACCOUNT_RATE_LIMIT_PREFIX = 'acct:';
const ACCOUNT_RATE_LIMIT_HASH_LENGTH = RATE_LIMIT_BUCKET_KEY_MAX_LENGTH - ACCOUNT_RATE_LIMIT_PREFIX.length;
const DEFAULT_TRUSTED_PROXY_HOPS = 1;
export const RATE_LIMIT_BUCKET_PURGE_BATCH_SIZE = 1000;
export const RATE_LIMIT_BUCKET_PURGE_MAX_BATCHES = 50;

// In-memory Maps kept as fast-path cache. On restart they are empty;
// the DB is the source of truth.
export const loginRateLimit = createWindowBoundedMap<string>(LOGIN_RATE_LIMIT_MAX_KEYS, LOGIN_WINDOW_MS);

export const searchRateLimit = createResetAtBoundedMap<string>(SEARCH_RATE_LIMIT_MAX_KEYS);
const SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS = 1000;
let lastSearchRateLimitPruneAt = 0;
let warnedMissingTrustProxy = false;

const adminTokenAuthRateLimit = createResetAtBoundedMap<string>(ADMIN_TOKEN_AUTH_RATE_LIMIT_MAX_KEYS);

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
    // R20C20: Number(), not parseInt — parseInt('1e1')===1 (wrong); Number('1e1')===10.
    // The Number.isInteger guard rejects fractional/NaN values back to the default,
    // which is the conservative (fewer-trusted-hops) choice for this security setting.
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_TRUSTED_PROXY_HOPS;
    return parsed;
}

export function getClientIp(headerStore: HeaderLike): string {
    // TEMP-CLIENTIP-DIAG (remove after diagnosis): privacy-safe — logs header
    // PRESENCE/shape only, never the actual IP. Gated on a request header so
    // only an explicit probe triggers it.
    if (headerStore.get('x-clientip-diag') === '1') {
        const xff = headerStore.get('x-forwarded-for') || '';
        console.error('[CLIENTIP-DIAG]', JSON.stringify({
            trust: process.env.TRUST_PROXY ?? '(unset)',
            hops: process.env.TRUSTED_PROXY_HOPS ?? '(unset)',
            hasXff: !!xff,
            xffParts: xff ? xff.split(',').filter(Boolean).length : 0,
            hasXReal: !!headerStore.get('x-real-ip'),
        }));
    }
    // Only trust proxy headers when TRUST_PROXY is explicitly set.
    // Without it, an attacker can spoof X-Forwarded-For to bypass rate limits.
    if (process.env.TRUST_PROXY === 'true') {
        const xForwardedFor = headerStore.get('x-forwarded-for');
        if (xForwardedFor && xForwardedFor.length <= 512) {
            const parts = xForwardedFor.split(',').map(p => p.trim()).filter(Boolean);
            // AGG9B-22 / CR9-S2 (loop-B cycle 9b): standard append-mode
            // proxies (`$proxy_add_x_forwarded_for`) each append the PEER
            // ADDRESS they accepted the connection from, so with `hopCount`
            // trusted proxies the entry appended by the OUTERMOST trusted
            // proxy — the true client as that proxy saw it — sits at raw
            // position `parts.length - hopCount` (the hopCount-th entry from
            // the right). Example: client → cdn → nginx (hops=2) yields
            // "…client-sent junk…, client, cdn"; the client is 2nd from the
            // right. The previous `- 1` selected one slot further left — an
            // attacker-controllable leftover under append mode, and an
            // always-out-of-range index under the shipped overwrite-mode
            // nginx (which was only saved by the X-Real-IP fallback).
            // Index on RAW right-anchored positions (not a normalize-filtered
            // list) so an unparseable spoofed entry cannot shift the client
            // slot; if the selected entry does not normalize, fall through to
            // X-Real-IP rather than guessing. Chains shorter than hopCount
            // (a trusted hop did not append) also fall through.
            const hopCount = getTrustedProxyHopCount();
            const clientIndex = parts.length - hopCount;
            if (clientIndex >= 0) {
                const clientIp = normalizeIp(parts[clientIndex]);
                if (clientIp) return clientIp;
            }
        }

        const xRealIp = normalizeIp(headerStore.get('x-real-ip'));
        if (xRealIp) return xRealIp;
    }

    const ip = 'unknown';
    if (shouldWarnMissingTrustProxy(process.env.NODE_ENV, process.env.TRUST_PROXY, headerStore) && !warnedMissingTrustProxy) {
        warnedMissingTrustProxy = true;
        console.error('[rate-limit] [SECURITY] Proxy headers are present but TRUST_PROXY is not set — rate limiting uses "unknown" IP, meaning ALL users share a single rate-limit bucket. After 5 failed login attempts from ANY IP, ALL users are locked out for 15 minutes. Set TRUST_PROXY=true if behind a reverse proxy (e.g., nginx).');
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

export function pruneAdminTokenAuthRateLimit(now: number) {
    adminTokenAuthRateLimit.prune(now);
}

/** Lightweight pre-auth guard for PAT-bearing admin API requests.
 *
 * This runs before `verifyToken()`, which consults the DB, so invalid token
 * spray is bounded even when no authenticated session exists. The limit is
 * deliberately looser than public search because Lightroom integrations can
 * burst metadata reads during sync.
 */
export function preIncrementAdminTokenAuthAttempt(ip: string, now: number = Date.now()): boolean {
    pruneAdminTokenAuthRateLimit(now);
    const entry = adminTokenAuthRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        adminTokenAuthRateLimit.set(ip, { count: 1, resetAt: now + ADMIN_TOKEN_AUTH_WINDOW_MS });
    } else {
        adminTokenAuthRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    }
    return (adminTokenAuthRateLimit.get(ip)?.count ?? 0) > ADMIN_TOKEN_AUTH_MAX_REQUESTS;
}

export function resetAdminTokenAuthRateLimitForTests() {
    adminTokenAuthRateLimit.clear();
}

// AGG8F-01 / plan-233: pre-increment-then-check helpers for `/api/og`.
// Uses the same pattern as `loadMoreImages` in actions/public.ts so the
// public-unauthenticated rate-limit posture is uniform across surfaces.
export function pruneOgRateLimit(now: number, options?: { force?: boolean }) {
    const shouldPrune =
        options?.force
        || ogRateLimit.size > OG_RATE_LIMIT_MAX_KEYS
        || now - lastOgRateLimitPruneAt >= OG_RATE_LIMIT_PRUNE_INTERVAL_MS;

    if (!shouldPrune) {
        return false;
    }

    lastOgRateLimitPruneAt = now;
    ogRateLimit.prune(now);
    return true;
}

/** Returns `true` when the (pre-incremented) bucket is over the limit. */
export function preIncrementOgAttempt(ip: string, now: number): boolean {
    pruneOgRateLimit(now);
    const entry = ogRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        ogRateLimit.set(ip, { count: 1, resetAt: now + OG_WINDOW_MS });
    } else {
        ogRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    }
    return (ogRateLimit.get(ip)?.count ?? 0) > OG_MAX_REQUESTS;
}

/** Roll back a pre-incremented OG rate-limit counter.
 *
 *  SEC-R4C17-01 / DOC-R4C17-02: ONLY for rejections that consumed no
 *  post-validation work — i.e. malformed params bounced BEFORE any DB
 *  lookup or CPU (a non-numeric photo id). Post-DB failures
 *  (nonexistent topic/photo, missing derivatives, render errors) stay
 *  CHARGED: refunding them turns the limiter into a free enumeration
 *  oracle with unmetered DB/CPU consumption — the charged-404 policy
 *  AGG8F-01 established on `/api/og`. The OG bucket therefore follows
 *  Pattern-1 semantics for everything after syntactic validation
 *  (the guarded resource is server CPU/DB, not user fairness). Both
 *  routes' policies are source-locked: og-route-source-contracts.test.ts
 *  (topic route — zero rollbacks) and og-photo-fallback.test.ts
 *  (photo route — exactly two, both pre-DB). */
export function rollbackOgAttempt(ip: string) {
    const currentEntry = ogRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        ogRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt });
    } else {
        ogRateLimit.delete(ip);
    }
}

export function resetOgRateLimitForTests() {
    ogRateLimit.clear();
    lastOgRateLimitPruneAt = 0;
}

// ── Share-key rate-limit helpers ────────────────────────────────────

export function pruneShareRateLimit(now: number, options?: { force?: boolean }) {
    const shouldPrune =
        options?.force
        || shareRateLimit.size > SHARE_RATE_LIMIT_MAX_KEYS
        || now - lastShareRateLimitPruneAt >= SHARE_RATE_LIMIT_PRUNE_INTERVAL_MS;

    if (!shouldPrune) {
        return false;
    }

    lastShareRateLimitPruneAt = now;
    shareRateLimit.prune(now);
    return true;
}

/** Returns `true` when the (pre-incremented) bucket is over the limit. */
export function preIncrementShareAttempt(ip: string, now: number = Date.now()): boolean {
    pruneShareRateLimit(now);
    const entry = shareRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        shareRateLimit.set(ip, { count: 1, resetAt: now + SHARE_WINDOW_MS });
    } else {
        shareRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    }
    return (shareRateLimit.get(ip)?.count ?? 0) > SHARE_MAX_REQUESTS;
}

export function resetShareRateLimitForTests() {
    shareRateLimit.clear();
    lastShareRateLimitPruneAt = 0;
}

export function pruneFeedRateLimit(now: number, options?: { force?: boolean }) {
    const shouldPrune =
        options?.force
        || feedRateLimit.size > FEED_RATE_LIMIT_MAX_KEYS
        || now - lastFeedRateLimitPruneAt >= FEED_RATE_LIMIT_PRUNE_INTERVAL_MS;

    if (!shouldPrune) {
        return false;
    }

    lastFeedRateLimitPruneAt = now;
    feedRateLimit.prune(now);
    return true;
}

/** Returns `true` when the public feed bucket is over the limit. */
export function preIncrementFeedAttempt(ip: string, now: number = Date.now()): boolean {
    pruneFeedRateLimit(now);
    const entry = feedRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        feedRateLimit.set(ip, { count: 1, resetAt: now + FEED_WINDOW_MS });
    } else {
        feedRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    }
    return (feedRateLimit.get(ip)?.count ?? 0) > FEED_MAX_REQUESTS;
}

export function resetFeedRateLimitForTests() {
    feedRateLimit.clear();
    lastFeedRateLimitPruneAt = 0;
}

// ── Semantic search rate-limit helpers ────────────────────────────────

export const SEMANTIC_RATE_LIMIT_MAX = 30;
export const SEMANTIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const SEMANTIC_RATE_LIMIT_MAX_KEYS = 2000;
const semanticRateLimit = createResetAtBoundedMap<string>(SEMANTIC_RATE_LIMIT_MAX_KEYS);

export function pruneSemanticRateLimit(now: number) {
    semanticRateLimit.prune(now);
}

/** Pre-increment the semantic search rate-limit counter. Returns `true` when the
 *  bucket is over the limit AFTER the increment. Callers refund only branches
 *  that return before the guarded embedding/vector-scan work is consumed. */
export function preIncrementSemanticAttempt(ip: string, now: number = Date.now()): boolean {
    pruneSemanticRateLimit(now);
    const entry = semanticRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        semanticRateLimit.set(ip, { count: 1, resetAt: now + SEMANTIC_RATE_LIMIT_WINDOW_MS });
    } else {
        semanticRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    }
    return (semanticRateLimit.get(ip)?.count ?? 0) > SEMANTIC_RATE_LIMIT_MAX;
}

/** Roll back a pre-incremented semantic search rate-limit counter. Used only
 *  when a request exits before semantic mode lookup or body admission consumes
 *  protected work. Disabled/stub-mode responses and malformed or too-short
 *  bodies that were already read stay charged per the route-level posture. */
export function rollbackSemanticAttempt(ip: string) {
    const currentEntry = semanticRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        semanticRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt });
    } else {
        semanticRateLimit.delete(ip);
    }
}

export function resetSemanticRateLimitForTests(): void {
    semanticRateLimit.clear();
}

// ── MySQL-backed persistent rate limiting ──────────────────────────────

/**
 * Align a timestamp to the start of its rate-limit window.
 * Returns unix seconds (not ms) aligned to the window boundary.
 */
export function getRateLimitBucketStart(nowMs: number, windowMs: number): number {
    const windowSec = Math.max(1, Math.floor(windowMs / 1000));
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
 * Unlike resetRateLimit (which deletes the whole entry), this wraps
 * decrement and cleanup in a transaction so concurrent increments are
 * not lost between UPDATE and DELETE.
 * If the count would drop to 0 or below, the row is deleted instead.
 */
export async function decrementRateLimit(
    ip: string,
    type: string,
    windowMs: number,
    bucketStart: number = getRateLimitBucketStart(Date.now(), windowMs),
): Promise<void> {
    const start = bucketStart;

    await db.transaction(async (tx) => {
        // Decrement first
        await tx.update(rateLimitBuckets)
            .set({ count: sql`GREATEST(${rateLimitBuckets.count} - 1, 0)` })
            .where(
                and(
                    eq(rateLimitBuckets.ip, ip),
                    eq(rateLimitBuckets.bucketType, type),
                    eq(rateLimitBuckets.bucketStart, start),
                ),
            );

        // Clean up zero-count rows to avoid accumulation
        await tx.delete(rateLimitBuckets).where(
            and(
                eq(rateLimitBuckets.ip, ip),
                eq(rateLimitBuckets.bucketType, type),
                eq(rateLimitBuckets.bucketStart, start),
                sql`${rateLimitBuckets.count} <= 0`,
            ),
        );
    });
}

function affectedRowsFromDelete(result: unknown): number {
    const candidate = Array.isArray(result) ? result[0] : result;
    if (candidate && typeof candidate === 'object' && 'affectedRows' in candidate) {
        const affectedRows = (candidate as { affectedRows?: unknown }).affectedRows;
        if (typeof affectedRows === 'number' && Number.isFinite(affectedRows)) return affectedRows;
    }
    return 0;
}

/**
 * Remove expired buckets from the database in indexed, bounded batches.
 * Call periodically (e.g., from the existing hourly GC interval).
 */
export async function purgeOldBuckets(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoffSec = Math.floor((Date.now() - maxAgeMs) / 1000);
    let deleted = 0;

    for (let batch = 0; batch < RATE_LIMIT_BUCKET_PURGE_MAX_BATCHES; batch += 1) {
        const result = await db.execute(sql`
            DELETE FROM ${rateLimitBuckets}
            WHERE ${rateLimitBuckets.bucketStart} < ${cutoffSec}
            LIMIT ${RATE_LIMIT_BUCKET_PURGE_BATCH_SIZE}
        `);
        const affectedRows = affectedRowsFromDelete(result);
        deleted += affectedRows;
        if (affectedRows < RATE_LIMIT_BUCKET_PURGE_BATCH_SIZE) break;
    }

    return deleted;
}
