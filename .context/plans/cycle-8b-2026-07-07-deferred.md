# Run-10 Cycle 8 (loop-B) Deferred Findings — 2026-07-07/08

Rules honored: severities/confidences preserved from the review lanes (no downgrades to
justify deferral); every deferral cites file+line, reason, and exit criterion. No
security/correctness/data-loss finding is deferred — each row below is a structural
refactor, a test-infrastructure investment, or a perf item below the measured-impact bar,
consistent with the repo's own precedent rows in `deferred-carry-forward.md` (C94-04/05
test-infra, C4-16 structural partition, C2-55 perf long-tail). Deferred work remains bound
by repo policy when picked up (GPG-signed conventional+gitmoji commits, no `--no-verify`,
Node 24+/TS 6).

## D8b-01 — AGG8b-09 / ARCH8-01: LR-upload vs browser-upload duplicated orchestration
- **Severity/Confidence:** MED / High.
- **Citation:** `apps/web/src/app/api/admin/lr/upload/route.ts` (whole file, 612 lines) vs
  `apps/web/src/app/actions/images.ts` `uploadImages()` (~129-655); drift history
  CR-R9C6-01 → CR-R9C7-01 documented at `lr/upload/route.ts:538-547`.
- **Reason:** both prior drift instances are healed; the fix is a cross-cutting extraction
  (`ingestUploadedImage(...)`) across the repo's two most safety-critical write paths —
  exactly the class the repo's C1-32 incremental-drainage policy schedules on the next
  natural touch rather than as a standalone sweep ("Incremental drainage policy
  (per-cycle, ongoing)", `deferred-carry-forward.md` C1-32 row).
- **Exit criterion:** next upload-flow-touching cycle folds the shared orchestration
  extraction, OR a third settings/validation drift between the two paths lands (then it
  becomes non-deferrable rework evidence).

## D8b-02 — AGG8b-23 (behavioral half) / TEST8-03: upload-quota TOCTOU concurrency harness
- **Severity/Confidence:** HIGH / High (test-design finding; the underlying code is
  verified correct — verifier cycle-8 confirmed the claim-before-await + rollback contract).
- **Citation:** `apps/web/src/app/actions/images.ts:196-320`;
  `apps/web/src/__tests__/images-action-toctou-claim.test.ts`.
- **Reason for partial deferral:** this cycle ships the strictly-stronger static pin (WP7:
  zero `await` tokens allowed in the check→claim window — closes the reviewer's concrete
  bypass of the old two-named-awaits pin). The remaining half — a true two-invocation
  interleaving harness for `uploadImages()` — requires mocking the full server-action
  dependency surface (headers/cookies/db/fs/queue), i.e. the same test-infra investment
  class as the open C94-04 row ("Route-level LR upload behavior coverage (test-infra
  investment)") and C4-18 (component harness decision). Not a code-correctness deferral.
- **Exit criterion:** a reusable server-action behavioral harness lands (C94-04/C4-18
  class), OR any regression/incident traced to the upload window fires immediate re-open.

## D8b-03 — AGG8b-25 / TEST8-05 (residual): db-actions spawn-mock behavioral coverage
- **Severity/Confidence:** MED / High.
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts` watchdog `onTimeout`
  call sites (backup/restore/migrate; ~204/771/882 at review baseline); file-loop wiring
  now source-pinned by the peer's `restore-sql-scan-file-loop.test.ts`.
- **Reason:** this is the already-open C6-12 row's exact scope; the watchdog PRIMITIVE is
  behaviorally tested (`db-child-watchdog.test.ts`) but the three real `onTimeout`
  callbacks still need the reusable child_process spawn-mock harness C6-12 calls for. Do
  NOT mark C6-12 closed on the primitive tests alone (test-engineer lane's explicit
  warning).
- **Exit criterion:** unchanged from C6-12 — next restore-path cycle OR the spawn-mock
  harness lands.

## D8b-04 — AGG8b-26 / TEST8-06: SW template execution harness
- **Severity/Confidence:** LOW / Medium.
- **Citation:** `apps/web/public/sw.template.js` vs `apps/web/src/lib/sw-cache.ts`;
  `apps/web/src/__tests__/sw-template-contract.test.ts` (regex pins only).
- **Reason:** accepted architecture tradeoff documented in CLAUDE.md (template + unit-tested
  reference implementation + contract pins); an eval-in-stubbed-`self` harness is the same
  decision class as the open C4-18 row.
- **Exit criterion:** chains C4-18 — next SW-template-touching cycle must evaluate the
  minimal harness (adopt or record why not).

## D8b-05 — AGG8b-28 / PERF-F1: embedding bootstrap scan pool-budget documentation
- **Severity/Confidence:** LOW / Medium.
- **Citation:** `apps/web/src/lib/image-queue.ts` `bootstrapMissingActiveEmbeddings`
  (~527) + per-row embedding upsert; contrast `resolveBackfillConcurrency` budget note in
  `admin-backfill-runner.ts`.
- **Reason:** the scan is sequential (≤1 connection at a time) so there is no live
  starvation defect to fix; the ask is a budget doc/semaphore unification — exactly the
  open C6-04c row ("shared pool-budget semaphore; doc half shipped c6 WP7"). Folded there
  rather than duplicated.
- **Exit criterion:** C6-04c's — peer image-queue work lands + measured pool starvation,
  OR next image-queue cycle.

## D8b-06 — AGG8b-31 / PERF8-SW-01: HTML offline-cache O(N) eviction reads
- **Severity/Confidence:** LOW / High.
- **Citation:** `apps/web/public/sw.template.js` `evictHtmlCacheIfNeeded` (~146-165) and
  the `sw-cache.ts` mirror — `keys()` + per-key `match()` header reads on every HTML write
  past the 50-entry cap.
- **Reason:** bounded cost (≤50 cache reads per navigation, off the critical rendering
  path, only when the offline cache is full); any change touches the high-blast-radius SW
  surface (template + generated `sw.js` + contract test + CLAUDE.md's documented 50-entry
  cap) — disproportionate for a LOW without a measured symptom.
- **Exit criterion:** next SW-template-touching cycle folds an amortization (meta-map
  recency like the image cache, or hysteresis), OR a measured SW main-thread cost report.

## D8b-07 — AGG8b-32 / PERF8-BF-01: `(pipeline_version, id)` index for backfill scans
- **Severity/Confidence:** LOW / High.
- **Citation:** `apps/web/src/db/schema.ts:83` (`pipeline_version` — no index); consumers
  `scripts/backfill-color-pipeline.ts` + `lib/admin-backfill-runner.ts` candidate queries.
- **Reason:** full scan is fine at the documented single-admin scale; the repo's
  migration-authoring checklist (CLAUDE.md "Adding a new migration") makes a standalone
  LOW-motivated migration disproportionate — the finding's own recommendation is to ride
  the next journal entry.
- **Exit criterion:** next schema/migration-authoring cycle folds the index (same
  treatment as the open C2-21 `(processed, updated_at, id)` row), OR a measured multi-second
  backfill candidate scan on a large gallery.

## No-action records (not deferrals — nothing to schedule)

- **AGG8b-12 / CRIT8-02:** empty commit `f201309c` with a refactor message (real work in
  parent `515a25bd`). History is pushed and shared with the concurrent peer loop; the
  repo's git-safety rules prohibit history rewriting on the shared branch ("no force-push
  to protected branches"; user-level rule: rebase/reset of published history is a
  destructive action requiring explicit user confirmation). Recorded for provenance only;
  the cycle-7b plan already attributes the work to `515a25bd`.
- **AGG8b-35 / TRACE8-02:** delete-mid-fan-out burns bounded retries (~15-20 s log noise,
  zero correctness impact) — informational.
- **AGG8b-36 / TRACE8-03:** GET_LOCK-throw release-vs-destroy — superseded at HEAD by the
  peer's `destroyPooledAdvisoryLockConnectionOnAcquireError` (strictly stronger than the
  mysql2-internals reasoning the lane relied on). Closed.
- **AGG8b-37 / CRIT8-06:** process-overhead observation — acknowledged; this cycle keeps
  the `8b` disambiguation convention.
