# Run-10 Cycle 6/100 Deferred Findings

Date: 2026-07-07
Aggregate source: `.context/reviews/cycle-6-2026-07-07/_aggregate.md`

Deferred items preserve original severity/confidence (never downgraded to justify deferral).
Per repo rules (CLAUDE.md, `.context/plans/README.md`): security/correctness/data-loss findings are
NOT deferred unless a specific repo rule permits, or the fix is blocked by a peer-owned file, a
product/operator decision, or missing measurement/test-infra. Each row records file+line citation,
severity/confidence, deferral reason, and the exit criterion that re-opens it.

## Deferred items

### DEF-C6-05 — `bulkUpdateImages` per-row UPDATE loop inside one transaction

- Aggregate: C6-05 (perf F1). Severity/confidence: **MED / High**.
- Citation: `apps/web/src/app/actions/images.ts:1170-1180`.
- Reason: performance optimization (collapse ≤100 sequential per-row UPDATE round-trips into one
  `CASE id WHEN … END` statement). Not correctness/security/data-loss. The `CASE`-SQL rewrite touches
  a mutating admin path and its correctness wants a DB-backed test, which this repo does not have (no
  DB-reaching unit infra — same constraint as C1-31). At single-admin/personal-gallery scale the
  round-trip cost is bounded (≤100 rows, local/low-latency DB in the shipped topology).
- Exit criterion: measured admin bulk-apply latency shows the loop is hot, OR DB-backed test infra
  lands so the `CASE` rewrite can be verified before shipping.

### DEF-C6-04c — image-queue ↔ backfill shared pool-budget semaphore (code half)

- Aggregate: C6-04 (architect F2). Severity/confidence: **MED / High**.
- Citation: `apps/web/src/lib/image-queue.ts:120-133` (peer-dirty), `apps/web/src/lib/admin-backfill-runner.ts:105-142`.
- Reason: the corrective code (a shared background-connection semaphore, or each resolver subtracting
  the peer's max) centres on `image-queue.ts`, which is uncommitted-in-flight by the peer session this
  cycle — editing it risks clobbering their work. The doc half (extend the TRC-07 note) IS scheduled
  in WP7 this cycle.
- Exit criterion: peer image-queue work lands (file no longer dirty) AND a measured pool-starvation
  event during simultaneous re-encode + upload processing, OR the next image-queue-touching cycle
  folds the shared budget.

### DEF-C6-06c — DB-TLS import-time throw → startup guard + optional system-CA path (code half)

- Aggregate: C6-06 (critic F3). Severity/confidence: **MED / Med**.
- Citation: `apps/web/src/db/index.ts:11-19`, `apps/web/scripts/mysql-connection-options.js:14-28`.
- Reason: the current throw-at-import for a non-local `DB_HOST` without `DB_SSL_CA` is a DELIBERATE,
  documented fail-closed posture (README.md, apps/web/README.md, `.env.local.example`). Moving it to a
  clean startup probe and re-introducing a "verify against system CAs" opt-in is a security/ops
  posture decision, not a bug fix, and could weaken TLS if done carelessly. The doc-wording tightening
  (CLAUDE.md `DB_SSL_CA` mandatory) IS scheduled in WP7.
- Exit criterion: an operator upgrade incident caused by the import-time throw, OR a deliberate
  product/ops decision to support public-CA managed MySQL via the system trust store.

### DEF-C6-12 — DB-restore child-process failure path behavioral (spawn-mock) test

- Aggregate: C6-12 (test-engineer F2). Severity/confidence: **MED / High**.
- Citation: `apps/web/src/__tests__/db-restore.test.ts:47-76`, `apps/web/src/app/[locale]/admin/db-actions.ts:783-796`.
- Reason: the `failRestore` cleanup path is currently locked only by source-text assertions. A real
  behavioral test requires building a `child_process.spawn` mock emitting `error`/`close`/timeout and
  asserting `kill`/`stdin.destroy`/temp-unlink side effects — a test-infra investment in the same
  class as the deferred C94-04 (LR route-level coverage) and C94-05 (admin Playwright coverage). The
  scheduled WP8 spends this cycle's test-infra budget on the LR upload branches where a harness
  already exists (cheaper, higher marginal coverage).
- Exit criterion: next restore-path-touching cycle, OR a `child_process` spawn-mock harness lands for
  another test and can be reused here.

### DEF-C6-17 — `check-action-origin` clears (not restores) rate-limit scan state

- Aggregate: C6-17 (critic F4). Severity/confidence: **LOW / Med**.
- Citation: `apps/web/scripts/check-action-origin.ts:774-778, 983-989`.
- Reason: the direction is fail-safe — a cleared gate can only make the scanner OVER-strict (false
  CI failure), never miss a real mutation-before-gate. There is no live trigger today (no gated public
  action mutates after a `trackAnalyticsDbWrite`). Modifying a security lint gate's traversal for a
  purely-cosmetic correctness gap risks introducing a real gate regression for no current benefit.
- Exit criterion: a legitimately-gated public action that mutates after an analytics call hits a
  spurious `lint:action-origin` failure, OR the scanner is reworked for another reason.

### DEF-C6-18 — permanent-failure `processing_error` UPDATE lacks the `processed = false` guard

- Aggregate: C6-18 (tracer F2). Severity/confidence: **LOW / Med**.
- Citation: `apps/web/src/lib/image-queue.ts` permanent-failure catch branch (PEER-DIRTY this cycle).
- Reason: (1) the fix lands in `image-queue.ts`, uncommitted-in-flight by the peer session; (2) not
  currently exploitable — the one realistic AUTO_INCREMENT id-reuse trigger (DB restore) is already
  closed by `quiesceImageProcessingQueueForRestore` clearing retry timers before import. Pure
  defense-in-depth consistency with the file's sibling UPDATEs.
- Exit criterion: peer image-queue work lands AND a new id-reuse trigger is introduced, OR the next
  image-queue-touching cycle adds the guard alongside other work.

### DEF-C6-19 — truncated metadata reveal is mouse-hover-`title`-only (no keyboard/touch equivalent)

- Aggregate: C6-19 (designer F3). Severity/confidence: **LOW-MED / Med**.
- Citation: `apps/web/src/components/info-bottom-sheet.tsx:413,419`, `photo-viewer.tsx:806,812`,
  `image-manager.tsx:494`, `upload-dropzone.tsx:537`.
- Reason: a11y improvement spanning four components (Radix `Tooltip` wrap on focusable elements, or
  stop truncating). The full text is present in the DOM for linear screen-reader reading; the gap is
  sighted keyboard-only / touch-only users. Belongs in an a11y batch alongside the already-deferred
  color-metadata semantics polish (C96-13) rather than a piecemeal one-off.
- Exit criterion: AT/keyboard-user report, OR the next a11y label/polish batch.

### DEF-C6-20 — smart-collection compiled-SQL cost has no ceiling on `/c/[slug]`

- Aggregate: C6-20 (perf F3). Severity/confidence: **LOW / Low-Med**.
- Citation: `apps/web/src/lib/smart-collections.ts:142-273`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17,105`.
- Reason: latent — smart collections have NO admin authoring UI (rows are DB-INSERT-only per
  CLAUDE.md), so a near-ceiling predicate tree cannot be authored through the product today. Chains on
  the C1-25(a) Collections-UI product decision.
- Exit criterion: a Collections authoring UI ships → add a save-time compiled-complexity ceiling or
  per-collection compiled-result caching.

### DEF-C6-21 — bulk uploads send one file per server-action call

- Aggregate: C6-21 (perf F2). Severity/confidence: **LOW-MED / Med**.
- Citation: `apps/web/src/components/upload-dropzone.tsx:240-297`, `apps/web/src/app/actions/images.ts:129-230`.
- Reason: performance; the server already accepts a batched `formData.getAll('files')`. Actual upload
  bandwidth (200 MB/file) dominates wall-clock at photo scale; the redundant per-call auth/lock/config
  overhead is real but bounded. The sequential-upload constraint is the separately-deferred C4-10.
- Exit criterion: a many-small-file / high-DB-latency deployment reports perceived upload lag, OR the
  next upload-flow perf cycle.

### DEF-C6-22 — login rate-limit in-memory idle-gap vs DB aligned-window divergence

- Aggregate: C6-22 (tracer F3). Severity/confidence: **LOW / Med**.
- Citation: `apps/web/src/lib/rate-limit.ts:441-474`, `apps/web/src/app/actions/auth.ts:104-170`.
- Reason: not an auth bypass — the stricter in-memory idle-gap semantics dominate in normal operation.
  Only a narrow coincidence (process restart AND DB window boundary) briefly resets both layers. A
  rate-limit tuning nuance, not a security defect; both layers function independently.
- Exit criterion: an observed brute-force incident exploiting the restart-at-boundary window, OR a
  rate-limit algorithm unification pass.

### DEF-C6-23 — schema migration runs at container boot with no cross-process advisory lock

- Aggregate: C6-23 (architect F3). Severity/confidence: **LOW / Med**.
- Citation: `apps/web/scripts/migrate.js:999-1030`, Dockerfile CMD, `scripts/init-db.ts:26`.
- Reason: theoretical in the shipped single-web-instance topology (compose stop-old-then-start-new
  recreate makes migrate overlap unlikely). Wrapping the migration in an advisory lock touches the
  load-bearing migration machinery, where a regression can wedge deploys — the repo's own runbook
  treats that machinery as high-blast-radius. Not correctness/data-loss under the documented topology.
- Exit criterion: an observed concurrent-migrate `ER_DUP_KEYNAME`/half-reconcile failure, OR a
  dedicated migration-machinery hardening cycle.

### DEF-C6-24 — two divergent process-local singleton-state patterns, no stated rule

- Aggregate: C6-24 (architect F4). Severity/confidence: **LOW / High (existence), Low (prod impact)**.
- Citation: `globalThis[Symbol.for(...)]` registries vs plain `let cache` (`gallery-config.ts:216-217`,
  `settings-hash.ts:69-70`, `serve-upload.ts:70-71`).
- Reason: maintainability/consistency; in production standalone each module instantiates once, so the
  duplicated-cache-staleness risk is dev-HMR-only. No confirmed production bug.
- Exit criterion: a real duplicated-cache staleness bug (settings flip fails to invalidate), OR a
  config-cache refactor adopts a single documented rule.

### DEF-C6-28 — `OnThisDayWidget` computes "today" from the server clock, not the visitor timezone

- Aggregate: C6-28 (debugger F1 retry lane). Severity/confidence: **MED / High**.
- Citation: `apps/web/src/lib/on-this-day-date.ts:6-11`, `apps/web/src/components/on-this-day-widget.tsx:15-16`.
- Reason: the correct fix (make "today" client-driven, or standardize a timezone policy) is a
  client/server-boundary design decision for a minor home-page widget; the low-risk mitigation
  (require operators to set `TZ`) needs an operator-default product call. Not data-loss/security. The
  self-hosted single-timezone deployment model means a single operator TZ setting already resolves it
  in practice.
- Exit criterion: on-this-day is made client-driven, OR a `TZ` operator-config note ships in the
  deployment docs, OR a visitor reports wrong on-this-day content.

### DEF-C6-27 — `titlePrefix` bulk-edit field named as prefix but performs exact title set

- Aggregate: C6-27 (code-reviewer F2 retry lane). Severity/confidence: **LOW / Med**.
- Citation: `apps/web/src/lib/bulk-edit-types.ts:14`, `apps/web/src/app/actions/images.ts:1083-1120,1220`,
  `apps/web/src/components/bulk-edit-dialog.tsx:148`.
- Reason: no live behavior bug — the UI label is "Title" and matches the exact-`SET` behavior; this is
  a naming/maintainability risk. The rename touches the audit-log field key `titlePrefixMode`, so it
  ripples into audit records/tests; not worth the churn without a bundling opportunity.
- Exit criterion: next bulk-edit-touching cycle, OR a maintainer trips on the prefix naming.

### DEF-C6-25 — `.omc/wiki` pages still claim CLIP semantic search "LIVE in production"

- Aggregate: C6-25 (document-specialist AGG-C10-19/20 reconfirm). Severity/confidence: **LOW-MED / High**.
- Citation: `.omc/wiki/clip-semantic-search-us-p51.md:15`, `.omc/wiki/gallerykit-architecture-overview.md:33`,
  `.omc/wiki/schema-derived-list-drift-migration-reconcile-lesson.md`.
- Reason: already scheduled by the PEER session's cycle-10 plan (AGG-C10-19/20). Editing shared wiki
  pages the peer is actively scheduling would risk a double-edit / merge conflict. The primary docs
  (README, apps/web/README) are correctly hedged — the overclaim is isolated to these wiki pages.
- Exit criterion: peer cycle-10 closes AGG-C10-19/20; if it does not, fold into the next docs cycle
  owned by this loop.
