import siteConfig from '@/site-config.json';

export function validateSeoOgImageUrl(rawValue: string, configuredBaseUrl: string = process.env.BASE_URL?.trim() || siteConfig.url) {
    const trimmedUrl = rawValue.trim();
    if (!trimmedUrl) {
        return true;
    }

    if (trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')) {
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
