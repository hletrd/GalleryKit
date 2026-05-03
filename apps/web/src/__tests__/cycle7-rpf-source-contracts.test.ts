/**
 * Cycle 7 RPF / P392-07 / C7-RPF-07: source-contract tests for the cycle 7
 * in-cycle fixes. Behavior-level tests are impractical for these paths (the
 * webhook + checkout + sales action need real Stripe + a real DB), so
 * source-text guards prevent silent regressions on the cycle 7 fix shapes.
 *
 * Covered:
 *   - P392-01 / C7-RPF-01: checkout-failure log uses structured-object form
 *     with imageId field; legacy positional form ('... failed:') absent.
 *   - P392-02 / C7-RPF-02: webhook signature-verify log uses structured-object
 *     form with signatureLength field; legacy positional form absent.
 *   - P392-03 / C7-RPF-03: webhook insert-failure log uses structured-object
 *     form with sessionId field; legacy positional form absent.
 *   - P392-04 / C7-RPF-04: refund-failure log uses structured-object form
 *     with entitlementId field; legacy positional form absent.
 *   - P392-05 / C7-RPF-05: listEntitlements-failure log uses structured form;
 *     legacy positional form absent.
 *   - P392-06 / C7-RPF-06: dead `customer_email: undefined` key absent
 *     in checkout route.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHECKOUT_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'checkout', '[imageId]', 'route.ts'),
    'utf8',
);

const WEBHOOK_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
    'utf8',
);

const SALES_ACTIONS_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'actions', 'sales.ts'),
    'utf8',
);

describe('cycle 7 RPF / checkout source-contracts', () => {
    it('P392-01: checkout-failure log uses structured-object form with imageId field', () => {
        // Structured form with imageId correlation key.
        expect(CHECKOUT_SRC).toMatch(
            /console\.error\(\s*['"]Stripe checkout session creation failed['"],\s*\{[\s\S]*?imageId:\s*image\.id[\s\S]*?\}/,
        );
        // Legacy positional form (with trailing colon in label) absent.
        expect(CHECKOUT_SRC).not.toMatch(
            /console\.error\(\s*['"]Stripe checkout session creation failed:['"],\s*err\s*\)/,
        );
    });

    it('P392-06: dead `customer_email: undefined` key absent', () => {
        expect(CHECKOUT_SRC).not.toMatch(/customer_email:\s*undefined/);
    });
});

describe('cycle 7 RPF / webhook source-contracts', () => {
    it('P392-02: signature-verify log uses structured-object form with signatureLength', () => {
        expect(WEBHOOK_SRC).toMatch(
            /console\.error\(\s*['"]Stripe webhook signature verification failed['"],\s*\{[\s\S]*?signatureLength:\s*signature\.length[\s\S]*?\}/,
        );
        // Legacy positional form absent.
        expect(WEBHOOK_SRC).not.toMatch(
            /console\.error\(\s*['"]Stripe webhook signature verification failed:['"],\s*err\s*\)/,
        );
    });

    it('P392-03: insert-failure log uses structured-object form with sessionId/imageId/tier', () => {
        expect(WEBHOOK_SRC).toMatch(
            /console\.error\(\s*['"]Stripe webhook: failed to insert entitlement['"],\s*\{[\s\S]*?sessionId,[\s\S]*?imageId,[\s\S]*?tier,[\s\S]*?\}/,
        );
        // Legacy positional form absent.
        expect(WEBHOOK_SRC).not.toMatch(
            /console\.error\(\s*['"]Stripe webhook: failed to insert entitlement:['"],\s*err\s*\)/,
        );
    });
});

describe('cycle 7 RPF / sales action source-contracts', () => {
    it('P392-04: refund-failure log uses structured-object form with entitlementId', () => {
        expect(SALES_ACTIONS_SRC).toMatch(
            /console\.error\(\s*['"]Stripe refund failed['"],\s*\{\s*entitlementId,\s*err\s*\}/,
        );
        // Legacy positional form absent.
        expect(SALES_ACTIONS_SRC).not.toMatch(
            /console\.error\(\s*['"]Stripe refund failed:['"],\s*err\s*\)/,
        );
    });

    it('P392-05: listEntitlements-failure log uses structured-object form', () => {
        expect(SALES_ACTIONS_SRC).toMatch(
            /console\.error\(\s*['"]listEntitlements failed['"],\s*\{\s*err\s*\}/,
        );
        // Legacy positional form absent.
        expect(SALES_ACTIONS_SRC).not.toMatch(
            /console\.error\(\s*['"]listEntitlements failed:['"],\s*err\s*\)/,
        );
    });
});
