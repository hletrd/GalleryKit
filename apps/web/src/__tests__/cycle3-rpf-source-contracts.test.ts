/**
 * Cycle 3 RPF / P262-12 / C3-RPF-12: source-contract tests for the
 * cycle 3 in-cycle fixes. These tests assert the SHAPE of the patched
 * code, not behavior — the webhook + download routes are hard to
 * exercise end-to-end without real Stripe + a real upload directory,
 * so source-text guards prevent silent regressions.
 *
 * Covered:
 *   - P262-01 / C3-RPF-01: webhook gates on `payment_status === 'paid'`
 *     before INSERT.
 *   - P262-02 / C3-RPF-02: webhook rejects `amountTotalCents <= 0`
 *     before INSERT.
 *   - P262-03 / C3-RPF-03: download route imports `UPLOAD_DIR_ORIGINAL`
 *     from `@/lib/upload-paths` instead of hardcoding the path.
 *   - P262-04 / C3-RPF-04: download route sanitizes the extension before
 *     interpolating into Content-Disposition.
 *   - P262-05 / C3-RPF-05: download route runs `lstat` (file existence
 *     check) BEFORE the atomic single-use claim.
 *   - P262-07 / C3-RPF-07: webhook SELECTs by sessionId before
 *     generateDownloadToken so retries do not mint a fresh token.
 *   - P262-09 / C3-RPF-09: webhook lowercases the customer email before
 *     INSERT.
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

const SALES_PAGE_SRC = fs.readFileSync(
    path.resolve(
        __dirname, '..', 'app', '[locale]', 'admin', '(protected)',
        'sales', 'page.tsx',
    ),
    'utf8',
);

describe('cycle 3 RPF / webhook source-contracts', () => {
    it('P262-01: gates on session.payment_status === "paid" BEFORE INSERT', () => {
        const gateIndex = WEBHOOK_SRC.indexOf("session.payment_status !== 'paid'");
        const insertIndex = WEBHOOK_SRC.indexOf('db.insert(entitlements)');
        expect(gateIndex).toBeGreaterThan(-1);
        expect(insertIndex).toBeGreaterThan(-1);
        expect(gateIndex).toBeLessThan(insertIndex);
    });

    it('P262-02: rejects amountTotalCents <= 0 BEFORE INSERT', () => {
        // The guard uses Number.isInteger and a positive-amount check.
        expect(WEBHOOK_SRC).toMatch(/Number\.isInteger\(amountTotalCents\)/);
        expect(WEBHOOK_SRC).toMatch(/amountTotalCents\s*<=\s*0/);
        const guardIndex = WEBHOOK_SRC.indexOf('amountTotalCents <= 0');
        const insertIndex = WEBHOOK_SRC.indexOf('db.insert(entitlements)');
        expect(guardIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeLessThan(insertIndex);
    });

    it('P262-07: SELECTs existing entitlement by sessionId BEFORE generateDownloadToken', () => {
        // Strip comments first so the test is robust against doc-strings that
        // mention `generateDownloadToken()`.
        const stripped = WEBHOOK_SRC
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        const selectIndex = stripped.indexOf('eq(entitlements.sessionId, sessionId)');
        const tokenGenIndex = stripped.indexOf('generateDownloadToken()');
        expect(selectIndex).toBeGreaterThan(-1);
        expect(tokenGenIndex).toBeGreaterThan(-1);
        expect(selectIndex).toBeLessThan(tokenGenIndex);
    });

    it('P262-09: lowercases customerEmail (after slice, before INSERT)', () => {
        // The transform should be applied right at the slice site.
        expect(WEBHOOK_SRC).toMatch(/\.slice\(0, 320\)\.toLowerCase\(\)/);
        const lowerIndex = WEBHOOK_SRC.indexOf('.toLowerCase()');
        const insertIndex = WEBHOOK_SRC.indexOf('db.insert(entitlements)');
        expect(lowerIndex).toBeGreaterThan(-1);
        expect(lowerIndex).toBeLessThan(insertIndex);
    });

    it('P262-11: tier-allowlist reject branch logs at error level', () => {
        // The block uses a regex that walks until the matching `})` of
        // NextResponse.json since the block contains nested braces.
        const block = WEBHOOK_SRC.match(
            /if\s*\(\s*!isPaidLicenseTier\(tier\)\s*\)\s*\{[\s\S]*?return\s+NextResponse\.json[\s\S]*?\}\)?\s*;?\s*\n\s*\}/,
        );
        expect(block).not.toBeNull();
        const blockStr = block?.[0] ?? '';
        expect(blockStr).toMatch(/console\.error/);
    });
});

describe('cycle 3 RPF / download route source-contracts', () => {
    it('P262-03: imports UPLOAD_DIR_ORIGINAL from @/lib/upload-paths', () => {
        expect(DOWNLOAD_ROUTE_SRC).toMatch(
            /import\s*\{\s*UPLOAD_DIR_ORIGINAL\s*\}\s*from\s*['"]@\/lib\/upload-paths['"]/,
        );
    });

    it('P262-03: does NOT hardcode `data/uploads/original` path', () => {
        // The previous shape was `path.resolve(process.cwd(), 'data', 'uploads', 'original')`
        // The new shape is `const uploadsDir = UPLOAD_DIR_ORIGINAL`.
        expect(DOWNLOAD_ROUTE_SRC).not.toMatch(/process\.cwd\(\)\s*,\s*['"]data['"]/);
        expect(DOWNLOAD_ROUTE_SRC).toMatch(/uploadsDir\s*=\s*UPLOAD_DIR_ORIGINAL/);
    });

    it('P262-04: sanitizes extension before interpolating into Content-Disposition', () => {
        // The extension must be filtered to alphanumerics + dot before being
        // appended to the filename string. Pattern ensures we use a safe set.
        expect(DOWNLOAD_ROUTE_SRC).toMatch(
            /replace\(\/\[\^a-zA-Z0-9\.\]\/g,\s*['"]['"]\)/,
        );
        // The interpolated downloadName must use the sanitized variable, not
        // the raw `ext`.
        expect(DOWNLOAD_ROUTE_SRC).toMatch(/`photo-\$\{imageId\}\$\{safeExt\}`/);
    });

    it('P262-05: lstat runs BEFORE the atomic single-use claim', () => {
        const lstatIndex = DOWNLOAD_ROUTE_SRC.indexOf('await lstat(filePath)');
        const claimIndex = DOWNLOAD_ROUTE_SRC.indexOf('downloadedAt: sql`NOW()`');
        expect(lstatIndex).toBeGreaterThan(-1);
        expect(claimIndex).toBeGreaterThan(-1);
        expect(lstatIndex).toBeLessThan(claimIndex);
    });

    it('P262-05: image SELECT runs BEFORE the atomic single-use claim', () => {
        // Image filename SELECT must move above the claim too, since lstat
        // depends on the filename.
        const imageSelectIndex = DOWNLOAD_ROUTE_SRC.indexOf('filename_original: images.filename_original');
        const claimIndex = DOWNLOAD_ROUTE_SRC.indexOf('downloadedAt: sql`NOW()`');
        expect(imageSelectIndex).toBeGreaterThan(-1);
        expect(imageSelectIndex).toBeLessThan(claimIndex);
    });
});

describe('cycle 3 RPF / sales action source-contracts', () => {
    it('P262-06: getTotalRevenueCents action is removed', () => {
        expect(SALES_ACTIONS_SRC).not.toMatch(/export\s+async\s+function\s+getTotalRevenueCents/);
        // Also confirm `sum` import was removed (it was only used by that action).
        expect(SALES_ACTIONS_SRC).not.toMatch(/import\s*\{[^}]*\bsum\b[^}]*\}\s*from\s*['"]drizzle-orm['"]/);
    });

    it('P262-06: sales page no longer imports or calls getTotalRevenueCents', () => {
        // Strip block + line comments first, then assert no real reference.
        const stripped = SALES_PAGE_SRC
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(stripped).not.toMatch(/getTotalRevenueCents/);
        // Should not pass `totalRevenueCents` prop either.
        expect(stripped).not.toMatch(/totalRevenueCents\s*=/);
    });

    it('P262-10: sales page passes t("errorLoad") when listEntitlements fails', () => {
        expect(SALES_PAGE_SRC).toMatch(/salesResult\.error\s*\?\s*t\(['"]errorLoad['"]\)/);
    });
});
