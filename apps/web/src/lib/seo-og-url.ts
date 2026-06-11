import siteConfig from '@/site-config.json';

export function validateSeoOgImageUrl(rawValue: string, configuredBaseUrl: string = process.env.BASE_URL?.trim() || siteConfig.url) {
    const trimmedUrl = rawValue.trim();
    if (!trimmedUrl) {
        return true;
    }

    if (trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')) {
        // SEC-R4C20-01: reject backslashes in the relative branch. Browsers and
        // link-preview crawlers normalize `\` to `/` per the WHATWG URL spec for
        // http/https, so a value like `/\evil.com` — which slips past the `//`
        // check because its second char is `\`, not `/` — resolves to the
        // scheme-relative `//evil.com` (→ https://evil.com/). That bypasses the
        // same-origin intent of this validator both in the public `<meta
        // og:image>` tag and in the 302 `Location` of /api/og/photo/[id]
        // (open redirect). Upstream `normalizeStringRecord` already strips C0
        // controls (tab/CR/LF), so backslash is the only char that survives
        // normalization AND re-normalizes to `/`; rejecting it closes the gap.
        if (trimmedUrl.includes('\\')) {
            return false;
        }
        return true;
    }

    let url: URL;
    try {
        url = new URL(trimmedUrl);
    } catch {
        return false;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        return false;
    }

    try {
        const siteOrigin = new URL(configuredBaseUrl).origin;
        return url.origin === siteOrigin;
    } catch {
        return false;
    }
}
