/**
 * US-P31: In-memory rate-limit maps for anonymous reactions.
 *
 * Two buckets:
 *   - per-visitor (cookie): 10 toggles per 60-second sliding window
 *   - per-IP: 60 toggles per 60-second sliding window
 *
 * Uses the same ResetAt-based BoundedMap pattern as loadMoreRateLimit
 * in actions/public.ts.
 */

import { createResetAtBoundedMap } from '@/lib/bounded-map';

export const REACTION_WINDOW_MS = 60 * 1000; // 60 seconds
export const REACTION_VISITOR_MAX = 10;       // per visitor cookie
export const REACTION_IP_MAX = 60;            // per IP

const REACTION_RATE_LIMIT_MAX_KEYS = 5000;

export const reactionVisitorRateLimit = createResetAtBoundedMap<string>(REACTION_RATE_LIMIT_MAX_KEYS);
export const reactionIpRateLimit = createResetAtBoundedMap<string>(REACTION_RATE_LIMIT_MAX_KEYS);

/** Pre-increment and check a per-visitor rate-limit bucket. Returns true if over limit. */
export function checkAndIncrementVisitorReaction(visitorKey: string, now: number): boolean {
    reactionVisitorRateLimit.prune(now);
    const entry = reactionVisitorRateLimit.get(visitorKey);
    if (!entry || entry.resetAt <= now) {
        reactionVisitorRateLimit.set(visitorKey, { count: 1, resetAt: now + REACTION_WINDOW_MS });
    } else {
        entry.count++;
    }
    return (reactionVisitorRateLimit.get(visitorKey)?.count ?? 0) > REACTION_VISITOR_MAX;
}

/** Pre-increment and check a per-IP rate-limit bucket. Returns true if over limit. */
export function checkAndIncrementIpReaction(ip: string, now: number): boolean {
    reactionIpRateLimit.prune(now);
    const entry = reactionIpRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        reactionIpRateLimit.set(ip, { count: 1, resetAt: now + REACTION_WINDOW_MS });
    } else {
        entry.count++;
    }
    return (reactionIpRateLimit.get(ip)?.count ?? 0) > REACTION_IP_MAX;
}

/** Roll back a per-visitor reaction counter (on rate-limit rejection). */
export function rollbackVisitorReaction(visitorKey: string) {
    const entry = reactionVisitorRateLimit.get(visitorKey);
    if (entry && entry.count > 1) {
        entry.count--;
    } else {
        reactionVisitorRateLimit.delete(visitorKey);
    }
}

/** Roll back a per-IP reaction counter (on rate-limit rejection). */
export function rollbackIpReaction(ip: string) {
    const entry = reactionIpRateLimit.get(ip);
    if (entry && entry.count > 1) {
        entry.count--;
    } else {
        reactionIpRateLimit.delete(ip);
    }
}

/** Reset both maps — for tests only. */
export function resetReactionRateLimitsForTests() {
    reactionVisitorRateLimit.clear();
    reactionIpRateLimit.clear();
}
