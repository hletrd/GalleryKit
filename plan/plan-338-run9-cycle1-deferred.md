# Plan 338 — Run-9 Cycle-1 deferred / record-only findings (cycle 4/100)

**Source:** `.context/reviews/_aggregate.md` (run-9 cycle-1 fan-out, 11 agents, no failures). HEAD at planning time: `ce0029aa`.
**Rule basis (STRICT, per the cycle's deferred-fix policy):** Every review finding is either scheduled in `plan-337-run9-cycle1-fixes.md` or recorded HERE. No finding is silently dropped. Each entry below preserves the ORIGINAL severity/confidence (never downgraded to justify deferral), a file+line citation, a concrete deferral reason, and an exit criterion that re-opens it. Security/correctness/data-loss findings are deferred ONLY when CLAUDE.md explicitly permits, with the rule quoted. Deferred work, when picked up, remains bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push, Node 24+/TS6).

> This list is ONLY for existing review findings. No new refactors/features are introduced under "deferred."

---

## Deferred 1 — AGG-C4-08: service-worker image-cache metadata lost-update (no CAS)

- **Severity/Confidence (original, preserved):** LOW / High.
- **Where:** `apps/web/public/sw.template.js` (shipped source) + `apps/web/public/sw.js` (generated) — `touchMeta` / `recordAndEvict` do `getMeta → mutate → setMeta` (whole-doc overwrite) with no single-flight lock (~`:70-122,152-161` in `sw.js`).
- **Reason for deferral:** the affected state is cache-HOUSEKEEPING only (the 50 MB LRU `total` accounting + recency timestamps), never served bytes. N concurrent masonry tiles can drop each other's meta writes, so the LRU `total` can drift low (cache exceeds the 50 MB soft cap until the browser's own quota eviction reclaims it). CLAUDE.md documents the SW cache as best-effort ("stale-while-revalidate", "OFFLINE-ONLY fallback", "best-effort"); no correctness or data-loss guarantee is breached. Pre-existing (= prior AGG-R8c3-10; re-confirmed unchanged this cycle by debugger BUG-1 + perf-reviewer PERF-L1). NOT a security/correctness/data-loss finding, so freely deferrable.
- **Exit criterion:** re-open if a hard 50 MB cap becomes a requirement (e.g. low-storage-device complaints), at which point add a single-flight meta-write lock or an atomic compare-and-swap around `setMeta`, re-stamp `sw.js` via `scripts/build-sw.ts`, and update `apps/web/src/__tests__/sw-template-contract.test.ts`. No action while the cap remains a soft target.

## Deferred 2 — AGG-C4-09: stale `KNOWN_VIOLATIONS['components/image-manager.tsx'] = 6` (real count 1)

- **Severity/Confidence (original, preserved):** LOW / Med.
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:182`.
- **Reason for deferral:** test-PRECISION, not a live defect. The aggregate budget of 6 (when the real scanner count measured by test-engineer is 1) leaves up to ~5 NEW sub-44 touch targets in that one file able to ship before the gate fires. The stale-budget detector at `:710-714` is informational, not a hard failure. This is the SAME finding as prior AGG-R8c3-15 — already recorded in `plan-336-run8-cycle3-deferred.md` Deferred 5. It is carried forward here ONLY to confirm it is still open and not silently dropped; it remains deferred on the original rationale (recounting + tightening is a test-precision nit best batched with other touch-target-audit work, and the dedicated checkbox/scale-token unit tests still guard the specific AGG-R8c3-03/-06 behaviors independently). NOT a correctness/security/data-loss finding.
- **Exit criterion:** re-open when touch-target-audit work is next scheduled (e.g. alongside Item 1 of plan-337 which already edits this file) — recount the real value and tighten the entry from 6 to the true count, adding a comment with the measurement date. NOTE: plan-337 Item 1 edits this same test file; if convenient the implementer MAY opportunistically tighten this entry in that commit, but it is not required this cycle.

## Deferred 3 — AGG-C4-T1: narrow test-depth gaps on freshly-landed, currently-behaving code

- **Severity/Confidence (original, preserved):** LOW / High (test-engineer TE-4/5/6).
- **Where:** (a) `getLatestImageForOg` (`apps/web/src/lib/data.ts`) — its source-text/SQL-shape test can't catch a dropped `processed=true` filter or a reversed sort. (b) the home-OG sanitize pin (`apps/web/src/__tests__/sanitize-for-og-global.test.ts`) asserts the `sanitizeForOg` IMPORT, not the call SITE. (c) `retryFailedImage` (`apps/web/src/app/actions/images.ts`) — its localized invalid-id branch (`t('invalidImageId')`) has no behavioral test.
- **Reason for deferral:** test-DEPTH on code that currently behaves correctly (all three were verified working this cycle). These are belt-and-braces pins against FUTURE regressions, not live defects, and each is narrow. Not correctness/security/data-loss. Deferrable; cheap enough that they MAY be opportunistically added if the implementer has spare capacity, but not required.
- **Exit criterion:** re-open when (a) `getLatestImageForOg` is refactored (add a behavioral test asserting it returns the latest PROCESSED image by the homepage sort, via a seeded in-memory/mock query), OR (b) the home-OG route's sanitize call site is touched (add an assertion that the route APPLIES `sanitizeForOg`, not just imports it), OR (c) `retryFailedImage`'s error handling is touched (add a test for the localized invalid-id path). Until then the code is correct and the surrounding tests cover the happy paths.

## Deferred 4 — AGG-C4-T2: encode-heavy real-AVIF tests share the `public/uploads` tree (cold-flake mechanism)

- **Severity/Confidence (original, preserved):** LOW / High (test-engineer TE-3; = prior AGG-R8c3-09).
- **Where:** `apps/web/src/__tests__/backfill-color-pipeline.test.ts`, `process-image-color-roundtrip.test.ts`, and 2 sibling encode-heavy tests — their *source* fixtures use `mkdtemp`, but they write DERIVATIVES into the shared `apps/web/public/uploads` tree.
- **Reason for deferral:** test-INFRA noise, not a logic defect. Under full-suite parallelism the libheif encoder can contend on the shared files → intermittent "corrupt header" / `outcome: error`. This cycle the flake did NOT reproduce (cold run 2067/2067 green; 4 warm rounds 78/78). Same finding as prior AGG-R8c3-09, already recorded in `plan-336` Deferred 1 — carried forward to confirm it's still open. Not correctness/security/data-loss. The warm-rerun-green status keeps the cycle gate honest.
- **Exit criterion:** re-open when (a) the encode tests are migrated to a unique per-test temp upload dir (or a serial pool / `describe.sequential`) so they no longer contend on shared `public/uploads`, OR (b) the flake escalates to failing on warm reruns / blocking a real CI gate.

## Deferred 5 — AGG-C4-R1: color-encode + column-write logic triplicated (root-cause refactor)

- **Severity/Confidence (original, preserved):** MED / High (architect ARCH-R9-01 root cause).
- **Where:** the operation "re-run `processImageFormats` + `detectColorSignals` → resolve the decision → write the 10-column color set → handle delete-mid-reencode" is implemented independently in `apps/web/src/lib/image-queue.ts` (upload), `apps/web/src/lib/admin-backfill-runner.ts` (in-app backfill), and `apps/web/scripts/backfill-color-pipeline.ts` (sidecar), coupled only by hand-written "mirrors X" comments.
- **Reason for deferral:** maintainability/architecture. The DUPLICATION is the root cause that already produced two divergent correctness guarantees this cycle — AGG-C4-02 (sidecar missing the cleanup guard) and AGG-C4-04 (upload worker wrong `sizes` arg). Those two SYMPTOMS are SCHEDULED in plan-337 (Items 2 + 4) and fixed now. The CONSOLIDATION itself (extract a shared `applyColorPipelineResult()` writer owning the column list + cleanup contract, anchored by one cross-site test) is a non-trivial refactor touching all three write paths and the color pipeline — out of proportion to a one-cycle hygiene pass, and it shares a root cause with the prior-deferred AGG-R8c3-13 (triplicated ICC-name→gamut ladder, `plan-336` Deferred 4). Both consolidations should land TOGETHER with the WI-09 HDR-encoder work that will add the next column/keyword, so the new column and the dedup land with one test. This is NOT a deferral of a correctness defect — the live correctness symptoms are fixed in plan-337; only the DRY consolidation is deferred.
- **Exit criterion:** re-open when WI-09 (or any new color column / gamut keyword) is implemented — extract the shared `applyColorPipelineResult()` writer AND the shared `iccNameToGamut()` helper together, add one cross-module consistency test covering all three write paths + the audit-vs-delivery token match, so a new column/keyword cannot be added to one path and forgotten in the others.

## Deferred 6 — AGG-C4-R2: `lib/api-auth.ts` → `app/actions/auth` layering inversion

- **Severity/Confidence (original, preserved):** LOW / Med (architect; = prior AGG-R8c3-12).
- **Where:** `apps/web/src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — the SOLE `lib`→`app` upward dependency (authoritative scan found exactly one).
- **Reason for deferral:** maintainability/architecture, not a live defect. No hard ESM cycle today; gates green. Same finding as prior AGG-R8c3-12, already recorded in `plan-336` Deferred 3 — carried forward unchanged. Fixing it (extract identity reads to a `lib/auth-session.ts` leaf) is a non-trivial auth-surface refactor, risky to land alongside the substantive fixes without dedicated review. No security finding (the auth check itself is correct; only the import direction is upside-down).
- **Exit criterion:** re-open when (a) a second `lib` module needs `isAdmin`/identity (the inversion would replicate), OR (b) an actual ESM circular-import warning appears, OR (c) a dedicated auth-layer refactor cycle is scheduled. Then extract `lib/auth-session.ts` and have both `app/actions/auth` and `lib/api-auth` import DOWN from it.

## Deferred 7 — AGG-C4-R3: `COLOR_IMPACTING_KEYS` hand-maintained + `@/db` libs server-only by docstring

- **Severity/Confidence (original, preserved):** LOW / High (architect; = prior AGG-R8c3-A5).
- **Where:** `apps/web/src/lib/settings-hash.ts` (`COLOR_IMPACTING_KEYS` hand-maintained, not derived from `GalleryConfig` — drifted 3→9 once); the 14 `@/db`-importing libs are server-only by DOCSTRING, only `apps/web/src/lib/caption-generator.ts:19` carries an `import 'server-only'` guard.
- **Reason for deferral:** architecture hardening, not a live defect. The boundary test still enforces the key set, and the docstring convention has held. Same finding as prior AGG-R8c3-A5, already recorded in `plan-336` Deferred 6/7 — carried forward unchanged. Not correctness/security/data-loss.
- **Exit criterion:** re-open when (a) a `COLOR_IMPACTING_KEYS` drift recurs (then derive the set from `GalleryConfig` so it cannot drift), OR (b) a client bundle accidentally imports one of the heavy `@/db` libs (then add `import 'server-only'` to the offenders). No action while the boundary test + docstrings hold.

## Deferred 8 — AGG-C4-R4: `@/lib/storage` dead seam

- **Severity/Confidence (original, preserved):** LOW / record-only (architect ARCH-R9-02).
- **Where:** `apps/web/src/lib/storage/` (~390 LOC) — consumed only by its own index + a test; not wired into the upload/process/serve pipeline.
- **Reason for deferral:** NOT a defect. CLAUDE.md explicitly documents the storage abstraction as unwired ("the product currently supports local filesystem storage only … Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end"). The code is honestly self-documented. Record-only; the only risk is interface-rot if storage backends are ever wired without validating against the real fs call sites first.
- **Exit criterion:** re-open ONLY if/when a storage backend (S3/MinIO) is actually wired into the pipeline — at that point validate the abstraction against the real filesystem call sites in `process-image.ts`/`serve-upload.ts`/the upload routes before exposing any admin switch. No action otherwise (deleting working, documented scaffold would be a destructive change requiring explicit owner sign-off per global CLAUDE.md).

## Deferred 9 — AGG-C4-R5: documented-intentional perf tradeoffs (record-only)

- **Severity/Confidence (original, preserved):** LOW / High (perf-reviewer record-only set).
- **Where + items:** (a) bootstrap `notInArray` over ≤1000 permanently-failed IDs (`apps/web/src/lib/image-queue.ts:601-603`); (b) decode-once-per-format ~18 decodes/image (WI-14 fresh-instance-per-format); (c) Atom feed `updated_at` filesort (bounded by FEED_LIMIT=50 + route cache); (d) timeline `YEAR()/MONTH()/DAY()` non-sargable (bounded by LIMIT); (e) single connection pool of 10 + single-writer topology.
- **Reason for deferral:** all DOCUMENTED-INTENTIONAL tradeoffs in CLAUDE.md (Performance Optimizations / Image Processing Pipeline / Runtime topology sections), NOT defects. The `notInArray` happy path (empty failed-set) is zero-cost; the decode/feed/timeline costs are bounded; the single-pool/single-writer topology is the shipped Docker design. Re-confirmed unchanged this cycle.
- **Exit criterion:** (a) `notInArray` — re-open and switch to a `processing_error IS NULL` filter only if a large permanently-failed population appears (restart-safe alternative); (b)-(e) — re-open only if traffic/scale outgrows the documented personal-gallery target (then revisit the topology decisions explicitly, with an owner decision per CLAUDE.md's single-writer note). No action at current scale.

---

## Summary

- **Scheduled in plan-337 (fixed this cycle):** AGG-C4-01, -02, -03 (MED); AGG-C4-04, -05, -06, -07 (LOW).
- **Deferred here (recorded, severity preserved):** AGG-C4-08, -09 (LOW); AGG-C4-T1, -T2 (LOW test-depth/infra); AGG-C4-R1 consolidation (MED root-cause refactor — its live symptoms are FIXED in plan-337, only the DRY dedup deferred); AGG-C4-R2, -R3, -R4, -R5 (LOW arch/record).
- **No CRITICAL/HIGH defect.** No security/correctness/data-loss finding is deferred (the two MED data-hygiene items scheduled in plan-337 are admin-only low-prob disk leaks, fixed now; the deferred AGG-C4-R1 is a DRY refactor whose live symptoms are already fixed). All deferrals are maintainability/test-precision/doc/record-only, each with an exit criterion.
