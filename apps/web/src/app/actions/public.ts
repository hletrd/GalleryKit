'use server';

import { headers } from 'next/headers';
import { getImagesLite, searchImages } from '@/lib/data';

import { isValidSlug } from '@/lib/validation';
import { stripControlChars } from '@/lib/sanitize';
import { getClientIp, searchRateLimit, SEARCH_WINDOW_MS, SEARCH_MAX_REQUESTS, SEARCH_RATE_LIMIT_MAX_KEYS, checkRateLimit, incrementRateLimit, isRateLimitExceeded } from '@/lib/rate-limit';

export async function loadMoreImages(topicSlug?: string, tagSlugs?: string[], offset: number = 0, limit: number = 30) {
    // Validate slug format before passing to data layer (defense in depth)
    if (topicSlug && (!isValidSlug(topicSlug))) return [];
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const safeOffset = Math.max(Math.floor(Number(offset)) || 0, 0);
    // Cap maximum offset to prevent deep pagination DoS
    if (safeOffset > 10000) return [];
    // Cap tag array and validate format to prevent complex query DoS
    const safeTags = (tagSlugs || [])
        .slice(0, 20)
        .filter(s => /^[a-z0-9-]+$/i.test(s) && s.length <= 100);
    const images = await getImagesLite(topicSlug, safeTags, safeLimit, safeOffset);
    return images;
}

export async function searchImagesAction(query: string) {
    if (!query || typeof query !== 'string') return [];
    // Sanitize before validation so length checks operate on the same value
    // that will be stored (matches uploadImages/settings.ts pattern, see C46-02).
    const sanitizedQuery = stripControlChars(query.trim()) ?? '';
    if (sanitizedQuery.length > 200 || sanitizedQuery.length < 2) return [];

    // Server-side rate limiting for search (LIKE queries are expensive)
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    // Prune expired entries unconditionally and enforce hard cap
    for (const [key, val] of searchRateLimit) {
        if (val.resetAt <= now) searchRateLimit.delete(key);
    }
    if (searchRateLimit.size > SEARCH_RATE_LIMIT_MAX_KEYS) {
        const excess = searchRateLimit.size - SEARCH_RATE_LIMIT_MAX_KEYS;
        let evicted = 0;
        for (const key of searchRateLimit.keys()) {
            if (evicted >= excess) break;
            searchRateLimit.delete(key);
            evicted++;
        }
    }

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
            // Roll back the pre-incremented in-memory counter to stay consistent
            // with DB source of truth. Without this, the in-memory counter
            // stays overcounted while DB is undercounted, causing premature
            // rate limiting for the remainder of the window.
            const currentEntry = searchRateLimit.get(ip);
            if (currentEntry && currentEntry.count > 1) {
                currentEntry.count--;
            } else {
                searchRateLimit.delete(ip);
            }
            return [];
        }
    } catch {
        // DB unavailable — rely on in-memory Map
    }

    // sanitizedQuery already has stripControlChars applied — belt-and-suspenders slice
    const safeQuery = sanitizedQuery.slice(0, 200);
    return searchImages(safeQuery, 20);
}
