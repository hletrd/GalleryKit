/**
 * Cycle 2 RPF / P260-14 / C2-RPF-12: contract tests asserting that
 * `refundEntitlement` invalidates any in-flight download token. The
 * test combines:
 *   1. Source-contract assertion that the action sets
 *      `downloadTokenHash: null` in the same UPDATE that flips
 *      `refunded: true`.
 *   2. Behavioral assertion via `verifyTokenAgainstHash` that a
 *      cleared (null) hash cannot match any token, so the download
 *      route's hash check would reject the customer's previous token
 *      after refund.
 *
 * The download route's `if (entitlement.refunded)` check is also a
 * source-contract assertion in `stripe-download-tokens.test.ts`; this
 * test focuses on the refund-side invariant.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateDownloadToken, verifyTokenAgainstHash } from '../lib/download-tokens';

const SALES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'actions', 'sales.ts'),
    'utf8',
);

const DOWNLOAD_ROUTE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'download', '[imageId]', 'route.ts'),
    'utf8',
);

describe('refund-clears-download-token (source-contract)', () => {
    it('refundEntitlement sets downloadTokenHash to null', () => {
        // The action must include `downloadTokenHash: null` in the UPDATE
        // that flips refunded. Both fields must appear in the same .set({...})
        // block to guarantee atomicity.
        const setBlock = SALES_SRC.match(
            /\.set\(\s*\{[^}]*refunded:\s*true[^}]*\}\s*\)/,
        );
        expect(setBlock).not.toBeNull();
        const blockStr = setBlock?.[0] ?? '';
        expect(blockStr).toMatch(/downloadTokenHash:\s*null/);
    });

    it('refundEntitlement does not set downloadTokenHash to anything other than null', () => {
        // Defensive: catch a future refactor that sets the hash to ''
        // or to a static value (which would still pass the previous test
        // if regex weakened) — but here we assert null specifically.
        const updateBlocks = SALES_SRC.match(
            /\.update\(entitlements\)\s*\.set\(\s*\{[^}]*\}\s*\)/g,
        );
        expect(updateBlocks).not.toBeNull();
        for (const block of updateBlocks ?? []) {
            if (block.includes('refunded: true')) {
                // The refund-update block must clear the hash
                expect(block).toMatch(/downloadTokenHash:\s*null/);
            }
        }
    });

    it('download route checks refunded flag before serving the file', () => {
        // The route must short-circuit on entitlement.refunded === true
        // before invoking the file stream. Use a regex that matches the
        // call site (createReadStream(...)), not the top-of-file import.
        const refundCheckIndex = DOWNLOAD_ROUTE_SRC.indexOf('entitlement.refunded');
        expect(refundCheckIndex).toBeGreaterThan(-1);
        // Match the call site, not the import line. The call site has a
        // `createReadStream(` followed by an identifier; the import does not.
        const streamCallMatch = DOWNLOAD_ROUTE_SRC.match(/createReadStream\(\s*\w/);
        expect(streamCallMatch).not.toBeNull();
        const streamIndex = streamCallMatch?.index ?? -1;
        expect(streamIndex).toBeGreaterThan(-1);
        // Refund check happens before the stream is created
        expect(refundCheckIndex).toBeLessThan(streamIndex);
    });
});

describe('refund-clears-download-token (behavioral via hash verify)', () => {
    it('verifyTokenAgainstHash rejects when storedHash is null (post-refund)', () => {
        const { token } = generateDownloadToken();
        // Simulate the post-refund state: DB has cleared the hash.
        // verifyTokenAgainstHash must reject.
        // Cast through unknown to mimic the real-world DB null path.
        expect(verifyTokenAgainstHash(token, null as unknown as string)).toBe(false);
    });

    it('verifyTokenAgainstHash rejects when storedHash is empty string', () => {
        const { token } = generateDownloadToken();
        expect(verifyTokenAgainstHash(token, '')).toBe(false);
    });

    it('verifyTokenAgainstHash rejects malformed hex (P260-11 shape guard)', () => {
        const { token } = generateDownloadToken();
        // Non-64-char or non-hex storedHash should be rejected with shape guard
        expect(verifyTokenAgainstHash(token, 'not-hex-and-not-64-chars')).toBe(false);
        expect(verifyTokenAgainstHash(token, 'a'.repeat(63))).toBe(false); // 63 chars
        expect(verifyTokenAgainstHash(token, 'a'.repeat(65))).toBe(false); // 65 chars
        expect(verifyTokenAgainstHash(token, 'g'.repeat(64))).toBe(false); // not hex
        expect(verifyTokenAgainstHash(token, 'A'.repeat(64))).toBe(false); // uppercase
    });
});

describe('sales action error-mapping contract (P260-07)', () => {
    it('exports RefundErrorCode union type', () => {
        // Check that the source declares the union type
        expect(SALES_SRC).toMatch(/RefundErrorCode/);
    });

    it('maps charge_already_refunded to already-refunded code', () => {
        expect(SALES_SRC).toMatch(/charge_already_refunded/);
        expect(SALES_SRC).toMatch(/already-refunded/);
    });

    it('maps resource_missing to charge-unknown code', () => {
        expect(SALES_SRC).toMatch(/resource_missing/);
        expect(SALES_SRC).toMatch(/charge-unknown/);
    });

    it('maps Stripe network errors to network code', () => {
        expect(SALES_SRC).toMatch(/StripeConnectionError/);
        expect(SALES_SRC).toMatch(/'network'/);
    });
});
