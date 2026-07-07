'use server';

import { headers } from 'next/headers';
import { getImagesLite, normalizeImageListCursor, searchImages, getSmartCollectionBySlugCached, getImagesForSmartCollection, type ImageListCursorInput } from '@/lib/data';
import { parseSmartCollectionQuery, compileSmartCollection } from '@/lib/smart-collections';
import { db, images, imageViews, topicViews, sharedGroupViews, sharedGroups, sharedGroupImages, topics } from '@/db';
import { isBot, lookupCountry, sanitizeReferrerHost } from '@/lib/analytics';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { isValidSlug, isValidTagSlug } from '@/lib/validation';
import { isBase56 } from '@/lib/base56';
import { stripControlChars } from '@/lib/sanitize';
import { countCodePoints } from '@/lib/utils';
import { getClientIp, searchRateLimit, SEARCH_WINDOW_MS, SEARCH_MAX_REQUESTS, checkRateLimit, decrementRateLimit, incrementRateLimit, isRateLimitExceeded, pruneSearchRateLimit, getRateLimitBucketStart } from '@/lib/rate-limit';
import { createResetAtBoundedMap } from '@/lib/bounded-map';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { canonicalizeRequestedTagSlugs } from '@/lib/tag-slugs';
import { toMySqlDateTime } from '@/lib/mysql-datetime';
import { trackAnalyticsDbWrite } from '@/lib/background-db-writes';

type PublicImageListItem = Awaited<ReturnType<typeof getImagesLite>>[number];
type PublicSearchItem = Awaited<ReturnType<typeof searchImages>>[number];

export type LoadMoreImagesResult =
    | { status: 'ok'; images: PublicImageListItem[]; hasMore: boolean }
    | { status: 'maintenance' | 'rateLimited' | 'error'; images: []; hasMore: true }
    | { status: 'invalid'; images: []; hasMore: false };

export type SearchImagesResult =
    | { status: 'ok'; results: PublicSearchItem[] }
    | { status: 'maintenance' | 'rateLimited' | 'error' | 'invalid'; results: [] };

async function rollbackSearchAttempt(ip: string, bucketStart: number, dbIncremented: boolean) {
    const currentEntry = searchRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        searchRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt });
    } else {
        searchRateLimit.delete(ip);
    }
    if (dbIncremented) {
        await decrementRateLimit(ip, 'search', SEARCH_WINDOW_MS, bucketStart).catch((err) => {
            console.debug('Failed to roll back search DB rate limit:', err);
        });
    }
}

const LOAD_MORE_WINDOW_MS = 60 * 1000;
const LOAD_MORE_MAX_REQUESTS = 120;
const LOAD_MORE_RATE_LIMIT_MAX_KEYS = 2000;
const loadMoreRateLimit = createResetAtBoundedMap<string>(LOAD_MORE_RATE_LIMIT_MAX_KEYS);

function pruneLoadMoreRateLimit(now: number) {
    loadMoreRateLimit.prune(now);
}

function preIncrementLoadMoreAttempt(ip: string, now: number): boolean {
    pruneLoadMoreRateLimit(now);
    const entry = loadMoreRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        loadMoreRateLimit.set(ip, { count: 1, resetAt: now + LOAD_MORE_WINDOW_MS });
    } else {
        loadMoreRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    }
    return (loadMoreRateLimit.get(ip)?.count ?? 0) > LOAD_MORE_MAX_REQUESTS;
}

function rollbackLoadMoreAttempt(ip: string, bucketStart?: number, dbIncremented: boolean = false) {
    const currentEntry = loadMoreRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        loadMoreRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt });
    } else {
        loadMoreRateLimit.delete(ip);
    }
    // C16-MED-01: symmetric rollback of in-memory and DB counters, matching
    // the searchImagesAction rollback pattern. The DB decrement is best-effort
    // so a transient DB failure does not prevent the in-memory rollback.
    if (dbIncremented && bucketStart !== undefined) {
        decrementRateLimit(ip, 'load_more', LOAD_MORE_WINDOW_MS, bucketStart).catch((err) => {
            console.debug('Failed to roll back load_more DB rate limit:', err);
        });
    }
}

/** M6: Shared load-more rate-limit check. Returns 'rateLimited' when the bucket
 *  is over limit, 'ok' when under limit, or 'dbError' when the DB check fails
 *  but the in-memory check passed (caller should proceed with caution).
 *  Handles pre-increment, DB increment, combined check, and rollback uniformly. */
async function checkLoadMoreRateLimit(
    ip: string,
    now: number,
): Promise<{ status: 'ok' | 'rateLimited' | 'dbError'; bucketStart: number; dbIncremented: boolean }> {
    const bucketStart = getRateLimitBucketStart(now, LOAD_MORE_WINDOW_MS);
    // C1-01 (run-10 cycle-1): read-only saturated fast path, mirroring
    // searchImagesAction. A caller already at/over the in-memory budget is
    // rejected before ANY persistent limiter work, so a sustained over-limit
    // retry loop costs zero DB increment/select/decrement round-trips on the
    // single-writer MySQL instance. Admitted-request accounting below is
    // unchanged.
    pruneLoadMoreRateLimit(now);
    const saturatedEntry = loadMoreRateLimit.get(ip);
    if (saturatedEntry && saturatedEntry.resetAt > now && saturatedEntry.count >= LOAD_MORE_MAX_REQUESTS) {
        return { status: 'rateLimited', bucketStart, dbIncremented: false };
    }
    const overLimitInMemory = preIncrementLoadMoreAttempt(ip, now);
    let dbIncremented = false;

    try {
        await incrementRateLimit(ip, 'load_more', LOAD_MORE_WINDOW_MS, bucketStart);
        dbIncremented = true;
    } catch {
        // DB unavailable — keep the in-memory pre-increment
    }

    try {
        const dbLimit = await checkRateLimit(ip, 'load_more', LOAD_MORE_MAX_REQUESTS, LOAD_MORE_WINDOW_MS, bucketStart);
        if (overLimitInMemory || isRateLimitExceeded(dbLimit.count, LOAD_MORE_MAX_REQUESTS, true)) {
            rollbackLoadMoreAttempt(ip, bucketStart, dbIncremented);
            return { status: 'rateLimited', bucketStart, dbIncremented };
        }
    } catch {
        if (overLimitInMemory) {
            rollbackLoadMoreAttempt(ip, bucketStart, dbIncremented);
            return { status: 'rateLimited', bucketStart, dbIncremented };
        }
        // DB check failed but in-memory passed — proceed with caution
        return { status: 'dbError', bucketStart, dbIncremented };
    }

    return { status: 'ok', bucketStart, dbIncremented };
}

/** @action-origin-exempt: public read-only pagination action with its own rate limit */
export async function loadMoreImages(topicSlug?: string, tagSlugs?: string[], offsetOrCursor: number | ImageListCursorInput = 0, limit: number = 30): Promise<LoadMoreImagesResult> {
    if (isRestoreMaintenanceActive()) return { status: 'maintenance', images: [], hasMore: true };
    // Validate slug format before passing to data layer (defense in depth)
    if (topicSlug && (!isValidSlug(topicSlug))) return { status: 'invalid', images: [], hasMore: false };
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const normalizedCursor = normalizeImageListCursor(offsetOrCursor);
    if (!normalizedCursor && typeof offsetOrCursor === 'object' && offsetOrCursor !== null) {
        return { status: 'invalid', images: [], hasMore: false };
    }
    const usesCursor = normalizedCursor !== null;
    const safeOffset = normalizedCursor ?? Math.max(Math.floor(Number(offsetOrCursor)) || 0, 0);
    // Cap legacy offset pagination to prevent deep pagination DoS. Cursor-based
    // calls are preferred because they stay stable when new photos arrive.
    if (!usesCursor && typeof safeOffset === 'number' && safeOffset > 10000) return { status: 'invalid', images: [], hasMore: false };
    // Cap tag array and validate format to prevent complex query DoS
    const safeTags = Array.isArray(tagSlugs)
        ? canonicalizeRequestedTagSlugs(tagSlugs).filter(isValidTagSlug)
        : [];

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();

    // M6: DRY rate-limit check via shared helper
    const rateLimitResult = await checkLoadMoreRateLimit(ip, now);
    if (rateLimitResult.status === 'rateLimited') {
        return { status: 'rateLimited', images: [], hasMore: true };
    }

    try {
        const rows = await getImagesLite(topicSlug, safeTags, safeLimit + 1, safeOffset);
        return {
            status: 'ok',
            images: rows.slice(0, safeLimit),
            hasMore: rows.length > safeLimit,
        };
    } catch (err) {
        rollbackLoadMoreAttempt(ip, rateLimitResult.bucketStart, rateLimitResult.dbIncremented);
        // C2-MED-02: return a structured error response instead of throwing.
        // Throwing from a server action sends a generic error to the client
        // and can leave the Load More button in a broken state. Returning a
        // structured response lets the client handle the error gracefully
        // with a toast notification while keeping the button functional.
        console.error('loadMoreImages failed:', err);
        return { status: 'error', images: [], hasMore: true };
    }
}

/** @action-origin-exempt: public read-only pagination action with its own rate limit */
export async function loadMoreSmartCollectionImages(
    slug: string,
    offsetOrCursor: number | ImageListCursorInput = 0,
    limit: number = 30,
): Promise<LoadMoreImagesResult> {
    if (isRestoreMaintenanceActive()) return { status: 'maintenance', images: [], hasMore: true };
    if (!isValidSlug(slug)) return { status: 'invalid', images: [], hasMore: false };

    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    // R4C5 COR-R4C5-01: mirror loadMoreImages' cursor handling. The load-more
    // client sends a keyset cursor after the first page; the previous
    // offset-only coercion turned that object into `Number(obj) → NaN → 0`,
    // so every load-more re-served page 1 (duplicate grid + endless sentinel
    // loop). Unparseable object cursors fail closed as 'invalid' instead of
    // silently becoming offset 0.
    const normalizedCursor = normalizeImageListCursor(offsetOrCursor);
    if (!normalizedCursor && typeof offsetOrCursor === 'object' && offsetOrCursor !== null) {
        return { status: 'invalid', images: [], hasMore: false };
    }
    const usesCursor = normalizedCursor !== null;
    const safeOffset = normalizedCursor ?? Math.max(Math.floor(Number(offsetOrCursor)) || 0, 0);
    // Cap legacy offset pagination to prevent deep pagination DoS. Cursor-based
    // calls are preferred because they stay stable when new photos arrive.
    if (!usesCursor && typeof safeOffset === 'number' && safeOffset > 10000) {
        return { status: 'invalid', images: [], hasMore: false };
    }

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();

    // M6: DRY rate-limit check via shared helper
    const rateLimitResult = await checkLoadMoreRateLimit(ip, now);
    if (rateLimitResult.status === 'rateLimited') {
        return { status: 'rateLimited', images: [], hasMore: true };
    }

    try {
        const collection = await getSmartCollectionBySlugCached(slug);
        if (!collection || !collection.is_public) {
            return { status: 'invalid', images: [], hasMore: false };
        }

        const ast = parseSmartCollectionQuery(collection.query_json);
        const compiledCondition = compileSmartCollection(ast);
        // R4C5 COR-R4C5-01: pass `safeLimit` — the helper applies its own
        // single +1 lookahead internally. The previous `safeLimit + 1`
        // double-applied it, making `hasMore` false while exactly
        // `safeLimit + 1` rows remained and the `.slice(0, safeLimit)`
        // dropped the final row — collections sized ≡ 1 (mod page size)
        // permanently lost their last photo.
        const { images: rows, hasMore } = await getImagesForSmartCollection(compiledCondition, safeLimit, safeOffset);

        return {
            status: 'ok',
            images: rows,
            hasMore,
        };
    } catch (err) {
        rollbackLoadMoreAttempt(ip, rateLimitResult.bucketStart, rateLimitResult.dbIncremented);
        console.error('loadMoreSmartCollectionImages failed:', err);
        return { status: 'error', images: [], hasMore: true };
    }
}

/** @action-origin-exempt: public read-only search action with its own rate limit */
export async function searchImagesAction(query: string): Promise<SearchImagesResult> {
    if (!query || typeof query !== 'string') return { status: 'invalid', results: [] };
    if (isRestoreMaintenanceActive()) return { status: 'maintenance', results: [] };
    // Sanitize before validation so length checks operate on the same value
    // that will be stored (matches uploadImages/settings.ts pattern, see C46-02).
    // This ordering is correct: control characters are stripped FIRST so they
    // cannot inflate the code-point count (e.g., a 200-char string with 1 control
    // char would pass a 200-code-point limit if counted before stripping, but
    // the stored value would be 199 code points — under the limit). Stripping
    // before counting ensures the limit reflects the actual stored value length.
    const sanitizedQuery = stripControlChars(query.trim()) ?? '';
    // C9RPF-MED-02: use countCodePoints for both min and max length checks
    // so supplementary characters (emoji, rare CJK) are counted consistently.
    // Previously, min used `.length` (UTF-16 code units) while max used
    // `countCodePoints`, causing a single emoji to pass the min check
    // (`.length === 2`) even though it is one logical character.
    if (countCodePoints(sanitizedQuery) > 200 || countCodePoints(sanitizedQuery) < 2) return { status: 'invalid', results: [] };

    // Server-side rate limiting for search (LIKE queries are expensive)
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    const bucketStart = getRateLimitBucketStart(now, SEARCH_WINDOW_MS);
    pruneSearchRateLimit(now);

    // Fast-path check from in-memory Map
    const entry = searchRateLimit.get(ip);
    if (entry && entry.resetAt > now && entry.count >= SEARCH_MAX_REQUESTS) {
        return { status: 'rateLimited', results: [] };
    }

    // Increment BEFORE the DB-backed check (TOCTOU fix).
    // Without this, concurrent requests all pass the check before any of them
    // record the increment, allowing burst searches to exceed the limit.
    if (!entry || entry.resetAt <= now) {
        searchRateLimit.set(ip, { count: 1, resetAt: now + SEARCH_WINDOW_MS });
    } else {
        searchRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    }

    // DB-backed increment BEFORE the check (matches sharing.ts and admin-users.ts pattern).
    // Use one pinned bucketStart for increment/check/rollback so a request that
    // crosses a minute boundary cannot decrement the wrong MySQL bucket.
    let searchDbIncremented = false;
    try {
        await incrementRateLimit(ip, 'search', SEARCH_WINDOW_MS, bucketStart);
        searchDbIncremented = true;
    } catch {
        // DB unavailable — keep the in-memory pre-increment so the in-memory
        // rate limit remains effective during DB outages. The in-memory map
        // is the fallback authority when the DB is unreachable.
    }

    // DB-backed check for accuracy across restarts
    try {
        const dbLimit = await checkRateLimit(ip, 'search', SEARCH_MAX_REQUESTS, SEARCH_WINDOW_MS, bucketStart);
        if (isRateLimitExceeded(dbLimit.count, SEARCH_MAX_REQUESTS, true)) {
            await rollbackSearchAttempt(ip, bucketStart, searchDbIncremented);
            return { status: 'rateLimited', results: [] };
        }
    } catch {
        // DB unavailable — rely on in-memory Map
    }

    // C21-AGG-01: pass sanitizedQuery directly instead of slicing with
    // .slice(0, 200) which can split a surrogate pair (UTF-16 boundary).
    // The caller already validates length with countCodePoints() above,
    // and searchImages in data.ts also guards with countCodePoints(query) > 200.
    try {
        return { status: 'ok', results: await searchImages(sanitizedQuery, 20) };
    } catch (err) {
        await rollbackSearchAttempt(ip, bucketStart, searchDbIncremented);
        // C18-MED-01: return a structured error response instead of throwing.
        // Throwing from a server action sends a generic error to the client
        // and can leave the search UI in a broken state. Returning a
        // structured response lets the client handle the error gracefully
        // with a toast notification while keeping search functional.
        // Matches the loadMoreImages pattern (C2-MED-02).
        console.error('searchImagesAction failed:', err);
        return { status: 'error', results: [] };
    }
}

// ---------------------------------------------------------------------------
// US-P44: fire-and-forget view recording actions.
// These live in public.ts and carry explicit @action-origin-exempt comments
// because lint:action-origin scans this file too. They do NOT require
// same-origin admin auth — they are intentionally public, rate-limited, and
// validate targets before durable writes.
// Bot views are recorded with bot=true and excluded from public-facing counts.
// Full IPs are never stored; only country_code derived from the IP.
// ---------------------------------------------------------------------------

// C9RPF-MED-01: in-memory per-IP rate limit for analytics view-recording
// endpoints. Without this, bots or malicious actors can flood the
// imageViews/topicViews/sharedGroupViews tables with millions of INSERTs.
// Budget: 120 requests/min per IP — generous for normal browsing (one view
// per page load) but restrictive enough to prevent automated flooding.
const VIEW_RECORD_WINDOW_MS = 60 * 1000;
const VIEW_RECORD_MAX_REQUESTS = 120;
const VIEW_RECORD_RATE_LIMIT_MAX_KEYS = 2000;
const VIEW_RECORD_BUCKET_TYPE = 'view_record';
const viewRecordRateLimit = createResetAtBoundedMap<string>(VIEW_RECORD_RATE_LIMIT_MAX_KEYS);

function isViewRecordRateLimited(ip: string, now: number): boolean {
    viewRecordRateLimit.prune(now);
    const entry = viewRecordRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        viewRecordRateLimit.set(ip, { count: 1, resetAt: now + VIEW_RECORD_WINDOW_MS });
        return false;
    }
    viewRecordRateLimit.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    return entry.count + 1 > VIEW_RECORD_MAX_REQUESTS;
}

async function rollbackViewRecordAttempt(ip: string, bucketStart: number, dbIncremented: boolean) {
    const currentEntry = viewRecordRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        viewRecordRateLimit.set(ip, { count: currentEntry.count - 1, resetAt: currentEntry.resetAt });
    } else {
        viewRecordRateLimit.delete(ip);
    }
    if (dbIncremented) {
        await decrementRateLimit(ip, VIEW_RECORD_BUCKET_TYPE, VIEW_RECORD_WINDOW_MS, bucketStart).catch((err) => {
            console.debug('Failed to roll back view_record DB rate limit:', err);
        });
    }
}

async function checkViewRecordRateLimit(
    ip: string,
    now: number,
): Promise<{ status: 'ok' | 'rateLimited'; bucketStart: number; dbIncremented: boolean }> {
    const bucketStart = getRateLimitBucketStart(now, VIEW_RECORD_WINDOW_MS);
    // C1-01 (run-10 cycle-1): read-only saturated fast path — see
    // checkLoadMoreRateLimit. Over-limit view recording must not spend DB
    // limiter round-trips per rejected request.
    viewRecordRateLimit.prune(now);
    const saturatedEntry = viewRecordRateLimit.get(ip);
    if (saturatedEntry && saturatedEntry.resetAt > now && saturatedEntry.count >= VIEW_RECORD_MAX_REQUESTS) {
        return { status: 'rateLimited', bucketStart, dbIncremented: false };
    }
    const overLimitInMemory = isViewRecordRateLimited(ip, now);
    let dbIncremented = false;

    try {
        await incrementRateLimit(ip, VIEW_RECORD_BUCKET_TYPE, VIEW_RECORD_WINDOW_MS, bucketStart);
        dbIncremented = true;
    } catch {
        // DB unavailable: keep the in-memory pre-increment as the fallback authority.
    }

    try {
        const dbLimit = await checkRateLimit(ip, VIEW_RECORD_BUCKET_TYPE, VIEW_RECORD_MAX_REQUESTS, VIEW_RECORD_WINDOW_MS, bucketStart);
        if (overLimitInMemory || isRateLimitExceeded(dbLimit.count, VIEW_RECORD_MAX_REQUESTS, true)) {
            await rollbackViewRecordAttempt(ip, bucketStart, dbIncremented);
            return { status: 'rateLimited', bucketStart, dbIncremented };
        }
    } catch {
        if (overLimitInMemory) {
            await rollbackViewRecordAttempt(ip, bucketStart, dbIncremented);
            return { status: 'rateLimited', bucketStart, dbIncremented };
        }
    }

    return { status: 'ok', bucketStart, dbIncremented };
}

async function buildViewParams(requestHeaders: Awaited<ReturnType<typeof headers>>) {
    const ip = getClientIp(requestHeaders);
    const referrerHeader = requestHeaders.get('referer') ?? requestHeaders.get('referrer') ?? '';
    const ua = requestHeaders.get('user-agent') ?? '';
    return {
        ip,
        referrer_host: sanitizeReferrerHost(referrerHeader),
        country_code: lookupCountry(ip),
        bot: isBot(ua),
    };
}

/**
 * Record a photo view event. Intentionally fire-and-forget: the INSERT
 * is NOT awaited so analytics never blocks the page render. Errors are
 * swallowed across the full recorder body — a failed view recording is acceptable
 * compared to a broken user experience.
 *
 * @action-origin-exempt: public analytics endpoint — no admin auth needed
 */
export async function recordPhotoView(imageId: number): Promise<void> {
    if (typeof imageId !== 'number' || !Number.isInteger(imageId) || imageId <= 0) return;
    if (isRestoreMaintenanceActive()) return;
    try {
        const requestHeaders = await headers();
        const params = await buildViewParams(requestHeaders);
        if ((await checkViewRecordRateLimit(params.ip, Date.now())).status === 'rateLimited') return;
        const [visibleImage] = await db.select({ id: images.id })
            .from(images)
            .where(and(eq(images.id, imageId), eq(images.processed, true)))
            .limit(1);
        if (!visibleImage) return;
        if (isRestoreMaintenanceActive()) return;
        // Fire-and-forget: tracked for restore drain, but not awaited by pages.
        trackAnalyticsDbWrite(() => db.insert(imageViews).values({
            imageId,
            referrer_host: params.referrer_host,
            country_code: params.country_code,
            bot: params.bot,
        })).catch((err: unknown) => {
            console.warn('[analytics] recordPhotoView failed:', err);
        });
    } catch (err) {
        console.warn('[analytics] recordPhotoView failed:', err);
    }
}

// @action-origin-exempt: public analytics endpoint — no admin auth needed
export async function recordTopicView(topicSlug: string): Promise<void> {
    if (typeof topicSlug !== 'string' || topicSlug.length === 0 || topicSlug.length > 255) return;
    // R4C2 COR-R4C2-07: slug-format pre-check, parity with loadMoreImages.
    // The FK on topic_views.topic → topics.slug already rejects junk rows,
    // but failing fast here saves a doomed INSERT round-trip per junk call
    // and keeps the validation posture identical across the public actions.
    if (!isValidSlug(topicSlug)) return;
    if (isRestoreMaintenanceActive()) return;
    try {
        const requestHeaders = await headers();
        const params = await buildViewParams(requestHeaders);
        if ((await checkViewRecordRateLimit(params.ip, Date.now())).status === 'rateLimited') return;
        const [visibleTopic] = await db.select({ slug: topics.slug })
            .from(topics)
            .where(eq(topics.slug, topicSlug))
            .limit(1);
        if (!visibleTopic) return;
        if (isRestoreMaintenanceActive()) return;
        trackAnalyticsDbWrite(() => db.insert(topicViews).values({
            topic: topicSlug,
            referrer_host: params.referrer_host,
            country_code: params.country_code,
            bot: params.bot,
        })).catch((err: unknown) => {
            console.warn('[analytics] recordTopicView failed:', err);
        });
    } catch (err) {
        console.warn('[analytics] recordTopicView failed:', err);
    }
}

// @action-origin-exempt: public analytics endpoint — no admin auth needed
export async function recordSharedGroupView(groupId: number, groupKey: string): Promise<void> {
    if (typeof groupId !== 'number' || !Number.isInteger(groupId) || groupId <= 0) return;
    const trimmedGroupKey = typeof groupKey === 'string' ? groupKey.trim() : '';
    if (!isBase56(trimmedGroupKey, 10)) return;
    if (isRestoreMaintenanceActive()) return;
    try {
        const requestHeaders = await headers();
        const params = await buildViewParams(requestHeaders);
        if ((await checkViewRecordRateLimit(params.ip, Date.now())).status === 'rateLimited') return;
        const [visibleGroup] = await db.select({ id: sharedGroups.id })
            .from(sharedGroups)
            .innerJoin(sharedGroupImages, eq(sharedGroupImages.groupId, sharedGroups.id))
            .innerJoin(images, eq(sharedGroupImages.imageId, images.id))
            .where(and(
                eq(sharedGroups.id, groupId),
                eq(sharedGroups.key, trimmedGroupKey),
                eq(images.processed, true),
                or(isNull(sharedGroups.expires_at), gt(sharedGroups.expires_at, toMySqlDateTime(new Date()))),
            ))
            .limit(1);
        if (!visibleGroup) return;
        if (isRestoreMaintenanceActive()) return;
        trackAnalyticsDbWrite(() => db.insert(sharedGroupViews).values({
            groupId,
            referrer_host: params.referrer_host,
            country_code: params.country_code,
            bot: params.bot,
        })).catch((err: unknown) => {
            console.warn('[analytics] recordSharedGroupView failed:', err);
        });
    } catch (err) {
        console.warn('[analytics] recordSharedGroupView failed:', err);
    }
}
