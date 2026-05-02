/**
 * Analytics helpers for US-P44.
 *
 * Privacy contract:
 * - Full IPs are NEVER stored. Only country_code (2-char ISO 3166-1 alpha-2)
 *   derived from the IP is persisted.
 * - referrer_host is TLD+1 only (e.g. "github.com"), never a full URL or path.
 * - Same-origin referrers are stored as 'self'.
 * - Empty/absent referrers are stored as 'direct'.
 * - Private IPs, onion addresses, and invalid hosts are stored as 'direct'.
 */

import siteConfig from '@/site-config.json';

// ---------------------------------------------------------------------------
// Bot detection — uses isbot (lightweight, well-maintained UA list)
// Dep justified: isbot is 10 KB unpacked, no network calls, battle-tested by
// many analytics projects. Alternative: hand-rolled regex — less accurate.
// ---------------------------------------------------------------------------
import { isbot as isbotCheck } from 'isbot';

export function isBot(userAgent: string | null | undefined): boolean {
    if (!userAgent) return false;
    return isbotCheck(userAgent);
}

// ---------------------------------------------------------------------------
// GeoIP — uses geoip-lite which embeds MaxMind GeoLite2-Country DB at install
// time (~40 MB install, ~6 MB in-process). No network call per request.
// Dep justified: zero per-request latency, free, embedded DB, widely used.
// Fallback: 'XX' for any lookup failure.
// ---------------------------------------------------------------------------
let geoLookup: ((ip: string) => { country?: string } | null) | null = null;

function getGeoLookup() {
    if (geoLookup !== null) return geoLookup;
    try {
        // Dynamic require so Next.js does not bundle geoip-lite into the client
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const geoip = require('geoip-lite') as { lookup: (ip: string) => { country?: string } | null };
        geoLookup = geoip.lookup.bind(geoip);
    } catch {
        // geoip-lite not available (e.g. unit test environment without native bindings)
        geoLookup = () => null;
    }
    return geoLookup;
}

export function lookupCountry(ip: string | null | undefined): string {
    if (!ip) return 'XX';
    try {
        const result = getGeoLookup()?.(ip);
        const code = result?.country;
        if (typeof code === 'string' && /^[A-Z]{2}$/.test(code)) {
            return code;
        }
    } catch {
        // ignore
    }
    return 'XX';
}

// ---------------------------------------------------------------------------
// Referrer host sanitization
// Rules (in order):
//  1. Empty / missing referrer → 'direct'
//  2. Parse URL; if parse fails → 'direct'
//  3. If host is a private IP, loopback, or .onion → 'direct'
//  4. Normalize to lowercase, strip port
//  5. If host matches own site host → 'self'
//  6. Extract TLD+1 (eTLD+1 approximation: last two labels for most domains,
//     last three for known two-part TLDs like co.uk, com.au, etc.)
//  7. Cap at 128 chars; if still too long → 'direct'
// ---------------------------------------------------------------------------

// Private / loopback / link-local IP patterns (IPv4 + IPv6)
const PRIVATE_IP_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

// Simple test: is the string a bare IPv4/IPv6 address?
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
// IPv6: contains colon (simplified — full validation not needed here)
const IPV6_RE = /:/;

// Known two-part second-level TLDs (subset — enough to avoid "co" as TLD+1)
// This is a lightweight approximation; we do not ship the full Public Suffix List.
const TWO_PART_TLDS = new Set([
    'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.id', 'co.il',
    'co.th', 'co.tz', 'co.ug', 'co.zw', 'com.au', 'com.br', 'com.cn',
    'com.mx', 'com.ar', 'com.sg', 'com.hk', 'com.tw', 'com.tr', 'com.sa',
    'com.my', 'com.ng', 'com.pk', 'com.vn', 'com.pe', 'com.co', 'com.ec',
    'com.ph', 'com.bn', 'org.uk', 'org.au', 'net.au', 'ne.jp', 'or.jp',
    'ac.uk', 'gov.uk', 'gov.au', 'edu.au',
]);

/**
 * Extract TLD+1 from a hostname.
 * Examples:
 *   "www.github.com" → "github.com"
 *   "sub.bbc.co.uk"  → "bbc.co.uk"
 *   "github.com"     → "github.com"
 */
export function extractTldPlusOne(host: string): string {
    const labels = host.split('.');
    if (labels.length <= 2) return host; // already TLD+1 or bare TLD

    // Check if last two labels form a known two-part TLD
    const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
    if (TWO_PART_TLDS.has(lastTwo)) {
        // Need three labels: name.second.tld
        if (labels.length <= 3) return host;
        return `${labels[labels.length - 3]}.${lastTwo}`;
    }

    return `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
}

function isPrivateHost(host: string): boolean {
    if (host === 'localhost') return true;
    if (host.endsWith('.onion')) return true;
    // URL.hostname returns IPv6 addresses with surrounding brackets (e.g. "[::1]").
    // Strip brackets before testing against PRIVATE_IP_RE.
    const normalized = (host.startsWith('[') && host.endsWith(']'))
        ? host.slice(1, -1)
        : host;
    if (IPV4_RE.test(normalized) || IPV6_RE.test(normalized)) {
        return PRIVATE_IP_RE.test(normalized);
    }
    return false;
}

function getSiteHost(): string {
    try {
        const url = new URL(siteConfig.url as string);
        return url.hostname.toLowerCase();
    } catch {
        return '';
    }
}

export function sanitizeReferrerHost(referrer: string | null | undefined): string {
    if (!referrer || typeof referrer !== 'string' || referrer.trim() === '') {
        return 'direct';
    }

    let parsed: URL;
    try {
        parsed = new URL(referrer.trim());
    } catch {
        return 'direct';
    }

    // Only http/https referrers are meaningful
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'direct';
    }

    const rawHost = parsed.hostname.toLowerCase();
    if (!rawHost) return 'direct';

    if (isPrivateHost(rawHost)) return 'direct';

    // Same-origin check
    const siteHost = getSiteHost();
    if (siteHost && rawHost === siteHost) return 'self';

    const tldPlusOne = extractTldPlusOne(rawHost);

    // Cap length (schema: varchar 128)
    if (tldPlusOne.length > 128) return 'direct';

    return tldPlusOne;
}
