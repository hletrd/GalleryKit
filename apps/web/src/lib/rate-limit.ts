import { isIP } from 'net';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_MAX_KEYS = 5000;

export const SEARCH_WINDOW_MS = 60 * 1000; // 1 minute
export const SEARCH_MAX_REQUESTS = 30;
export const SEARCH_RATE_LIMIT_MAX_KEYS = 2000;

export type RateLimitEntry = { count: number; lastAttempt: number };

export type HeaderLike = { get(name: string): string | null };

// Rate limiting: client IP -> { count, lastAttempt }
export const loginRateLimit = new Map<string, RateLimitEntry>();

export const searchRateLimit = new Map<string, { count: number; resetAt: number }>();

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

export function getClientIp(headerStore: HeaderLike): string {
    // Prefer X-Real-IP if set by a trusted reverse proxy (e.g., nginx).
    const xRealIp = normalizeIp(headerStore.get('x-real-ip'));
    if (xRealIp) return xRealIp;

    // Fall back to X-Forwarded-For; take the last IP (commonly the one added by the proxy).
    const xForwardedFor = headerStore.get('x-forwarded-for');
    if (xForwardedFor && xForwardedFor.length <= 512) {
        const parts = xForwardedFor.split(',').map(p => p.trim()).filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
            const normalized = normalizeIp(parts[i] || null);
            if (normalized) return normalized;
        }
    }

    return 'unknown';
}

export function pruneLoginRateLimit(now: number) {
    // Prune expired entries (O(n) single pass)
    for (const [key, entry] of loginRateLimit) {
        if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
            loginRateLimit.delete(key);
        }
    }

    // Hard cap: if still over limit after expiry pruning, evict oldest entries.
    // Use a single pass to find the oldest entries instead of sorting the entire Map.
    if (loginRateLimit.size > LOGIN_RATE_LIMIT_MAX_KEYS) {
        const excess = loginRateLimit.size - LOGIN_RATE_LIMIT_MAX_KEYS;
        // Map iteration order is insertion order; oldest entries are first.
        // Re-inserted entries (updated IPs) move to the end, so this is a reasonable LRU heuristic.
        let evicted = 0;
        for (const key of loginRateLimit.keys()) {
            if (evicted >= excess) break;
            loginRateLimit.delete(key);
            evicted++;
        }
    }
}
