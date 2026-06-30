# Cycle 32/100 Deferred Findings

Date: 2026-06-30 KST
Review source: `.context/reviews/_aggregate.md`
Status: deferred carry-forward

Deferral rules applied: each item preserves original severity/confidence and cites the aggregate finding plus source regions. Security, correctness, and data-loss defects are not deferred unless they are documented operator/trust-boundary choices, manual production validation tasks, or review/test-infrastructure gaps rather than confirmed product defects. Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, `git pull --rebase` before push, required gates, no force-push, no `--no-verify`, no co-author lines, and current toolchain/package policy.

## Deferred Items

### D32-01 - Dynamic gallery first-page grouped counts

- Finding/citation: `AGG32-09`; `apps/web/src/lib/data.ts:898-927`, `apps/web/src/lib/data.ts:1466-1481`
- Original severity/confidence: Medium / High
- Reason for deferral: performance/product tradeoff around exact public counts. It is not a correctness, security, or data-loss defect, and changing count semantics requires broader UI/API review.
- Exit criterion: listing TTFB/slow-query logs implicate first-page counts, or count-display semantics are redesigned.

### D32-02 - Semantic/similar newest-window scan limitation

- Finding/citation: `AGG32-10`; `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`
- Original severity/confidence: Medium / High
- Reason for deferral: architectural retrieval/indexing work. `CLAUDE.md` documents semantic search as operator-enabled and bounded by `SEMANTIC_SCAN_LIMIT`, so replacing it requires vector-index/search-boundary design beyond this cycle.
- Exit criterion: production semantic corpus nears/exceeds `SEMANTIC_SCAN_LIMIT`, or operator requires corpus-wide recall/tail-latency guarantees.

### D32-03 - Timeline and On This Day non-sargable predicates

- Finding/citation: `AGG32-11`; `apps/web/src/lib/data-timeline.ts:88-117`, `apps/web/src/lib/data-timeline.ts:125-145`
- Original severity/confidence: Low / High
- Reason for deferral: schema/index performance improvement requiring migration design. No current correctness/security issue was shown.
- Exit criterion: timeline/On This Day slow queries appear or timeline schema work is scheduled.

### D32-04 - Masonry JPEG fallback may load base JPEG

- Finding/citation: `AGG32-12`; `apps/web/src/components/grid-picture.tsx:30-50`, `apps/web/src/components/home-client.tsx:334-361`
- Original severity/confidence: Low / Medium
- Reason for deferral: edge-path performance polish; AVIF/WebP sources cover the main browser path, and legacy derivative safety needs careful fallback testing.
- Exit criterion: image fallback code is edited, WebP/AVIF 404s are reported, or LCP/bandwidth metrics implicate fallback JPEGs.

### D32-05 - Optional DB health check public DB load

- Finding/citation: `AGG32-13`; `apps/web/src/app/api/health/route.ts:6-40`
- Original severity/confidence: Low / Medium
- Reason for deferral: default behavior is liveness-only and performs no DB query. The DB probe is operator-enabled and should normally be network-restricted.
- Exit criterion: `HEALTH_CHECK_DB=true` is enabled on a public endpoint or health route pressure appears in logs.

### D32-06 - Root-equivalent admin authorization

- Finding/citation: `AGG32-14`; `CLAUDE.md:5`, `CLAUDE.md:234-236`, `apps/web/src/app/actions/admin-users.ts:77-84`, `apps/web/src/app/[locale]/admin/db-actions.ts:365-371`
- Original severity/confidence: Medium / High
- Reason for deferral: this is an explicitly documented product/security model: `CLAUDE.md` states GalleryKit has multiple root-admin accounts and no role/capability separation. Adding roles would be a major product/security design change.
- Exit criterion: lower-trust operator accounts are introduced or user requests role/capability separation.

### D32-07 - DB restore trusts allowed application-table state

- Finding/citation: `AGG32-15`; `apps/web/src/lib/sql-restore-scan.ts:12-31`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-680`
- Original severity/confidence: Medium / High
- Reason for deferral: full-state SQL restore is an admin/operator trust boundary by design; the scanner blocks statement classes and non-app tables but cannot prove row provenance. Changing this requires signed backups/provenance design.
- Exit criterion: restore trust model changes, signed backups are designed, or admin roles reduce restore authority.

### D32-08 - Process-local public/token-spray limits

- Finding/citation: `AGG32-16`; `CLAUDE.md:234-236`, `apps/web/src/lib/rate-limit.ts:74-99`, `apps/web/src/lib/rate-limit.ts:318-375`
- Original severity/confidence: Low / High
- Reason for deferral: `CLAUDE.md` documents the shipped topology as single web-instance/single-writer and warns not to horizontally scale until process-local state is moved.
- Exit criterion: app is scaled beyond one web process/host or edge/shared rate limiting is introduced.

### D32-09 - Plaintext SQL backup storage boundary

- Finding/citation: `AGG32-17`; `CLAUDE.md:213-218`, `apps/web/src/app/[locale]/admin/db-actions.ts:185-230`, `apps/web/src/app/api/admin/db/download/route.ts:45-90`
- Original severity/confidence: Low / High
- Reason for deferral: `CLAUDE.md` explicitly states plaintext SQL backups are protected by the operator host/storage encryption boundary; app-level backup encryption is product/ops scope.
- Exit criterion: backup storage policy changes or encrypted backup support is requested.

### D32-10 - Production `TRUST_PROXY` validation

- Finding/citation: `AGG32-18`; `apps/web/src/lib/rate-limit.ts:166-196`
- Original severity/confidence: Medium / Medium
- Reason for deferral: manual production configuration validation, not a local source defect. Repo deploy target/credentials are gitignored and config-owned.
- Exit criterion: production proxy chain changes or operator requests deployed topology validation.

### D32-11 - Advisory lock global namespace

- Finding/citation: `AGG32-19`; `apps/web/src/lib/advisory-locks.ts:8-47`, `CLAUDE.md:234-237`
- Original severity/confidence: Low / High
- Reason for deferral: documented one-GalleryKit-per-MySQL-server deployment assumption; namespacing locks requires migration/runtime configuration design.
- Exit criterion: multiple GalleryKit databases share one MySQL server or instance namespacing is prioritized.

### D32-12 - Schema reconcile structural DB diff coverage

- Finding/citation: `AGG32-20`; `apps/web/scripts/migrate.js:317-819`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-172`
- Original severity/confidence: High / High
- Reason for deferral: test-infrastructure gap rather than confirmed schema bug. A structural information_schema diff requires a running MySQL CI fixture and Drizzle expectation mapping beyond this cycle's local fix scope.
- Exit criterion: migrations/reconcile are edited, CI MySQL structural diff lane is approved, or schema drift is suspected.

### D32-13 - Restore/backup executable state-machine tests

- Finding/citation: `AGG32-21`; `apps/web/src/app/[locale]/admin/db-actions.ts:365-820`, `apps/web/src/__tests__/db-restore.test.ts:42-77`
- Original severity/confidence: High / Medium
- Reason for deferral: test-depth gap, not a confirmed restore defect. Full mocks for child process, streams, locks, maintenance, audit, and queue resume are large and should be handled in a dedicated restore-test hardening pass.
- Exit criterion: restore flow is touched, restore failure reports appear, or dedicated restore test work is scheduled.

### D32-14 - Real CLIP integration outside default CI

- Finding/citation: `AGG32-22`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `.github/workflows/quality.yml:66-80`
- Original severity/confidence: Medium / High
- Reason for deferral: requires seeded model weights/cache and a slower/manual CI lane. This cycle fixes a CLIP slot correctness bug but does not change model dependencies or activation policy.
- Exit criterion: CLIP/model dependencies change, semantic production activation is planned, or CI weight cache is approved.

### D32-15 - Deploy/nginx checks are string contracts

- Finding/citation: `AGG32-23`; `apps/web/deploy.sh:1-85`, `apps/web/nginx/default.conf:21-203`, `apps/web/src/__tests__/deploy-script-contract.test.ts:21-127`
- Original severity/confidence: Medium / High
- Reason for deferral: CI/tooling hardening, not a confirmed deploy defect. Parser/runtime checks require Docker/nginx availability assumptions in CI and should be added deliberately.
- Exit criterion: deploy/nginx config changes, CI environment supports parser gates, or deploy syntax/config failure occurs.

### D32-16 - Docker production image not built in CI

- Finding/citation: `AGG32-24`; `apps/web/Dockerfile:49-61`, `.github/workflows/quality.yml:48-80`
- Original severity/confidence: Medium / High
- Reason for deferral: CI expansion with Docker build cost and native package pin strategy implications. This cycle will fix Dependabot root coverage first.
- Exit criterion: native package pins change, CI budget allows Docker build gate, or deploy-only Docker failures recur.

### D32-17 - Mobile gallery filter hierarchy

- Finding/citation: `AGG32-25`; `apps/web/src/components/home-client.tsx:255-286`, `apps/web/src/components/tag-filter.tsx:63-120`
- Original severity/confidence: Medium / High
- Reason for deferral: broad visual/product layout change requiring mobile/desktop screenshots and English/Korean review. Not a correctness/security issue.
- Exit criterion: next UI-focused cycle or user requests mobile photo-first layout work.

### D32-18 - Live search unavailable for visible tag

- Finding/citation: `AGG32-26`; `apps/web/src/components/search.tsx:160-245`, `apps/web/src/app/actions/public.ts:305`
- Original severity/confidence: Medium / High for live symptom; root cause unconfirmed
- Reason for deferral: live production symptom needs logs or local DB reproduction. Local browser review had DB unavailable, and speculative backend changes risk masking the real cause.
- Exit criterion: production logs/local reproduction identify the failing search path, DB error, rate-limit state, or data issue.

### D32-19 - Admin image manager responsive card mode

- Finding/citation: `AGG32-27`; `apps/web/src/components/image-manager.tsx:424-594`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`
- Original severity/confidence: Medium / High
- Reason for deferral: UI feature/layout work with broad admin surface impact; requires browser verification on authenticated admin data.
- Exit criterion: admin mobile/tablet image-management work is prioritized.

### D32-20 - Photo card accessible naming verbosity

- Finding/citation: `AGG32-28`; `apps/web/src/components/home-client.tsx:323-355`, `apps/web/src/components/home-client.tsx:395-405`
- Original severity/confidence: Low / Medium
- Reason for deferral: low-severity AT polish; should be paired with accessibility snapshots across card/detail pages.
- Exit criterion: next card/grid accessibility pass.

### D32-21 - Routine UI transition timing

- Finding/citation: `AGG32-29`; `apps/web/src/components/home-client.tsx:357-371`, `apps/web/src/components/photo-viewer.tsx:716-724`
- Original severity/confidence: Low / High
- Reason for deferral: subjective interaction polish with visual feel tradeoffs; no functional failure.
- Exit criterion: visual polish pass or user requests faster browsing motion.

### D32-22 - Generic route error operator diagnostics

- Finding/citation: `AGG32-30`; `apps/web/src/app/[locale]/error.tsx:22-57`
- Original severity/confidence: Low / High
- Reason for deferral: public-safe error copy design, not a correctness defect. Needs product decision on incident/reference-code disclosure.
- Exit criterion: public error-state copy/design pass.

### D32-23 - Gallery scroll restoration key excludes query/filter state

- Finding/citation: `AGG32-36`; `apps/web/src/components/home-client.tsx:124-170`, `apps/web/src/components/tag-filter.tsx:23-45`
- Original severity/confidence: Low / High
- Reason for deferral: low-severity public UX state issue; scheduled work already includes higher-impact correctness/accessibility fixes.
- Exit criterion: gallery filtering/navigation state is edited or next public UX pass runs.

## Gate Warnings

No new full-gate warnings recorded yet. Prompt 3 must append any unavoidable gate warnings here with preserved severity and exit criteria.
