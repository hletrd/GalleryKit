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

    it('usedRow heuristic requires cleared hash AND set downloadedAt (R4C3 COR-R4C3-03)', () => {
        // refundEntitlement clears the hash WITHOUT setting downloadedAt, so
        // the "Token already used" disambiguation query must require BOTH
        // `isNull(downloadTokenHash)` and `isNotNull(downloadedAt)` — or a
        // refunded-never-downloaded row mislabels any mistyped token for the
        // image as 410 "already used" instead of the accurate 404.
        const usedRowBlock = DOWNLOAD_ROUTE_SRC.match(
            /const\s*\[usedRow\][\s\S]*?\.limit\(1\)/,
        );
        expect(usedRowBlock).not.toBeNull();
        const blockStr = usedRowBlock?.[0] ?? '';
        expect(blockStr).toMatch(/isNull\(entitlements\.downloadTokenHash\)/);
        expect(blockStr).toMatch(/isNotNull\(entitlements\.downloadedAt\)/);
    });

    it('download route checks refunded flag before serving the file', () => {
        // The route must short-circuit on entitlement.refunded === true
        // before invoking the file stream. R4C4 COR-R4C4-06: the stream now
        // comes from the validated FileHandle (`fileHandle.createReadStream()`).
        const refundCheckIndex = DOWNLOAD_ROUTE_SRC.indexOf('entitlement.refunded');
        expect(refundCheckIndex).toBeGreaterThan(-1);
        const streamCallMatch = DOWNLOAD_ROUTE_SRC.match(/fileHandle\.createReadStream\(\)/);
        expect(streamCallMatch).not.toBeNull();
        const streamIndex = streamCallMatch?.index ?? -1;
        expect(streamIndex).toBeGreaterThan(-1);
        // Refund check happens before the stream is created
        expect(refundCheckIndex).toBeLessThan(streamIndex);
    });
});

/**
 * R4C4 COR-R4C4-06 / TEST-R4C4-15: open-before-claim ordering. The file
 * handle must be opened (awaited — failures observable while the token is
 * still intact) BEFORE the atomic single-use claim, and must be closed on
 * every post-open non-success path so it cannot leak.
 */
describe('download route open-before-claim contract (R4C4 COR-R4C4-06)', () => {
    it('opens the file handle BEFORE the single-use claim UPDATE', () => {
        const openIndex = DOWNLOAD_ROUTE_SRC.search(/fileHandle\s*=\s*await\s+open\(/);
        const claimIndex = DOWNLOAD_ROUTE_SRC.indexOf('downloadedAt: sql`NOW()`');
        expect(openIndex).toBeGreaterThan(-1);
        expect(claimIndex).toBeGreaterThan(-1);
        expect(openIndex).toBeLessThan(claimIndex);
    });

    it('open failures share the ENOENT-to-404 catch that leaves the token intact', () => {
        // The open() sits inside the same try whose catch maps ENOENT to
        // 'File not found' BEFORE any claim — so a vanished file never
        // consumes the token.
        const tryIndex = DOWNLOAD_ROUTE_SRC.search(/fileHandle\s*=\s*await\s+open\(/);
        const catchBlock = DOWNLOAD_ROUTE_SRC.slice(tryIndex);
        expect(catchBlock).toMatch(/code === 'ENOENT'[\s\S]*?File not found[\s\S]*?status:\s*404/);
        // And that 404 return precedes the claim UPDATE in source order.
        const enoentIndex = tryIndex + catchBlock.search(/code === 'ENOENT'/);
        const claimIndex = DOWNLOAD_ROUTE_SRC.indexOf('downloadedAt: sql`NOW()`');
        expect(enoentIndex).toBeLessThan(claimIndex);
    });

    it('closes the handle on the already-used 410 and claim-failure paths', () => {
        // Both the affected===0 branch and the claim-UPDATE catch must close
        // the open handle before returning.
        const claimCatch = DOWNLOAD_ROUTE_SRC.match(/Download claim UPDATE failed[\s\S]{0,200}/);
        expect(DOWNLOAD_ROUTE_SRC).toMatch(/await fileHandle\.close\(\)\.catch\(\(\) => undefined\);\s*return new NextResponse\('Token already used'/);
        expect(claimCatch).not.toBeNull();
        const claimCatchBlock = DOWNLOAD_ROUTE_SRC.slice(
            DOWNLOAD_ROUTE_SRC.indexOf('} catch (err: unknown) {', DOWNLOAD_ROUTE_SRC.search(/fileHandle\s*=\s*await\s+open\(/)),
        );
        expect(claimCatchBlock).toContain('fileHandle.close()');
    });

    it('streams from the validated handle, not a raw path re-open', () => {
        expect(DOWNLOAD_ROUTE_SRC).toMatch(/fileHandle\.createReadStream\(\)/);
        // The raw-path form must be gone (it opened asynchronously AFTER the
        // claim, burning the token on a vanished file).
        expect(DOWNLOAD_ROUTE_SRC).not.toMatch(/createReadStream\(resolvedFilePath\)/);
        expect(DOWNLOAD_ROUTE_SRC).not.toMatch(/import\s*\{[^}]*createReadStream[^}]*\}\s*from\s*'fs'/);
    });

    it('Content-Length comes from the opened inode (handle.stat), not the pre-open lstat', () => {
        expect(DOWNLOAD_ROUTE_SRC).toMatch(/fileSize\s*=\s*\(await fileHandle\.stat\(\)\)\.size/);
        expect(DOWNLOAD_ROUTE_SRC).toMatch(/'Content-Length':\s*fileSize\.toString\(\)/);
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
