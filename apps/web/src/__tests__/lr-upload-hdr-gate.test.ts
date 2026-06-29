/**
 * Run-3 RPF cycle 1 / F2: source-text contract test for the Lightroom PAT
 * upload route (/api/admin/lr/upload). Asserts the `allow_hdr_ingest` ingest
 * gate is present and ordered before the DB insert, mirroring the browser
 * upload action (app/actions/images.ts).
 *
 * The route is a multipart, token-authenticated handler that is heavy to
 * exercise end-to-end (FormData + Sharp + DB + queue). Per the repo convention
 * (og-route-source-contracts.test.ts), a
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
 * left GPS in the on-disk original (the admin-downloadable source file), leaking
 * the photographer's protected location to anyone who downloads it. This
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

    it('attributes the upload via uploaded_by from the resolved actor user (SEC-C3-02)', () => {
        expect(LR_SRC).toMatch(/const actorUserId = tokenUserId \?\? cookieUser\?\.id \?\? null/);
        expect(LR_SRC).toMatch(/uploaded_by:\s*actorUserId/);
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

    it('does not return raw processor exception messages for generic save failures', () => {
        expect(LR_SRC).toContain("console.error('LR upload: failed to save uploaded original'");
        expect(LR_SRC).toContain("Upload failed while processing the image.");
        expect(LR_SRC).not.toContain("const msg = err instanceof Error ? err.message : 'Upload failed'");
        expect(LR_SRC).not.toContain('NextResponse.json({ error: msg }');
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

    it('guards entry on isRestoreMaintenanceActive before body parsing and DB work (DEF-C4-01)', () => {
        const guardIndex = LR_SRC.search(/if\s*\(\s*isRestoreMaintenanceActive\(\)\s*\)/);
        const formDataIndex = LR_SRC.indexOf('request.formData()');
        const topicSelectIndex = LR_SRC.indexOf('db.select({ slug: topics.slug })');
        const insertIndex = LR_SRC.indexOf('db.insert(images)');
        expect(guardIndex).toBeGreaterThan(-1);
        expect(formDataIndex).toBeGreaterThan(-1);
        expect(topicSelectIndex).toBeGreaterThan(-1);
        expect(insertIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeLessThan(formDataIndex);
        expect(guardIndex).toBeLessThan(topicSelectIndex);
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
        // R15C15 TE-15-01: lock the bavail contract. The cycle-14 fix changed
        // this route from `bfree` (raw free blocks, incl. root-reserved) to
        // `bavail` (blocks the non-root node user can actually allocate); on
        // ext4 with 5% root reserve a near-full disk passes a bfree-based check
        // then fails at writeFile with ENOSPC. Without this assertion a revert
        // to bfree passes the whole suite (same class as cycle-14 TE-02).
        expect(LR_SRC).toMatch(/stats\.bavail\b/);
        expect(LR_SRC).not.toMatch(/stats\.bfree\b/);
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
            /import\s*\{[^}]*MAX_TOTAL_UPLOAD_BYTES[^}]*MAX_UPLOAD_FILE_BYTES[^}]*SERVER_ACTION_BODY_OVERHEAD_BYTES[^}]*UPLOAD_MAX_FILES_PER_WINDOW[^}]*\}\s*from\s*['"]@\/lib\/upload-limits['"]/,
        );
    });

    it('enforces the individual and cumulative byte windows before body parsing (DEF-C4-03)', () => {
        expect(LR_SRC).toMatch(/request\.headers\.get\(['"]content-length['"]\)/);
        expect(LR_SRC).toMatch(/request\.headers\.get\(['"]transfer-encoding['"]\)/);
        expect(LR_SRC).toMatch(/declaredUploadBytes\s*>\s*MAX_TOTAL_UPLOAD_BYTES/);
        expect(LR_SRC).toMatch(/declaredUploadBytes\s*>\s*MAX_UPLOAD_FILE_BYTES\s*\+\s*SERVER_ACTION_BODY_OVERHEAD_BYTES/);
        expect(LR_SRC).toMatch(/tracker\.count\s*\+\s*1\s*>\s*UPLOAD_MAX_FILES_PER_WINDOW/);
        expect(LR_SRC).toMatch(/tracker\.bytes\s*\+\s*declaredUploadBytes\s*>\s*MAX_TOTAL_UPLOAD_BYTES/);
        const perFilePreParseIndex = LR_SRC.indexOf('MAX_UPLOAD_FILE_BYTES + SERVER_ACTION_BODY_OVERHEAD_BYTES');
        const trackerIndex = LR_SRC.indexOf('tracker.count += 1');
        const formDataIndex = LR_SRC.indexOf('request.formData()');
        expect(perFilePreParseIndex).toBeGreaterThan(-1);
        expect(trackerIndex).toBeGreaterThan(-1);
        expect(formDataIndex).toBeGreaterThan(-1);
        expect(perFilePreParseIndex).toBeLessThan(formDataIndex);
        expect(trackerIndex).toBeLessThan(formDataIndex);
    });

    it('rejects parsed Lightroom files above MAX_UPLOAD_FILE_BYTES before saving', () => {
        const sizeCheckIndex = LR_SRC.search(/fileSize\s*>\s*MAX_UPLOAD_FILE_BYTES/);
        const saveIndex = LR_SRC.indexOf('saveOriginalAndGetMetadata(fileEntry)');
        expect(sizeCheckIndex).toBeGreaterThan(-1);
        expect(saveIndex).toBeGreaterThan(-1);
        expect(sizeCheckIndex).toBeLessThan(saveIndex);
    });

    it('settles the tracker claim back down on a pre-success reject (DEF-C4-03)', () => {
        // settleUploadTrackerClaim must be reachable with successCount 0 so a
        // rejected/failed upload releases the pre-claimed quota rather than
        // permanently consuming the window.
        expect(LR_SRC).toMatch(/settleUploadTrackerClaim\(/);
        expect(LR_SRC).toMatch(/settleTrackerToActual\(false\)/);
        expect(LR_SRC).toMatch(/settleTrackerToActual\(true,\s*fileSize\)/);
    });

    it('settles the preclaim if topic lookup throws after upload quota is claimed', () => {
        const topicLookupBlock = LR_SRC.match(
            /try\s*\{\s*\[topicRow\]\s*=\s*await db\.select\(\{ slug: topics\.slug \}\)[\s\S]*?\}\s*catch \(err\) \{[\s\S]*?\n\s{8}\}/,
        );
        expect(topicLookupBlock).not.toBeNull();
        const block = topicLookupBlock?.[0] ?? '';
        expect(block).toContain('settleTrackerToActual(false)');
        expect(block).toContain("console.error('LR upload: failed to verify topic', err)");
        expect(block).toMatch(/status:\s*500/);
    });

    it('uses the auth-wrapper token context instead of re-verifying the PAT', () => {
        expect(LR_SRC).not.toMatch(/verifyToken/);
        expect(LR_SRC).toMatch(/getAdminAuthToken\(request\)\?\.userId/);
    });
});

/**
 * Run-4 cycle 1: lock the four remaining PAT-vs-browser parity gaps closed
 * this cycle (see .context/reviews/run4-cycle1/_aggregate.md).
 * - COR-R4C1-02: contain insert failures (delete original + settle quota + 500).
 * - COR-R4C1-03: sanitize user_filename via the shared getSafeUserFilename.
 * - COR-R4C1-04: validate title/description by code points (no UTF-16 slice).
 * - COR-R4C1-05: forward camera_model / capture_date to the processing queue.
 */
describe('lr upload parity source-contract (run-4 cycle 1)', () => {
    // COR-R4C1-02 — insert-failure containment.
    // R4C4 COR-R4C4-03 widened the try to cover the whole post-save window
    // (EXIF / restore probe / blur barrier / insert), so the insert is no
    // longer the FIRST statement inside the try; the contract is now: the
    // insert sits inside a try whose catch deletes the original, settles the
    // quota, and answers structured 500 JSON.
    it('wraps the images insert in a try/catch (COR-R4C1-02)', () => {
        const insertIndex = LR_SRC.indexOf('db.insert(images)');
        expect(insertIndex).toBeGreaterThan(-1);
        const tryIndex = LR_SRC.lastIndexOf('try {', insertIndex);
        expect(tryIndex).toBeGreaterThan(-1);
        const catchMatch = LR_SRC.slice(insertIndex).match(/\}\s*catch\s*\(err\)\s*\{[\s\S]*?\n\s{8}\}/);
        expect(catchMatch).not.toBeNull();
        const blockStr = catchMatch?.[0] ?? '';
        // On failure anywhere in the window: delete the on-disk original,
        // release the pre-claimed tracker quota, and answer structured 500.
        expect(blockStr).toMatch(/deleteOriginalUploadFile\(data\.filenameOriginal\)/);
        expect(blockStr).toMatch(/settleTrackerToActual\(false\)/);
        expect(blockStr).toMatch(/status:\s*500/);
    });

    // COR-R4C1-03 — shared user-filename sanitizer
    it('derives user_filename through the shared getSafeUserFilename (COR-R4C1-03)', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*getSafeUserFilename[^}]*\}\s*from\s*['"]@\/lib\/upload-filenames['"]/,
        );
        expect(LR_SRC).toMatch(/user_filename:\s*safeUserFilename/);
        // The raw client-controlled name must no longer be persisted.
        expect(LR_SRC).not.toMatch(/user_filename:\s*fileEntry\.name/);
    });

    it('rejects an unusable filename with 400 before any disk work (COR-R4C1-03)', () => {
        const guardIndex = LR_SRC.search(/if\s*\(\s*!safeUserFilename\s*\)/);
        const saveIndex = LR_SRC.indexOf('saveOriginalAndGetMetadata(fileEntry)');
        expect(guardIndex).toBeGreaterThan(-1);
        expect(saveIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeLessThan(saveIndex);
    });

    it('audits the sanitized filename, not raw client input (COR-R4C1-03)', () => {
        expect(LR_SRC).toMatch(/filename:\s*safeUserFilename/);
        expect(LR_SRC).not.toMatch(/filename:\s*fileEntry\.name/);
    });

    // COR-R4C1-04 — code-point validation, no UTF-16 slicing
    it('validates title/description by code points and drops the UTF-16 slices (COR-R4C1-04)', () => {
        expect(LR_SRC).toMatch(
            /import\s*\{[^}]*countCodePoints[^}]*\}\s*from\s*['"]@\/lib\/utils['"]/,
        );
        expect(LR_SRC).toMatch(/countCodePoints\(title\)\s*>\s*255/);
        expect(LR_SRC).toMatch(/countCodePoints\(description\)\s*>\s*5000/);
        // The surrogate-splitting truncations must be gone.
        expect(LR_SRC).not.toMatch(/\.slice\(0,\s*255\)/);
        expect(LR_SRC).not.toMatch(/\.slice\(0,\s*4096\)/);
    });

    // COR-R4C1-05 — caption inputs forwarded to the queue
    it('forwards camera_model and capture_date in the enqueue payload (COR-R4C1-05)', () => {
        const enqueueBlock = LR_SRC.match(/enqueueImageProcessing\(\{[\s\S]*?\}\);/);
        expect(enqueueBlock).not.toBeNull();
        const blockStr = enqueueBlock?.[0] ?? '';
        expect(blockStr).toMatch(/camera_model:\s*exifDb\.camera_model/);
        expect(blockStr).toMatch(/capture_date:\s*exifDb\.capture_date/);
    });

    // CR-R9C7-01 / C1 AGG-M4 — the admin processing/search settings must be forwarded from
    // the persisted upload-time processing snapshot on the LR publish enqueue,
    // exactly as the browser path does
    // (CR-R9C6-01). Because this path always supplies a truthy `quality`
    // object, the queue handler's `if (!quality && !imageSizes)` config-load
    // gate never enters, so an omitted setting silently falls back to the
    // process-image default instead of the admin's configured value. This
    // source-contract assertion is the regression lock the c6 fix lacked for
    // the LR path (the c6 wiring test covers only the browser path).
    it('forwards all admin processing and semantic settings from config in the enqueue payload (CR-R9C7-01)', () => {
        const enqueueBlock = LR_SRC.match(/enqueueImageProcessing\(\{[\s\S]*?\}\);/);
        expect(enqueueBlock).not.toBeNull();
        const blockStr = enqueueBlock?.[0] ?? '';
        expect(blockStr).toMatch(/forceSrgbDerivatives:\s*processingSettingsSnapshot\.forceSrgbDerivatives/);
        expect(blockStr).toMatch(/wideGamutJpegChroma:\s*processingSettingsSnapshot\.wideGamutJpegChroma/);
        expect(blockStr).toMatch(/avifEffort:\s*processingSettingsSnapshot\.avifEffort/);
        expect(blockStr).toMatch(/sdrJpegChroma:\s*processingSettingsSnapshot\.sdrJpegChroma/);
        expect(blockStr).toMatch(/wideGamutMaxSourcePixels:\s*processingSettingsSnapshot\.wideGamutMaxSourcePixels/);
        expect(blockStr).toMatch(/autoAltTextEnabled:\s*processingSettingsSnapshot\.autoAltTextEnabled/);
        expect(blockStr).toMatch(/semanticSearchMode:\s*processingSettingsSnapshot\.semanticSearchMode/);
    });
});

/**
 * R4C4 COR-R4C4-03 / TEST-R4C4-12: the whole post-save window (EXIF
 * extraction, late restore-maintenance probe, blur-data-url write barrier,
 * DB insert) must sit inside ONE containment try whose catch deletes the
 * orphaned original, settles the pre-claimed tracker quota, and returns a
 * parseable JSON 500 — parity with the browser path's per-file catch
 * (app/actions/images.ts). Source-contract style per this file's documented
 * convention (the route is too heavy to exercise end-to-end in unit scope).
 */
describe('lr upload post-save containment source-contract (R4C4 COR-R4C4-03)', () => {
    // The containment catch is identified by its log line.
    const CATCH_LOG = 'LR upload: post-save processing failed';

    it('opens the containment try BEFORE extractExifForDb and the blur write barrier', () => {
        const catchIndex = LR_SRC.indexOf(CATCH_LOG);
        expect(catchIndex).toBeGreaterThan(-1);
        // Find the try block that the catch closes: walk back from the catch
        // to the nearest preceding `try {` and assert the risky calls sit
        // between them.
        const tryIndex = LR_SRC.lastIndexOf('try {', catchIndex);
        expect(tryIndex).toBeGreaterThan(-1);
        const windowSrc = LR_SRC.slice(tryIndex, catchIndex);
        expect(windowSrc).toContain('extractExifForDb(data.exifData)');
        expect(windowSrc).toContain('assertBlurDataUrl(data.blurDataUrl)');
        expect(windowSrc).toContain('cleanupOriginalIfRestoreMaintenanceBegan');
        expect(windowSrc).toContain('db.insert(images)');
    });

    it('catch deletes the original, settles the claim, and returns JSON 500', () => {
        const catchIndex = LR_SRC.indexOf(CATCH_LOG);
        expect(catchIndex).toBeGreaterThan(-1);
        // The catch body runs from the log line to the closing of the 500
        // response return.
        const catchBody = LR_SRC.slice(catchIndex, catchIndex + 600);
        expect(catchBody).toMatch(/deleteOriginalUploadFile\(data\.filenameOriginal\)/);
        expect(catchBody).toMatch(/settleTrackerToActual\(false\)/);
        expect(catchBody).toMatch(/\{\s*error:\s*'Upload failed'\s*\}/);
        expect(catchBody).toMatch(/status:\s*500/);
    });

    it('post-insert work (enqueue/audit/revalidate) stays OUTSIDE the containment try', () => {
        const catchIndex = LR_SRC.indexOf(CATCH_LOG);
        const enqueueIndex = LR_SRC.indexOf('enqueueImageProcessing({');
        const revalidateIndex = LR_SRC.indexOf('revalidateAllAppData()');
        expect(enqueueIndex).toBeGreaterThan(catchIndex);
        expect(revalidateIndex).toBeGreaterThan(catchIndex);
    });

    it('the settle closure is idempotent (double-settle cannot steal quota)', () => {
        // The guard flag must be checked before settleUploadTrackerClaim runs.
        expect(LR_SRC).toMatch(/let\s+trackerSettled\s*=\s*false/);
        expect(LR_SRC).toMatch(/if\s*\(trackerSettled\)\s*return;/);
    });
});
