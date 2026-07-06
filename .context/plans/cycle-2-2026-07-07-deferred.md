# Run-10 Cycle 2/100 Deferred Findings

Start HEAD: `642c5091`. Review aggregate: `.context/reviews/cycle-2-2026-07-07/_aggregate.md`.

Repo rules consulted before deferral (in order): `CLAUDE.md`, `AGENTS.md`,
`.context/plans/README.md` (incl. the carry-forward age-budget policy) and prior deferred
registers; `CONTRIBUTING.md`/`.cursorrules` are absent. Deferrals preserve original
severity/confidence. When picked up, repo policy applies (GPG-signed conventional+gitmoji
commits, no `--no-verify`, full gates). No security, correctness, or data-loss finding is
deferred below: every deferral is a performance opportunity, a product decision, a
test-infra investment, or an accepted-by-design boundary whose documentation ships this
cycle in WP6/WP25.

## Newly deferred (cycle-2)

### C2-07 — extend the public rate-limit lint gate to `page.tsx` (critic CRIT-03)
- Original severity/confidence: Medium (process) / High.
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts`; evidence chain in
  `.context/reviews/cycle-2-2026-07-07/critic.md`.
- Reason: the substantive gap it steers around (unthrottled SSR pages) is addressed this
  cycle at the honest layer (WP6: nginx edge limiter + documented boundary). Extending a
  source-shape scanner to RSC `page.tsx` is new test-infra with high false-positive risk —
  the same scanner-ossification class the same lane flagged in C2-31; building MORE regex
  gating before the tokenizer rework would compound it.
- Exit criterion: either the C2-31 tokenizer rework lands (then extend scope on the sound
  parser), or a future cycle adds a DB-reaching public `page.tsx` without an edge limiter —
  whichever comes first re-opens this as a scheduled item.

### C2-12 — Leaflet map renders up to 10k DOM markers with no clustering (perf PERF-02)
- Original severity/confidence: Medium (escalates toward High at scale) / High.
- Citations: `apps/web/src/components/map/map-client.tsx:120-139`, `data.ts:1714`.
- Reason: proper fix needs a new dependency (markercluster/supercluster) or a
  canvas-renderer redesign plus device validation; not safely landable alongside this
  cycle's already-wide client surface. Current production gallery (~445 photos) is far
  from the degradation threshold.
- Exit criterion: geotagged, map-visible photo count approaching ~1000, OR a measured
  multi-second `/map` mount on a mid-range device — either schedules the clustering work.

### C2-14b — TTL cache of the decoded embedding matrix for semantic/similar search (perf PERF-04, cache half)
- Original severity/confidence: Medium / High (mechanism).
- Citations: `api/search/semantic/route.ts:270-311`, `similar/[id]/route.ts:173-206`.
- Reason: the per-request decode cost is removed this cycle (WP12 zero-copy); the shared
  matrix cache adds invalidation complexity (model-version + updated_at keying) on a
  surface that is disabled by default in production.
- Exit criterion: semantic search enabled in production AND measured scan latency or DB
  read pressure attributable to the per-request MEDIUMBLOB fetch.

### C2-15 — anonymous view recording costs 4 sequential DB round-trips (perf PERF-05)
- Original severity/confidence: Medium / High (round-trip count confirmed).
- Citations: `apps/web/src/app/actions/public.ts:436-529`, `lib/rate-limit.ts:451-496`.
- Reason: the proposed `LAST_INSERT_ID(count + 1)` upsert fold changes the semantics of a
  security-relevant limiter primitive shared by login/search/share paths; landing it
  without DB-integration test infrastructure risks weakening the documented two-tier
  limiter for a latency win nobody has measured a need for at current scale.
- Exit criterion: measured view-record latency or pool pressure at scale, OR the
  introduction of DB-backed test infra (same criterion family as C1-31) — then implement
  the single-statement fold with regression tests on the limiter contract.

### C2-16 — non-sargable MONTH()/DAY() on-this-day scan per home render (perf PERF-06)
- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/lib/data-timeline.ts:97-119`; widget on
  `app/[locale]/(public)/page.tsx` (`revalidate = 0`).
- Reason: every remedy trades against a documented contract or schema: a TTL cache
  violates the CLAUDE.md "public route freshness" contract (uploads visible immediately);
  generated month/day columns or a functional index require a new migration. Both are
  product/schema decisions beyond a safe this-cycle change.
- Exit criterion: measured home-page latency attributable to the widget at gallery scale,
  OR the next schema-touching cycle folds in the generated-column index, OR a product
  decision to relax widget freshness.

### C2-20 — GPS strip reads the whole ≤200 MB original into memory (perf PERF-10)
- Original severity/confidence: Medium / High (mechanism; RSS impact unmeasured).
- Citations: `apps/web/src/lib/process-image.ts:1752`; callers in `actions/images.ts:415`,
  `api/admin/lr/upload/route.ts:416`.
- Reason: bounded-head streaming requires re-validating every scrubber's assumption that
  metadata precedes pixel data per container — a correctness-sensitive rework of the most
  rigorously bounds-checked module in the repo; sibling finding C1-33 already established
  the "measure on the deploy host first" policy for upload RSS work.
- Exit criterion: the C1-33 RSS trace happens (same instrumentation covers this), or an
  OOM/RSS incident during concurrent GPS-stripped uploads — then scope streaming or a
  strip-concurrency semaphore.

### C2-21 — feed/sitemap ORDER BY `updated_at` unindexed → filesort (perf PERF-11)
- Original severity/confidence: Medium (LOW at personal scale) / High.
- Citations: `apps/web/src/lib/data.ts:841-873,1692-1703`; `db/schema.ts:117-123`.
- Reason: the fix is a new migration (`(processed, updated_at, id)` index) — bundling a
  schema migration into this already-large cycle violates the repo's own careful
  migration-authoring runbook cadence; the surface is mitigated (feed rate-limited +
  `s-maxage=1800`; sitemap ISR 3600).
- Exit criterion: next cycle that authors a migration for any reason folds this index in,
  OR measured feed/sitemap latency at >10k processed images.

### C2-24b — make the site-config runtime mount real (or remove it) + unify precedence (architect ARCH-03, refactor half)
- Original severity/confidence: Medium / High.
- Citations: 15 `import siteConfig from '@/site-config.json'` sites;
  `docker-compose.yml` `:ro` mount; split precedence (`footer_text`/`home_link`/`locale`/
  `url`/`google_analytics_id` file-only vs DB-overridable SEO fields).
- Reason: converting to runtime `fs` reads touches middleware CSP, OG routes, layout, and
  analytics in one change and alters documented build-time semantics — a product/ops
  decision (which fields SHOULD be runtime-editable?) more than a bug fix. The honest
  doc half (mount is inert until rebuild) ships this cycle in WP25.
- Exit criterion: an operator actually needs runtime site-config edits (e.g. GA id change
  without rebuild), or a product decision unifies the config precedence model.

### C2-27 — delete or trim the unwired S3-shaped storage abstraction (architect ARCH-06)
- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/storage/{index,local,types}.ts`;
  `__tests__/storage-quarantine.test.ts` (quarantine is already test-enforced).
- Reason: CLAUDE.md's own rule keeps the module as an internal abstraction while
  forbidding documenting/exposing it; deleting vs completing it is an explicit product
  decision (same clause as the deferred C1-25(a) Collections UI decision). The quarantine
  test already prevents accidental wiring.
- Exit criterion: explicit product decision — either the storage backend integration is
  scheduled (then keep + wire), or it is ruled out (then delete the multi-backend surface).

### C2-28 — admin image table per-row memo-defeat + per-row document listeners (perf PERF-12)
- Original severity/confidence: Medium-Low / Medium-High.
- Citations: `apps/web/src/components/image-manager.tsx:502`,
  `components/tag-input.tsx:58-66,158-166`.
- Reason: admin-only surface with impact gated on large tables × large tag vocabularies;
  this cycle's client-render budget is spent on the public-facing WP14/WP15.
- Exit criterion: an admin-side perceived-lag report, or the next admin-table-touching
  cycle folds in the row memoization + delegated listener.

### C2-30 — restore drain aborts on mutation slots held through post-commit file cleanup (critic CRIT-04)
- Original severity/confidence: Low / High (validated safe-by-design; availability papercut).
- Citations: `apps/web/src/app/actions/images.ts:772`, `lib/admin-mutation-barrier.ts:76`,
  `db-actions.ts:530-597`.
- Reason: correctness is unaffected (abort > corrupt, as designed); narrowing the slot to
  the DB-commit boundary must not accidentally exempt any write path — a careful
  barrier-semantics change reviewed fresh only one cycle after the barrier landed (C1-03).
  Let the fence settle one cycle before re-scoping it.
- Exit criterion: a real spurious restore-abort incident (large delete + restore
  collision), or the next cycle that touches the mutation barrier re-scopes the slot to
  the transaction boundary with tests.

### C2-31 — scanner string-stripping should tokenize, not regex (critic CRIT-05)
- Original severity/confidence: Low / High (process/architecture tax with a dated instance).
- Citations: commit `642c5091`; `scripts/check-public-route-rate-limit.ts`;
  `api/health/route.ts:8,37` prose bent to appease the regex.
- Reason: a tokenizer rework of the lint-gate scanners is test-infra investment governed
  by the C1-32 incremental-drainage policy (adopted in `.context/plans/README.md`); doing
  it mid-cycle alongside 20+ product fixes risks gate churn.
- Exit criterion: the next scanner false-positive/ossification instance (any prose edited
  to appease a regex again) triggers the tokenizer rewrite as a scheduled item; C2-07's
  exit criterion chains on this.

### C2-35 — admin backfill lacks permanent-failure tracking (code CQ-04)
- Original severity/confidence: Low / Medium.
- Citations: `apps/web/src/lib/admin-backfill-runner.ts:407-431,487-576`.
- Reason: operator-triggered surface with bounded waste (one doomed encode attempt per
  run); a persisted failure-marker design (new column or state table) deserves its own
  small design pass rather than an ad hoc in-memory set that resets per process.
- Exit criterion: an operator report of a never-clean backfill banner in practice, or the
  next backfill-touching cycle adds the known-bad-row skip with its marker design.

### C2-38 — production CSP `style-src 'unsafe-inline'` (security SEC-02)
- Original severity/confidence: Low / High.
- Citations: `apps/web/src/lib/content-security-policy.ts:114`.
- Reason: standard Next/Tailwind trade-off; script-src is nonce-based with no
  unsafe-inline, and no HTML-injection sink exists (verified by the same lane). Moving to
  nonce/hash-based styles is a framework-fighting project with visual-regression risk.
- Exit criterion: Next.js ships first-class style-nonce support, or an HTML-injection
  sink is ever found (which would independently be a CRIT).

### C2-46 — delete paths skip the per-image claim → wasted re-encode during backfill (tracer TRC-03)
- Original severity/confidence: Low-Medium / Medium (correctness-safe by design, tested).
- Citations: `apps/web/src/app/actions/images.ts:655-923`,
  `lib/admin-backfill-runner.ts:441-541`.
- Reason: pure efficiency optimization on an already-correct, test-locked convergence
  path; a non-blocking lock attempt in delete adds a failure mode to the most
  data-destructive user action for a rare-window CPU saving.
- Exit criterion: measured wasted re-encode volume during real curation-while-backfill
  usage, or the NFS unlink-of-open-file probe (tracer's next-probe note) surfaces an
  actual filesystem hazard — the latter would re-classify this as correctness.

### C2-50 — storage singleton rollback path untested (test TEST-05)
- Original severity/confidence: Low / High (confirmed gap; nil practical exposure).
- Citations: `apps/web/src/lib/storage/index.ts:85-127`.
- Reason: module is quarantine-enforced unwired (`storage-quarantine.test.ts`); testing
  dead code contradicts the C1-32 test-value policy. Chains on the C2-27 product decision.
- Exit criterion: the storage quarantine is lifted (C2-27 resolves toward integration) —
  the rollback test becomes part of that integration's regression base.

### C2-53 — duplicate accessible names for breakpoint-twinned controls (designer UX-04)
- Original severity/confidence: Low / High.
- Citations: `photo-viewer.tsx` ("Info" ×2), `lightbox.tsx` ("Open fullscreen view" ×2).
- Reason: only one twin is visible/focusable per viewport; differentiating labels per
  breakpoint is naming polish with i18n churn across two locales. This cycle's a11y
  budget goes to the confirmed HIGH focus-loss regression (WP2).
- Exit criterion: a voice-control/AT user report, or the next a11y-focused cycle batches
  it with other label work.

### C2-54 — untitled photo H1/title falls back to raw hashtag string (designer UX-05)
- Original severity/confidence: Low / High (deliberate design per `lib/photo-title.ts`).
- Reason: the hashtag fallback is an intentional product choice for this photographer's
  tagging workflow (performer names); changing the H1/title template is a product/SEO
  decision, not a defect fix.
- Exit criterion: product decision on a localized descriptive fallback template
  ("Untitled photo — X, Y") for H1/<title> while keeping the hashtag caption styling.

### C2-55 — perf long-tail (PERF-14, 15, 16, 17, 18, 20, 21, 22, 23)
- Original severity/confidence: Low (individually recorded) / High-Medium.
- Citations: `.context/reviews/cycle-2-2026-07-07/perf-reviewer.md` §LOW findings.
- Reason: individually low-value or design-accepted (SW JSON meta blob — explicitly
  deferred in `sw-cache.ts:120-124`; HEAD-probe cooldown — trades against the documented
  R10-H3 freshness intent; decode pyramid — needs photographer-quality sign-off; LIKE
  full-scan + FULLTEXT — scale-gated; feed 304 rebuild — deliberate C32-FEED; dropzone
  O(n²) — admin-only ≤100 files; inline CLIP backfill action — already gated + unwired;
  candidate-COUNT poll — needs poll-frequency evidence; LR RAM buffering — mitigated and
  informational).
- Exit criterion (class-level): each item re-opens on its own measurement trigger
  (profiled hot path, scale threshold, or the referenced design decision); any cycle
  touching the owning file should drain the matching item per the C1-32 policy.

## Carry-forward register (unchanged home: `.context/plans/cycle-96-2026-07-01-deferred.md` + `cycle-1-2026-07-06-deferred.md`)

- No cycle-1 deferred item is re-opened by cycle-2 findings; none hit the age budget this
  cycle (all cycle-1 items are 1 cycle old; the C96 register's High items were drained or
  reclassified in run-10 cycle 1).
- C2 items overlapping prior registers: C2-40 (SEC-04 XFH topology) is the same operator
  confirmation as C1-11 (operator part) — remains there; C2-20 chains on C1-33's
  measurement exit criterion (noted above).
