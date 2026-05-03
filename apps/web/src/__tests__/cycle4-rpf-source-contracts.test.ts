/**
 * Cycle 4 RPF / P264-11 / C4-RPF-11: source-contract tests for the cycle 4
 * in-cycle fixes. Behavior-level tests are impractical for these paths (the
 * webhook + download routes need real Stripe + a real upload directory) so
 * source-text guards prevent silent regressions on the cycle 4 fix shapes.
 *
 * Covered:
 *   - P264-01 / C4-RPF-01: webhook slices customer email to 255 (NOT 320)
 *     to match the entitlements.customer_email varchar(255) column width,
 *     and trims before the slice (P264-05).
 *   - P264-02 / C4-RPF-02: webhook performs a defensive image-tier
 *     cross-check between Stripe metadata.tier and the current
 *     images.license_tier, logging a warning on mismatch.
 *   - P264-03 / C4-RPF-03: webhook splits payment_status reject log
 *     severity — 'unpaid' uses console.warn (async happy path); other
 *     non-paid statuses use console.error.
 *   - P264-04 / C4-RPF-04: sales-client mapErrorCode switch covers all
 *     RefundErrorCode values; en/ko have new keys.
 *   - P264-06 / C4-RPF-06: download route uses Promise.all over the two
 *     realpath calls.
 *   - P264-07 / C4-RPF-07: sales.ts mapStripeRefundError maps both
 *     StripeAuthenticationError and StripeRateLimitError to 'network'.
 *   - P264-08 / C4-RPF-08: sales-client row button text is pinned to
 *     t.refundButton (no rotation on refundingId).
 *   - P264-09 / C4-RPF-09: errorLoad div has role="alert".
 *   - P264-10 / C4-RPF-10: .env.local.example documents
 *     LOG_PLAINTEXT_DOWNLOAD_TOKENS.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WEBHOOK_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
    'utf8',
);

const DOWNLOAD_ROUTE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'download', '[imageId]', 'route.ts'),
    'utf8',
);

const SALES_ACTIONS_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'actions', 'sales.ts'),
    'utf8',
);

const SALES_CLIENT_SRC = fs.readFileSync(
    path.resolve(
        __dirname, '..', 'app', '[locale]', 'admin', '(protected)',
        'sales', 'sales-client.tsx',
    ),
    'utf8',
);

const SALES_PAGE_SRC = fs.readFileSync(
    path.resolve(
        __dirname, '..', 'app', '[locale]', 'admin', '(protected)',
        'sales', 'page.tsx',
    ),
    'utf8',
);

const SCHEMA_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'db', 'schema.ts'),
    'utf8',
);

const ENV_EXAMPLE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '.env.local.example'),
    'utf8',
);

const EN_JSON_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'messages', 'en.json'),
    'utf8',
);

const KO_JSON_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'messages', 'ko.json'),
    'utf8',
);

describe('cycle 4 RPF / webhook source-contracts', () => {
    it('P264-01: slices customer email to 255 (matching schema column width), trims first (P264-05)', () => {
        // Cycle 4 RPF / P264-01 + P264-05: shape was .trim().slice(0, 255).toLowerCase()
        // Cycle 5 RPF / P388-06: trim is now hoisted into a `trimmedEmailRaw`
        // local so the trimmed length can be range-checked BEFORE truncation.
        // The .trim() call still happens (now on its own line); the
        // .slice(0, 255).toLowerCase() chain remains. The test allows the
        // multi-line form.
        expect(WEBHOOK_SRC).toMatch(/customerEmailRaw\.trim\(\)/);
        expect(WEBHOOK_SRC).toMatch(/\.slice\(0, 255\)\.toLowerCase\(\)/);
        // Must NOT use the legacy 320-char limit anymore.
        expect(WEBHOOK_SRC).not.toMatch(/customerEmailRaw\.slice\(0, 320\)/);
    });

    it('P264-01: schema column width is varchar(255) for customer_email', () => {
        // The slice limit MUST match the schema. If schema width changes, this
        // test will fire so the slice limit is reviewed in lockstep.
        expect(SCHEMA_SRC).toMatch(/customerEmail:\s*varchar\(["']customer_email["'],\s*\{\s*length:\s*255\s*\}\)/);
    });

    it('P264-02: defensive image-tier cross-check warns on mismatch', () => {
        // The cross-check shape must include both the SELECT on images and
        // the conditional warn comparing currentImage.license_tier !== tier.
        expect(WEBHOOK_SRC).toMatch(/from\(images\)/);
        expect(WEBHOOK_SRC).toMatch(/currentImage\.license_tier\s*!==\s*tier/);
        // The warn must precede the INSERT so the audit signal lands before
        // the entitlement row is created.
        const warnIndex = WEBHOOK_SRC.indexOf("console.warn('Stripe webhook: tier mismatch");
        const insertIndex = WEBHOOK_SRC.indexOf('db.insert(entitlements)');
        expect(warnIndex).toBeGreaterThan(-1);
        expect(insertIndex).toBeGreaterThan(-1);
        expect(warnIndex).toBeLessThan(insertIndex);
    });

    it('P264-03: payment_status branch splits unpaid (warn) from other (error)', () => {
        // Cycle 4 RPF / P264-03: 'unpaid' is the documented async-paid happy
        // path and uses console.warn; other non-paid statuses still use
        // console.error.
        expect(WEBHOOK_SRC).toMatch(/session\.payment_status\s*===\s*['"]unpaid['"]/);
        // Both severities must be present in the payment_status branch.
        expect(WEBHOOK_SRC).toMatch(/console\.warn\(['"]Stripe webhook: rejecting non-paid \(async\) session/);
        expect(WEBHOOK_SRC).toMatch(/console\.error\(['"]Stripe webhook: rejecting unexpected non-paid status/);
    });
});

describe('cycle 4 RPF / download route source-contracts', () => {
    it('P264-06: parallelizes the two realpath calls via Promise.all', () => {
        // Match a Promise.all containing both realpath calls. The exact
        // formatting may vary so the regex is intentionally loose on
        // whitespace and naming.
        expect(DOWNLOAD_ROUTE_SRC).toMatch(/Promise\.all\(\[[\s\S]*?realpath\(uploadsDir\)[\s\S]*?realpath\(filePath\)[\s\S]*?\]\)/);
    });
});

describe('cycle 4 RPF / sales action source-contracts', () => {
    it('P264-07: maps StripeAuthenticationError and StripeRateLimitError to network', () => {
        expect(SALES_ACTIONS_SRC).toMatch(
            /e\.type\s*===\s*['"]StripeAuthenticationError['"][\s\S]*?e\.type\s*===\s*['"]StripeRateLimitError['"][\s\S]*?return\s*['"]network['"]/,
        );
    });
});

describe('cycle 4 RPF / sales-client source-contracts', () => {
    it('P264-04: mapErrorCode switch covers all three new RefundErrorCode values', () => {
        expect(SALES_CLIENT_SRC).toMatch(/case\s*['"]not-found['"]\s*:\s*[\s\S]*?return\s*t\.refundErrorNotFound/);
        expect(SALES_CLIENT_SRC).toMatch(/case\s*['"]invalid-id['"]\s*:\s*[\s\S]*?return\s*t\.refundErrorInvalidId/);
        expect(SALES_CLIENT_SRC).toMatch(/case\s*['"]no-payment-intent['"]\s*:\s*[\s\S]*?return\s*t\.refundErrorNoPaymentIntent/);
    });

    it('P264-04: SalesTranslations interface declares the three new keys', () => {
        expect(SALES_CLIENT_SRC).toMatch(/refundErrorNotFound:\s*string/);
        expect(SALES_CLIENT_SRC).toMatch(/refundErrorInvalidId:\s*string/);
        expect(SALES_CLIENT_SRC).toMatch(/refundErrorNoPaymentIntent:\s*string/);
    });

    it('P264-04: page.tsx passes the three new keys through to client', () => {
        expect(SALES_PAGE_SRC).toMatch(/refundErrorNotFound:\s*t\(['"]refundErrorNotFound['"]\)/);
        expect(SALES_PAGE_SRC).toMatch(/refundErrorInvalidId:\s*t\(['"]refundErrorInvalidId['"]\)/);
        expect(SALES_PAGE_SRC).toMatch(/refundErrorNoPaymentIntent:\s*t\(['"]refundErrorNoPaymentIntent['"]\)/);
    });

    it('P264-04: en.json has the three new keys', () => {
        expect(EN_JSON_SRC).toMatch(/"refundErrorNotFound":\s*"/);
        expect(EN_JSON_SRC).toMatch(/"refundErrorInvalidId":\s*"/);
        expect(EN_JSON_SRC).toMatch(/"refundErrorNoPaymentIntent":\s*"/);
    });

    it('P264-04: ko.json has the three new keys', () => {
        expect(KO_JSON_SRC).toMatch(/"refundErrorNotFound":\s*"/);
        expect(KO_JSON_SRC).toMatch(/"refundErrorInvalidId":\s*"/);
        expect(KO_JSON_SRC).toMatch(/"refundErrorNoPaymentIntent":\s*"/);
    });

    it('P264-08: row Refund button text is pinned to t.refundButton (no rotation on refundingId)', () => {
        // Match the Button block that was previously toggling text. The new
        // shape renders just `{t.refundButton}` and uses `disabled` for the
        // in-flight cue. The previous shape `refundingId === row.id ? t.refunding : t.refundButton`
        // must be absent.
        expect(SALES_CLIENT_SRC).not.toMatch(/refundingId\s*===\s*row\.id\s*\?\s*t\.refunding\s*:\s*t\.refundButton/);
    });

    it('P264-09: errorLoad div has role="alert"', () => {
        expect(SALES_CLIENT_SRC).toMatch(/role=["']alert["'][^>]*>\s*\{t\.errorLoad\}/);
    });
});

describe('cycle 4 RPF / env example documentation', () => {
    it('P264-10: LOG_PLAINTEXT_DOWNLOAD_TOKENS is documented in .env.local.example', () => {
        expect(ENV_EXAMPLE_SRC).toMatch(/LOG_PLAINTEXT_DOWNLOAD_TOKENS/);
    });
});
