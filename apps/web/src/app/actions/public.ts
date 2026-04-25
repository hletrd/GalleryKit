'use server';

import { headers } from 'next/headers';
import { getImagesLite, searchImages } from '@/lib/data';

import { isValidSlug, isValidTagSlug } from '@/lib/validation';
import { stripControlChars } from '@/lib/sanitize';
import { getClientIp, searchRateLimit, SEARCH_WINDOW_MS, SEARCH_MAX_REQUESTS, checkRateLimit, decrementRateLimit, incrementRateLimit, isRateLimitExceeded, pruneSearchRateLimit } from '@/lib/rate-limit';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';

async function rollbackSearchAttempt(ip: string) {
    const currentEntry = searchRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
    } else {
        searchRateLimit.delete(ip);
    }
    await decrementRateLimit(ip, 'search', SEARCH_WINDOW_MS).catch((err) => {
        console.debug('Failed to roll back search DB rate limit:', err);
    });
}

const LOAD_MORE_WINDOW_MS = 60 * 1000;
const LOAD_MORE_MAX_REQUESTS = 120;
const LOAD_MORE_RATE_LIMIT_MAX_KEYS = 2000;
const loadMoreRateLimit = new Map<string, { count: number; resetAt: number }>();

function pruneLoadMoreRateLimit(now: number) {
    for (const [key, entry] of loadMoreRateLimit) {
        if (entry.resetAt <= now) loadMoreRateLimit.delete(key);
    }

    if (loadMoreRateLimit.size > LOAD_MORE_RATE_LIMIT_MAX_KEYS) {
        const excess = loadMoreRateLimit.size - LOAD_MORE_RATE_LIMIT_MAX_KEYS;
        let evicted = 0;
        for (const key of loadMoreRateLimit.keys()) {
            if (evicted >= excess) break;
            loadMoreRateLimit.delete(key);
            evicted++;
        }
    }
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

async function rollbackLoadMoreAttempt(ip: string) {
    const currentEntry = loadMoreRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
    } else {
        loadMoreRateLimit.delete(ip);
    }
    await decrementRateLimit(ip, 'load_more', LOAD_MORE_WINDOW_MS).catch((err) => {
        console.debug('Failed to roll back load_more DB rate limit:', err);
    });
}

export async function loadMoreImages(topicSlug?: string, tagSlugs?: string[], offset: number = 0, limit: number = 30) {
    if (isRestoreMaintenanceActive()) return { images: [], hasMore: false };
    // Validate slug format before passing to data layer (defense in depth)
    if (topicSlug && (!isValidSlug(topicSlug))) return { images: [], hasMore: false };
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const safeOffset = Math.max(Math.floor(Number(offset)) || 0, 0);
    // Cap maximum offset to prevent deep pagination DoS
    if (safeOffset > 10000) return { images: [], hasMore: false };
    // Cap tag array and validate format to prevent complex query DoS
    const safeTags = (tagSlugs || [])
        .slice(0, 20)
        .map((slug) => slug.trim())
        .filter(isValidTagSlug);

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();

    if (preIncrementLoadMoreAttempt(ip, now)) {
        return { images: [], hasMore: false };
    }

    try {
        await incrementRateLimit(ip, 'load_more', LOAD_MORE_WINDOW_MS);
        const dbLimit = await checkRateLimit(ip, 'load_more', LOAD_MORE_MAX_REQUESTS, LOAD_MORE_WINDOW_MS);
        if (isRateLimitExceeded(dbLimit.count, LOAD_MORE_MAX_REQUESTS, true)) {
            await rollbackLoadMoreAttempt(ip);
            return { images: [], hasMore: false };
        }
    } catch {
        // DB unavailable — rely on the in-memory pre-increment fallback.
    }

    try {
        const rows = await getImagesLite(topicSlug, safeTags, safeLimit + 1, safeOffset);
        return {
            images: rows.slice(0, safeLimit),
            hasMore: rows.length > safeLimit,
        };
    } catch (err) {
        await rollbackLoadMoreAttempt(ip);
        throw err;
    }
}

export async function searchImagesAction(query: string) {
    if (!query || typeof query !== 'string') return [];
    if (isRestoreMaintenanceActive()) return [];
    // Sanitize before validation so length checks operate on the same value
    // that will be stored (matches uploadImages/settings.ts pattern, see C46-02).
    const sanitizedQuery = stripControlChars(query.trim()) ?? '';
    if (sanitizedQuery.length > 200 || sanitizedQuery.length < 2) return [];

    // Server-side rate limiting for search (LIKE queries are expensive)
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    pruneSearchRateLimit(now);

    // Fast-path check from in-memory Map
    const entry = searchRateLimit.get(ip);
    if (entry && entry.resetAt > now && entry.count >= SEARCH_MAX_REQUESTS) {
        return [];
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
    // Placing incrementRateLimit before checkRateLimit ensures the counter reflects
    // the current request when the check runs, preventing burst attacks that exploit
    // the gap between check and increment.
    try {
        await incrementRateLimit(ip, 'search', SEARCH_WINDOW_MS);
    } catch {
        // DB unavailable — keep the in-memory pre-increment so the in-memory
        // rate limit remains effective during DB outages. The in-memory map
        // is the fallback authority when the DB is unreachable.
    }

    // DB-backed check for accuracy across restarts
    try {
        const dbLimit = await checkRateLimit(ip, 'search', SEARCH_MAX_REQUESTS, SEARCH_WINDOW_MS);
        if (isRateLimitExceeded(dbLimit.count, SEARCH_MAX_REQUESTS, true)) {
            // C6R-RPL-03 / AGG6R-02: symmetric rollback of BOTH counters.
            // Prior code only rolled back the in-memory counter, leaving the
            // DB counter inflated by 1 per over-limit event. Over the 60s
            // window, legitimate burst users paid an extra counted attempt.
            await rollbackSearchAttempt(ip);
            return [];
        }
    } catch {
        // DB unavailable — rely on in-memory Map
    }

    // sanitizedQuery already has stripControlChars applied — belt-and-suspenders slice
    const safeQuery = sanitizedQuery.slice(0, 200);
    try {
        return await searchImages(safeQuery, 20);
    } catch (err) {
        await rollbackSearchAttempt(ip);
        throw err;
    }
}
