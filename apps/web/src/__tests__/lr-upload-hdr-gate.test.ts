/**
 * Run-3 RPF cycle 1 / F2: source-text contract test for the Lightroom PAT
 * upload route (/api/admin/lr/upload). Asserts the `allow_hdr_ingest` ingest
 * gate is present and ordered before the DB insert, mirroring the browser
 * upload action (app/actions/images.ts).
 *
 * The route is a multipart, token-authenticated handler that is heavy to
 * exercise end-to-end (FormData + Sharp + DB + queue). Per the repo convention
 * (stripe-webhook-source.test.ts, og-route-source-contracts.test.ts), a
 * source-contract test is the practical guardrail against a future refactor
 * silently dropping the HDR gate and re-introducing the browser/Lightroom
 * ingest-path divergence the R8 plan warned about.
 *
 * Also closes the "LR route has zero test coverage" sub-finding from
 * test-engineer.md F2.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LR_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'admin', 'lr', 'upload', 'route.ts'),
    'utf8',
);

describe('lr upload HDR-ingest source-contract', () => {
    it('imports deleteOriginalUploadFile from upload-paths', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*deleteOriginalUploadFile[^}]*\}\s*from\s*['"]@\/lib\/upload-paths['"]/,
        );
    });

    it('reads config.allowHdrIngest to gate HDR ingest', () => {
        expect(LR_SRC).toContain('config.allowHdrIngest');
    });

    it('rejects HDR sources when allowHdrIngest is false, before the DB insert', () => {
        // The gate must reference isHdr + !config.allowHdrIngest.
        const gateIndex = LR_SRC.search(/data\.colorSignals\?\.isHdr\s*&&\s*!config\.allowHdrIngest/);
        expect(gateIndex).toBeGreaterThan(-1);
        // It must precede the images insert so a rejected HDR source never
        // lands a DB row.
        const insertIndex = LR_SRC.indexOf('db.insert(images)');
        expect(insertIndex).toBeGreaterThan(-1);
        expect(gateIndex).toBeLessThan(insertIndex);
    });

    it('deletes the saved original and returns 422 on HDR reject', () => {
        // Walk the reject block from the gate condition to its closing brace.
        const block = LR_SRC.match(
            /if\s*\(\s*data\.colorSignals\?\.isHdr\s*&&\s*!config\.allowHdrIngest\s*\)\s*\{[\s\S]*?\n\s*\}/,
        );
        expect(block).not.toBeNull();
        const blockStr = block?.[0] ?? '';
        // Original must be removed from disk so a rejected ingest leaves no
        // orphaned file (parity with the browser path).
        expect(blockStr).toMatch(/deleteOriginalUploadFile\(/);
        // 422 Unprocessable Entity — the source was understood but rejected.
        expect(blockStr).toMatch(/status:\s*422/);
    });

    it('still wraps withAdminAuth with the lr:upload token scope (auth unchanged)', () => {
        expect(LR_SRC).toMatch(/withAdminAuth\(/);
        expect(LR_SRC).toMatch(/allowTokenScope:\s*['"]lr:upload['"]/);
    });
});
