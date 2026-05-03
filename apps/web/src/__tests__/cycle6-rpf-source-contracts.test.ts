/**
 * Cycle 6 RPF / P390-06 / C6-RPF-06: source-contract tests for the cycle 6
 * in-cycle fixes. Behavior-level tests are impractical for these paths (the
 * webhook + checkout + refund routes need real Stripe + a real DB) so
 * source-text guards prevent silent regressions on the cycle 6 fix shapes.
 *
 * Covered:
 *   - P390-01 / C6-RPF-01: Stripe Checkout session creation passes
 *     `idempotencyKey: \`checkout-${imageId}-${ip}-${minute}\`` (parallel
 *     to cycle 5 P388-01 refund idempotency-key).
 *   - P390-02 / C6-RPF-02: webhook invalid-imageId log uses structured
 *     object form with sessionId + imageIdStr (NOT positional 2nd arg).
 *   - P390-03 / C6-RPF-03: refund action's catch path returns a stable
 *     'Refund failed' string instead of `err.message` (no Stripe request
 *     ID leak).
 *   - P390-04 / C6-RPF-04: mapStripeRefundError unknown branch emits a
 *     warn line (with NODE_ENV=test guard).
 *   - P390-05 / C6-RPF-05: webhook oversized-email reject log includes
 *     `cap: 255` field for self-documentation.
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

describe('cycle 6 RPF / checkout source-contracts', () => {
    it('P390-01: stripe.checkout.sessions.create passes idempotencyKey of checkout-${imageId}-${ip}-${minute}', () => {
        // The call uses multi-line formatting. Match the call site, the
        // idempotency-key derivation, and verify the key is wired into the
        // SAME call (i.e. appears AFTER `stripe.checkout.sessions.create(`
        // and BEFORE the next semicolon).
        expect(CHECKOUT_SRC).toMatch(/stripe\.checkout\.sessions\.create\(/);
        expect(CHECKOUT_SRC).toMatch(
            /idempotencyKey\s*=\s*`checkout-\$\{image\.id\}-\$\{ip\}-\$\{Math\.floor\(Date\.now\(\)\s*\/\s*60_000\)\}`/,
        );
        const callIndex = CHECKOUT_SRC.indexOf('stripe.checkout.sessions.create(');
        expect(callIndex).toBeGreaterThan(-1);
        const semiIndex = CHECKOUT_SRC.indexOf(';', callIndex);
        const keyIndex = CHECKOUT_SRC.indexOf('{ idempotencyKey }', callIndex);
        expect(keyIndex).toBeGreaterThan(callIndex);
        expect(keyIndex).toBeLessThan(semiIndex);
    });
});

describe('cycle 6 RPF / webhook source-contracts', () => {
    it('P390-02: invalid-imageId log uses structured-object form (NOT positional 2nd arg)', () => {
        // The structured form: console.error('label', { sessionId, imageIdStr })
        expect(WEBHOOK_SRC).toMatch(
            /console\.error\(\s*['"]Stripe webhook: invalid imageId in metadata['"],\s*\{[\s\S]*?sessionId,[\s\S]*?imageIdStr,?[\s\S]*?\}/,
        );
        // The legacy positional form must be absent.
        expect(WEBHOOK_SRC).not.toMatch(
            /console\.error\(\s*['"]Stripe webhook: invalid imageId in metadata['"],\s*imageIdStr\s*\)/,
        );
    });

    it('P390-05: oversized-email reject log includes cap: 255 field', () => {
        expect(WEBHOOK_SRC).toMatch(
            /console\.error\(\s*['"]Stripe webhook: rejecting oversized customer email['"],\s*\{[\s\S]*?cap:\s*255/,
        );
    });
});

describe('cycle 6 RPF / sales action source-contracts', () => {
    it('P390-03: refund catch path returns stable "Refund failed" (NOT err.message)', () => {
        // Search for the catch block's return statement structure. The
        // stable string form must be present.
        expect(SALES_ACTIONS_SRC).toMatch(
            /catch\s*\(\s*err\s*\)\s*\{[\s\S]*?return\s*\{\s*error:\s*['"]Refund failed['"],\s*errorCode:\s*mapStripeRefundError\(err\)[\s\S]*?\}/,
        );
        // The legacy form `err instanceof Error ? err.message : 'Refund
        // failed'` must be absent from the catch block. Search for the
        // specific signature-style match.
        expect(SALES_ACTIONS_SRC).not.toMatch(
            /error:\s*err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*['"]Refund failed['"]/,
        );
    });

    it('P390-04: mapStripeRefundError emits warn for unrecognized error types (with NODE_ENV=test guard)', () => {
        // The warn line is inside the unknown-branch fallthrough.
        expect(SALES_ACTIONS_SRC).toMatch(
            /process\.env\.NODE_ENV\s*!==\s*['"]test['"][\s\S]*?console\.warn\(\s*['"]Stripe refund: unrecognized error type['"]/,
        );
        // Verify the warn structured-object includes name/type/code.
        expect(SALES_ACTIONS_SRC).toMatch(
            /console\.warn\(\s*['"]Stripe refund: unrecognized error type['"],\s*\{[\s\S]*?name:[\s\S]*?type:[\s\S]*?code:/,
        );
    });

    it('P390-04: warn appears BEFORE the unknown return (not after dead code)', () => {
        const warnIdx = SALES_ACTIONS_SRC.search(
            /console\.warn\(\s*['"]Stripe refund: unrecognized error type['"]/,
        );
        // Find the unknown-branch return: the LAST `return 'unknown'` in the
        // mapStripeRefundError function (it should be the function's tail
        // return after StripeRateLimitError check).
        const unknownReturnIdx = SALES_ACTIONS_SRC.lastIndexOf("return 'unknown'");
        expect(warnIdx).toBeGreaterThan(-1);
        expect(unknownReturnIdx).toBeGreaterThan(-1);
        expect(warnIdx).toBeLessThan(unknownReturnIdx);
    });
});
