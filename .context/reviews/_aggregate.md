# Cycle 18 Aggregate Review

Date: 2026-06-30 KST
HEAD reviewed: `4ad6a394453fac80cc29aacc6f93eab3ed8c12ca`
Scope: Prompt 1 deep multi-agent review, current HEAD only.

## Agents

Native callable agent types in this environment were `default`, `explorer`, and `worker`, so the requested reviewer lanes were run as role-instructed `default` subagents, within the six-agent concurrency cap. All requested reviewer lanes returned and wrote provenance artifacts:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `designer.md`

Additional evidence reported by reviewers:

- `verifier` reported full gate success: lint, typecheck, all custom lint gates, full Vitest, and production build with the known local MySQL sitemap fallback warning.
- `security-reviewer` reported custom security lint gates passing, focused security tests passing, and `npm audit --workspace=apps/web --audit-level=low` with 0 vulnerabilities.
- `tracer` reported `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit` passing.
- `designer` used Playwright/browser validation, ARIA snapshots, focus/keyboard checks, and responsive checks. Local MySQL was unavailable (`ECONNREFUSED 127.0.0.1:3306`), so protected admin/data-heavy flows were partly static-reviewed.

No agent failures were reported. Raw reviewer findings before dedupe: 50.

## High-Signal Cross-Agent Findings

### AGG-C18-01 - CLIP inference admission has an unbounded, abort-insensitive pending queue

- Severity/confidence: High / High
- Status: Confirmed
- Source agents: perf-reviewer, critic, debugger
- Citations: `apps/web/src/lib/clip-model.ts:53-70`, `apps/web/src/lib/clip-model.ts:138-146`, `apps/web/src/lib/clip-model.ts:171-222`, `apps/web/src/app/api/search/semantic/route.ts:248-255`, `apps/web/src/lib/image-queue.ts:327-332`, `apps/web/src/lib/image-queue.ts:720-746`
- Failure scenario: production semantic search with `CLIP_INFERENCE_CONCURRENCY=1` receives a burst while upload embeddings are queued. Disconnected request waiters remain in memory and eventually consume ONNX CPU; background side effects accumulate and shutdown drain worsens.
- Suggested fix: replace the manual waiter array with a bounded queue/semaphore supporting max pending depth, max wait time, and abort-driven removal. Return 429/503 on saturation and consider separate quotas/priorities for public search and background embedding.

### AGG-C18-02 - Disabled/non-production semantic routes can consume DB config reads without retaining rate-limit budget

- Severity/confidence: Medium / High
- Status: Confirmed
- Source agents: critic, debugger
- Citations: `apps/web/src/app/api/search/semantic/route.ts:168-205`, `apps/web/src/app/api/search/similar/[id]/route.ts:85-113`, `apps/web/src/lib/gallery-config.ts:34-39`, `apps/web/src/lib/request-origin.ts:79-106`
- Failure scenario: a scripted same-origin-looking client repeatedly posts to disabled semantic routes. Each request performs a DB-backed config lookup before any retained semantic rate-limit charge, creating MySQL pressure invisible to the semantic limiter.
- Suggested fix: after cheap syntactic gates, retain a rate-limit charge before DB-backed mode lookup, or cache the mode on a bounded no-DB path. Add disabled/stub tests for retained charges or cache behavior.

### AGG-C18-03 - Public route rate-limit scanner misses transitive local mutator helpers

- Severity/confidence: Medium / High
- Status: Confirmed
- Source agents: code-reviewer, verifier, debugger
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:124-150`, `apps/web/scripts/check-public-route-rate-limit.ts:212-286`, `apps/web/scripts/check-public-route-rate-limit.ts:355-360`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:364-381`
- Failure scenario: a future public `POST` route calls `writeFirst() -> actuallyWrite() -> db.insert(...)`, then charges a limiter after `writeFirst()`. The scanner only marks directly mutating helpers, so the lint gate passes despite mutation before rate-limit retention.
- Suggested fix: compute local mutating functions to a fixed point through the local call graph and add a two-hop negative fixture.

### AGG-C18-04 - Browser and Lightroom uploads duplicate the ingest transaction owner

- Severity/confidence: High / High
- Status: Confirmed design risk
- Source agents: architect, test-engineer
- Citations: `apps/web/src/app/actions/images.ts:350-531`, `apps/web/src/app/api/admin/lr/upload/route.ts:243-516`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:384-394`
- Failure scenario: a future upload-time column or byte-impacting processing setting is added to browser upload but missed in the Lightroom route. Browser uploads persist complete metadata while Lightroom uploads silently omit it, causing photographer-visible color/search/backfill drift.
- Suggested fix: extract a server-only ingest service that owns save/gate/EXIF/insert/snapshot/queue construction, leaving browser action and Lightroom route as transport adapters. Add adapter parity tests for insert keys and queue-job keys.

### AGG-C18-05 - One-row-per-image embeddings make model cutovers destructive

- Severity/confidence: Medium / High
- Status: Confirmed design risk
- Source agents: critic, debugger
- Citations: `apps/web/src/db/schema.ts:280-294`, `apps/web/scripts/backfill-clip-embeddings.ts:123-183`, `apps/web/src/app/actions/embeddings.ts:103-163`, `apps/web/src/lib/image-queue.ts:356-367`, `apps/web/src/app/api/search/semantic/route.ts:261-284`, `apps/web/src/app/api/search/similar/[id]/route.ts:115-156`
- Failure scenario: an operator starts a new CLIP model backfill. Processed images overwrite old embeddings; rollback cannot restore the old model by flipping a setting, and a failed cutover leaves no single model version with complete coverage.
- Suggested fix: store embeddings by `(image_id, model_version)` with an active serving pointer and cleanup path, or document production model upgrades as destructive maintenance windows and gate search until coverage is complete.

### AGG-C18-06 - Correctness relies on single-process topology that is documented but not runtime-enforced

- Severity/confidence: Medium if scaled, Low under shipped topology / High
- Status: Confirmed risk
- Source agents: architect, tracer
- Citations: `CLAUDE.md:227-230`, `apps/web/docker-compose.yml:1-27`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-78`, `apps/web/src/lib/image-queue.ts:275-324`, `apps/web/src/lib/rate-limit.ts:112-121`, `apps/web/src/lib/data.ts:13-63`, `apps/web/src/lib/admin-backfill-runner.ts:144-230`
- Failure scenario: a second web process is started for blue/green or emergency testing. Restore maintenance, upload claims, rate limits, queue/backfill status, and view-count buffers split per process, allowing uploads/settings/restore/rate-limit behavior to diverge.
- Suggested fix: add a startup/deploy guard or DB lease that fails loudly for multiple web instances unless an explicit opt-in exists, or move the process-local coordination states to shared storage.

### AGG-C18-07 - Bulk image tag edits can skip `images.updated_at` when combined with no-op scalar updates

- Severity/confidence: Medium / Medium
- Status: Likely confirmed
- Source agents: code-reviewer, debugger
- Citations: `apps/web/src/app/actions/images.ts:1057-1068`, `apps/web/src/app/actions/images.ts:1123-1155`, `apps/web/src/db/schema.ts:97-100`, `apps/web/src/lib/data.ts:828-852`
- Failure scenario: an admin bulk-edits photos by setting topic to the current topic and adding a tag. The scalar update is a no-op and the tag touch branch is skipped because `setClause` is non-empty, so public tags change without feed/sitemap freshness advancing.
- Suggested fix: whenever tag mutation rows are affected, explicitly bump `images.updated_at` for affected image IDs regardless of scalar update shape. Add a scalar-no-op-plus-tag regression.

### AGG-C18-08 - Backup creation is not serialized with restore

- Severity/confidence: Medium / Medium-high
- Status: Confirmed
- Source agents: tracer
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:119-170`, `apps/web/src/app/[locale]/admin/db-actions.ts:286-390`, `apps/web/src/__tests__/db-restore.test.ts:52-64`, `apps/web/src/__tests__/restore-upload-lock.test.ts:7-32`
- Failure scenario: one admin starts a dump while another starts restore. The backup passes the maintenance check before restore marks maintenance, then `mysqldump` and restore import compete for metadata locks and can delay/fail each other.
- Suggested fix: make backup and restore share the same DB-level serialization contract, such as non-blocking `GET_LOCK(LOCK_DB_RESTORE, 0)` around the whole dump, with a translated busy error and a contract test.

### AGG-C18-09 - Public DB failures recover into a generic self-looping error page

- Severity/confidence: High / High
- Status: Confirmed UX issue
- Source agents: designer
- Citations: `apps/web/src/app/[locale]/error.tsx:22-53`, `apps/web/src/app/[locale]/(public)/page.tsx:151-176`, route evidence from Playwright when local MySQL was unavailable
- Failure scenario: a visitor hits a temporary DB-backed public failure and sees a generic error shell whose primary action retries the same failing route, with weak navigation/context. This makes transient outage recovery worse and obscures whether the gallery is empty or unavailable.
- Suggested fix: provide a public-facing temporary-unavailable/error state with home/navigation recovery and distinguish true empty gallery from query failures.

### AGG-C18-10 - One-time upload token can be dismissed before copying with no recovery path

- Severity/confidence: High / High
- Status: Confirmed UX issue
- Source agents: designer
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx` token creation/copy dialog region cited in `designer.md`
- Failure scenario: an admin creates a Lightroom/API token, closes the one-time dialog before copying, and cannot recover the secret. They must revoke/recreate, which is costly and error-prone.
- Suggested fix: make dismissal harder until copy/download/acknowledgement, or add a secondary confirmation that the token cannot be viewed again.

### AGG-C18-11 - Resolved-path streaming comments/tests overstate TOCTOU closure

- Severity/confidence: Low / Medium
- Status: Confirmed documentation/test overclaim
- Source agents: code-reviewer, verifier, debugger, document-specialist
- Citations: `apps/web/src/app/api/admin/db/download/route.ts:43-84`, `apps/web/src/lib/serve-upload.ts:175-217`, `apps/web/src/lib/serve-upload.ts:263-267`
- Failure scenario: future hardening work assumes descriptor-backed validation already exists because comments say the TOCTOU gap is closed, but code validates/stat's one path object and later opens by pathname.
- Suggested fix: either open/fstat/stream the same descriptor where the threat model requires it, or weaken comments/tests to accurately state reduced path risk rather than full closure.

### AGG-C18-12 - `serve-upload` cache comment says one day while headers are one hour

- Severity/confidence: Low / High
- Status: Confirmed
- Source agents: verifier, document-specialist
- Citations: `apps/web/src/lib/serve-upload.ts:245-252`, `apps/web/next.config.ts:69-72`, `apps/web/nginx/default.conf:173-176`
- Failure scenario: future cache changes use the stale "one day" comment as guidance and diverge from the one-hour `max-age=3600` policy.
- Suggested fix: update the comment to one hour and add/adjust a source-contract test if needed.

## Additional Confirmed Findings And Risks

### AGG-C18-13 - Initial listing pages combine tag aggregation with `COUNT(*) OVER()` on the hot path

- Severity/confidence: Medium-High / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/data.ts` listing query regions cited in `perf-reviewer.md`

### AGG-C18-14 - Public keyword search can run multiple leading-wildcard scans per admitted query

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/app/actions/public.ts:236-318`, `apps/web/src/lib/data.ts:1537-1613`

### AGG-C18-15 - Batch image deletion repeats full derivative-directory scans per image and format

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/app/actions/images.ts:807-845`, `apps/web/src/lib/process-image.ts:575-664`

### AGG-C18-16 - GPS stripping materializes large originals in memory

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/process-image.ts:1738-1822`, `apps/web/src/app/actions/images.ts:381-388`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-381`

### AGG-C18-17 - Lightroom uploads parse the full multipart body before streaming to disk

- Severity/confidence: Medium / Medium-High
- Source agents: perf-reviewer
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:93-155`, `apps/web/src/lib/upload-limits.ts:1-6`

### AGG-C18-18 - Service-worker cached image hits wait on synchronous `HEAD` revalidation

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/public/sw.template.js:34-38`, `apps/web/public/sw.template.js:223-285`

### AGG-C18-19 - Gallery load-more keeps every loaded image in React state and DOM

- Severity/confidence: Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-421`, `apps/web/src/components/load-more.tsx:41-133`

### AGG-C18-20 - Public map can serialize and hydrate 10,000 markers plus 10,000 fallback links

- Severity/confidence: Medium / Medium-High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/data.ts:1648-1677`, `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`, `apps/web/src/components/map/map-client.tsx:76-143`

### AGG-C18-21 - Timeline/archive predicates use non-sargable date functions

- Severity/confidence: Low-Medium / High
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/data-timeline.ts:97-145`, `apps/web/src/lib/data-timeline.ts:186-207`

### AGG-C18-22 - Admin dashboard and analytics fanout can exhaust the small shared pool

- Severity/confidence: Low-Medium / Medium
- Source agents: perf-reviewer
- Citations: `apps/web/src/db/index.ts:23-38`, dashboard/analytics page regions cited in `perf-reviewer.md`

### AGG-C18-23 - Semantic and similar search decode and score every scanned embedding in process

- Severity/confidence: Low-Medium / Medium
- Source agents: perf-reviewer
- Citations: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-305`, `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`

### AGG-C18-24 - Upload dropzone renders object URLs and full preview cards for every selected file

- Severity/confidence: Low-Medium / Medium
- Source agents: perf-reviewer
- Citations: upload dropzone regions cited in `perf-reviewer.md`

### AGG-C18-25 - Middleware CSP/header wiring lacks behavior tests

- Severity/confidence: Medium / High
- Source agents: test-engineer
- Citations: `apps/web/src/__tests__` and middleware/header regions cited in `test-engineer.md`

### AGG-C18-26 - Lightroom upload route behavior is protected mostly by source-contract tests

- Severity/confidence: Medium / High
- Source agents: test-engineer
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`

### AGG-C18-27 - Migration reconcile coverage is a source tripwire, not schema equivalence

- Severity/confidence: Medium / High
- Source agents: test-engineer
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`, `apps/web/scripts/migrate.js`

### AGG-C18-28 - PWA manifest and generated icon assets lack installability tests

- Severity/confidence: Low / High
- Source agents: test-engineer
- Citations: manifest/icon files cited in `test-engineer.md`

### AGG-C18-29 - Reserved topic route segments are duplicated without a sync test

- Severity/confidence: Low / Medium
- Source agents: test-engineer
- Citations: reserved segment code/tests cited in `test-engineer.md`

### AGG-C18-30 - Admin token auth rate-limit wrapper path lacks wrapper-level test coverage

- Severity/confidence: Medium / High
- Source agents: test-engineer
- Citations: admin token auth/rate-limit regions cited in `test-engineer.md`

### AGG-C18-31 - Repo-local `.env.deploy` is the default deploy secret path

- Severity/confidence: Low / High
- Source agents: security-reviewer
- Citations: `scripts/deploy-remote.sh` / deploy docs regions cited in `security-reviewer.md`

### AGG-C18-32 - Deploy env allows arbitrary shell command overrides without a separate guard

- Severity/confidence: Low / Medium
- Source agents: security-reviewer
- Citations: `scripts/deploy-remote.sh` regions cited in `security-reviewer.md`

### AGG-C18-33 - Docker build-time env and runtime `.env.local` are split

- Severity/confidence: Medium / High
- Source agents: architect
- Citations: `apps/web/docker-compose.yml:7-21`, `apps/web/deploy.sh:15-31`, `apps/web/Dockerfile:65-70`, `apps/web/next.config.ts:28`, `apps/web/next.config.ts:98-105`, `README.md:148-149`, `apps/web/.env.local.example:9-16`

### AGG-C18-34 - `process-image` pipeline-version history omits current v7

- Severity/confidence: Low / High
- Source agents: document-specialist
- Citations: `apps/web/src/lib/process-image.ts` / docs regions cited in `document-specialist.md`

### AGG-C18-35 - Cycle-18 plan/index completion state is internally inconsistent

- Severity/confidence: Low / High
- Source agents: document-specialist
- Citations: `.context/plans/cycle-18-plan.md`, `.context/plans/README.md`

### AGG-C18-36 - First-run Categories has no empty state even though uploads require a category

- Severity/confidence: Medium / High
- Source agents: designer
- Citations: admin categories/upload UI regions cited in `designer.md`

### AGG-C18-37 - Token revoke confirmation uses a generic dialog and can hide in-flight feedback

- Severity/confidence: Medium / High
- Source agents: designer
- Citations: token management UI regions cited in `designer.md`

## Agent Failures

None.
