# Cycle 6 Aggregate Review

Date: 2026-07-07
Review baseline: committed HEAD `583277fb` (`docs(plan): schedule cycle 10 fixes` — planning-only).
Shared worktree: a second session owns the peer-dirty churn (CLIP/semantic/timeline/data/schema/
image-queue/instrumentation + several tests). Reviewers reviewed COMMITTED HEAD; peer-dirty files
were read via `git show HEAD:<path>` and are NOT proposed for edits this cycle.

## Agent coverage

Fanned out 12 reviewer lanes concurrently. 10 returned; 2 opus lanes (code-reviewer, debugger)
hung ~35 min and were re-spawned once with a tighter sonnet scope (see AGENT FAILURES).

Returned per-agent files (this cycle dir):
`security-reviewer.md`, `verifier.md`, `perf-reviewer.md`, `architect.md`, `critic.md`,
`tracer.md`, `test-engineer.md`, `document-specialist.md`, `designer.md`,
`feature-dev-code-reviewer.md`.

## Validation evidence gathered by lanes (against HEAD)

- `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit`: PASS on committed HEAD
  (security + feature-dev lanes). `lint:action-origin` FAILS in the working tree ONLY on the peer's
  uncommitted `public.ts` edit — HEAD is clean (verified via `git show HEAD:` + `checkActionSource`).
- `lint`, `typecheck`: PASS on HEAD (feature-dev lane).
- `npm test`: 3168 passed / 4 skipped on HEAD, plus 2 failures caused solely by the peer's
  in-progress `photo-title.ts` edit (document-specialist lane; not a committed-HEAD regression).
- Numeric/contract sweep (verifier + document-specialist): IMAGE_PIPELINE_VERSION=7,
  COLOR_IMPACTING_KEYS=9, pool 10/queue 20, backfill cap 2, advisory-lock name list, nginx caps,
  migration journal 30/30 — all match code. High doc fidelity.

Raw findings across lanes: ~36. Deduped below: 25 (+ known-reconfirmed items folded).

## Deduped findings

Severity/confidence preserve the highest across duplicating lanes. Cross-agent agreement noted.

### C6-01 — DB-restore dangerous-SQL streaming scanner evadable by intra-keyword chunk-boundary split  [SEV: MED | CONF: High | security]
- Lanes: security F1 (empirically reproduced).
- `apps/web/src/lib/sql-restore-scan.ts:267-278` + `apps/web/src/app/[locale]/admin/db-actions.ts:719-748`.
- `appendSqlScanChunk` joins the compacted tail to the next 1 MiB chunk with an injected `\n`.
  When an attacker aligns a dangerous statement so the read boundary falls INSIDE a keyword token
  (`DROP TAB`|`LE images;`), the injected `\n` breaks the keyword and `/\bDROP\s+TABLE\b/i` never
  matches — the statement passes the scanner into `mysql --one-database`. Existing boundary tests
  only split at whitespace/word boundaries, never inside a token. Reproduced: 7/31 alignments evade.
- Security defense-in-depth (auth + same-origin + --one-database still intact); the scanner is a
  documented, load-bearing safety control against a malicious backup file. NOT deferrable.
- Fix: add a byte-continuous raw overlap bridge (retain last N raw bytes; scan
  `rawTailSuffix + rawChunkPrefix` with no separator) alongside the compacted tail; regression test
  splitting inside a keyword token.

### C6-02 — settings-hash: `buildHashFromConfig` is a second, hand-maintained copy of the byte-impacting settings list (config-path ETag can go invariant to a new setting)  [SEV: MED | CONF: High | correctness]
- Lanes: architect F1 (MED/High) + verifier F1 (LOW/Med, no-arg raw-numeric asymmetry) — same root.
- `apps/web/src/lib/settings-hash.ts:82-116`.
- The config-arg path hand-maps 9 key→value pairs; the no-arg DB path iterates `COLOR_IMPACTING_KEYS`.
  A future 10th byte-impacting setting that the author forgets to add to `buildHashFromConfig` makes
  the serve-upload hot-path ETag INVARIANT to that setting (silent stale derivatives — the exact
  failure the hash exists to prevent). Existing guards don't catch it (the R8-H1 equality test passes
  the hypothetical new key EMPTY on both sides). Verifier F1: no-arg path hashes raw numeric values
  verbatim (a stored `image_quality_avif=150` hashes as `150`, not the clamped default) — residual of
  the C4-19 image_sizes-only normalization; LOW (only the cold-start fallback path, admin write
  validates values before persist).
- Fix: exhaustive `Record<ColorImpactingKey, (c)=>string>` mapper so `tsc` requires a mapper per key;
  per-key flip test; add `buildHashFromConfig` to the CLAUDE.md "adding a color-impacting setting"
  checklist. (Optionally normalize the no-arg numeric path through the validator.)

### C6-03 — restore drain cluster: unbounded background-write drain + unenforced drain checklist + tight maintenance-drain budget  [SEV: MED | CONF: High | availability/correctness]
- Lanes: tracer F1 (MED/High) + critic F1 (MED/High) + critic F2 (LOW-MED/Med). Cross-lane agreement.
- (a) tracer F1: `drainBackgroundDbWritesForRestore()` (`background-db-writes.ts:77-84`) has NO
  timeout, unlike its two sibling restore drains AND unlike the SAME function's graceful-shutdown
  caller (`instrumentation.ts` Promise.race 15s). A single stuck analytics write during a restore
  hangs the drain indefinitely while restore holds 4 advisory locks + the durable maintenance marker
  → uploads/processing/admin mutations wedged site-wide with no operator signal. Pure availability
  (occurs before `runRestore`, no corruption). `background-db-writes.ts` + `db-actions.ts` NOT
  peer-dirty; the alias is used ONLY by the restore path (instrumentation uses the un-aliased fn).
- (b) critic F1: restore quiescence is a hand-maintained drain checklist with no registry/test; it
  ALREADY regressed this cycle (`drainMaintenanceSweepsForRestore` was added in `cae5fbd9` after the
  maintenance sweep was found able to delete rows mid-restore). Recurring "add one more case" class.
- (c) critic F2: `drainMaintenanceSweepsForRestore` 5s budget vs the 15s shutdown budget for the same
  sweeps → spurious `restoreFailed` on a large `image_views` purge; chunked deletes don't cancel
  cooperatively on `isRestoreMaintenanceActive()`.
- Fix: bound (a) with the same Promise.race+abort pattern (SCHEDULE — non-peer-dirty). (b) drain
  registry / at-minimum an enumerated-invariant comment (SCHEDULE comment; registry = larger, defer).
  (c) raise budget or cooperative-cancel (DEFER, tuning).

### C6-04 — image-queue and backfill pool-budget resolvers each reserve the SAME connections, ignoring the other  [SEV: MED | CONF: High | perf/architecture]
- Lanes: architect F2. Extends known TRC-07 with NEW evidence (largest overlap, not enumerated there).
- `admin-backfill-runner.ts:105-142` + `image-queue.ts:120-133` (HEAD) + `db/index.ts:31`.
- Both reserve 5 "for live traffic" and cap at 2 workers, neither subtracts the other. Concurrent
  admin re-encode + upload processing pins 9/10; the "5 reserved" is really 1 free → live `getImage`
  fan-outs queue behind encode holds. Code half of the fix is in peer-dirty `image-queue.ts`.
- Fix: shared background-connection semaphore, OR each resolver subtracts peer max, OR mutual
  exclusion. Doc half (extend TRC-07 note in CLAUDE.md) is SCHEDULE-able now; code half DEFER
  (peer-dirty image-queue.ts).

### C6-05 — `bulkUpdateImages` applies suggested alt-text via a sequential per-row UPDATE loop inside one transaction  [SEV: MED | CONF: High | perf]
- Lanes: perf F1.
- `apps/web/src/app/actions/images.ts:1170-1180`. Up to 100 sequential UPDATE round-trips on the same
  held connection inside the txn while the admin-mutation-slot + restore-drain budget is pinned.
- Fix: single `UPDATE … SET title = CASE id … END WHERE id IN (…)` parameterized statement. DEFER
  (perf; needs DB-backed verification of the CASE SQL; personal-gallery scale; images.ts is not
  peer-dirty but the correctness of raw CASE SQL wants a DB test). Exit: measured admin bulk-apply
  latency OR DB-backed test infra.

### C6-06 — DB TLS hardening throws at module import and removes the system-CA option (upgrade footgun)  [SEV: MED | CONF: Med | ops/reliability]
- Lanes: critic F3.
- `apps/web/src/db/index.ts:11-19`, `apps/web/scripts/mysql-connection-options.js:14-28`.
- Non-local `DB_HOST` without `DB_SSL_CA` THROWS at `@/db` import → instrumentation + /api/live +
  every route/action 500 (blackholes liveness). Also removes the previously-valid "verify against
  system CA" path (managed/public-CA MySQL now must pin a file). Partly deliberate + documented, but
  CLAUDE.md:94 wording still reads optional.
- Fix: doc half (tighten CLAUDE.md:94 to "mandatory for non-local hosts") SCHEDULE now; code half
  (startup guard instead of import throw + optional system-CA opt-in) DEFER (security/ops decision).

### C6-07 — CLAUDE.md "Database Indexes" omits the two `0029` feed/sitemap `updated_at` indexes  [SEV: MED | CONF: High | docs]
- Lanes: document-specialist F1.
- `idx_images_processed_updated_at (processed, updated_at, created_at, id)` and
  `idx_images_topic_updated_at (topic, processed, updated_at, created_at, id)` (migration 0029,
  `schema.ts:120,122`) are missing from the canonical index list. SCHEDULE (doc).

### C6-08 — Failed-image retry / permanent-failure subsystem completely undocumented in CLAUDE.md  [SEV: MED | CONF: High | docs]
- Lanes: document-specialist F2.
- `MAX_RETRIES=3` + backoff, `permanentlyFailedIds` bounded FIFO, `processing_error`/`failed_at`/
  `processing_settings_json` columns, admin dashboard Retry button (`retryFailedImage`) — an
  operator-facing feature with zero canonical description. SCHEDULE (doc).

### C6-09 — Toast notifications auto-dismiss in 4s with no close button and no keyboard-focus pause  [SEV: MED | CONF: High | a11y/UX]
- Lanes: designer F1.
- `apps/web/src/components/ui/sonner.tsx:13-37` (+ root `layout.tsx:149`). sonner default 4s lifetime,
  `closeButton` never set → NO toast in the product has a dismiss control; keyboard focus does not
  pause the countdown (only mouse hover / pointerdown). Upload can fire 4 stacked warning toasts; DB
  backup errors show raw unbounded server strings that vanish in 4s.
- Fix: pass `closeButton` to root `<Toaster />`; longer/Infinity duration for error+warning. SCHEDULE.

### C6-10 — Admin data tables never set `scope="col"` on header cells  [SEV: LOW-MED | CONF: High | a11y]
- Lanes: designer F2. `apps/web/src/components/ui/table.tsx:68-79` + 3 data tables. WCAG H63 / SC 1.3.1.
- Fix: default `scope="col"` in the shared `TableHead` primitive (one place fixes all). SCHEDULE.

### C6-11 — LR upload route behavior harness covers only 2 of many failure branches  [SEV: MED | CONF: High | tests]
- Lanes: test-engineer F1. `lr-upload-route-behavior.test.ts` + route.ts (restore-guard ×2, 429 quota,
  507 disk, 411 content-length, GPS-strip 422 all source-string-only). Harness now exists to test
  cheaply. SCHEDULE (add 4 `it()` blocks; test file NOT peer-dirty).

### C6-12 — DB-restore child-process failure/cleanup path is source-text-only, not behavior-tested  [SEV: MED | CONF: High | tests]
- Lanes: test-engineer F2. `db-restore.test.ts:47-76` greps `failRestore` source for literal
  fragments; never simulates a real spawn/timeout/stdin failure to observe kill/unlink/keepMaintenance.
- Fix: `child_process.spawn` mock behavioral test. SCHEDULE (test; NOT peer-dirty).

### C6-13 — New privacy source-string tests can pass vacuously if module markers drift  [SEV: LOW | CONF: Med | tests/privacy]
- Lanes: critic F5 + test-engineer F4 (agreement). `privacy-fields.test.ts` `sourceBetween(...)`
  extraction can return empty → leak regex matches nothing → passes while leaking; also assumes the
  table is always imported as literal `images`.
- Fix: assert extracted block non-empty + contains ≥1 expected public key before the leak regex.
  SCHEDULE (test hardening; NOT peer-dirty).

### C6-14 — `/api/og` error-path response omits `X-Content-Type-Options: nosniff`  [SEV: LOW | CONF: Low | defense-in-depth]
- Lanes: feature-dev F1. `apps/web/src/app/api/og/route.tsx:264-269` — parity gap vs the per-photo OG
  route and every other public route. Not exploitable (static literal body). SCHEDULE (one-liner).

### C6-15 — Three `UPLOAD_ORIGINAL_ROOT`-pattern env overrides undocumented (`UPLOAD_ROOT`, `TOPIC_RESOURCES_ROOT`, `TOPIC_RESOURCES_TMP_ROOT`)  [SEV: LOW | CONF: Med | docs]
- Lanes: document-specialist F3. Test/sandbox path overrides mirroring the documented pattern.
  SCHEDULE (doc, small).

### C6-16 — AGENTS.md test-count "2000+ unit tests" stale (actual ~3168)  [SEV: LOW | CONF: High | docs]
- Lanes: document-specialist DOC5-01 reconfirm. apps/web/README copy was fixed (C4-40); AGENTS.md:37
  copy still stale. SCHEDULE (one-liner). [Same partial-fix pattern flagged before.]

### C6-17 — `check-action-origin` scanner clears but never restores rate-limit state around `trackAnalyticsDbWrite`  [SEV: LOW | CONF: Med | tooling]
- Lanes: critic F4. `scripts/check-action-origin.ts:774-778,983-989`. Direction is fail-safe
  (over-strict only, never a security miss) but can false-fail a gated action that mutates after an
  analytics call; misleading name (`restoreOnlyRateLimitState` clears, not restores). DEFER (LOW,
  no live trigger; touching a security gate scanner needs care). Exit: a real over-strict CI failure.

### C6-18 — `processing_error` permanent-failure UPDATE lacks the `processed = false` guard its siblings use  [SEV: LOW | CONF: Med | correctness/defense-in-depth]
- Lanes: tracer F2. `image-queue.ts` permanent-failure catch branch (PEER-DIRTY). Not currently
  exploitable (quiesce clears retry timers before restore id-reuse). DEFER (peer-dirty image-queue.ts;
  defense-in-depth). Exit: peer work lands + a new id-reuse trigger, or next image-queue cycle.

### C6-19 — Truncated metadata (camera/lens/filename) recoverable only via mouse-hover `title`  [SEV: LOW-MED | CONF: Med | a11y]
- Lanes: designer F3. `info-bottom-sheet.tsx:413,419`, `photo-viewer.tsx:806,812`,
  `image-manager.tsx:494`, `upload-dropzone.tsx:537`. Keyboard/touch users can't read truncated text.
  DEFER to an a11y batch (multi-component Tooltip wrap; aligns with C96-13). Exit: AT/keyboard-user
  report OR next a11y label batch.

### C6-20 — Smart-collection predicate compilation has no compiled-SQL cost ceiling on always-dynamic `/c/[slug]`  [SEV: LOW | CONF: Low-Med | perf]
- Lanes: perf F3. Latent until an authoring UI ships (rows are DB-INSERT-only today). DEFER, chained
  to C1-25(a). Exit: Collections authoring UI ships → add save-time complexity ceiling/caching.

### C6-21 — Bulk photo uploads always send one file per server-action call  [SEV: LOW-MED | CONF: Med | perf]
- Lanes: perf F2. Server already batches `formData.getAll('files')`; client sends 1/call → N× admin
  auth+lock+config overhead. DEFER (perf; bandwidth dominates at photo scale; sequential constraint is
  the already-deferred C4-10). Exit: many-small-file / high-DB-latency perceived-lag report.

### C6-22 — Login rate-limit: in-memory idle-gap reset vs DB aligned-window reset diverge at process-restart-near-boundary  [SEV: LOW | CONF: Med | security/tuning]
- Lanes: tracer F3. Narrow timing coincidence (restart AND window boundary) briefly hands a fresh
  budget; not a general bypass. DEFER (tuning). Exit: observed brute-force incident OR rate-limit redesign.

### C6-23 — Schema migration runs at container boot with no cross-process advisory lock  [SEV: LOW | CONF: Med | reliability]
- Lanes: architect F3. `migrate.js` has 0 `GET_LOCK`; two overlapping migrate runs (init during boot,
  overlapping deploy, CI parallel) can `ER_DUP_KEYNAME`/half-apply reconcile. Theoretical in the
  single-instance topology. DEFER (LOW; touching migration machinery is risky). Exit: observed
  concurrent-migrate failure OR a migration-machinery cycle.

### C6-24 — Two divergent process-local singleton-state patterns, no stated rule  [SEV: LOW | CONF: High (existence)/Low (prod impact) | architecture]
- Lanes: architect F4. `globalThis[Symbol.for]` registries vs plain `let cache` (config/settings-hash/
  serve-upload). Dev-HMR duplication + partial invalidation risk; prod standalone unaffected. DEFER
  (maintainability). Exit: a real duplicated-cache staleness bug OR a config-cache refactor.

### C6-25 — Wiki drift: two `.omc/wiki/*` pages still claim CLIP semantic search "LIVE in production"  [SEV: LOW-MED | CONF: High | docs]
- Lanes: document-specialist (AGG-C10-19/20 reconfirm). `clip-semantic-search-us-p51.md:15`,
  `gallerykit-architecture-overview.md:33`, and the reconcile-lesson wiki page still describe pre-FDR-01
  behavior. Already scheduled by the peer's cycle-10 plan (AGG-C10-19/20). DEFER to peer ownership
  (avoid double-editing). Exit: peer cycle-10 closes it, else fold next docs cycle.

### C6-26 — Edit-metadata dialog lacks the settle-before-close guard its sibling delete flows have (stale save can clobber a different image's edit)  [SEV: MED | CONF: High | correctness/UX]
- Lanes: code-reviewer F1 (retry lane).
- `apps/web/src/components/image-manager.tsx:274-317, 611-616, 663-664`.
- The metadata-edit `Dialog` (unlike the delete `AlertDialog` flows retrofitted with COR-R4C16-01
  settle-before-close) unconditionally closes on ESC/backdrop/Cancel and `isSavingEdit` is a single
  component-wide boolean. A save on Image A left in-flight, then Cancel + Edit on Image B, leaves B's
  Save button falsely stuck "Saving…"; when A's response lands it force-closes B's open dialog
  (`setEditingImage(null)`) discarding B's edits with an "Image updated" toast that refers to A. The
  repo's `alert-dialog-action-settle.test.ts` scanner only matches `<AlertDialogAction`, so the plain
  `Dialog`/`Button` flow is structurally invisible to it. Same lower-severity gap on the batch-add-tag
  Dialog (single instance → self-only false state).
- Fix: block `onOpenChange(false)` + disable Cancel while `isSavingEdit` (mirror the delete flows), OR
  scope in-flight state to the target image id and only let a response mutate `editingImage` when the
  id still matches. Optionally extend the settle scanner to plain `Dialog` async-button flows.
  `image-manager.tsx` is NOT peer-dirty → SCHEDULE.

### C6-27 — `titlePrefix` bulk-edit field is named/commented as a prefix but performs an exact title set  [SEV: LOW | CONF: Med | maintainability]
- Lanes: code-reviewer F2 (retry lane).
- `apps/web/src/lib/bulk-edit-types.ts:14`, `apps/web/src/app/actions/images.ts:1083-1120,1220`,
  `apps/web/src/components/bulk-edit-dialog.tsx:148`. No live behavior bug (UI label is just "Title"
  and matches the exact-set behavior); a future maintainer could assume prefix-concat semantics.
- Fix: rename `titlePrefix`→`title` across type/variable/audit-key/comments. DEFER (LOW; the audit-log
  field `titlePrefixMode` rename touches audit records/tests — naming cleanup, not a bug). Exit: next
  bulk-edit-touching cycle, OR a maintainer trips on the naming.

### C6-28 — `OnThisDayWidget` computes "today" from the server clock (UTC by default), not the visitor's timezone  [SEV: MED | CONF: High | correctness]
- Lanes: debugger F1 (retry lane).
- `apps/web/src/lib/on-this-day-date.ts:6-11`, `apps/web/src/components/on-this-day-widget.tsx:15-16`.
- `getLocalMonthDay()` defaults to `new Date()` resolved in the Node process TZ; the server component
  runs on a `revalidate=0` page and neither Dockerfile nor compose sets `TZ`, so the shipped container
  defaults to UTC. For a KST audience (the demo/i18n locale), 00:00-08:59 KST shows YESTERDAY's
  on-this-day content. Inconsistent with `exif-datetime.ts` which explicitly pins `timeZone:'UTC'` for
  stored dates. Distinct from the known `MONTH()/DAY()` scan-cost note (AGG-C10-0x).
- Fix: (a) document/require operators set `TZ` (Node honors `process.env.TZ`) — minimal, matches the
  self-hosted single-timezone model; or (b) make "today" client-driven. DEFER (MED; the correct fix is
  a client/server-boundary design decision for a minor widget; the TZ-env mitigation needs an operator
  default call). Exit: on-this-day made client-driven, OR a `TZ` operator-config note ships, OR a
  visitor reports wrong on-this-day content.

## Known/deferred items reconfirmed still open (not re-counted as NEW)

- AGG-C10-01 nested PostCSS vuln (peer cycle-10 owns), AGG-C10-06 embedding text-vs-blob (schema
  peer-dirty), AGG-C10-07 reconcile 2nd schema authority, AGG-C10-08..11 test-harness gaps,
  AGG-C10-12 maintenance-scheduler no SIGTERM stop (peer-dirty instrumentation), AGG-C10-14 nginx
  drift (operator), AGG-C10-15/16 timeline/search a11y labels (peer-dirty pages), C1-25(a) Collections
  UI, C2-27/C2-50 storage quarantine, C80-06/C2-24b site-config build inlining, C3-08op nginx apply.
- Honesty invariants skeptically re-verified and HOLD (critic + verifier): color/HDR admin-gating,
  privacy `_SensitiveKeysInPublic` compile guard, shared `sanitizeForOg` (3 consumers), hdr-filenames
  un-wired, COLOR_IMPACTING_KEYS=9, advisory-lock scoping, migration post-conditions.

## Process notes

- feature-dev F2: the briefing's hand-maintained peer-dirty list drifted from live `git status`
  (`cycle-10-source-contracts.test.ts`, `migrate-reconcile-coverage.test.ts`, `public-actions.test.ts`
  are also peer-dirty). Future cycles should read live `git status` for the peer-dirty set.

## AGENT FAILURES

- `code-reviewer` (opus) and `debugger` (opus): the initial spawns did not write their output file
  within ~35 min (consistent with the feature-dev-code-reviewer hang pattern noted by the orchestrator
  in cycles 3-4, here manifesting on the two heaviest opus lanes). Both were RE-SPAWNED once with a
  tighter sonnet-scoped prompt per the PROMPT 1 retry-once rule.
  - `code-reviewer` retry RETURNED (`code-reviewer.md`) and added two NEW findings (C6-26 MED/High
    edit-dialog settle race, C6-27 LOW naming) — both folded into the deduped list above and into the
    plan/deferred registers.
  - `debugger` retry RETURNED (`debugger.md`) and added one NEW finding (C6-28 MED/High OnThisDay
    server-timezone) — folded into the deduped list above and deferred. All other flows it traced
    (restore fencing, serve-upload fd-free 304, image-zoom role self-match, photo-navigation reset
    coordination, drain loops, pagination/bounded-map boundaries) were found correct, no regressions.
