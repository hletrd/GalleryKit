/**
 * Cycle 5 RPF / P388-07 / C5-RPF-07: source-contract tests for the cycle 5
 * in-cycle fixes. Behavior-level tests are impractical for these paths (the
 * webhook + refund routes need real Stripe + a real DB) so source-text
 * guards prevent silent regressions on the cycle 5 fix shapes.
 *
 * Covered:
 *   - P388-01 / C5-RPF-01: refund mutation passes Idempotency-Key
 *     (`refund-${entitlementId}`).
 *   - P388-02 / C5-RPF-02: webhook idempotent-skip + entitlement-created
 *     log lines use structured-object form (NOT template literal).
 *   - P388-03 / C5-RPF-03: 'auth-error' is in the RefundErrorCode union;
 *     mapStripeRefundError maps StripeAuthenticationError → 'auth-error';
 *     StripeRateLimitError remains 'network'.
 *   - P388-04 / C5-RPF-04: EMAIL_SHAPE regex declared at module scope
 *     (NOT inside POST handler).
 *   - P388-05 / C5-RPF-05: mapStripeRefundError handles non-Error
 *     throws (AbortError, ETIMEDOUT, ECONNREFUSED) BEFORE the instanceof
 *     check.
 *   - P388-06 / C5-RPF-06: webhook rejects raw email > 255 chars BEFORE
 *     truncation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WEBHOOK_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
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

const EN_JSON_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'messages', 'en.json'),
    'utf8',
);

const KO_JSON_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'messages', 'ko.json'),
    'utf8',
);

describe('cycle 5 RPF / sales action source-contracts', () => {
    it('P388-01: refund mutation passes idempotencyKey of refund-${entitlementId}', () => {
        // The call uses multi-line formatting with optional trailing
        // commas. Match the two key concepts — the call site name AND
        // the deterministic idempotency key — independently with
        // ordering enforced by an indexOf comparison below.
        expect(SALES_ACTIONS_SRC).toMatch(/stripe\.refunds\.create\(/);
        expect(SALES_ACTIONS_SRC).toMatch(/idempotencyKey:\s*`refund-\$\{entitlementId\}`/);
        // Ensure the idempotency key is wired into the SAME call (i.e. the
        // idempotencyKey appears AFTER `stripe.refunds.create(` and BEFORE
        // the next semicolon).
        const callIndex = SALES_ACTIONS_SRC.indexOf('stripe.refunds.create(');
        expect(callIndex).toBeGreaterThan(-1);
        const semiIndex = SALES_ACTIONS_SRC.indexOf(';', callIndex);
        const keyIndex = SALES_ACTIONS_SRC.indexOf('idempotencyKey: `refund-${entitlementId}`', callIndex);
        expect(keyIndex).toBeGreaterThan(callIndex);
        expect(keyIndex).toBeLessThan(semiIndex);
    });

    it('P388-03: RefundErrorCode union includes auth-error', () => {
        // Match the union member explicitly. The `|` separators allow any
        // formatting (single or multi-line); the literal must appear.
        expect(SALES_ACTIONS_SRC).toMatch(/['"]auth-error['"]/);
    });

    it('P388-03: mapStripeRefundError returns auth-error for StripeAuthenticationError', () => {
        expect(SALES_ACTIONS_SRC).toMatch(
            /e\.type\s*===\s*['"]StripeAuthenticationError['"][\s\S]*?return\s*['"]auth-error['"]/,
        );
    });

    it('P388-03: StripeRateLimitError remains mapped to network (not auth-error)', () => {
        expect(SALES_ACTIONS_SRC).toMatch(
            /e\.type\s*===\s*['"]StripeRateLimitError['"][\s\S]*?return\s*['"]network['"]/,
        );
    });

    it('P388-05: mapStripeRefundError handles AbortError before instanceof Error guard', () => {
        // The non-Error short-circuit must precede the instanceof Error
        // line so AbortError DOMException values map to 'network'.
        const abortIndex = SALES_ACTIONS_SRC.search(/maybeNonError\?\.name\s*===\s*['"]AbortError['"]/);
        const instanceofIndex = SALES_ACTIONS_SRC.search(/!\s*\(\s*err\s+instanceof\s+Error\s*\)/);
        expect(abortIndex).toBeGreaterThan(-1);
        expect(instanceofIndex).toBeGreaterThan(-1);
        expect(abortIndex).toBeLessThan(instanceofIndex);
    });

    it('P388-05: mapStripeRefundError handles common net error codes (ETIMEDOUT/ECONNREFUSED)', () => {
        expect(SALES_ACTIONS_SRC).toMatch(/['"]ETIMEDOUT['"]/);
        expect(SALES_ACTIONS_SRC).toMatch(/['"]ECONNREFUSED['"]/);
    });
});

describe('cycle 5 RPF / webhook source-contracts', () => {
    it('P388-04: EMAIL_SHAPE regex declared at module scope (not inside POST handler)', () => {
        // The hoist places EMAIL_SHAPE BEFORE `export async function POST`.
        const regexIndex = WEBHOOK_SRC.indexOf('const EMAIL_SHAPE');
        const postFnIndex = WEBHOOK_SRC.indexOf('export async function POST');
        expect(regexIndex).toBeGreaterThan(-1);
        expect(postFnIndex).toBeGreaterThan(-1);
        expect(regexIndex).toBeLessThan(postFnIndex);
    });

    it('P388-06: webhook rejects raw email > 255 chars BEFORE truncation', () => {
        // Look for the explicit length check on the trimmed raw email.
        expect(WEBHOOK_SRC).toMatch(/trimmedEmailRaw\.length\s*>\s*255/);
        // The reject log line is structured-object form.
        expect(WEBHOOK_SRC).toMatch(
            /console\.error\(['"]Stripe webhook: rejecting oversized customer email['"],\s*\{[\s\S]*?sessionId/,
        );
    });

    it('P388-02: idempotent-skip log uses structured-object form (NOT template literal)', () => {
        expect(WEBHOOK_SRC).toMatch(
            /console\.info\(['"]Stripe webhook: idempotent skip['"],\s*\{\s*sessionId\s*\}\s*\)/,
        );
        // The legacy template literal form must be absent.
        expect(WEBHOOK_SRC).not.toMatch(/`Stripe webhook: idempotent skip\b[\s\S]*?session=\$\{sessionId\}`/);
    });

    it('P388-02: entitlement-created log uses structured-object form (NOT template literal)', () => {
        expect(WEBHOOK_SRC).toMatch(
            /console\.info\(['"]Entitlement created['"],\s*\{\s*imageId,\s*tier,\s*sessionId\s*\}\s*\)/,
        );
        expect(WEBHOOK_SRC).not.toMatch(/`Entitlement created:\s*imageId=\$\{imageId\}/);
    });
});

describe('cycle 5 RPF / sales-client source-contracts', () => {
    it('P388-03: SalesTranslations declares refundErrorAuth key', () => {
        expect(SALES_CLIENT_SRC).toMatch(/refundErrorAuth:\s*string/);
    });

    it('P388-03: mapErrorCode switch handles auth-error case', () => {
        expect(SALES_CLIENT_SRC).toMatch(
            /case\s*['"]auth-error['"]\s*:\s*[\s\S]*?return\s*t\.refundErrorAuth/,
        );
    });

    it('P388-03: page.tsx passes refundErrorAuth through to client', () => {
        expect(SALES_PAGE_SRC).toMatch(/refundErrorAuth:\s*t\(['"]refundErrorAuth['"]\)/);
    });

    it('P388-03: en.json has refundErrorAuth key', () => {
        expect(EN_JSON_SRC).toMatch(/"refundErrorAuth":\s*"/);
    });

    it('P388-03: ko.json has refundErrorAuth key', () => {
        expect(KO_JSON_SRC).toMatch(/"refundErrorAuth":\s*"/);
    });
});
