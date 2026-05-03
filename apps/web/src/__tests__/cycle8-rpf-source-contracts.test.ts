/**
 * Cycle 8 RPF / P394-02 / C8-RPF-02: source-contract tests for the cycle 8
 * in-cycle fixes. Behavior-level tests are impractical for this path (the
 * download route needs a real DB and filesystem fixture for the lstat/
 * realpath catch to fire), so a source-text guard prevents silent regression
 * on the cycle 8 fix shape.
 *
 * Covered:
 *   - P394-01 / C8-RPF-01: download lstat/realpath catch log uses
 *     structured-object form with `entitlementId: entitlement.id` field;
 *     legacy positional form (`'Download lstat/realpath error:'` with
 *     trailing colon and `err` as 2nd positional arg) absent.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DOWNLOAD_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'download', '[imageId]', 'route.ts'),
    'utf8',
);

describe('cycle 8 RPF / download route source-contracts', () => {
    it('P394-01: lstat/realpath catch log uses structured-object form with entitlementId', () => {
        // Structured form with entitlementId correlation key.
        expect(DOWNLOAD_SRC).toMatch(
            /console\.error\(\s*['"]Download lstat\/realpath error['"],\s*\{[\s\S]*?entitlementId:\s*entitlement\.id[\s\S]*?\}/,
        );
        // Legacy positional form (with trailing colon in label) absent.
        expect(DOWNLOAD_SRC).not.toMatch(
            /console\.error\(\s*['"]Download lstat\/realpath error:['"],\s*err\s*\)/,
        );
    });

    it('P394-01: stream-error catch retains its existing structured form (regression guard)', () => {
        // The same-file stream-error log was already structured (cycle 4 era).
        // Pin it so a future refactor cannot revert.
        expect(DOWNLOAD_SRC).toMatch(
            /console\.error\(\s*['"]Download stream error:['"],\s*\{[\s\S]*?entitlementId:\s*entitlement\.id[\s\S]*?\}/,
        );
    });
});
