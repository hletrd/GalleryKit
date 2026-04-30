'use server';

import { headers } from 'next/headers';
import { getImagesLite, normalizeImageListCursor, searchImages, type ImageListCursorInput } from '@/lib/data';

import { isValidSlug, isValidTagSlug } from '@/lib/validation';
import { stripControlChars } from '@/lib/sanitize';
import { countCodePoints } from '@/lib/utils';
import { getClientIp, searchRateLimit, SEARCH_WINDOW_MS, SEARCH_MAX_REQUESTS, checkRateLimit, decrementRateLimit, incrementRateLimit, isRateLimitExceeded, pruneSearchRateLimit, getRateLimitBucketStart } from '@/lib/rate-limit';
import { createResetAtBoundedMap } from '@/lib/bounded-map';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { canonicalizeRequestedTagSlugs } from '@/lib/tag-slugs';

type PublicImageListItem = Awaited<ReturnType<typeof getImagesLite>>[number];
type PublicSearchItem = Awaited<ReturnType<typeof searchImages>>[number];

export type LoadMoreImagesResult =
    | { status: 'ok'; images: PublicImageListItem[]; hasMore: boolean }
    | { status: 'maintenance' | 'rateLimited' | 'error'; images: []; hasMore: true }
    | { status: 'invalid'; images: []; hasMore: false };

export type SearchImagesResult =
    | { status: 'ok'; results: PublicSearchItem[] }
    | { status: 'maintenance' | 'rateLimited' | 'error' | 'invalid'; results: [] };

async function rollbackSearchAttempt(ip: string, bucketStart: number) {
    const currentEntry = searchRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
    } else {
        searchRateLimit.delete(ip);
    }
    await decrementRateLimit(ip, 'search', SEARCH_WINDOW_MS, bucketStart).catch((err) => {
        console.debug('Failed to roll back search DB rate limit:', err);
    });
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
        entry.count++;
    }
    return (loadMoreRateLimit.get(ip)?.count ?? 0) > LOAD_MORE_MAX_REQUESTS;
}

function rollbackLoadMoreAttempt(ip: string, bucketStart?: number) {
    const currentEntry = loadMoreRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
    } else {
        loadMoreRateLimit.delete(ip);
    }
    // C16-MED-01: symmetric rollback of in-memory and DB counters, matching
    // the searchImagesAction rollback pattern. The DB decrement is best-effort
    // so a transient DB failure does not prevent the in-memory rollback.
    if (bucketStart !== undefined) {
        decrementRateLimit(ip, 'load_more', LOAD_MORE_WINDOW_MS, bucketStart).catch((err) => {
            console.debug('Failed to roll back load_more DB rate limit:', err);
        });
    }
}

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
    const safeTags = canonicalizeRequestedTagSlugs(tagSlugs || [])
        .filter(isValidTagSlug);

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    const bucketStart = getRateLimitBucketStart(now, LOAD_MORE_WINDOW_MS);

    // C17-MED-01: in-memory pre-increment happens first (TOCTOU prevention),
    // then DB increment, THEN combined check. This order matches searchImagesAction
    // and ensures the DB counter stays in sync even when the in-memory map
    // catches an over-limit. Previously, the DB increment was skipped when
    // the in-memory pre-check caught an over-limit, causing the DB counter to
    // undercount after a process restart.
    const overLimitInMemory = preIncrementLoadMoreAttempt(ip, now);

    // C16-MED-01: DB-backed increment and check for accuracy across restarts.
    // Matches the searchImagesAction pattern. The DB round-trip is ~1ms and
    // does not materially impact scroll responsiveness at 120 req/min.
    try {
        await incrementRateLimit(ip, 'load_more', LOAD_MORE_WINDOW_MS, bucketStart);
    } catch {
        // DB unavailable — keep the in-memory pre-increment so the in-memory
        // rate limit remains effective during DB outages.
    }

    // Combined check: if either in-memory or DB-backed check shows over-limit,
    // roll back both counters and return rate-limited. The rollback on the
    // over-limit branch is symmetric with searchImagesAction.
    try {
        const dbLimit = await checkRateLimit(ip, 'load_more', LOAD_MORE_MAX_REQUESTS, LOAD_MORE_WINDOW_MS, bucketStart);
        if (overLimitInMemory || isRateLimitExceeded(dbLimit.count, LOAD_MORE_MAX_REQUESTS, true)) {
            rollbackLoadMoreAttempt(ip, bucketStart);
            return { status: 'rateLimited', images: [], hasMore: true };
        }
    } catch {
        // DB unavailable — rely on in-memory BoundedMap
        if (overLimitInMemory) {
            rollbackLoadMoreAttempt(ip, bucketStart);
            return { status: 'rateLimited', images: [], hasMore: true };
        }
    }

    try {
        const rows = await getImagesLite(topicSlug, safeTags, safeLimit + 1, safeOffset);
        return {
            status: 'ok',
            images: rows.slice(0, safeLimit),
            hasMore: rows.length > safeLimit,
        };
    } catch (err) {
        rollbackLoadMoreAttempt(ip, bucketStart);
        // C2-MED-02: return a structured error response instead of throwing.
        // Throwing from a server action sends a generic error to the client
        // and can leave the Load More button in a broken state. Returning a
        // structured response lets the client handle the error gracefully
        // with a toast notification while keeping the button functional.
        console.error('loadMoreImages failed:', err);
        return { status: 'error', images: [], hasMore: true };
    }
}

export async function searchImagesAction(query: string): Promise<SearchImagesResult> {
    if (!query || typeof query !== 'string') return { status: 'invalid', results: [] };
    if (isRestoreMaintenanceActive()) return { status: 'maintenance', results: [] };
    // Sanitize before validation so length checks operate on the same value
    // that will be stored (matches uploadImages/settings.ts pattern, see C46-02).
    const sanitizedQuery = stripControlChars(query.trim()) ?? '';
    if (countCodePoints(sanitizedQuery) > 200 || sanitizedQuery.length < 2) return { status: 'invalid', results: [] };

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
        entry.count++;
    }

    // DB-backed increment BEFORE the check (matches sharing.ts and admin-users.ts pattern).
    // Use one pinned bucketStart for increment/check/rollback so a request that
    // crosses a minute boundary cannot decrement the wrong MySQL bucket.
    try {
        await incrementRateLimit(ip, 'search', SEARCH_WINDOW_MS, bucketStart);
    } catch {
        // DB unavailable — keep the in-memory pre-increment so the in-memory
        // rate limit remains effective during DB outages. The in-memory map
        // is the fallback authority when the DB is unreachable.
    }

    // DB-backed check for accuracy across restarts
    try {
        const dbLimit = await checkRateLimit(ip, 'search', SEARCH_MAX_REQUESTS, SEARCH_WINDOW_MS, bucketStart);
        if (isRateLimitExceeded(dbLimit.count, SEARCH_MAX_REQUESTS, true)) {
            await rollbackSearchAttempt(ip, bucketStart);
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
        await rollbackSearchAttempt(ip, bucketStart);
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
