# Run-10 Cycle 4/100 Deferred Findings

Start HEAD: `ec433dc4`. Review aggregate: `.context/reviews/cycle-4-2026-07-07/_aggregate.md`.

Repo rules consulted before deferral (in order): `CLAUDE.md`, `AGENTS.md`,
`.context/plans/README.md` (age-budget + C1-32 drainage policies, incl. the MED-checkpoint
extension this cycle adds), `deferred-carry-forward.md`, prior deferred registers;
`CONTRIBUTING.md`/`.cursorrules` are absent. Deferrals preserve original severity/confidence
(no downgrade-to-defer). When picked up, repo policy applies (GPG-signed conventional+gitmoji
commits, no `--no-verify`, full gates). No security, correctness, or data-loss finding is
deferred below: every correctness-class C4 finding (C4-01..09, C4-12, C4-15, C4-19..21,
C4-23, C4-29, and all doc-accuracy items) is scheduled in `cycle-4-2026-07-07-plan.md`; the
deferrals here are performance/concurrency redesigns, operator-side actions, needs-validation
items, process/trend notes, and accepted-by-design boundaries.

## Newly deferred / closed dispositions (cycle-4)

### C4-10 — upload-contract lock serializes all uploads deployment-wide (perf PERF4-04)
- Original severity/confidence: MED / Med (likely).
- Citations: `apps/web/src/app/actions/images.ts:198→~651`,
  `apps/web/src/app/api/admin/lr/upload/route.ts:272→608`,
  `apps/web/src/lib/upload-processing-contract-lock.ts:9-56`.
- Reason: the fix shape is reader/writer lock semantics (uploads shared, settings-change
  exclusive) or shrinking the exclusive window — a transaction-semantics redesign on the
  single most data-critical serialization path, with no observed incident: single-admin
  sequential dropzone flows (the shipped product reality) are unaffected.
- Exit criterion: a real concurrent-upload UX report (two admins / parallel LR clients
  hitting the misleading `uploadSettingsLocked`), OR a product decision to support
  parallel external upload clients — either schedules the reader/writer split with tests.

### C4-11 — LR route retains multi-hundred-MiB blobs past the parse slot (perf PERF4-05)
- Original severity/confidence: MED / Med (likely).
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:60-74,180-186,348,489`.
- Reason: the fix (hold the slot / add a semaphore until the original is flushed and the
  `File` reference dropped) changes the LR route's concurrency contract and needs memory
  measurement to size correctly — the C1-33/C2-20 measurement class this register already
  tracks; staggered multi-client LR upload is not an observed workload.
- Exit criterion: C1-33's RSS trace lands, OR an RSS/OOM incident during LR uploads —
  either schedules the retention-window fix sized by real numbers.

### C4-13 — inert nginx limiter config accumulation / no repo-side verification (critic INFO4-08)
- Original severity/confidence: MED / Med.
- Citations: `apps/web/nginx/default.conf` (zones `public`, `nextimage`); cycle-2/3 ledgers.
- Reason: the reload itself is the C3-08op operator action (destructive-action gated —
  unchanged); the NEW element here (a read-only >burst 429 probe the repo could run
  post-deploy) only produces a meaningful signal AFTER the operator applies the config, so
  it is sequenced behind C3-08op rather than schedulable now.
- Exit criterion: C3-08op's operator apply happens → the next cycle adds the read-only
  429-probe verification to the post-deploy checklist and closes both halves together.

### C4-16 — image-queue ProcessingQueueState god-object / O(4)-site reset obligation (architect ARCH4-03)
- Original severity/confidence: LOW-MED / High (erosion trend).
- Citations: `apps/web/src/lib/image-queue.ts:317-414` (17-field state; reset fan-out).
- Reason: the fix is a typed `{durable|transient}` partition + single
  `resetTransientQueueState` helper — a refactor of every lifecycle site that is safest
  landed in a cycle NOT already touching the queue's semantics (this cycle's WP9 touches
  cursor logic; stacking a state-model refactor on top raises regression risk for zero
  user-visible gain this cycle). Matches the architect's phased plan (Cycle B).
- Exit criterion: the next image-queue-touching cycle folds the partition+helper in the
  same change (C1-32 drainage policy), OR a fifth lifecycle-site reset bug lands first.

### C4-17 — retention sweeps parasitic on the image-queue gcInterval (architect ARCH4-04)
- Original severity/confidence: LOW-MED / High.
- Citations: `apps/web/src/lib/image-queue.ts:1229-1239` (hourly timer armed only after
  queue bootstrap), `instrumentation.ts:25-29`.
- Reason: the fix is extracting `startMaintenanceScheduler()` owned by
  `instrumentation.ts` (architect's Cycle A) — a lifecycle-ownership refactor. Under
  normal operation bootstrap succeeds and all sweeps run; the erosion fires only when
  bootstrap is stuck (ECONNREFUSED loop / restore window), which is already an
  operator-visible outage state. Not schedulable on top of this cycle's already-wide
  queue+SW+guard surface without diluting verification.
- Exit criterion: SCHEDULED-NEXT — cycle 5 should take the maintenance-scheduler
  extraction as a WP (this row is the pickup note); re-opens immediately if any retention
  sweep is observed not running in production before then.

### C4-18 — no component-behavior test harness; source-text-pin class keeps growing (test TEST4-03)
- Original severity/confidence: LOW-MED / High (trend; ratio flat at 43.3%, count +2 files).
- Citations: `apps/web/src/__tests__/optimistic-image-retry.test.ts` (self-documents the
  gap), `similar-route-embedding-copy.test.ts`; metric history c2 139/307 → c3 143/330 →
  c4 145/335.
- Reason: adopting a jsdom/RTL harness is test-infrastructure investment with repo-wide
  conventions to set (which components, what to mock); not a bug fix. The C2-31 remainder
  (lint-gate scanner tokenizer) stays under its own unchanged row.
- Exit criterion: the next cycle that fixes component behavior reachable only by a
  source-text pin must evaluate a minimal RTL/jsdom harness IN that WP (adopt or record
  why not) — repeated refusal without evaluation re-raises this as a process finding.

### C4-22 — per-photo OG card self-fetches its own derivative over public HTTPS (perf PERF4-07)
- Original severity/confidence: LOW / Med-High (likely).
- Citations: `apps/web/src/lib/og-photo-fetch.ts:72-87`, `api/og/photo/[id]/route.tsx:188-201`.
- Reason: swapping the transport to a capped `fs.readFile` re-opens the settled
  budget/timeout design and needs serve-upload-style containment replicated in the OG
  path; the current design works and its cost is bounded by the documented budgets.
- Exit criterion: a hairpin-DNS/self-origin OG incident (photo cards degrading to the
  site-default fallback), OR a measured cold-OG latency complaint — either schedules the
  fs-read transport with containment tests.

### C4-24 — admin upload previews decode full-resolution originals (perf PERF4-11)
- Original severity/confidence: LOW / Med-High (likely).
- Citations: `apps/web/src/components/upload-dropzone.tsx:503,524-532,284-286`.
- Reason: admin-only surface, sequential upload masks most of the cost; thumbnailing
  previews (createImageBitmap/canvas downscale) is new client-side machinery. Same class
  as the deferred C2-28 admin-table perf row.
- Exit criterion: an admin perceived-lag report during bulk upload, OR the next
  admin-surface perf cycle (fold with C2-28).

### C4-25 (code half) — SW never caches opaque/CDN-origin image responses (tracer TRC4-07)
- Original severity/confidence: LOW / Med.
- Citations: `apps/web/public/sw.template.js:51-53,304`.
- Reason: supporting opaque-response caching means storing padding-opaque bodies with
  unverifiable sizes in the LRU (browsers over-report opaque sizes massively), which would
  wreck the 50 MB accounting the cap depends on; the honest fix for a CDN deployment is a
  design decision (skip SW caching entirely for cross-origin + document, or same-origin
  proxy). The DOC half (CLAUDE.md callout) is scheduled in WP12.
- Exit criterion: `IMAGE_BASE_URL` is actually configured on a production deployment —
  the SW caching story for that topology must then be decided before enabling.

### C4-26 — SW eviction recency read outside the meta mutation queue (tracer TRC4-08)
- Original severity/confidence: LOW / Low-Med (needs-validation; narrow, self-healing).
- Citations: `apps/web/public/sw.template.js:263` (`evictExpiredCachedImage` bare
  `getMeta()` read) vs `:98-104` (`withMetaMutation`).
- Disposition: folded into WP5/run-10 c4. `evictExpiredCachedImage` now reads LRU meta
  through `withMetaMutation` in both `apps/web/public/sw.template.js` and
  `apps/web/src/lib/sw-cache.ts`, so this row no longer enters carry-forward.
- Exit criterion: closed by the fold; re-open only on a reproduced spurious eviction at
  the staleness boundary.

### C4-28 — view-count SIGTERM flush reports success when every write failed (tracer TRC4-13)
- Original severity/confidence: LOW / Med (accepted-by-design data loss; signal gap only).
- Citations: `apps/web/src/lib/data.ts:127-152,222-249`, `instrumentation.ts:51-59,74`.
- Reason: the buffer is documented best-effort/non-audit-grade (CLAUDE.md Database Schema);
  making the exit code reflect a failed best-effort flush would fail otherwise-clean
  shutdowns for an accepted-loss store — a monitoring-semantics product decision.
- Exit criterion: process-supervisor monitoring starts keying off exit codes for flush
  health, OR the buffer is promoted to durable storage (either re-opens the signaling).

### C4-30 — share-limiter has no e2e-reachable reset; merged spec trades granularity (test TEST4-04)
- Original severity/confidence: LOW / Likely.
- Citations: `apps/web/e2e/swipe-visual-reset.spec.ts`; `apps/web/src/lib/rate-limit.ts:96-97,356-358`;
  `playwright.config.ts:57-58`.
- Reason: a test-mode limiter bypass is a security-adjacent escape hatch that must be
  designed not to weaken production (env-gating pattern review needed); WP7 removes the
  biggest budget consumer (per-step SSR), which materially de-pressurizes the class.
- Exit criterion: the next /g/ or /s/ e2e flake instance after WP7 lands — then design the
  env-gated bypass + split the merged spec back into independent tests.

### C4-09d — durable embedding-scan cursor + per-row failure marking (debugger DBG4-03 / tracer TRC4-05 / critic MED4-04 root)
- Original severity/confidence: MED / High (structural; low practical trigger at current scale).
- Citations: `apps/web/src/lib/image-queue.ts:353,436,532-588`; deploy policy in CLAUDE.md.
- Reason: WP9 ships the cheap halves (model-version reset + documented restart caveat).
  Durable persistence (admin_settings row) and per-row failure marking are schema/state
  design decisions whose benefit only materializes with a ≥`SEMANTIC_SCAN_LIMIT`
  permanently-un-embeddable backlog — an abnormal state for this deployment class.
- Exit criterion: a real permanently-un-embeddable backlog ≥ SEMANTIC_SCAN_LIMIT observed
  in production (continuation log spamming across deploys), OR semantic search enabled in
  production at a scale where wrap-around re-scans are measurable.

### SEC4-03 — O_NOFOLLOW / fd-realpath re-check on the serve-upload open (security)
- Original severity/confidence: LOW / Med (hardening outside the stated threat model).
- Citations: `apps/web/src/lib/serve-upload.ts:296`.
- Reason: exploitation requires a hostile local writer inside
  `public/uploads/{jpeg,webp,avif}`, which the documented threat model excludes (app
  writes only UUID names and rejects symlinks at write time); pre-existing, not introduced
  this cycle. Recorded by the security lane itself as optional/deferred-class.
- Exit criterion: the storage-backend product decision (C2-27) lands multi-writer or
  non-local storage, OR the threat model adds hostile-local-writer.

### C4-46 — CLAUDE.md operational-document navigability trend (critic INFO4-10)
- Original severity/confidence: INFO / Low (subjective trend; accuracy verified holding).
- Citations: `CLAUDE.md` (723 lines).
- Reason: restructuring the operational doc is an editorial project, not a finding-shaped
  fix; accuracy (the load-bearing property) was re-verified across two lanes this cycle.
- Exit criterion: an operator/agent incident traceable to failing to FIND a correct
  runbook entry that existed, OR CLAUDE.md crossing ~1000 lines.

## Recorded, no action required (INFO class, dispositions)
- C4-43 / CR4-03: migrate.js loud-fail behavior change — documented in WP1's CLAUDE.md
  note; correct trade, recorded for operator visibility.
- CR4-01: superseded by WP5 (the serialization it flags is removed).
- CR4-04: closed by WP2's `stopping` flag (recorded here so the INFO isn't re-derived).
- SEC4-01/SEC4-02: security-lane records (residual TOCTOU pre-existing + out-of-model;
  nextimage zone is a net hardening) — no action beyond SEC4-03's row above.
- C4-27: operator-facing doc note scheduled (WP12); no code lock — duplicate work
  converges via onDuplicateKeyUpdate; a shared advisory lock would couple the live queue
  to sidecar lifetimes for no correctness gain.
- C4-45: policy note scheduled (WP12: MED 16-cycle checkpoint added to plans README).
- TRC4-11b: rapid-double-swipe/orientation e2e permutations — the mechanism is
  overwrite-only (ruled safe by trace); WP11/C4-29 adds the chevron trigger; further
  permutations are not worth a session each. Re-opens with any real stale-visual report.
- C4-31/32/33/34/37/38/39/40/41: all scheduled in WP12 (listed here for the no-silent-drop
  audit trail only).

## Deferral-register updates (prior cycles, new evidence this cycle)
- **C3-35 (migrate journal redesign): new evidence attached** — ARCH4-06: the machinery is
  now a 4-branch decision tree with a documented manual-resolution sharp edge; exit
  criterion unchanged (incident OR dedicated maintenance window). WP1 adds a DML guard but
  does NOT retire the root non-monotonic-journal compensation machinery.
- **C3-36 / C1-32 (god-module drainage): frontier widened** — ARCH4 layering sweep:
  `process-image.ts` is now 1829 LOC (≈ `data.ts`'s 1860), with `image-queue.ts` 1309 and
  `admin-backfill-runner.ts` 930 close behind. Same policy governs: peel one concern in
  the next cycle that touches each file. No new row (policy extension, not new finding).
- **C2-14b rider: verified enforced** — PERF4 lane confirmed the mandatory-copy constraint
  is now in code + documented (`clip-embeddings.ts:117-131`). Row unchanged.
- **C3-32: exit criterion FIRED and CLOSED** — DES4-P3 reproduced against a production
  build: zero console output; the JSON-LD warning is dev-only (React 19 dev heuristic).
  Row removed from the carry-forward register this cycle (WP13).
- **C4-26: folded and CLOSED** — WP5 serialized the service-worker eviction recency read
  behind `withMetaMutation` in both the template and TypeScript mirror. Row removed from
  the carry-forward register this cycle (WP13 correction).
- All other carry-forward rows re-observed with no exit criterion fired (perf lane
  explicitly re-checked C2-12/15/16/20/21/28/55, C3-17/28/30/31; designer re-confirmed
  C2-53/C2-54 out of scope unchanged).
