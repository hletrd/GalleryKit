import {
    decrementRateLimit,
    incrementRateLimit,
    LOGIN_WINDOW_MS,
    loginRateLimit,
    resetRateLimit,
} from '@/lib/rate-limit';
import { createWindowBoundedMap, type WindowEntry } from '@/lib/bounded-map';

const PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS = 5000;

export function getLoginRateLimitEntry(ip: string, now: number): WindowEntry {
    const entry = loginRateLimit.get(ip) ?? { count: 0, lastAttempt: 0 };

    if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
        entry.count = 0;
    }

    return entry;
}

export async function recordFailedLoginAttempt(ip: string, now: number, bucketStart?: number) {
    const entry = getLoginRateLimitEntry(ip, now);
    entry.count += 1;
    entry.lastAttempt = now;
    loginRateLimit.set(ip, entry);

    await incrementRateLimit(ip, 'login', LOGIN_WINDOW_MS, bucketStart);
}

export async function clearSuccessfulLoginAttempts(ip: string, bucketStart?: number) {
    await resetRateLimit(ip, 'login', LOGIN_WINDOW_MS, bucketStart);
    loginRateLimit.delete(ip);
}

/**
 * Decrement (not delete) the login rate limit counter for rollback scenarios.
 * On unexpected infrastructure errors, the user didn't fail auth — so the
 * pre-incremented count should be rolled back. Using decrement instead of
 * delete prevents concurrent rollbacks from losing counts (C1-07).
 */
export async function rollbackLoginRateLimit(ip: string, bucketStart?: number) {
    const entry = loginRateLimit.get(ip);
    if (entry && entry.count > 1) {
        entry.count -= 1;
    } else if (entry) {
        loginRateLimit.delete(ip);
    }
    await decrementRateLimit(ip, 'login', LOGIN_WINDOW_MS, bucketStart);
}

// Separate in-memory Map for password change rate limiting.
// Decoupled from loginRateLimit so that failed password changes don't
// lock out login (and vice versa) via the in-memory fast-path cache.
// The DB-backed check uses a separate 'password_change' bucket type.
export const passwordChangeRateLimit = createWindowBoundedMap<string>(PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS, LOGIN_WINDOW_MS);

export function getPasswordChangeRateLimitEntry(ip: string, now: number): WindowEntry {
    const entry = passwordChangeRateLimit.get(ip) ?? { count: 0, lastAttempt: 0 };

    if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
        entry.count = 0;
    }

    return entry;
}

export async function clearSuccessfulPasswordAttempts(ip: string, bucketStart?: number) {
    await resetRateLimit(ip, 'password_change', LOGIN_WINDOW_MS, bucketStart);
    passwordChangeRateLimit.delete(ip);
}

/**
 * Decrement (not delete) the password change rate limit counter for rollback scenarios.
 * Same rationale as rollbackLoginRateLimit — prevents concurrent rollbacks from
 * losing counts (C1-07).
 */
export async function rollbackPasswordChangeRateLimit(ip: string, bucketStart?: number) {
    const entry = passwordChangeRateLimit.get(ip);
    if (entry && entry.count > 1) {
        entry.count -= 1;
    } else if (entry) {
        passwordChangeRateLimit.delete(ip);
    }
    await decrementRateLimit(ip, 'password_change', LOGIN_WINDOW_MS, bucketStart);
}

/** Prune expired entries and enforce hard cap on password change rate-limit Map. */
export const PASSWORD_CHANGE_MAX_ATTEMPTS = 10;

export function prunePasswordChangeRateLimit(now: number) {
    passwordChangeRateLimit.prune(now);
}
