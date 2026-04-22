interface HeaderLookup {
    get(name: string): string | null | undefined;
}

function normalizeHeaderValue(value: string | null | undefined) {
    return value?.split(',')[0]?.trim() || '';
}

function getProtocolFromCandidate(candidate: string | null | undefined) {
    const origin = candidate ? toOrigin(candidate) : null;
    return origin ? new URL(origin).protocol.replace(/:$/, '') : null;
}

function getExpectedOrigin(requestHeaders: HeaderLookup) {
    const host = normalizeHeaderValue(requestHeaders.get('x-forwarded-host'))
        || normalizeHeaderValue(requestHeaders.get('host'));
    if (!host) {
        return null;
    }

    const protocol = normalizeHeaderValue(requestHeaders.get('x-forwarded-proto'))
        || getProtocolFromCandidate(requestHeaders.get('origin'))
        || getProtocolFromCandidate(requestHeaders.get('referer'))
        || 'http';
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

    return true;
}
