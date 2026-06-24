import {
    decrementRateLimit,
    incrementRateLimit,
    LOGIN_WINDOW_MS,
    LOGIN_RATE_LIMIT_MAX_KEYS,
    loginRateLimit,
    resetRateLimit,
} from '@/lib/rate-limit';
import { createWindowBoundedMap, type WindowEntry } from '@/lib/bounded-map';

const PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS = 5000;

// Account-scoped in-memory rate limit map, keyed by buildAccountRateLimitKey().
// Mirrors the IP-scoped loginRateLimit but throttles per-username, preventing
// distributed brute-force where each IP gets a fresh budget but all target
// the same account. The DB-backed 'login_account' bucket remains the source
// of truth across restarts; this map is the fast-path fallback when the DB
// rate-limit table is unavailable (matches the IP map pattern).
export const accountLoginRateLimit = createWindowBoundedMap<string>(LOGIN_RATE_LIMIT_MAX_KEYS, LOGIN_WINDOW_MS);

export function getLoginRateLimitEntry(ip: string, now: number): WindowEntry {
    const entry = loginRateLimit.get(ip) ?? { count: 0, lastAttempt: 0 };

    if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
        entry.count = 0;
    }

    return entry;
}

export function getAccountLoginRateLimitEntry(accountKey: string, now: number): WindowEntry {
    const entry = accountLoginRateLimit.get(accountKey) ?? { count: 0, lastAttempt: 0 };

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

export async function clearSuccessfulAccountLoginAttempts(accountKey: string, bucketStart?: number) {
    await resetRateLimit(accountKey, 'login_account', LOGIN_WINDOW_MS, bucketStart);
    accountLoginRateLimit.delete(accountKey);
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

/**
 * Roll back the account-scoped in-memory rate limit counter.
 * Same rationale as rollbackLoginRateLimit — for error scenarios where
 * the pre-increment should not count against the user.
 */
export async function rollbackAccountLoginRateLimit(accountKey: string, bucketStart?: number) {
    const entry = accountLoginRateLimit.get(accountKey);
    if (entry && entry.count > 1) {
        entry.count -= 1;
    } else if (entry) {
        accountLoginRateLimit.delete(accountKey);
    }
    await decrementRateLimit(accountKey, 'login_account', LOGIN_WINDOW_MS, bucketStart);
}

/** Prune expired entries from the account-scoped login rate-limit map. */
export function pruneAccountLoginRateLimit(now: number) {
    accountLoginRateLimit.prune(now);
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
