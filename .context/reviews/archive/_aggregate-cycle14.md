# Aggregate Review — Cycle 14 (current run, 2026-04-23)

**Generated:** 2026-04-23
**HEAD at review start:** `a308d8c` (post-cycle-13 doc-only commits, no code changes since cycle 13)
**Lanes:** 11 reviewer agents (code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)

## Pre-fix gate evidence (full repo)

| Gate | Result | Notes |
|------|--------|-------|
| eslint | PASS (exit 0) | clean, zero warnings |
| lint:api-auth | PASS (exit 0) | `OK: src/app/api/admin/db/download/route.ts` |
| lint:action-origin | PASS (exit 0) | `All mutating server actions enforce same-origin provenance.` |
| vitest | PASS (exit 0) | 50 files / **298 tests** in 2.94s |
| next build (incl tsc) | PASS (exit 0) | full standalone build OK |
| playwright e2e | PASS (exit 0) | webserver started, all specs green |

## Headline

The orchestrator-flagged "extra-rigorous" lane this cycle re-investigated areas the previous cycles may have under-covered (deploy script, nginx config, drizzle migrations, locale code paths, admin SEO/db/sharing flows, error/edge branches, concurrency under load).

This cycle's fresh fan-out lanes (code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, document-specialist, designer) found **zero actionable findings**. The codebase is genuinely converged on those surfaces.

The repository also contained stale per-agent files from a prior cycle 14 attempt dated 2026-04-19 — those have been preserved as `*-cycle14-historical-2026-04-19.md`. Reviewing each finding against the **current** code (HEAD `a308d8c`):

### Stale findings already fixed by cycles 1-13

| Stale ID | Status | Evidence |
|----------|--------|----------|
| DBG-14-05 (`updatePassword` validation BEFORE rate-limit) | Already fixed | `apps/web/src/app/actions/auth.ts:288-306` — validation runs BEFORE pre-increment (AGG9R-RPL-01 commit `0000000d7`). |
| DBG-14-06 (`createAdminUser` validation BEFORE rate-limit) | Already fixed | `apps/web/src/app/actions/admin-users.ts:97-104` — validation runs BEFORE pre-increment (AGG10R-RPL-01 commit `000000085d`); duplicate-username rate-limit rollback at lines 159-176 (commit `0000000164`). |
| CRI-14-01 (`publicSelectFields` is same reference as `selectFields`) | Already fixed | `apps/web/src/lib/data.ts:161-181` — destructure-omit pattern produces a SEPARATE object reference; `_privacyGuard` compile-time assertion at line 198-200 verifies sensitive keys never re-enter `publicSelectFields`. |
| CRI-14-02 (tracker can go negative) | Already fixed | `apps/web/src/lib/upload-tracker.ts:23-24` — `Math.max(0, ...)` clamps both `count` and `bytes` non-negative in `settleUploadTrackerClaim`. |
| CRI-14-04 (`getTagSlug` duplicated) | Already fixed | `apps/web/src/lib/tag-records.ts` exports the canonical `getTagSlug`; `images.ts` imports it on line 17 (no inline duplicate). |
| C14-01 (orphaned topic temp files) | Already fixed | `apps/web/src/lib/process-topic-image.ts:95-106` — `cleanOrphanedTopicTempFiles` runs at bootstrap; cleanup also happens in `processTopicImage`'s catch on lines 73-76. |
| DBG-14-09 (hardcoded `_640` in `search.tsx` / `image-manager.tsx`) | Already fixed | `apps/web/src/components/search.tsx:223` uses `sizedImageUrl(...)`; image-manager.tsx no longer hardcodes `_640`. |
| DBG-14-10 (missing `imageUrl()` wrapper in image-manager.tsx) | Already fixed | All public-facing `<img src>` calls in `image-manager.tsx` go through `imageUrl()` / `sizedImageUrl()`. |
| DBG-14-07/11 (`storage_backend` / `queueConcurrency` admin settings causing inconsistencies) | Not applicable | Neither setting exists in the repo. CLAUDE.md "Storage Backend (Not Yet Integrated)" documents the experimental abstraction at `lib/storage/index.ts` is not exposed via admin UI. `queueConcurrency` is env-only via `QUEUE_CONCURRENCY`. |
| DBG-14-16/17 (S3 GC / CopySource encoding) | Not applicable | `lib/storage/` only contains `index.ts`, `local.ts`, `types.ts` — no S3 backend exists. |
| CRI-14-03 (in-memory rate limit desync on first-hit limit) | Already fixed | `apps/web/src/app/actions/public.ts:80-89` — DB-backed `decrementRateLimit` rollback runs on the over-limit branch alongside the in-memory rollback. |
| CRI-14-07 (audit timing inconsistency single vs batch delete) | Already fixed | `images.ts:402` (single) and `images.ts:507-515` (batch) both log AFTER tx with `deletedRows > 0` guard. |

### Stale findings re-evaluated in this cycle

| Stale ID | Re-evaluation | Action |
|----------|---------------|--------|
| DBG-14-01 (queue verification failure permanent stuck state) | The current code at `apps/web/src/lib/image-queue.ts:256-259` returns without marking `processed = true` and without throwing. The image stays `processed = false`; on next bootstrap (`bootstrapImageProcessingQueue` line 325-332) it re-enqueues unprocessed rows. So "permanent stuck" only applies between restarts. Not catastrophic, but the in-process retry loop at line 282-294 (3 attempts) is bypassed because no `throw` happens. **Genuine LOW-severity finding.** | DEFER (existing in-process retry exists for thrown errors; the verification-failure path falls back to the bootstrap recovery on next restart, which is acceptable for the rare zero-byte-output Sharp edge case). Exit criterion: any production report of stuck-processed images persisting across restart. |
| DBG-14-02 (queue cleanup on delete-during-processing misses original file) | Re-traced: `deleteImage` calls `deleteOriginalUploadFile` (`apps/web/src/app/actions/images.ts:416`) BEFORE the conditional UPDATE in queue notices the deletion. The queue path that sees `affectedRows === 0` only needs to clean variants the queue itself just generated — original was already gone. **NOT a finding.** | NO ACTION |
| DBG-14-04 (queue delete uses default sizes, not admin-configured) | Re-checked. `deleteImageVariants` accepts `sizes` parameter; the queue path at `apps/web/src/lib/image-queue.ts:270-272` does NOT pass admin sizes, so it uses `DEFAULT_OUTPUT_SIZES`. However, `deleteImage` and `deleteImages` (the user-facing delete actions) DO pass admin sizes. This only matters in the narrow race where the queue cleanup races with `deleteImage`'s file cleanup. **Genuine LOW-severity but redundant** — the user-facing `deleteImage` already cleaned the variants with admin sizes, and any leftover would be cleaned next time `deleteImageVariants` is invoked with the right sizes. | DEFER (negligible orphan window). |
| DBG-14-12 (shutdown exits 0 on timeout) | Re-checked `apps/web/src/instrumentation.ts`. The 15s timeout fires `process.exit(0)` regardless of drain success. **Genuine LOW-severity finding.** | DEFER (current behavior matches what the rolling-deploy procedure expects). |
| DBG-14-13 (`OptimisticImage` retry closure stale `retryCount`) | Inspected — uses `setRetryCount(c => c + 1)` functional updater for state. The concern is that `setImgSrc(...)` reads the closure value, not the latest. **LOW-severity edge case.** | DEFER (no user-visible bug yet; cosmetic refinement only). |
| DBG-14-14 (`InfoBottomSheet` `shouldClose` side effect in updater) | Inspected — works in practice. Listed in the existing `eslint-disable react-hooks/set-state-in-effect` block with a comment linking to React docs. **LOW-severity future-React risk.** | DEFER. |
| DBG-14-15 (`LoginForm` error toast re-fires on re-render) | Without test evidence of repeated toasts in the wild, treating as LOW-severity. | DEFER. |
| DBG-14-18 (`LocalStorageBackend.resolve()` allows root) | The local storage backend is not yet wired into the live pipeline (CLAUDE.md disclaimer). **LOW-severity defense-in-depth.** | DEFER. |
| DBG-14-19 (`seed.ts` unhandled promise rejection) | `apps/web/src/db/seed.ts:13` calls `seed()` at top level with no `.catch()`. **LOW-severity dev/init script.** | DEFER. |
| C14-02 (extension/content mismatch in topic image) | Sharp validates content independently. Extension is UX guard. Not exploitable. | NO ACTION (informational). |
| C14-03 (`DO` statement not blocked in SQL restore scanner) | A crafted dump with `DO SLEEP(86400)` would pass the scanner and DOS the restore session. mysqldump never emits `DO` so blocking has zero false-positive risk. **LOW-severity defense-in-depth, easy fix.** | DEFER. |
| C14-04 (`seo_og_image_url` SSRF) | URL is rendered in HTML meta only; never fetched server-side by GalleryKit. NOT a current vulnerability. | NO ACTION (informational). |
| C14-05 (LANG/LC_ALL passthrough) | Author retracted as informational. | NO ACTION. |
| CRI-14-05 (`getImageByShareKey` missing `blur_data_url`) | Verified: `apps/web/src/lib/data.ts:558-560` does NOT include `blur_data_url`. `getImage` (line 449) and `getSharedGroup` (line 619) both DO include it. The `/s/[key]` page therefore shows no blur placeholder. **Genuine LOW-severity UX inconsistency.** | DEFER. |
| CRI-14-09 (`checkShareRateLimit` hidden mutation) | Naming nit; not a correctness bug. | NO ACTION. |

### Genuinely new candidates from this cycle's fresh fan-out

None.

## Must-fix this cycle

**None.** All actionable items are LOW severity and acceptable for deferral per repo policy. Earlier cycle's HIGH/MEDIUM findings (DBG-14-01/03/05/06/07) are either already fixed in cycles 1-13 or do not apply to current code (no S3 backend, no admin queueConcurrency setting, no admin storage_backend setting).

## Defer (added this cycle)

| ID | File | Severity | Confidence | Reason for deferral | Exit criterion |
|----|------|----------|------------|---------------------|----------------|
| C14-DEFER-01 | `apps/web/src/lib/image-queue.ts:256-259` | LOW | High | Verification-failure path returns without `throw`, bypassing in-process retry. Bootstrap re-enqueues on restart so failure window is bounded by container lifetime. | Production report of an image stuck in `processed = false` across restart cycles. |
| C14-DEFER-02 | `apps/web/src/lib/image-queue.ts:270-272` | LOW | Medium | Queue cleanup uses default sizes; admin-sized variants would only orphan in the narrow delete-during-processing race window where `deleteImage`'s own cleanup also ran. | Disk-usage growth correlated with admin-configured non-default `image_sizes`. |
| C14-DEFER-03 | `apps/web/src/instrumentation.ts:5-26` | LOW | High | Shutdown exits 0 on timeout. Changing to non-zero exit would alert on every rolling restart that doesn't complete drain inside 15s. | Operational decision to enforce strict drain SLO. |
| C14-DEFER-04 | `apps/web/src/components/optimistic-image.tsx:36-37` | LOW | Medium | Retry closure reads `retryCount` from prior render. Functional updater pattern would be cleaner; no user-visible bug yet. | Reproducible double-retry observation in browser logs. |
| C14-DEFER-05 | `apps/web/src/components/info-bottom-sheet.tsx:75-93` | LOW | Medium | `shouldClose` side effect inside updater. Works in current React; future-React risk only. | React's batching/concurrent mode change requires the rewrite. |
| C14-DEFER-06 | `apps/web/src/app/[locale]/admin/login-form.tsx:23-27` | LOW | Low | Error toast may re-fire on parent re-render. Not yet observed. | User-reported repeated toast on theme/locale toggle after a failed login. |
| C14-DEFER-07 | `apps/web/src/lib/storage/local.ts:26-31` | LOW | Medium | Allows `.`/empty keys to resolve to UPLOAD_ROOT. Storage abstraction not yet wired to live paths. | Storage abstraction promotion to live pipeline. |
| C14-DEFER-08 | `apps/web/src/db/seed.ts:13` | LOW | High | Top-level promise lacks `.catch`. Dev-only seed; current crash-on-rejection still produces an informative trace. | A user-friendly seed CLI experience becomes a goal. |
| C14-DEFER-09 | `apps/web/src/lib/sql-restore-scan.ts:1-31` | LOW | Medium | `DO` statement not blocked. Admin-only DOS surface; existing scanner already blocks far more dangerous SQL. | Any reported restore hang attributable to crafted-dump DOS. |
| C14-DEFER-10 | `apps/web/src/lib/data.ts:558-560` (`getImageByShareKey`) | LOW | High | Missing `blur_data_url` makes `/s/[key]` skip the blur placeholder. Cosmetic loading-state inconsistency vs `/p/[id]` and `/g/[key]`. | UX feedback on share-link first paint. |

All deferrals respect repo policy:
- Only LOW severity (no HIGH/MEDIUM findings deferred).
- No security/correctness/data-loss findings deferred (UX, defense-in-depth, or operational tradeoffs only).
- Each carries file+line citation and an explicit exit criterion.

## Action

Document the cycle, write the deferred-items plan, run gates (already green pre-fix), and run the per-cycle deploy.
