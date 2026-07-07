import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootLayout = readFileSync(path.join(__dirname, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');
const publicLayout = readFileSync(path.join(__dirname, '..', 'app', '[locale]', '(public)', 'layout.tsx'), 'utf8');
const adminLayout = readFileSync(path.join(__dirname, '..', 'app', '[locale]', 'admin', 'layout.tsx'), 'utf8');

describe('Google Analytics route boundary', () => {
    it('keeps third-party analytics out of the locale root and admin layout', () => {
        expect(rootLayout).not.toContain('google_analytics_id');
        expect(rootLayout).not.toContain('google-analytics');
        expect(rootLayout).not.toContain('googletagmanager.com');
        expect(adminLayout).not.toContain('google_analytics_id');
        expect(adminLayout).not.toContain('googletagmanager.com');
    });

    it('loads optional Google Analytics only from the public layout with CSP nonce', () => {
        expect(publicLayout).toContain("import Script from 'next/script'");
        expect(publicLayout).toContain("import { getCspNonce } from '@/lib/csp-nonce'");
        expect(publicLayout).toContain('siteConfig.google_analytics_id');
        expect(publicLayout).toContain('https://www.googletagmanager.com/gtag/js');
        expect(publicLayout).toContain('id="google-analytics"');
        expect(publicLayout).toContain('nonce={nonce}');
    });
});
