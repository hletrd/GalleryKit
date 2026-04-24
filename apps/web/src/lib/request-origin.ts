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

function getExpectedOrigin(requestHeaders: HeaderLookup) {
    const trustedForwardedProto = trustsProxyHeaders()
        ? normalizeTrustedProxyHeaderValue(requestHeaders.get('x-forwarded-proto'))
        : '';
    const protocol = trustedForwardedProto
        || getProtocolFromCandidate(requestHeaders.get('origin'))
        || getProtocolFromCandidate(requestHeaders.get('referer'))
        || 'http';

    const trustedForwardedHost = trustsProxyHeaders()
        ? normalizeTrustedProxyHeaderValue(requestHeaders.get('x-forwarded-host'))
        : '';
    const rawHost = trustedForwardedHost
        || normalizeHeaderValue(requestHeaders.get('host'));
    if (!rawHost) {
        return null;
    }

    const host = stripDefaultPort(rawHost, protocol);
    return toOrigin(`${protocol}://${host}`);
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

export function hasTrustedSameOriginWithOptions(
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
