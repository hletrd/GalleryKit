import { describe, expect, it } from 'vitest';
import { buildDownloadInterstitialHtml, escapeHtml } from '@/lib/download-interstitial';

/**
 * R4C7 COR-R4C7-02: unit coverage for the no-claim confirmation page
 * builder. The route-level method contract (GET claim-free, POST
 * claims) is pinned by `download-route-method-contract.test.ts`; this
 * suite owns the pure HTML-building concerns: escaping, the
 * POST-form shape, and the token-never-in-body invariant.
 */

const strings = {
    title: 'Download your photo',
    description: 'This is a single-use download link for Sunset. Your download starts when you press the button below.',
    button: 'Download photo',
    expiryNote: 'The link is valid for 24 hours after purchase and can be used once.',
};

describe('escapeHtml', () => {
    it('escapes the five HTML-special characters', () => {
        expect(escapeHtml(`<script>alert("x&y'z")</script>`)).toBe(
            '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;',
        );
    });

    it('passes plain text through unchanged', () => {
        expect(escapeHtml('Sunset over Jeju 한라산')).toBe('Sunset over Jeju 한라산');
    });
});

describe('buildDownloadInterstitialHtml', () => {
    it('escapes attacker-shaped photo titles flowing through the description', () => {
        const html = buildDownloadInterstitialHtml({
            locale: 'en',
            strings: {
                ...strings,
                description: 'Single-use link for <img src=x onerror=alert(1)> "quoted".',
            },
        });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot;.');
    });

    it('renders a POST form with NO action attribute so the token-bearing query is preserved', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings });
        // Exactly the bare form: per the HTML form-submission algorithm an
        // omitted action submits to the document's own URL, keeping
        // `?token=…` intact for the POST — the token never enters the body.
        expect(html).toMatch(/<form method="post">/);
        expect(html).not.toMatch(/<form[^>]*action=/);
        expect(html).toMatch(/<button type="submit">/);
    });

    it('never embeds a token-shaped string (token stays in the URL only)', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings });
        expect(html).not.toMatch(/dl_[A-Za-z0-9_-]{43}/);
        expect(html).not.toContain('token=');
    });

    it('sets the lang attribute from the supported locale and includes robots noindex', () => {
        const ko = buildDownloadInterstitialHtml({ locale: 'ko', strings });
        expect(ko).toContain('<html lang="ko">');
        expect(ko).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('keeps the submit button at the 44px touch-target floor', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings });
        expect(html).toMatch(/button\s*\{[^}]*min-height:\s*44px/);
    });

    it('contains no script tags or external resource references', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings });
        expect(html).not.toContain('<script');
        expect(html).not.toMatch(/\bsrc=/);
        expect(html).not.toMatch(/href=/);
    });
});
