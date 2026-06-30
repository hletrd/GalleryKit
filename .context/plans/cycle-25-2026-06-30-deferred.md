# Cycle 25/100 Deferred Findings

Date: 2026-06-30 KST
Review source: `.context/reviews/_aggregate.md`
Status: deferred carry-forward

Deferral rules applied: every item below preserves original severity/confidence and cites the aggregate item. Security, correctness, and data-loss findings are not deferred unless an explicit repo rule permits the risk or the item is an accepted operational/design-risk note rather than a confirmed source defect. Deferred work remains bound by repo policy: signed Conventional Commit + gitmoji commits, pull-rebase before push, required gates, no force-push, no `--no-verify`, and current toolchain/package policy.

## Deferred Items

### D25-01 - Public first-page listing queries compute exact grouped totals

- Finding/citation: `AGG25-01`, `.context/reviews/_aggregate.md`; `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1417-1467`
- Original severity/confidence: Medium / High
- Reason for deferral: public totals are a user-visible product contract and query redesign needs UX and production `EXPLAIN` validation. This is a performance risk, not a correctness/data-loss finding.
- Exit criterion: reopen when exact public totals are redesigned, gallery size/query telemetry shows listing TTFB pressure, or smart-collection predicate work is scheduled.

### D25-02 - GPS stripping buffers full originals after streaming upload

- Finding/citation: `AGG25-03`; `apps/web/src/lib/process-image.ts:1737-1764`
- Original severity/confidence: Medium / High
- Reason for deferral: streaming/segment metadata stripping is a larger parser design with binary-format regression risk. Current upload cap bounds worst-case memory.
- Exit criterion: reopen when GPS-strip memory warnings occur, upload cap changes, or metadata parser work is scheduled.

### D25-03 - Upload-processing contract lock spans slow file and CPU work

- Finding/citation: `AGG25-04`; `apps/web/src/app/actions/images.ts:175-630`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-552`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: lock-boundary reduction affects browser and PAT upload consistency and needs a dedicated concurrency design. Current lock favors correctness over throughput.
- Exit criterion: reopen when upload contention is measured or upload settings/contract locking is refactored.

### D25-04 - Infinite masonry keeps all loaded photos mounted

- Finding/citation: `AGG25-05`; `apps/web/src/components/home-client.tsx:124-411`
- Original severity/confidence: Medium / High
- Reason for deferral: virtualization/windowing is a larger UI architecture change requiring scroll restoration and responsive visual QA.
- Exit criterion: reopen when large-gallery DOM/heap evidence appears or infinite-scroll UI is redesigned.

### D25-05 - Public map can serialize and mount up to 10,000 markers

- Finding/citation: `AGG25-06`; `apps/web/src/app/[locale]/(public)/map/page.tsx:31-89`
- Original severity/confidence: Medium / High
- Reason for deferral: clustering/viewport APIs and accessible list virtualization are a separate map redesign.
- Exit criterion: reopen when map-visible GPS count grows, map route latency is measured, or map API work is scheduled.

### D25-06 - CSV export buffers multiple large copies

- Finding/citation: `AGG25-07`; `apps/web/src/app/[locale]/admin/db-actions.ts:79-159`
- Original severity/confidence: Medium / High
- Reason for deferral: streaming export/background job is a larger admin workflow change; current cap prevents unbounded export.
- Exit criterion: reopen if export cap increases, memory pressure is observed, or admin DB/export workflow is revised.

### D25-07 - Timeline/archive predicates are non-sargable

- Finding/citation: `AGG25-08`; `apps/web/src/lib/data-timeline.ts:97-207`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: range rewrite/generated columns need query-plan validation and possibly schema migration; current issue is performance-only.
- Exit criterion: reopen when timeline/year routes become hot or archive schema/index work is scheduled.

### D25-08 - Public nav topic helper computes sitemap-only timestamps

- Finding/citation: `AGG25-09`; `apps/web/src/lib/data.ts:509-529`
- Original severity/confidence: Low / Medium
- Reason for deferral: low-severity helper split; production impact needs `EXPLAIN`/latency evidence.
- Exit criterion: reopen when nav/topic query latency appears or sitemap freshness logic changes.

### D25-09 - Service worker blocks cached images on per-tile HEAD probes

- Finding/citation: `AGG25-10`; `apps/web/public/sw.template.js:250-280`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: cache freshness behavior needs browser trace validation and product choice about stale-first image correctness.
- Exit criterion: reopen when service-worker strategy is revised or warm-cache image paint is measured as slow.

### D25-10 - Analytics page fans out aggregate scans

- Finding/citation: `AGG25-11`; `apps/web/src/lib/analytics-data.ts:28-207`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: performance tuning depends on production cardinalities and query plans.
- Exit criterion: reopen when analytics route shows DB/pool pressure or rollups/cache are planned.

### D25-11 - Bundled nginx config depends on external TLS termination

- Finding/citation: `AGG25-14`; `apps/web/nginx/default.conf:21-30`
- Original severity/confidence: Medium if misdeployed / Medium
- Reason for deferral: repo docs explicitly constrain this deployment: `README.md:164` says the checked-in nginx config is an internal HTTP hop behind a TLS-terminating edge and must not be exposed directly; `apps/web/README.md:54` says to add a real 443 server if nginx is public edge. This is a misdeployment risk, not a confirmed source vulnerability.
- Exit criterion: reopen if a public-edge nginx example is added, deployment topology changes, or production exposes the checked-in port-80 listener directly.

### D25-12 - Per-IP rate limiting depends on proxy topology

- Finding/citation: `AGG25-15`; `apps/web/src/lib/rate-limit.ts:164-195`
- Original severity/confidence: Low / High
- Reason for deferral: repo docs already define the safe topology: `README.md:166` explains `TRUST_PROXY=true` requirements and spoofing/fail-closed behavior; `CLAUDE.md:97-98` documents trusted proxy hops.
- Exit criterion: reopen when proxy topology changes, startup config validation work is scheduled, or rate-limit telemetry shows shared `unknown` buckets.

### D25-13 - All admins are root admins

- Finding/citation: `AGG25-16`; `apps/web/src/app/actions/admin-users.ts:77-84`
- Original severity/confidence: Low / High
- Reason for deferral: explicitly accepted by repo policy: `CLAUDE.md:236` says all admins are root admins with no role model; `CLAUDE.md:568` says 2FA/WebAuthn is not planned for the personal-gallery threat model.
- Exit criterion: reopen before adding non-equally-trusted operators, public user accounts, role/capability features, or stronger account-protection requirements.

### D25-14 - SQL backups are plaintext at rest

- Finding/citation: `AGG25-17`; `apps/web/src/app/api/admin/db/download/route.ts:21-89`
- Original severity/confidence: Low / High
- Reason for deferral: explicitly assigned to operator boundary: `CLAUDE.md:216` and `README.md:169` state backups are plaintext at rest and host/storage encryption is the operator responsibility.
- Exit criterion: reopen when adding backup encryption, retention controls, or managed-host backup features.

### D25-15 - Build inputs are mutable without provenance gate

- Finding/citation: `AGG25-18`; `apps/web/Dockerfile:1-21`, `apps/web/Dockerfile:49-67`
- Original severity/confidence: Low / High
- Reason for deferral: provenance/SBOM/image scanning is release-hardening work; immediate cycle handles deploy health and native-pin drift tests where feasible.
- Exit criterion: reopen when release provenance gates, SBOMs, or image scanning are added.

### D25-16 - Settings update race protections lack action-level behavior tests

- Finding/citation: `AGG25-22`; `apps/web/src/app/actions/settings.ts:68-166`
- Original severity/confidence: High / High
- Reason for deferral: this is a test-coverage gap, not a confirmed source defect; helper/source tests already cover the lock primitives. It requires a larger mocked action harness and is lower priority than the confirmed restore/analytics fixes scheduled this cycle.
- Exit criterion: reopen before changing `updateGallerySettings`, upload-processing settings, or settings lock helpers.

### D25-17 - Lightroom upload route lacks behavior-level side-effect tests

- Finding/citation: `AGG25-23`; `apps/web/src/app/api/admin/lr/upload/route.ts:78-547`
- Original severity/confidence: High / High
- Reason for deferral: this is a test-coverage gap rather than a confirmed runtime bug; route harness work is broad and should be scheduled before LR route changes.
- Exit criterion: reopen before modifying LR upload quota, locks, cleanup, queue payload, metadata, or auth behavior.

### D25-18 - Admin token plaintext acknowledgement lacks interaction coverage

- Finding/citation: `AGG25-26`; `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:46-235`
- Original severity/confidence: Medium / Medium
- Reason for deferral: interaction test coverage gap; no source defect was confirmed.
- Exit criterion: reopen when token UI is edited or Playwright/component coverage is expanded.

### D25-19 - Visual-check E2E captures screenshots without visual assertions

- Finding/citation: `AGG25-27`; `apps/web/e2e/nav-visual-check.spec.ts:6-78`
- Original severity/confidence: Low / High
- Reason for deferral: visual baseline policy needs stable masks and artifact workflow; existing geometry/touch tests remain the fast gate.
- Exit criterion: reopen when visual regression baselines are introduced or nav/layout screenshots become release blockers.

### D25-20 - Embedding column has split type ownership

- Finding/citation: `AGG25-32`; `apps/web/src/db/schema.ts:266-286`, `apps/web/drizzle/0012_image_embeddings.sql:5-8`
- Original severity/confidence: Medium / High
- Reason for deferral: schema/type cleanup requires Drizzle custom type/reconciler test work; current decoder handles the physical storage.
- Exit criterion: reopen before modifying embedding schema, migrations, or CLIP storage.

### D25-21 - Broad server-action barrel blurs client/server and domain boundaries

- Finding/citation: `AGG25-33`; `apps/web/src/app/actions.ts:1-34`
- Original severity/confidence: Medium / High
- Reason for deferral: broad layering refactor with many imports; no current bundle/auth defect was confirmed.
- Exit criterion: reopen when touching the action barrel, auth context, or client/server import scanner.

### D25-22 - Docker native dependency pins can drift outside CI

- Finding/citation: `AGG25-34`; `apps/web/Dockerfile:49-61`
- Original severity/confidence: Medium / Medium
- Reason for deferral: if not completed in P25-04 tests, Docker lockfile parity should be handled with broader build/provenance work. Current build gate still validates the host package graph.
- Exit criterion: reopen on Dockerfile native package edits, dependency upgrades, or CI Docker build adoption.

### D25-23 - Semantic search recall is a recency window

- Finding/citation: `AGG25-35`; `apps/web/src/app/api/search/semantic/route.ts:263-311`
- Original severity/confidence: Medium / High
- Reason for deferral: architectural retrieval decision requiring corpus-size/recall goals; production semantic search is operator-gated.
- Exit criterion: reopen when embedding count exceeds scan budget, search-quality complaints appear, or vector/ANN work is planned.

### D25-24 - Single-instance runtime ownership is documented but not enforced

- Finding/citation: `AGG25-36`; `apps/web/docker-compose.yml:12-28`, `apps/web/src/lib/restore-maintenance.ts:1-56`
- Original severity/confidence: Medium / Medium
- Reason for deferral: repo policy explicitly defines single-writer topology: `CLAUDE.md:235` says shipped compose is single web-instance/single-writer and not to horizontally scale unless coordination states move to shared storage. P25-01 handles the highest-risk restore subset.
- Exit criterion: reopen before horizontal scaling, blue/green overlap, process-manager migration, or adding a second web writer.

### D25-25 - Public analytics row writes are untracked fire-and-forget side effects

- Finding/citation: `AGG25-37`; `apps/web/src/app/actions/public.ts:362-456`
- Original severity/confidence: Low / High
- Reason for deferral: P25-02 addresses durable rate limiting and restore gating; full shutdown drain/drop counters are approximate-analytics design work. `CLAUDE.md:235` already says shared-group buffering is best-effort by design.
- Exit criterion: reopen if row-level analytics are promoted to durable/auditable metrics or shutdown queue work is scheduled.

### D25-26 - Public error shell drops normal wayfinding

- Finding/citation: `AGG25-42`; `apps/web/src/app/[locale]/error.tsx:22-55`
- Original severity/confidence: Medium / High
- Reason for deferral: public DB-unavailable shell redesign needs client-safe layout work and browser validation. It is a UX availability improvement, not data loss/correctness.
- Exit criterion: reopen when public error boundaries, first-run setup UX, or DB outage handling is edited.

### D25-27 - Modal backgrounds remain exposed to assistive technology

- Finding/citation: `AGG25-47`; `apps/web/src/components/search.tsx:363-524`, `apps/web/src/components/lightbox.tsx:451-459`, `apps/web/src/components/info-bottom-sheet.tsx:185-199`
- Original severity/confidence: High / High
- Reason for deferral: shared modal inerting across search/lightbox/sheet is a larger accessibility refactor with portal/root interaction risk. It is not a security/correctness/data-loss finding.
- Exit criterion: reopen when custom modal primitives are edited, Radix dialog migration starts, or accessibility budget prioritizes modal isolation.

### D25-28 - Admin settings copy mixes controls with operator runbook detail

- Finding/citation: `AGG25-49`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:307-789`
- Original severity/confidence: Medium / Medium
- Reason for deferral: IA/copy rewrite across English and Korean settings surfaces; no behavior defect.
- Exit criterion: reopen when settings IA, semantic search setup, or Korean admin copy is revised.

## Scheduled Elsewhere In Cycle 25

The following findings are not deferred because they are scheduled in `cycle-25-2026-06-30-plan.md`: `AGG25-02`, `AGG25-12`, `AGG25-13`, `AGG25-19`, `AGG25-20`, `AGG25-21`, `AGG25-24`, `AGG25-25`, `AGG25-28`, `AGG25-29`, `AGG25-30`, `AGG25-31`, `AGG25-38`, `AGG25-39`, `AGG25-40`, `AGG25-41`, `AGG25-43`, `AGG25-44`, `AGG25-45`, `AGG25-46`, and `AGG25-48`.

## Deferred Gate Warnings

### GW25-01 - Turbopack NFT trace warning for durable restore marker

- Finding/citation: `npm run build --workspace=apps/web`; import trace cites `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/instrumentation.ts`, and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Original severity/confidence: Warning / High
- Reason for deferral: the warning persists after narrowing the marker to a static `process.cwd()/data/restore-maintenance.json` path, which matches Turbopack's recommended statically scoped subfolder shape. The remaining trace comes from intentional server-only filesystem marker I/O needed to preserve failed-restore maintenance across process restarts, and replacing it with DB state would fail during the DB restore failure mode it protects.
- Exit criterion: reopen when Next/Turbopack file tracing behavior changes, when a non-filesystem host-side coordination primitive is adopted, or if this warning becomes an error-level build failure.
