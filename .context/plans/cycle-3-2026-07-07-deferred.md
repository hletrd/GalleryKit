# Run-10 Cycle 3/100 Deferred Findings

Start HEAD: `e08b6f97`. Review aggregate: `.context/reviews/cycle-3-2026-07-07/_aggregate.md`.

Repo rules consulted before deferral (in order): `CLAUDE.md`, `AGENTS.md`,
`.context/plans/README.md` (incl. the carry-forward age-budget policy) and prior deferred
registers; `CONTRIBUTING.md`/`.cursorrules` are absent. Deferrals preserve original
severity/confidence (no downgrade-to-defer). When picked up, repo policy applies
(GPG-signed conventional+gitmoji commits, no `--no-verify`, full gates). No security,
correctness, or data-loss finding is deferred below: every correctness-class C3 finding
(C3-01..C3-14) is scheduled in `cycle-3-2026-07-07-plan.md`; the deferrals here are
performance opportunities, operator-side actions not executable from this repo, process
notes, needs-validation items, and accepted-by-design boundaries.

## Newly deferred (cycle-3)

### C3-17 — trim the client-serialized i18n catalog to public namespaces (perf PERF3-05)
- Original severity/confidence: Low-Med / High (mechanism confirmed; ~21 KB raw / ~5-8 KB
  gzipped admin+server-only strings shipped per anonymous page view).
- Citations: `apps/web/src/app/[locale]/layout.tsx:88,129`; `src/i18n/request.ts:13`.
- Reason: a namespace-filtered `NextIntlClientProvider` payload requires a complete,
  guarded inventory of every client-side `useTranslations()` namespace — a missed
  namespace ships raw key strings to production users. The safe version needs its own
  scanner/contract test (new test infrastructure) and the risk-to-benefit at current
  payload size does not justify landing it alongside this cycle's already-wide surface.
- Exit criterion: measured payload/hydration concern (LCP/INP regression attributable to
  flight-payload size), OR the admin namespace grows past ~40 KB raw, OR an i18n
  namespace-inventory contract test lands (making the pick-list mechanically safe) —
  whichever comes first schedules the provider split.

### C3-30 — updateTag/deleteTag opposite lock order (perf PERF3-08)
- Original severity/confidence: Low / High (mechanism) with very low likelihood.
- Citations: `apps/web/src/app/actions/tags.ts:91,100-105,167-173`.
- Reason: requires two admins mutating the SAME tag concurrently; InnoDB detects the
  deadlock and rolls one transaction back (generic action error, no hang/corruption).
  A lock-ordering prelock or retry wrapper is real transaction-semantics churn on the
  most data-destructive tag action for a never-observed failure.
- Exit criterion: any observed `ER_LOCK_DEADLOCK` in production logs attributable to tag
  mutations — then add the tags-first prelock (or a retry-once wrapper) with tests.

### C3-31 — SQL-restore scan re-runs the regex battery over the 1 MB carry-over tail per chunk (perf PERF3-09)
- Original severity/confidence: Low (informational) / High.
- Citations: `apps/web/src/lib/sql-restore-scan.ts:267-278`.
- Disposition: ACCEPTED-BY-DESIGN candidate, recorded so nobody "optimizes" the
  security-critical tail re-scan away without understanding it. Restore-only, admin-gated,
  single-shot, under the maintenance marker.
- Exit criterion: a measured restore slowdown on a very large dump attributable to the
  scan (then track a high-water offset so only the unscanned suffix re-enters the battery).

### C3-32 — dev-console "script tag while rendering React component" warning (designer DES3-02)
- Original severity/confidence: Low / Medium (root cause not fully isolated; likely a
  React 19 dev-build heuristic on the documented JSON-LD `dangerouslySetInnerHTML` pattern).
- Citations: `apps/web/src/app/[locale]/(public)/page.tsx:215-231` and sibling JSON-LD sites.
- Reason: needs-validation item — confirming whether it fires in a production build
  requires a real browser console against `next build && next start`, which this cycle's
  budget does not cover; no user-visible impact was observed and JSON-LD has no client
  behavior to break.
- Exit criterion: reproduce against a production build with a real browser console; if the
  warning appears there too, schedule the investigation (Script-component variant or
  framework issue reference); if dev-only, reclassify as accepted framework noise.

### C3-33 — e2e spec committed one commit before its implementation (test TEST3-06)
- Original severity/confidence: Low / Medium (bisectability/process note; no gap at HEAD).
- Citations: `apps/web/e2e/focus-restore.spec.ts` (added `2c82a69c`) vs `fc21007a`.
- Disposition: recorded as a process note — no code change exists to make; the guidance
  (land test with or after its implementation, or flag the temporary red state in the
  commit message) is adopted going forward.
- Exit criterion: n/a (process note); a recurrence in a future cycle's review re-raises it
  as a commit-protocol finding.

### C3-35 (redesign half) — retire the migrate.js compensation machinery via a one-time journal `when` rewrite (architect ARCH3-05)
- Original severity/confidence: Low / Medium (maintainability trend).
- Citations: `apps/web/scripts/migrate.js`; `apps/web/drizzle/meta/_journal.json` (idx-7
  historical inversion).
- Scheduled part shipping this cycle: the DDL-only reconcile invariant is documented as
  first-class in the CLAUDE.md runbook (WP1).
- Reason: rewriting frozen journal metadata is a migration-machinery redesign touching the
  production `__drizzle_migrations` baseline — it needs its own dedicated design/verify
  window, not a slot in a 16-WP cycle.
- Exit criterion: the next migration-machinery incident (any silent-skip or baseline bug
  recurrence), OR a dedicated maintenance window is scheduled — either triggers the
  monotonic-journal rewrite design.

### C3-36 — `data.ts` god-module split (architect ARCH3-06)
- Original severity/confidence: Low / Medium (maintainability trend; no runtime cycle —
  verified type-only back-imports).
- Citations: `apps/web/src/lib/data.ts` (1860 LOC; hosts feed/sitemap queries, shared-group
  view buffer state, SEO settings alongside hot listing queries).
- Reason: governed by the existing C1-32 incremental-drainage policy — peel a concern only
  when a cycle already touches it; a big-bang split is prohibited churn.
- Exit criterion: each future cycle that touches a separable concern (feed/sitemap,
  view-buffer, SEO settings) moves that concern to a sibling module in the same change.

### C3-08op — production application of the nginx public/nextimage limiter config (critic CRIT3-01, operator half)
- Original severity/confidence: Medium / Med-High.
- Citations: `apps/web/nginx/default.conf`; cycle-2 ledger entry for C2-06.
- Scheduled part shipping this cycle: the apply+verify runbook (WP10) and the honest
  ledger reclassification ("shipped config; prod-apply pending").
- Reason: deploys do not touch host nginx by design; reloading the production edge from
  this loop without operator confirmation is a service-configuration change gated by the
  destructive-action policy. The repo can ship config + runbook, not the reload.
- Exit criterion: operator runs the WP10 runbook (nginx -t, reload, 429 probe) and the
  next cycle's post-deploy verification records the evidence — then C2-06/C3-08 close.

### C3-12op — LB-fronted realip configuration for nginx limiter zones (tracer TRC3-05, operator half)
- Original severity/confidence: Medium-High contingent / High (mechanism).
- Citations: `apps/web/nginx/default.conf:1-10` (`$binary_remote_addr` zones); topology
  contract comment.
- Scheduled part shipping this cycle: the topology-contract comment gains the realip half
  (WP10) so the documented remediation is complete.
- Reason: whether an LB fronts the production nginx is the same operator-only fact as
  C1-11 (still unconfirmed); shipping `set_real_ip_from` for a hypothetical LB would
  itself be wrong (trusting a spoofable header when nginx IS the edge).
- Exit criterion: chained on C1-11's operator topology confirmation. If LB-fronted, apply
  BOTH halves per the reconciled comment; if edge-direct, close as not-applicable.

### C3-37 / C3-38 — security lane INFO observations (SEC3-01, SEC3-02)
- Original severity/confidence: INFO / High and INFO / Medium.
- Disposition: recorded, no action required by the lane's own analysis (`/_next/image`
  exclusion is intentional + `limit_conn`-backstopped — and WP10 adds a dedicated zone
  anyway; the admin-location regex drift affects edge-tightness only, never authorization).
- Exit criterion: n/a (informational). A future admin mutation needing a >2 MiB body gets
  its own nginx location per the documented pattern.

### C2-37 residual — runtime `IMAGE_BASE_URL` has no boot-time validation (critic CRIT3-07 root-cause note)
- Original severity/confidence: Low / Medium (availability residual behind the shipped
  a4a2d250 degrade path; a malformed value now silently degrades CDN images with a
  once-per-process log instead of 500ing).
- Citations: `apps/web/src/lib/content-security-policy.ts` (`buildCspSafely`);
  `next.config.ts:8,27` (build-time validation exists; runtime container env is unchecked).
- Reason: a boot-time runtime check is a new startup-validation surface (instrumentation
  hook) whose failure semantics (warn vs refuse-to-boot) need a deliberate decision; the
  current behavior fails safe and logs.
- Exit criterion: an ops incident where a malformed runtime `IMAGE_BASE_URL` goes
  unnoticed past the once-per-process log, OR the next instrumentation-touching cycle
  folds in a boot-time env sanity log line.

## Deferral-register updates (prior cycles, new evidence this cycle)

- **C2-31 (scanner tokenizer): exit criterion FIRED** — cycle-2's `af3b2f7d` had to
  rewrite `next-config-uploads-headers.test.ts`'s string-offset boundary because prose
  comments false-positived it (CRIT3-06), which is the register's own trigger ("the next
  scanner false-positive/ossification instance"). Per the register, the concrete-instance
  tokenizer rework is SCHEDULED this cycle (WP12: brace-balanced nginx block parser +
  relaxing the `api-csp-header.test.ts` rule-count pin). The REMAINDER (tokenizing the
  lint-gate scanners `check-public-route-rate-limit` et al.) stays deferred with the same
  exit criterion, now one instance closer; C2-07 remains chained on it.
- **C2-14b (embedding matrix cache): constraint rider added** — PERF3-04: any future
  implementation MUST copy decoded vectors into cache-owned storage (zero-copy views pin
  entire mysql2 wire buffers). Deferral and exit criterion otherwise unchanged.
- All other cycle-1/cycle-2 deferrals were re-observed by the cycle-3 lanes with **no new
  evidence invalidating any deferral or exit criterion** (perf lane re-checked C2-12/14b/
  15/16/20/21/28/55 explicitly; designer re-confirmed C2-53/C2-54 unchanged).

## Carry-forward register

- Consolidated (NEW this cycle, C3-27/CRIT3-08): `.context/plans/deferred-carry-forward.md`
  tabulates every OPEN deferred item across the cycle-96 / cycle-1 / cycle-2 / cycle-3
  registers with first-deferred cycle + age so the 8-cycle age budget is mechanically
  checkable. The per-cycle registers remain the authoritative detail records; the table is
  the index.
- Age-budget check this cycle: no carry-forward High crosses 8 cycles unchanged (run-10
  items are ≤ 2 cycles old; the C96 register's High items were drained or reclassified in
  run-10 cycle-1).
