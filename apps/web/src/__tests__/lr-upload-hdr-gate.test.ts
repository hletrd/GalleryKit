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

/**
 * Run-3 RPF cycle 2 / F1: the LR PAT path must also strip GPS EXIF from the
 * on-disk original when `strip_gps_on_upload` is enabled, mirroring the browser
 * upload action (app/actions/images.ts PP-BUG-3). Nulling only the DB columns
 * left GPS in the file streamed verbatim by /api/download/[imageId], leaking
 * the photographer's protected location to paid-download purchasers. This
 * source-contract locks the strip so a future refactor cannot silently re-drop
 * the second ingest-path divergence.
 */
describe('lr upload GPS-original strip source-contract', () => {
    it('imports stripGpsFromOriginal from process-image', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*stripGpsFromOriginal[^}]*\}\s*from\s*['"]@\/lib\/process-image['"]/,
        );
    });

    it('imports UPLOAD_DIR_ORIGINAL from upload-paths', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*UPLOAD_DIR_ORIGINAL[^}]*\}\s*from\s*['"]@\/lib\/upload-paths['"]/,
        );
    });

    it('calls stripGpsFromOriginal on the saved original', () => {
        expect(LR_SRC).toMatch(/stripGpsFromOriginal\(/);
    });

    it('guards the GPS-original strip behind config.stripGpsOnUpload', () => {
        const guardIndex = LR_SRC.indexOf('config.stripGpsOnUpload');
        const stripIndex = LR_SRC.search(/stripGpsFromOriginal\(/);
        expect(guardIndex).toBeGreaterThan(-1);
        expect(stripIndex).toBeGreaterThan(-1);
        // The strip call must appear inside / after the stripGpsOnUpload guard
        // so GPS is only re-encoded when the admin enabled the setting (parity
        // with the browser path), never unconditionally.
        expect(stripIndex).toBeGreaterThan(guardIndex);
    });
});

/**
 * Run-3 RPF cycle 3: lock the remaining PAT-vs-browser upload divergences fixed
 * this cycle so a future refactor cannot silently re-introduce them.
 * - SEC-C3-01: store the ICC descriptor in `icc_profile_name` (not `color_space`,
 *   which is the EXIF ColorSpace tag value per CLAUDE.md).
 * - SEC-C3-02: attribute the upload to the verified PAT user via `uploaded_by`.
 * - CR-C3-01: acquire the upload-processing-contract advisory lock.
 * - CR-C3-02: surface RAW rejections with a specific message.
 */
describe('lr upload metadata/parity source-contract (cycle 3)', () => {
    it('writes the ICC descriptor to icc_profile_name (SEC-C3-01)', () => {
        expect(LR_SRC).toMatch(/icc_profile_name:\s*data\.iccProfileName/);
    });

    it('does NOT pollute color_space with the ICC name (SEC-C3-01)', () => {
        // The prior shape `color_space: data.iccProfileName || exifDb.color_space`
        // both lost the ICC name and overwrote color_space (the EXIF ColorSpace
        // tag value, NOT the ICC name per CLAUDE.md). color_space must flow only
        // from the `...exifDb` spread.
        expect(LR_SRC).not.toMatch(/color_space:\s*data\.iccProfileName/);
    });

    it('attributes the upload via uploaded_by from the token user (SEC-C3-02)', () => {
        expect(LR_SRC).toMatch(/uploaded_by:\s*tokenUserId/);
    });

    it('acquires the upload-processing-contract lock (CR-C3-01)', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*acquireUploadProcessingContractLock[^}]*\}\s*from\s*['"]@\/lib\/upload-processing-contract-lock['"]/,
        );
        expect(LR_SRC).toMatch(/acquireUploadProcessingContractLock\(/);
        // Lock must be acquired before the DB insert so the upload window is
        // serialized against image_sizes / strip_gps settings changes.
        const lockIndex = LR_SRC.search(/acquireUploadProcessingContractLock\(/);
        const insertIndex = LR_SRC.indexOf('db.insert(images)');
        expect(lockIndex).toBeGreaterThan(-1);
        expect(insertIndex).toBeGreaterThan(-1);
        expect(lockIndex).toBeLessThan(insertIndex);
    });

    it('releases the contract lock in a finally block (CR-C3-01)', () => {
        expect(LR_SRC).toMatch(/finally\s*\{[\s\S]*?uploadContractLock\.release\(\)/);
    });

    it('surfaces RAW rejections with a specific message (CR-C3-02)', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*RawFileError[^}]*\}\s*from\s*['"]@\/lib\/process-image['"]/,
        );
        expect(LR_SRC).toMatch(/err\s+instanceof\s+RawFileError/);
    });
});

/**
 * Run-3 RPF cycle 4: lock the final three PAT-vs-browser upload divergences
 * (carried LOW since cycle 2) so a future refactor cannot silently re-introduce
 * them. After this the PAT path mirrors EVERY browser-upload constraint.
 * - DEF-C4-01: honor the restore-maintenance window (entry guard + late
 *   post-save re-check), mirroring app/actions/images.ts:122-125 and 326-330.
 * - DEF-C4-02: mirror the 1 GB disk-space pre-check (images.ts:216-226).
 * - DEF-C4-03: mirror the cumulative upload-tracker window (images.ts:183-237).
 */
describe('lr upload parity source-contract (cycle 4)', () => {
    // DEF-C4-01 — restore-maintenance window
    it('imports the restore-maintenance helpers (DEF-C4-01)', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*isRestoreMaintenanceActive[^}]*cleanupOriginalIfRestoreMaintenanceBegan[^}]*\}\s*from\s*['"]@\/lib\/restore-maintenance['"]/,
        );
    });

    it('guards entry on isRestoreMaintenanceActive before the DB insert (DEF-C4-01)', () => {
        const guardIndex = LR_SRC.search(/if\s*\(\s*isRestoreMaintenanceActive\(\)\s*\)/);
        const insertIndex = LR_SRC.indexOf('db.insert(images)');
        expect(guardIndex).toBeGreaterThan(-1);
        expect(insertIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeLessThan(insertIndex);
    });

    it('re-checks restore-maintenance after save and cleans up the orphan (DEF-C4-01)', () => {
        // The late re-check must run after the GPS-strip / save window and
        // before the insert so a restore that begins mid-request does not race
        // a half-written row.
        const recheckIndex = LR_SRC.search(/cleanupOriginalIfRestoreMaintenanceBegan\(/);
        const insertIndex = LR_SRC.indexOf('db.insert(images)');
        expect(recheckIndex).toBeGreaterThan(-1);
        expect(recheckIndex).toBeLessThan(insertIndex);
    });

    // DEF-C4-02 — 1 GB disk-space pre-check
    it('imports statfs and runs the 1 GB disk pre-check before the save (DEF-C4-02)', () => {
        expect(LR_SRC).toMatch(/import\s*\{\s*statfs\s*\}\s*from\s*['"]fs\/promises['"]/);
        const statfsIndex = LR_SRC.search(/statfs\(UPLOAD_DIR_ORIGINAL\)/);
        const saveIndex = LR_SRC.indexOf('saveOriginalAndGetMetadata(fileEntry)');
        expect(statfsIndex).toBeGreaterThan(-1);
        expect(saveIndex).toBeGreaterThan(-1);
        // The disk pre-check must precede the save so a near-full disk yields a
        // clean 507 instead of an opaque save-path error.
        expect(statfsIndex).toBeLessThan(saveIndex);
        expect(LR_SRC).toMatch(/1024\s*\*\s*1024\s*\*\s*1024/);
        expect(LR_SRC).toMatch(/status:\s*507/);
    });

    // DEF-C4-03 — cumulative upload-tracker window
    it('imports the upload-tracker helpers and limits (DEF-C4-03)', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*getUploadTracker[^}]*\}\s*from\s*['"]@\/lib\/upload-tracker-state['"]/,
        );
        expect(LR_SRC).toMatch(
            /import\s*\{\s*settleUploadTrackerClaim\s*\}\s*from\s*['"]@\/lib\/upload-tracker['"]/,
        );
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*MAX_TOTAL_UPLOAD_BYTES[^}]*UPLOAD_MAX_FILES_PER_WINDOW[^}]*\}\s*from\s*['"]@\/lib\/upload-limits['"]/,
        );
    });

    it('enforces the cumulative count and byte windows (DEF-C4-03)', () => {
        expect(LR_SRC).toMatch(/tracker\.count\s*\+\s*1\s*>\s*UPLOAD_MAX_FILES_PER_WINDOW/);
        expect(LR_SRC).toMatch(/tracker\.bytes\s*\+\s*fileSize\s*>\s*MAX_TOTAL_UPLOAD_BYTES/);
    });

    it('settles the tracker claim back down on a pre-success reject (DEF-C4-03)', () => {
        // settleUploadTrackerClaim must be reachable with successCount 0 so a
        // rejected/failed upload releases the pre-claimed quota rather than
        // permanently consuming the window.
        expect(LR_SRC).toMatch(/settleUploadTrackerClaim\(/);
        expect(LR_SRC).toMatch(/settleTrackerToActual\(false\)/);
        expect(LR_SRC).toMatch(/settleTrackerToActual\(true\)/);
    });
});
