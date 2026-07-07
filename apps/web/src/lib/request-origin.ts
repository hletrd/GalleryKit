import siteConfig from '@/site-config.json';

interface HeaderLookup {
    get(name: string): string | null | undefined;
}

function trustsProxyHeaders() {
    return process.env.TRUST_PROXY === 'true';
}

function getHeaderValue(value: string | null | undefined, position: 'first' | 'last' = 'first') {
    const parts = value?.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
    if (parts.length === 0) return '';
    return position === 'last' ? parts[parts.length - 1] : parts[0];
}

function normalizeHeaderValue(value: string | null | undefined) {
    return getHeaderValue(value, 'first');
}

function normalizeTrustedProxyHeaderValue(value: string | null | undefined) {
    // Reverse proxies commonly append their trusted hop to the right side of
    // X-Forwarded-* chains. When TRUST_PROXY is enabled, prefer that
    // right-most value instead of the left-most client-supplied value.
    return getHeaderValue(value, 'last');
}

/** Strip default HTTP/HTTPS ports so that `host:443` matches the browser's
 *  `Origin` header (which omits `:443`). Without this normalization, reverse
 *  proxies that include the default port in `X-Forwarded-Host` cause
 *  legitimate same-origin requests to be rejected. */
function stripDefaultPort(host: string, protocol: string): string {
    if (protocol === 'https' && host.endsWith(':443')) {
        return host.slice(0, -4);
    }
    if (protocol === 'http' && host.endsWith(':80')) {
        return host.slice(0, -3);
    }
    return host;
}

function getProtocolFromCandidate(candidate: string | null | undefined) {
    const origin = candidate ? toOrigin(candidate) : null;
    return origin ? new URL(origin).protocol.replace(/:$/, '') : null;
}

function getConfiguredBaseOrigin() {
    const configured = process.env.BASE_URL?.trim();
    if (configured) {
        return toOrigin(configured);
    }
    // C7-05 (run-10 cycle 7b): fall back to siteConfig.url — the documented,
    // build-gated sibling of the env var (Deployment Checklist step 3;
    // `ensure-site-config.mjs` validates `BASE_URL || siteConfig.url` before
    // production builds) — so an operator who configured ONLY
    // site-config.json still gets the canonical-origin anchor for CSRF
    // same-origin checks instead of silently dropping to header inference.
    // Production-only: in dev/test the checked-in file commonly carries the
    // production URL while the app runs on localhost, where header-derived
    // origin resolution is the correct behavior (e2e sets BASE_URL env
    // explicitly via run-e2e-server.mjs).
    if (process.env.NODE_ENV === 'production') {
        const fileConfigured = typeof siteConfig.url === 'string' ? siteConfig.url.trim() : '';
        if (fileConfigured) {
            return toOrigin(fileConfigured);
        }
    }
    return null;
}

export function getTrustedRequestProtocol(requestHeaders: HeaderLookup) {
    const trustedForwardedProto = trustsProxyHeaders()
        ? normalizeTrustedProxyHeaderValue(requestHeaders.get('x-forwarded-proto'))
        : '';
    return trustedForwardedProto
        || getProtocolFromCandidate(requestHeaders.get('origin'))
        || getProtocolFromCandidate(requestHeaders.get('referer'))
        || null;
}

function getExpectedOrigin(requestHeaders: HeaderLookup) {
    // Production deploys already carry the canonical public origin in BASE_URL
    // for SEO/OG URLs. Use that value for CSRF provenance too so an edge that
    // forgets to scrub X-Forwarded-Host/Proto cannot redefine "same origin".
    const configuredBaseOrigin = getConfiguredBaseOrigin();
    if (configuredBaseOrigin) {
        return configuredBaseOrigin;
    }

    const protocol = getTrustedRequestProtocol(requestHeaders);

    // C7-13 (INFO, cycle 7b): under the SHIPPED nginx template Host and
    // X-Forwarded-Host are both set to the same $host, so this preference
    // order only matters for non-default proxy topologies where the two
    // diverge AND no canonical base URL is configured. The canonical anchor
    // above (BASE_URL / siteConfig.url) is the primary CSRF defense — do not
    // treat this fallback as the load-bearing protection.
    const rawHost = normalizeHeaderValue(requestHeaders.get('host'))
        || (trustsProxyHeaders()
            ? normalizeTrustedProxyHeaderValue(requestHeaders.get('x-forwarded-host'))
            : '');
    if (!rawHost) {
        return null;
    }

    const host = stripDefaultPort(rawHost, protocol ?? 'http');
    return toOrigin(`${protocol ?? 'http'}://${host}`);
}

function toOrigin(candidate: string) {
    try {
        return new URL(candidate).origin;
    } catch {
        return null;
    }
}

export function hasTrustedSameOrigin(requestHeaders: HeaderLookup) {
    return hasTrustedSameOriginWithOptions(requestHeaders);
}

function hasTrustedSameOriginWithOptions(
    requestHeaders: HeaderLookup,
    options: { allowMissingSource?: boolean } = {}
) {
    // Fail closed by default (C1R-01): require an explicit `Origin` or `Referer`
    // match. Callers that intentionally need the legacy loose contract must
    // opt in via `allowMissingSource: true`.
    const { allowMissingSource = false } = options;
    const expectedOrigin = getExpectedOrigin(requestHeaders);
    if (!expectedOrigin) {
        return false;
    }

    const origin = normalizeHeaderValue(requestHeaders.get('origin'));
    if (origin) {
        return toOrigin(origin) === expectedOrigin;
    }

    const referer = normalizeHeaderValue(requestHeaders.get('referer'));
    if (referer) {
        return toOrigin(referer) === expectedOrigin;
    }

    return allowMissingSource;
}

export { hasTrustedSameOriginWithOptions };
