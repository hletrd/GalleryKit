# Plan 273 — Run-4 Cycle 1 implementation fixes

**Status:** in-progress (PROMPT 3)
**Source review:** `.context/reviews/run4-cycle1/_aggregate.md` (+ 4 per-angle files)
**Deferred ledger:** `plan/plan-274-run4-cycle1-deferred.md`

## Repo policy honored
- GPG-sign every commit (`-S`); Conventional Commits + gitmoji; no `Co-Authored-By`.
- Fine-grained commits (one work item each); `git pull --rebase` before every push.
- Per-iteration deploy policy: `npm run deploy` after the cycle's work is green.
- No suppressions; root-cause fixes only.

## Tasks

### Task 1 — Fix flaky backfill detection-failure test (TEST-R4C1-06, HIGH-gate/High)
- File: `apps/web/src/__tests__/admin-backfill-runner-detection-failure.test.ts:169-171`
- Replace the fixed `10 × setImmediate` drain with `vi.waitFor` polling
  `readAdminBackfillState().running === false` (the runner's `finally` is the
  authoritative completion signal). Contract assertions unchanged.
- Verify: targeted vitest run of the file passes repeatedly.

### Task 2 — Decouple serve-upload from the sharp encoder graph (TEST/PERF-R4C1-07, HIGH-gate+MED/High)
- File: `apps/web/src/lib/serve-upload.ts:7` — import `IMAGE_PIPELINE_VERSION` from
  `@/lib/gallery-config-shared` (its definition site) instead of `@/lib/process-image`.
- File: `apps/web/src/__tests__/serve-upload.test.ts:43` — same import swap so the suite
  never loads the encoder graph.
- Verify: targeted vitest run of serve-upload.test.ts passes well under timeout.

### Task 3 — LR PAT upload: insert/enqueue failure containment (COR-R4C1-02 + SEC-R4C1-02, MED/High)
- File: `apps/web/src/app/api/admin/lr/upload/route.ts:344-371`
- Wrap insert → settle → enqueue tail in try/catch: on failure
  `deleteOriginalUploadFile(data.filenameOriginal)` + `settleTrackerToActual(false)` +
  log + `{ error: 'Upload failed' }` 500 JSON (NO_CACHE headers). Mirrors
  `app/actions/images.ts:471-488`.
- Test: extend LR-route test harness — reject `db.insert` and assert original deleted,
  tracker settled to 0, 500 JSON returned.

### Task 4 — LR PAT upload: `user_filename` sanitization parity (COR-R4C1-03, LOW-MED/High)
- Extract the browser path's `getSafeUserFilename` (`app/actions/images.ts:46-56`) into a
  shared helper (e.g. `@/lib/upload-filenames.ts`) consumed by BOTH paths; LR route rejects
  400 on null result; use the sanitized name for `user_filename` AND audit metadata.
- Test: control-char name, path-segment name, empty name, >255-byte name rejected on LR path;
  browser action behavior unchanged (existing tests stay green).

### Task 5 — LR PAT upload: title/description code-point validation (COR-R4C1-04, LOW-MED/High)
- File: `route.ts:305-306` — replace UTF-16 `.slice(0,255)` / `.slice(0,4096)` with the
  canonical `countCodePoints` checks (reject 400 when title > 255 or description > 5000
  code points), mirroring `updateImageMetadata` (C7-AGG7R-02).
- Test: 256-code-point emoji title → 400; 255 → accepted.

### Task 6 — LR PAT upload: enqueue carries camera_model/capture_date (COR-R4C1-05, LOW-MED/High)
- File: `route.ts:353-371` — add `camera_model: exifDb.camera_model,
  capture_date: exifDb.capture_date` to the `enqueueImageProcessing` payload
  (parity with `images.ts:462-463`).
- Test: assert enqueue mock receives both fields on the LR path.

### Task 7 — PAT token hygiene: label sanitization + expiresAt validation + generic errors (SEC-R4C1-01, MED/High)
- File: `apps/web/src/app/actions/lr-tokens.ts`
  - `createLrToken`: run `label` through `sanitizeAdminString`; reject on
    `rejected===true` or empty result.
  - Validate `expiresAt`: reject when `!Number.isFinite(parsed.getTime())` or in the past.
  - Replace raw `err.message` passthrough with a generic error + `console.error`.
- Test: bidi/zero-width label rejected; garbage/past expiresAt rejected; valid flows pass.

### Task 8 — Document the 4th lint gate (DOC-R4C1-08, LOW/High)
- `CLAUDE.md` "Lint Gates (security-critical)": change "Three" → "Four", add
  `lint:public-route-rate-limit` entry (scope: public mutating routes; exemption tag
  `@public-no-rate-limit-required: <reason>`; GET handlers not scanned).
- `AGENTS.md` "Quality gates (all blocking)": add the same gate line.

### Task 9 — Remove stray committed Playwright artifact (CHORE-R4C1-09, LOW/High)
- `git rm -- './--viewport=1440x900'` (3.4 KB PNG at repo root; recoverable from history).

### Task 11 — Fix fresh-DB first-run bootstrap in migrate.js (COR-R4C1-12, HIGH/High — found during gate work)
- File: `apps/web/scripts/migrate.js` (`prepareLegacyDatabaseIfNeeded`)
- A completely empty database fell through to `drizzle.migrate()`, whose
  MAX(created_at) cursor + the repo's non-monotonic journal `when` values
  (entries 7-17) silently skip migrations on the very first run; the bootstrap
  then dies on a later entry's SQL. A SECOND `npm run init` accidentally healed
  via the legacy-reconcile path (gallery tables now partially exist). Every
  fresh install and e2e cold database failed its first init.
- Fix: bootstrap fresh DBs through the same deterministic
  `reconcileLegacySchema` + `baselineAllJournalMigrations` path; drizzle's
  migrate() then verifies as a no-op via the existing post-condition.
- Verified: recreated the e2e MySQL container from scratch; `npm run init`
  succeeds FIRST run (21 baseline rows, all 20 tables, uploaded_by/avif_10bit
  present, admin seeded).

### Task 12 — Mirror color/HDR-era columns into reconcileLegacySchema (COR-R4C1-13, HIGH/High — found during gate work)
- File: `apps/web/scripts/migrate.js` (`reconcileLegacySchema`)
- Migrations 0015-0018's seven `images` columns were never mirrored into the
  reconciler (runbook step-3 contract violation), so any DB bootstrapped via
  the reconcile path (fresh installs per Task 11, legacy re-baselines) lacked
  `color_pipeline_decision` / CICP columns / `pipeline_version` /
  `has_gain_map` and failed its first `images` INSERT (ER_BAD_FIELD_ERROR —
  reproduced live by `e2e:seed`).
- Fix: seven idempotent `ensureColumn` guards mirroring the migration DDL.
- Verification: fresh-container `npm run init` first-run success + an
  authoritative drizzle-introspection vs information_schema diff = CLEAN.
- Regression lock: new `__tests__/migrate-reconcile-coverage.test.ts`
  asserts migrate.js mentions every drizzle table + column (39 assertions).

### Task 13 — Restore mouse access to photo Prev/Next buttons (UX-R4C1-14, HIGH/High — found during gate work)
- Files: `apps/web/src/components/photo-navigation.tsx:210/225` (fix),
  `apps/web/src/components/photo-viewer.tsx:712-751` (context).
- Commit fc3d0ad8 (R10-M11 blur crossfade) gave the AnimatePresence image
  wrapper `z-10`; it is a LATER sibling of the z-10 nav-button containers, so
  the full-bleed image box painted above them and swallowed every mouse click
  on Prev/Next (keyboard + swipe unaffected — which is how it went unnoticed).
  Caught by the shared-group e2e click test failing deterministically with
  "img … subtree intercepts pointer events" (twice).
- Fix: raise the two static nav-button containers to z-20 (the swipe
  indicators already sit at z-20).
- Verification: targeted e2e `public.spec.ts:101` + full e2e suite.

### Task 10 — Gates + deploy
- Run ALL gates repo-wide: eslint, typecheck, vitest, lint:api-auth, lint:action-origin,
  lint:public-route-rate-limit, production build, playwright e2e.
- Fix any new failures root-cause. Then `npm run deploy` (DEPLOY_MODE per-cycle).

## Progress
- [x] Plan written
- [x] Task 1 — vi.waitFor drain (commit 9d945ccd)
- [x] Task 2 — serve-upload light import + beforeAll transform-cache warm-up
      (the import fix alone still flaked under full-suite CPU contention —
      the remaining @/db → drizzle/mysql2 cold chain hit 20.8 s; the
      warm-up attributes one-time cost to setup with a 120 s hook timeout)
      (commit 748b5d7a)
- [x] Task 3 — LR insert-failure containment (commit 2bf32152)
- [x] Task 4 — shared getSafeUserFilename (`lib/upload-filenames.ts`; browser
      action + PAT route both consume it; behavioral test added)
      (commit 2bf32152)
- [x] Task 5 — code-point validation (commit 2bf32152)
- [x] Task 6 — enqueue caption fields (commit 2bf32152)
- [x] Task 7 — token hygiene (sanitizeAdminString label, expiry validation,
      generic error; behavioral test `lr-tokens-action.test.ts`)
      (commit f9d668d9)
- [x] Task 8 — lint-gate docs (commit 8950a82d)
- [x] Task 9 — stray artifact removal (commit 20169050)
- [x] Task 11 — migrate.js fresh-DB bootstrap (commit 80a808e9; verified
      first-run init on a recreated cold container)
- [x] Task 12 — reconcileLegacySchema color-era columns (commit 80a808e9;
      fresh-DB schema diff CLEAN; 39-assertion tripwire test added)
- [x] Task 13 — photo-nav z-20 fix (commit dd456239; targeted
      `public.spec.ts:101` PASSES; full e2e 20 passed / 2 skipped)
- [x] Task 10 — ALL GATES GREEN on the final tree: typecheck, eslint,
      lint:api-auth, lint:action-origin, lint:public-route-rate-limit,
      vitest 1564/1564 (160 files), production build (BUILD_EXIT=0; also
      re-proven by the e2e run's internal typecheck+build), playwright e2e
      20 passed / 2 skipped (local admin-spec skips by design). Deploy
      follows the docs/sw commits.
