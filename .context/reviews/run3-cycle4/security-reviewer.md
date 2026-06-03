# Security + PAT-divergence review — Run-3 Cycle 4

Reviewer angle: security-reviewer + critic. Repo: GalleryKit (Next.js 16).
Scope rules honored: color/HDR honesty, privacy field separation, single-writer
topology, hard-scope ban on edit/culling/scoring features.

## PRIMARY: Lightroom PAT upload divergence cluster — verdict

Compared line-by-line:
- PAT path: `apps/web/src/app/api/admin/lr/upload/route.ts`
- Browser path: `apps/web/src/app/actions/images.ts` (`uploadImages`, L120-548)

Cycles 1-3 fixes CONFIRMED present and test-locked
(`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`):
- HDR ingest gate (`config.allowHdrIngest`, route L155-161) ✓
- GPS strip on on-disk original (`stripGpsFromOriginal`, route L164-180) ✓
- `icc_profile_name` written to its own column, `color_space` no longer polluted
  (route L206) ✓
- `uploaded_by: tokenUserId` attribution (route L226) ✓
- upload-processing-contract advisory lock acquire+finally-release
  (route L113-119, L283-287) ✓
- RAW rejection specific message (route L136-141) ✓

No NEW HIGH/MED divergence found. The three remaining divergences are the
carried LOW items, all still REAL:

### DEF-C4-01 (was DEF-C3-01) — PAT path ignores restore-maintenance window
- Severity/confidence (preserved): LOW / High
- Citation: `route.ts` has no `getRestoreMaintenanceMessage` /
  `cleanupOriginalIfRestoreMaintenanceBegan`. Browser parity:
  `images.ts:122-125` (entry check), `:326-330` (post-save cleanup),
  `:332-338` (post-GPS-strip late re-check).
- Failure scenario: an LR publish that lands while a DB restore is in progress
  inserts an `images` row (and writes an on-disk original) that the restore then
  overwrites/wipes, orphaning the on-disk file. Narrow row-orphan, not security
  or data-loss for the gallery (the restore is the source of truth).
- Real & cheap? REAL. CHEAP — helpers already exist in
  `lib/restore-maintenance.ts` and are imported/used by the browser path.
- Fix: gate at entry (return 409/503) + post-save
  `cleanupOriginalIfRestoreMaintenanceBegan` + post-GPS-strip late re-check,
  mirroring the browser path's three checkpoints.

### DEF-C4-02 (was DEF-C3-02) — PAT path skips the 1 GB disk-space pre-check
- Severity/confidence (preserved): LOW / Med
- Citation: `route.ts` no `statfs` pre-check. Browser parity:
  `images.ts:216-226`.
- Failure scenario: near-full disk surfaces as a raw 422 from
  `saveOriginalAndGetMetadata` (ENOSPC) instead of a friendly
  "insufficient disk space". Cosmetic for a single trusted admin client; no
  correctness or security impact (the upload still fails cleanly).
- Real & cheap? REAL. CHEAP — `statfs` + `UPLOAD_DIR_ORIGINAL` already imported.
- Fix: mirror the browser `statfs(UPLOAD_DIR_ORIGINAL)` >= 1 GiB pre-check before
  `saveOriginalAndGetMetadata`.

### DEF-C4-03 (was DEF-C3-03) — PAT path outside the cumulative upload-tracker window
- Severity/confidence (preserved): LOW / Med
- Citation: `route.ts` no `getUploadTracker` / `MAX_TOTAL_UPLOAD_BYTES` /
  `UPLOAD_MAX_FILES_PER_WINDOW`. Browser parity: `images.ts:183-237`,
  `:259-265`, `:497/519` (settle).
- Failure scenario: a runaway LR plugin could push unbounded cumulative bytes/
  files per window. Bounded already by the shared per-file 200 MB cap
  (`process-image.ts`) + Sharp `limitInputPixels` decompression-bomb guard, so
  the residual abuse surface is small for a trusted `lr:upload` PAT.
- Real & cheap? REAL. MODERATE — the tracker is keyed `userId:ip` and the
  browser path pre-claims/settles across multi-file invocations; the PAT is
  single-file-per-request so the mirror is a count+bytes claim with a simple
  decrement-on-failure. Adds process-local state churn on a trusted scope.
- DECISION THIS CYCLE: fix to fully close the cluster (cost is low and removes
  the two-path divergence smell entirely), keyed on `lr:<tokenUserId|ip>`.

## SECONDARY: net-new security sweep (under-reviewed surfaces)

- `withAdminAuth` wrapper + `lint:api-auth` fixture enforce every admin API
  route wraps auth; LR route uses `allowTokenScope` correctly. No missing-auth
  surface found.
- DB restore: advisory lock `gallerykit_db_restore` on a dedicated connection;
  concurrent restore fails fast. No new finding.
- Stripe webhook + entitlements + download-token paths: covered by
  `stripe-download-tokens.test.ts`, `refund-clears-download-token.test.ts`. No
  new finding this pass.
- Privacy: `publicSelectFields` derived from `adminSelectFields` by omission,
  `_SensitiveKeysInPublic` compile guard intact. GPS/filename PII excluded. No
  new leak.
- i18n EN/KO parity: 812/812 keys, zero missing either direction. No finding.

## Summary
- CRIT 0, HIGH 0, MED 0, LOW 3 (all the carried PAT divergences, all REAL).
- PAT-cluster verdict: cycles 1-3 fixes complete & test-locked; only the 3 LOW
  items remain. They are real and cheap-to-moderate; clearing all 3 this cycle.
