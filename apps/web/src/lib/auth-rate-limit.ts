import {
    incrementRateLimit,
    LOGIN_RATE_LIMIT_MAX_KEYS,
    LOGIN_WINDOW_MS,
    loginRateLimit,
    resetRateLimit,
    type RateLimitEntry,
} from '@/lib/rate-limit';

export function getLoginRateLimitEntry(ip: string, now: number): RateLimitEntry {
    const entry = loginRateLimit.get(ip) ?? { count: 0, lastAttempt: 0 };

    if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
        entry.count = 0;
    }

    return entry;
}

export async function recordFailedLoginAttempt(ip: string, now: number) {
    const entry = getLoginRateLimitEntry(ip, now);
    entry.count += 1;
    entry.lastAttempt = now;
    loginRateLimit.set(ip, entry);

    await incrementRateLimit(ip, 'login', LOGIN_WINDOW_MS);
}

export async function clearSuccessfulLoginAttempts(ip: string) {
    loginRateLimit.delete(ip);
    await resetRateLimit(ip, 'login', LOGIN_WINDOW_MS);
}

// Separate in-memory Map for password change rate limiting.
// Decoupled from loginRateLimit so that failed password changes don't
// lock out login (and vice versa) via the in-memory fast-path cache.
// The DB-backed check uses a separate 'password_change' bucket type.
export const passwordChangeRateLimit = new Map<string, RateLimitEntry>();

export function getPasswordChangeRateLimitEntry(ip: string, now: number): RateLimitEntry {
    const entry = passwordChangeRateLimit.get(ip) ?? { count: 0, lastAttempt: 0 };

    if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
        entry.count = 0;
    }

    return entry;
}

export async function clearSuccessfulPasswordAttempts(ip: string) {
    passwordChangeRateLimit.delete(ip);
    await resetRateLimit(ip, 'password_change', LOGIN_WINDOW_MS);
}

/** Prune expired entries and enforce hard cap on password change rate-limit Map. */
export const PASSWORD_CHANGE_MAX_ATTEMPTS = 10;
const PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS = 5000;

export function prunePasswordChangeRateLimit(now: number) {
    for (const [key, entry] of passwordChangeRateLimit) {
        if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
            passwordChangeRateLimit.delete(key);
        }
    }

    // Hard cap: evict oldest entries if still over limit after expiry pruning
    if (passwordChangeRateLimit.size > PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS) {
        const excess = passwordChangeRateLimit.size - LOGIN_RATE_LIMIT_MAX_KEYS;
        let evicted = 0;
        for (const key of passwordChangeRateLimit.keys()) {
            if (evicted >= excess) break;
            passwordChangeRateLimit.delete(key);
            evicted++;
        }
    }
}
