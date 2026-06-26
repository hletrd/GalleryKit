# GalleryKit Architectural Review — Cycle 12
## HEAD: 2a9976a1 | Date: 2026-06-27 | Angle: architecture & design risk

---

## Summary

Since cycle 10 (bcd67b12), the 18 intervening commits are point fixes (rate-limit
shallow-copy, ENOENT discrimination, audit truncation, touch targets) plus ONE
genuinely structural addition: a **new graceful-shutdown lifecycle** introduced in
`instrumentation.ts` (commit b3c55036, R11C11). That addition is correct in isolation
but creates the cycle's most important NEW design risk: shutdown/flush responsibility is
now distributed and hardcoded, with no registry — the exact "forgotten-checklist" failure
class that already burned this repo (migrations, `COLOR_IMPACTING_KEYS`). The pre-existing
god-modules (`process-image.ts` 1694 lines, `data.ts` 1670, `image-queue.ts` 868,
`images.ts` action 1164) all continued to grow; the deferred splits are accruing interest.
Two coupling smells are newly load-bearing: (1) `image-queue.ts` has quietly become the
app's **de-facto cron scheduler** — its hourly GC runs session/rate-limit/audit/view-retention
purges, all gated on a successful image-queue bootstrap; (2) the `lib/storage/*` abstraction
(3 files) is now provably **dead code** — zero production importers and a mutation API that
can only ever switch local→local. The single `lib/ → app/` upward dependency persists. No
finding here is a security or correctness CRITICAL; these are structural-debt items whose
cost is paid by the next person who adds a background buffer, a maintenance sweep, or a
storage backend.

I explicitly respect the documented intentional decisions (single web-instance / single-writer
topology is BY DESIGN per CLAUDE.md). I do not re-flag process-local state as a bug; I only
flag where NEW code makes a future violation of that boundary more likely, or where intra-process
lifecycle coupling is itself the risk.

---

## Structural-MAJOR Findings

### R12-ARCH-01 (NEW) — No shutdown-hook registry: instrumentation.ts hardcodes the flush set
- **Modules:** `apps/web/src/instrumentation.ts:28-36`, `apps/web/src/lib/data.ts:196` (`flushBufferedSharedGroupViewCounts`), `apps/web/src/lib/image-queue.ts:251` (`shutdownImageProcessingQueue`)
- **Design risk:** The graceful-shutdown path flushes exactly TWO things by name —
  `shutdownImageProcessingQueue()` and `flushBufferedSharedGroupViewCounts()` — inside a 15 s
  `Promise.race`. There is no registry of "process-local state that must drain on SIGTERM."
  Today the set is complete (I verified image-views are written directly via fire-and-forget
  INSERT in `public.ts:357-369`, not buffered; only the shared-group `viewCountBuffer` in
  `data.ts:17` is buffered). But the moment a developer adds a new in-memory aggregation buffer
  (the obvious next candidates: a batched image-view buffer, an analytics counter buffer, or a
  write-behind cache), nothing forces them to wire it into `instrumentation.ts`.
- **Concrete failure scenario:** A future "batch image-view writes to reduce INSERT pressure"
  optimization adds a module-level buffer in `data.ts` or `analytics.ts`. It works in dev. In
  production every `docker compose up -d --build` deploy sends SIGTERM to the old container;
  the new buffer is silently discarded on every deploy and every restart. The loss is invisible
  (analytics undercount) and will not surface in any test. This is the SAME failure class as the
  non-monotonic `_journal.json` migration skip and the "forgot to add a key to
  `COLOR_IMPACTING_KEYS`" gap that CLAUDE.md already documents as recurring.
- **Remediation (worth doing now — low effort, high leverage):** Introduce a tiny
  `lib/shutdown-hooks.ts` with `registerShutdownHook(name, fn)` and `runShutdownHooks(deadlineMs)`.
  Have `data.ts` and `image-queue.ts` self-register their drain functions at module load;
  `instrumentation.ts` calls `runShutdownHooks()` instead of naming each one. This converts a
  silent omission into "you didn't register, so nothing changed" — and a unit test can assert the
  expected hook names are registered, closing the checklist gap the way the privacy-field and
  color-key compile guards do.
- **Severity:** MEDIUM | **Confidence:** HIGH

### R12-ARCH-02 (NEW) — Signal handlers registered AFTER blocking startup work
- **Modules:** `apps/web/src/instrumentation.ts:3-6` (assertion + bootstrap), `:57-72` (SIGTERM/SIGINT registration), `apps/web/src/lib/upload-paths.ts:82-103` (`assertNoLegacyPublicOriginalUploads`)
- **Design risk:** `register()` runs, in order: (1) `assertNoLegacyPublicOriginalUploads({ failInProduction: true })` which can `throw`, (2) `await bootstrapImageProcessingQueue()` (a DB scan that can be slow or hang on a degraded DB), (3) geoip pre-warm, and ONLY THEN (4) registers the SIGTERM/SIGINT handlers. Two problems fall out of this ordering:
  - **Startup-window race:** A SIGTERM arriving during the bootstrap DB scan (before line 57) is handled by Node's DEFAULT handler → immediate ungraceful exit, defeating the whole drain mechanism precisely when the queue may already be mid-encode.
  - **Throw aborts handler registration entirely:** If the legacy-upload assertion throws (it `throw`s on any non-ENOENT `readdir` error too, e.g. EACCES on a mis-permissioned volume — `upload-paths.ts:91`), or if bootstrap throws synchronously, control never reaches line 57 and the process runs (or crash-loops) with NO graceful-shutdown handler.
- **Concrete failure scenario:** A deploy mounts the legacy originals dir with wrong ownership. `fs.readdir` throws EACCES → `register()` throws → Next.js aborts startup → crash-loop. Operationally this looks identical to the disk-exhaustion incident in CLAUDE.md (userspace wedged) but the root cause is a startup-ordering choice, not disk.
- **Remediation (low effort):** Register the SIGTERM/SIGINT handlers FIRST (they are cheap and idempotent), then run the assertion and bootstrap. Wrap the assertion so a non-ENOENT IO error logs-and-continues rather than bricking startup (the `failInProduction` throw should be reserved for the actual "legacy files present" condition it was designed for, not for incidental IO faults).
- **Severity:** LOW-MEDIUM | **Confidence:** HIGH

### R12-ARCH-03 (NEW framing) — image-queue.ts is the de-facto cron scheduler, gated on its own bootstrap
- **Modules:** `apps/web/src/lib/image-queue.ts:795-803` (hourly `gcInterval`), `:619` (`purgeExpiredSessions`), and the imported sweeps `purgeOldBuckets` / `purgeOldAuditLog` / `purgeOldViewEvents`
- **Design risk:** The image-processing queue module owns the app's only periodic scheduler. Its hourly `setInterval` runs four cross-cutting maintenance jobs that have nothing to do with image processing: `purgeExpiredSessions()` (auth/session domain), `purgeOldBuckets()` (rate-limit domain), `purgeOldAuditLog()` (audit/security domain), `purgeOldViewEvents()` (analytics retention). The scheduler's existence is **coupled to image-queue bootstrap success**: the `gcInterval` is armed inside `bootstrapImageProcessingQueue()` (line 794, guarded by `!state.gcInterval`). If bootstrap fails — DB unavailable at startup → `scheduleBootstrapRetry` (line 807) — the GC timer is never armed, so session expiry, rate-limit bucket cleanup, audit-log retention, and view-event retention ALL silently stop running for the life of the process.
- **Concrete failure scenario:** DB is briefly unreachable at container start. Bootstrap enters the retry path and eventually processes images fine once DB returns — BUT the one-shot `if (!state.gcInterval)` arm sits inside the same try block that took the ECONNREFUSED branch, so on the retry path that re-enters bootstrap the GC may or may not arm depending on which branch wins. Net effect: a security-relevant sweep (expired session purge, audit-log retention) can be silently disabled by a transient startup DB blip, with no alert. A dev auditing "where are sessions purged?" must know to look inside the IMAGE QUEUE module — non-obvious.
- **Remediation (medium effort, defer-able but flag now):** Extract a `lib/maintenance-scheduler.ts` that owns the hourly cadence and registers the four domain sweeps, started from `instrumentation.ts` independently of image-queue bootstrap. The image queue keeps only `pruneRetryMaps` (its own concern). This decouples security/retention hygiene from image-processing readiness.
- **Severity:** MEDIUM | **Confidence:** HIGH

### R12-ARCH-04 (CARRY-OVER, sharpened) — lib/storage/* is dead code with a misleading mutation API
- **Modules:** `apps/web/src/lib/storage/index.ts` (147 lines), `lib/storage/local.ts`, `lib/storage/types.ts` — 3 files, ~13 KB
- **Design risk:** Verified at this HEAD: **zero** production importers (`grep '@/lib/storage'` over `lib` + `app` + `components`, excluding tests = 0). Only `__tests__/storage-local.test.ts` exercises it. Worse than "unwired": `switchStorageBackend(type)` (`index.ts:85-128`) accepts only the literal type `'local'` (`StorageBackendType = 'local'`), so the function's entire body — dispose-old / init-new / rollback — is an unreachable branch that can only ever switch local→local. A reader encountering `getStorageBackendStatus()` / `switchStorageBackend()` reasonably concludes GalleryKit supports pluggable storage backends; CLAUDE.md explicitly says it does NOT, and warns not to expose S3/MinIO as a feature. The abstraction is carrying maintenance cost (it must keep compiling, tracking the `StorageBackend` interface) and onboarding-confusion cost while delivering zero behavior.
- **Concrete failure scenario:** A new contributor is asked to "add S3 support," finds `lib/storage`, implements an `S3StorageBackend`, wires `switchStorageBackend('s3')` — and discovers nothing reads `getStorage()` in the upload/processing/serving paths (those still use direct `fs` in `process-image.ts`, `upload-paths.ts`, `serve-upload.ts`). Days of work against a façade.
- **Remediation (decision, low effort either way):** Pick a lane. Either (a) complete the migration — route `process-image.ts` writes, `upload-paths.ts`, and `serve-upload.ts` reads through `getStorage()` (HIGH effort, the prior architect's rec #3), or (b) move `lib/storage/*` to an explicitly-marked `experimental/` location or delete it to a feature branch until the integration is real. Shipping a public API that no production path calls is the worst of both — it implies a capability that doesn't exist.
- **Severity:** MEDIUM | **Confidence:** HIGH

### R12-ARCH-05 (CARRY-OVER, magnitude corrected) — data.ts god-module (1670 lines) now exports lifecycle hooks
- **Modules:** `apps/web/src/lib/data.ts` (1670 lines, 53 top-level functions)
- **Design risk:** The prior architect review described `data.ts` as "600+ lines"; the real figure at this HEAD is **1670**. It conflates: the entire read-side DAL (queries, cursor pagination, search, sitemap, map images, feed rows), the privacy field-selection machinery (`adminSelectFields` → `publicSelectFields` derivation + `PrivacySensitiveKeys` guard, `:398-424`), AND a 5-variable view-count buffering state machine with retry-cap + backoff + capacity eviction (`viewCountBuffer`, `viewCountRetryCount`, `viewCountFlushTimer`, `consecutiveFlushFailures`, `isFlushing`, `:17-64`). With R11C11 it now ALSO exports a process-lifecycle hook (`flushBufferedSharedGroupViewCounts`, `:196`) consumed by `instrumentation.ts`. A pure data-access layer should not own a write-behind buffer with its own failure-handling state machine, nor a shutdown drain hook. Every edit to the buffer logic risks the DAL queries beside it (merge-conflict surface), and the buffer's correctness (the C2-F01 atomic-swap dance documented at `:13-16`) is invisible to anyone reading the file for query logic.
- **Concrete failure scenario:** Two parallel review-fix cycles touch `data.ts` — one tuning the view-count backoff, one adding a query column to `getImage()`. Non-trivial rebase conflict in a 1670-line file that mixes both concerns. Onboarding dev cannot locate the buffer because the filename promises "data access."
- **Remediation (medium effort, defer-able):** Split into `data/queries.ts` (DAL), `data/privacy.ts` (field selection + guards), `data/view-buffer.ts` (the buffer + its lifecycle hook — which then self-registers under R12-ARCH-01). This is the prior AGG-M17 with a corrected magnitude and a now-concrete trigger (the buffer grew an exported lifecycle hook).
- **Severity:** MEDIUM | **Confidence:** HIGH

---

## Structural-MINOR Findings

### R12-ARCH-06 (CARRY-OVER) — Single lib/ → app/ upward dependency persists
- **Modules:** `apps/web/src/lib/api-auth.ts:1` (`import { isAdmin } from '@/app/actions/auth'`)
- **Risk:** Still the only upward edge in the graph (verified: it is the sole `lib/ → app/` import at this HEAD). `lib/` is meant to be the lower layer; importing a server action from `app/` inverts the dependency and means any test of `api-auth` drags in the full server-action + cookie + DB stack.
- **Remediation:** Extract `isAdmin()` into `lib/auth-check.ts` (or `lib/session.ts`); re-export from `app/actions/auth` for existing callers. Low effort, closes the layering inversion. (Same as AGG-M18.)
- **Severity:** LOW | **Confidence:** HIGH

### R12-ARCH-07 (NEW — trend note) — process-image.ts deferred split is accruing interest
- **Modules:** `apps/web/src/lib/process-image.ts` (1694 lines, up from 1633 at cycle 10)
- **Risk:** The god-module flagged every cycle keeps GROWING — +61 lines since cycle 10 (the `safeUnlink`/`safeCloseDirHandle` helpers, commit 3111cc7e). "Deferred" is not free: each cycle's point fixes land in the same monolith (encode + color-detect + GPS-strip + blur + verify + EXIF), widening the merge surface and the untestable-without-libvips footprint. The pattern is that the module is the path of least resistance for every new guard, so it monotonically accretes.
- **Remediation:** Treat the extraction (prior rec #5: `pipeline/{decision,encode,verify,gps-strip}.ts`) as a scheduled debt paydown, not an open-ended "someday." Even extracting the two leaf concerns with no shared mutable state (GPS-strip is already a separate file `gps-exif-strip.ts` at 605 lines; blur generation and post-encode verification are the next cleanest cuts) would halt the growth.
- **Severity:** LOW | **Confidence:** HIGH

### R12-ARCH-08 (NEW) — geoip-lite loaded via two different mechanisms in two modules
- **Modules:** `apps/web/src/instrumentation.ts:11-12` (`await import('geoip-lite')`), `apps/web/src/lib/analytics.ts:40` (`require('geoip-lite')`), memoized at `analytics.ts:33` (`let geoLookup`)
- **Risk:** The optional dependency is pre-warmed in `instrumentation.ts` via dynamic ESM `import()` and consumed in `analytics.ts` via CJS `require()`. It works today because both resolve to the same Node module cache, so the pre-warm populates the cache `require()` later hits. But the "is geoip available?" decision and its graceful-fallback knowledge are duplicated across two modules and two loader idioms. A future bundler/ESM-interop change (or a switch of `analytics.ts` to `import()`) could desync them, and the pre-warm's benefit silently evaporates with no test catching it.
- **Remediation:** Centralize geoip access in `analytics.ts` behind one loader (`ensureGeoip()`), and have `instrumentation.ts` call THAT to pre-warm, so a single module owns the optional-dependency contract. Low effort.
- **Severity:** LOW | **Confidence:** MEDIUM

### R12-ARCH-09 (CARRY-OVER) — image-queue.ts and images.ts action remain oversized
- **Modules:** `apps/web/src/lib/image-queue.ts` (868), `apps/web/src/app/actions/images.ts` (1164, `uploadImages` god-function)
- **Risk:** Both flagged previously (AGG-M20). `image-queue.ts` additionally hosts `purgeExpiredSessions` and the cron (see R12-ARCH-03). `images.ts` `uploadImages` still bundles quota checks, per-file validation, GPS strip, HDR rejection, EXIF, DB insert, blur validation, and cleanup in one ~350-line function. No regression, but unchanged debt — extracting `checkUploadQuota()` / `validateAndSaveFile()` / `enqueueForProcessing()` / `buildInsertValues()` remains the cleanest improvement.
- **Severity:** LOW (structural, deferred) | **Confidence:** HIGH

---

## Root Cause

The architecture's debt has a single throughline across 12 cycles: **fixes land where they are
easiest to add, not where they belong.** The review-fix loop is excellent at closing point defects
(the 18 commits since cycle 10 are all sound) but each fix is dropped into the nearest existing
module, so the load-bearing files (`process-image.ts`, `data.ts`, `image-queue.ts`, `images.ts`)
act as gravity wells that monotonically accrete responsibility. The R11C11 graceful-shutdown work
is the first NEW lifecycle concern in many cycles, and it immediately exhibited the same pattern —
rather than a registry, two specific drains were named inline; rather than its own scheduler, the
cron already lived in the image queue, so the new shutdown reaches into the image queue too. The
`storage/` module is the inverse symptom: an abstraction added ahead of need that was never pulled
through, so it ossified into a façade. None of this threatens the single-instance product today;
all of it raises the cost of the next structural change (a new buffer, a new sweep, a real storage
backend, or — the documented non-goal — horizontal scale-out).

---

## Recommendations (prioritized)

1. **R12-ARCH-01 — Add `lib/shutdown-hooks.ts` registry.** Low effort, high leverage; converts a
   silent-omission failure class into a tested invariant. **Do now.**
2. **R12-ARCH-02 — Register signal handlers before bootstrap; make the legacy-upload assertion
   tolerant of incidental IO errors.** Low effort; removes a startup crash-loop and a shutdown
   blind window. **Do now.**
3. **R12-ARCH-04 — Decide the fate of `lib/storage/*`** (complete the wiring or quarantine/delete).
   Low effort to quarantine; high effort to complete. **Decide now, even if the decision is "defer."**
4. **R12-ARCH-03 — Extract `lib/maintenance-scheduler.ts`** so retention/session/audit sweeps are
   not gated on image-queue bootstrap. Medium effort. **Schedule.**
5. **R12-ARCH-05 / R12-ARCH-07 / R12-ARCH-09 — God-module paydown** (`data.ts` buffer split,
   `process-image.ts` leaf-concern extraction, `uploadImages` helpers). Medium-high effort.
   **Schedule as deliberate debt paydown to halt monotonic growth.**
6. **R12-ARCH-06 — Move `isAdmin()` into `lib/`.** Low effort; closes the only layering inversion.

---

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| Shutdown-hook registry (R12-ARCH-01) | Tested invariant, future buffers safe by construction | One more module; marginal indirection |
| Handlers-first ordering (R12-ARCH-02) | No startup-window signal loss, no IO-fault crash-loop | Bootstrap errors now surface post-registration (acceptable) |
| Extract maintenance scheduler (R12-ARCH-03) | Retention/security sweeps independent of image readiness | New module; must ensure single arm across restarts |
| Complete storage abstraction | Real S3/MinIO path, testable with mocks | High effort; atomic-rename semantics differ per backend |
| Quarantine/delete storage | Removes dead API + onboarding confusion now | Loses the head-start if S3 is later wanted (recoverable from git) |
| Split data.ts | Smaller merge surface, clear ownership | Refactor risk on the privacy-guard + buffer correctness dance |
| Leave god-modules | No refactor risk this cycle | Files keep growing; cost compounds every cycle |

---

## Consensus Addendum

- **Antithesis (steelman):** For a single-admin, single-instance personal gallery, ALL of these are
  non-problems. The shutdown path flushes everything that is actually buffered TODAY (verified), so
  R12-ARCH-01 guards a buffer that does not exist. `image-queue.ts` owning the cron is pragmatic —
  one timer, one place, unref'd and cleared on shutdown; splitting it adds a module for no runtime
  benefit. The `storage/` façade is harmless inert code. The god-modules are stable, heavily tested
  (2000+ tests), and "monolith you can read top-to-bottom" beats "ten files you must cross-reference"
  for a solo maintainer. Premature decomposition would risk the carefully-tuned color pipeline for an
  abstraction nobody is asking for. By this reading, the correct action for most findings is "note and
  defer," which the prior cycles already did.
- **Tradeoff tension:** The review-fix loop's strength (closing point defects cheaply) is exactly what
  feeds the structural debt (defects land in gravity-well modules). You cannot have a high-velocity
  defect-closing loop AND naturally-decomposing modules without spending explicit refactor cycles that
  produce zero new behavior — which is hard to justify against the next functional finding every single
  cycle. The honest tension: each individual deferral is correct; the sum of all deferrals is a 1694-line
  file that grew again this cycle. The registry/handlers-ordering items (R12-ARCH-01/02) are the
  resolution point because they are cheap AND prevent the next silent failure — they pay for themselves
  the first time someone adds a buffer.
- **Synthesis:** Do the two cheap, leverage-positive items now (shutdown registry, handler ordering),
  make one explicit decision on `lib/storage` (even "quarantine"), and convert the perpetual "defer the
  god-module split" into ONE scheduled paydown that extracts only leaf concerns with no shared mutable
  state (view-buffer out of `data.ts`, verify/blur out of `process-image.ts`). That halts growth without
  touching the color-pipeline core, preserving the steelman's "don't abstract the tuned pipeline
  prematurely" while ending the monotonic accretion.

---

## References (this cycle, file:line)

- `apps/web/src/instrumentation.ts:3-6,28-36,57-72` — startup ordering + hardcoded shutdown flush set
- `apps/web/src/lib/upload-paths.ts:82-103` — `assertNoLegacyPublicOriginalUploads` throws on non-ENOENT IO + failInProduction
- `apps/web/src/lib/image-queue.ts:795-803` — hourly GC running session/bucket/audit/view-retention sweeps, armed only on bootstrap success
- `apps/web/src/lib/image-queue.ts:619` — `purgeExpiredSessions` lives in the image-queue module
- `apps/web/src/lib/data.ts:13-64,196` — 5-variable view-count buffer state machine + exported lifecycle drain hook
- `apps/web/src/lib/data.ts:398-424` — privacy field selection + `PrivacySensitiveKeys` guard (1670-line god-module)
- `apps/web/src/app/actions/public.ts:357-369` — image views written direct (fire-and-forget), NOT buffered (confirms shutdown set complete today)
- `apps/web/src/lib/storage/index.ts:85-128` — `switchStorageBackend` dead branch (local→local only); module has 0 production importers
- `apps/web/src/lib/api-auth.ts:1` — sole `lib/ → app/` upward dependency
- `apps/web/src/lib/process-image.ts` — 1694 lines (was 1633 at cycle 10)
- `apps/web/src/lib/analytics.ts:33,40` vs `instrumentation.ts:11-12` — geoip-lite via require() vs import() in two modules
- `apps/web/src/lib/queue-shutdown.ts:26-36` — gcInterval + bootstrapRetryTimer cleared on drain (verified correct)
