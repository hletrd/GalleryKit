import {
    incrementRateLimit,
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
