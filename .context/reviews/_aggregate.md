# Cycle 30/100 Aggregate Review

Date: 2026-06-30 KST
HEAD reviewed by agents: `6938659b` plus committed cycle-30 review artifacts
Status: Prompt 1 complete; implementation planning follows in `.context/plans/cycle-30-2026-06-30-plan.md`

## Agent Coverage

Review agents completed and wrote provenance files:

- `code-reviewer`: `.context/reviews/code-reviewer.md`
- `architect`: `.context/reviews/architect.md`
- `security-reviewer`: `.context/reviews/security-reviewer.md`
- `perf-reviewer`: `.context/reviews/perf-reviewer.md`
- `performance-reviewer`: `.context/reviews/performance-reviewer.md`
- `tracer`: `.context/reviews/tracer.md`
- `verifier`: `.context/reviews/verifier.md`
- `debugger`: `.context/reviews/debugger.md`
- `test-engineer`: `.context/reviews/test-engineer.md`
- `document-specialist`: `.context/reviews/document-specialist.md`
- `critic`: `.context/reviews/critic.md`
- `designer`: `.context/reviews/designer.md`
- `ui-ux-designer-reviewer`: `.context/reviews/ui-ux-designer-reviewer.md`
- `product-marketer-reviewer`: `.context/reviews/product-marketer-reviewer.md`

UI/UX review was included because this repository contains a Next.js web UI. The designer lane used live/browser evidence against the public gallery where feasible and cited text-extractable findings in its review files.

## Merged Findings

### AGG-C30-01 - Restore prep can leave the image-processing queue paused after partial setup failure

- Source agents: debugger
- Severity/confidence: High / High
- Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts`, restore prep sequence around `quiesceImageProcessingQueueForRestore()`, `drainBackgroundDbWritesForRestore()`, and `imageQueueQuiesced`.
- Problem: if quiescing the image queue succeeds but a later restore-prep step fails before `imageQueueQuiesced` is set, the cleanup path can skip queue resume even though the queue is already paused.
- Failure scenario: a transient DB/write-drain failure during restore preparation leaves normal image processing paused after restore fails early.
- Suggested fix: mark the queue as quiesced immediately after the quiesce call succeeds, before later prep steps, and lock the ordering in a regression test.

### AGG-C30-02 - Map privacy tests do not execute `getMapImages()`

- Source agents: verifier, test-engineer
- Severity/confidence: High / High (highest from test-engineer)
- Evidence: `apps/web/src/__tests__/map-privacy.test.ts`; `apps/web/src/lib/data.ts` `getMapImages()`.
- Problem: existing coverage checked source strings and reimplemented guard logic, but did not run the production function that exposes GPS-bearing public map rows.
- Failure scenario: a refactor can preserve strings or test-only guard logic while changing the actual query/return path, weakening the map privacy contract without a failing behavior test.
- Suggested fix: add a mocked DB-chain behavior test that invokes `getMapImages()`, verifies the map-visible/GPS query shape, and verifies the runtime leak guard throws on a bad row.

### AGG-C30-03 - Expensive public GET linting proves limiter presence, not limiter dominance

- Source agents: verifier
- Severity/confidence: Medium / Medium
- Evidence: `apps/web/scripts/check-public-route-rate-limit.ts`; `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- Problem: the public route scanner accepted an expensive GET handler if a rate-limit helper appeared anywhere in the handler body, even after DB/image/embedding work.
- Failure scenario: a public route could run expensive work and only then reject as rate-limited, defeating the protection during abuse.
- Suggested fix: require a pre-increment rate-limit gate before expensive marker statements for public expensive GET handlers and add passing/failing tests.

### AGG-C30-04 - `AGENTS.md` contradicts the public-route rate-limit GET gate

- Source agents: document-specialist
- Severity/confidence: Medium / High
- Evidence: `AGENTS.md` quality-gate list; `apps/web/scripts/check-public-route-rate-limit.ts`.
- Problem: docs still said GET handlers are not scanned even though the gate scans expensive GET handlers.
- Failure scenario: future agents may add or review public GET routes using stale instructions and accidentally weaken rate-limit coverage.
- Suggested fix: update the AGENTS gate description to mention expensive GET handlers and cheap operational GET exemptions.

### AGG-C30-05 - Live keyword search fails for a normal visible gallery term

- Source agents: critic, designer, ui-ux-designer-reviewer, product-marketer-reviewer
- Severity/confidence: High / High for live symptom, Medium for root cause
- Evidence: live browser review of the public search UI, plus search UI copy in `apps/web/src/components/search.tsx` and messages in `apps/web/messages/*.json`.
- Problem: the live demo returned a generic failure for a normal query, blocking a primary discovery workflow and weakening the "operator-controlled search" claim.
- Failure scenario: visitors search for a visible name/term, receive a generic failure, and cannot distinguish temporary search unavailability from no results or input issues.
- Suggested fix: make the generic failure copy accurately state temporary unavailability, keep short-query UX distinct, and validate the production root cause with logs or live request evidence when available.

### AGG-C30-06 - `/api/health` behavior/docs need liveness-vs-readiness clarity

- Source agents: verifier, debugger
- Severity/confidence: Medium / High
- Evidence: `apps/web/src/app/api/health/route.ts`; `apps/web/src/__tests__/health-route.test.ts`; docs references in `README.md`, `apps/web/README.md`, and `CLAUDE.md`.
- Problem: reviewers flagged potential confusion around default liveness-only behavior versus optional DB readiness and restore-maintenance responses.
- Failure scenario: an operator points a public liveness probe at a readiness mode or interprets restore-maintenance `503` as a container crash instead of intentional unavailability.
- Suggested fix: retain current tests and docs if they are already aligned; otherwise clarify docs.

### AGG-C30-07 - Dormant local storage backend validates a path, then reopens by path

- Source agents: code-reviewer, architect
- Severity/confidence: Medium / Medium (architect), Low / Medium (code-reviewer)
- Evidence: `apps/web/src/lib/storage/local.ts`; contrast with `apps/web/src/lib/serve-upload.ts` and `apps/web/src/lib/process-image.ts`.
- Problem: the future storage abstraction does not preserve the live pipeline's opened-handle read validation and atomic temp-rename write behavior.
- Failure scenario: if future image/resource paths are routed through this backend, readers may observe partial writes or path swaps between validation and open.
- Suggested fix: harden the backend before live adoption or explicitly quarantine it as not suitable for the live image pipeline.

### AGG-C30-08 - Service worker LRU metadata updates can lose entries under concurrent image fetches

- Source agents: perf-reviewer, performance-reviewer, tracer
- Severity/confidence: Medium / High
- Evidence: `apps/web/public/sw.template.js` image-cache metadata update flow.
- Problem: concurrent cache writes can read, mutate, and write shared metadata without serialization.
- Failure scenario: one fetch overwrites another fetch's metadata update, causing inaccurate LRU pruning and cache growth/eviction drift.
- Suggested fix: serialize image-cache metadata updates or use a merge/update helper that re-reads before commit.

### AGG-C30-09 - Color pipeline sidecar materializes all candidates and schedules all tasks before draining

- Source agents: perf-reviewer, performance-reviewer, tracer
- Severity/confidence: Medium / High
- Evidence: `scripts/backfill-color-pipeline.ts`.
- Problem: the sidecar can materialize all candidate rows and enqueue all tasks up front instead of bounded causal batches.
- Failure scenario: large libraries put avoidable memory and queue pressure on the sidecar/DB during operator backfills.
- Suggested fix: page candidates and schedule bounded batches with progress persisted between batches.

### AGG-C30-10 - Public map can serialize and hydrate up to 10,000 markers plus a 10,000-item fallback list

- Source agents: perf-reviewer, performance-reviewer, critic, designer, ui-ux-designer-reviewer, product-marketer-reviewer
- Severity/confidence: Medium / High
- Evidence: `apps/web/src/lib/data.ts` `MAP_MAX_MARKERS`; `apps/web/src/app/[locale]/(public)/map/page.tsx`; `apps/web/src/components/map/map-client.tsx`.
- Problem: the DB cap prevents unbounded queries but still permits a very large client payload, DOM/list fallback, and assistive-technology surface.
- Failure scenario: a map-visible collection near the cap creates slow mobile hydration and overwhelming keyboard/screen-reader navigation.
- Suggested fix: add clustering, viewport/bbox loading, accessible pagination/virtualization, and smaller initial payload limits.

### AGG-C30-11 - Semantic and similar search remain request-thread brute-force scans

- Source agents: architect, perf-reviewer, performance-reviewer, tracer, critic, designer, product-marketer-reviewer
- Severity/confidence: Medium / High
- Evidence: `apps/web/src/lib/clip-embeddings.ts`; `apps/web/src/app/api/search/semantic/route.ts`; `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Problem: semantic requests read and score many embeddings in the Next.js request process, bounded only by configurable scan caps.
- Failure scenario: higher corpus size or raised scan limits can monopolize CPU/DB time and make older relevant images undiscoverable beyond the newest-first scan window.
- Suggested fix: move retrieval behind a vector/search boundary, precomputed candidate layer, worker architecture, or measured production cap.

### AGG-C30-12 - Public exact counts remain on dynamic first-page and smart-collection queries

- Source agents: perf-reviewer, performance-reviewer, tracer
- Severity/confidence: Medium / High
- Evidence: `apps/web/src/lib/data.ts` first-page listing and smart collection count paths.
- Problem: exact grouped totals still run on hot public paths.
- Failure scenario: first paint for listing pages couples to count-query cost as the gallery grows.
- Suggested fix: replace exact totals with cached/approximate/deferred counts where product copy permits.

### AGG-C30-13 - Leading-wildcard public search predicates can force text scans

- Source agents: perf-reviewer, performance-reviewer
- Severity/confidence: Medium / Medium
- Evidence: `apps/web/src/lib/data.ts` public keyword search; `apps/web/src/app/actions/public.ts`.
- Problem: contains-style predicates are hard for MySQL indexes to satisfy.
- Failure scenario: search traffic over a larger corpus burns DB CPU even when results are limited.
- Suggested fix: use a full-text/ngram/search index or a dedicated search path.

### AGG-C30-14 - Real CLIP activation tests are skipped by default CI

- Source agents: test-engineer
- Severity/confidence: Medium / High
- Evidence: `apps/web/src/__tests__/clip-offline-load.test.ts`; `apps/web/src/__tests__/clip-semantic-integration.test.ts`; CI workflow.
- Problem: real model loading/integration tests depend on external weights and are skipped by default.
- Failure scenario: dependency/runtime drift breaks production CLIP activation while the normal gate remains green.
- Suggested fix: add scheduled or release-gated CI with cached weights and explicit operator-mode validation.

### AGG-C30-15 - Important public pages lack browser smoke coverage

- Source agents: test-engineer
- Severity/confidence: Medium / High
- Evidence: `apps/web/e2e/**`; public route set under `apps/web/src/app/[locale]/(public)`.
- Problem: map/timeline/year/smart-collection public flows are not covered by browser smoke tests.
- Failure scenario: SSR/hydration or responsive issues ship despite unit/source gates.
- Suggested fix: add seeded Playwright smoke flows for the missing public pages.

### AGG-C30-16 - Nav visual tests save screenshots but do not compare baselines

- Source agents: test-engineer
- Severity/confidence: Low / High
- Evidence: `apps/web/e2e/nav-visual-check.spec.ts`.
- Problem: screenshot artifacts are captured but not asserted against baselines.
- Failure scenario: visual regressions are only noticed manually after reviewing artifacts.
- Suggested fix: adopt stable screenshot baselines or remove "visual" implication from the test name/docs.

### AGG-C30-17 - E2E browser matrix is desktop Chromium only

- Source agents: test-engineer
- Severity/confidence: Medium / High
- Evidence: `apps/web/playwright.config.ts`; CI workflow.
- Problem: WebKit/mobile/P3-relevant browser behavior is not covered in the regular E2E matrix.
- Failure scenario: Safari/mobile rendering or interaction regressions escape gates.
- Suggested fix: add targeted WebKit/mobile lanes for color/navigation/gallery-critical paths when CI budget allows.

### AGG-C30-18 - Share links can be created from UI but not listed or revoked from UI

- Source agents: critic, designer, ui-ux-designer-reviewer, product-marketer-reviewer
- Severity/confidence: Medium / High
- Evidence: share creation UI/actions versus lack of admin management/revoke affordance.
- Problem: share lifecycle is incomplete for client-delivery trust.
- Failure scenario: an admin creates a link, later cannot discover or revoke it through the UI after circumstances change.
- Suggested fix: build a share management UI that lists active links, exposes metadata, and calls existing revoke/delete capabilities.

### AGG-C30-19 - Search result list keyboard behavior is unproven because live results fail

- Source agents: ui-ux-designer-reviewer
- Severity/confidence: Medium / Medium
- Evidence: live browser search failure and `apps/web/src/components/search.tsx`.
- Problem: the result-list keyboard design cannot be validated end-to-end while normal live search returns errors.
- Failure scenario: focus/keyboard issues in result navigation remain hidden behind the failure path.
- Suggested fix: after search works live, run browser/a11y smoke coverage for search results.

### AGG-C30-20 - Generic route error shell hides product-specific recovery context

- Source agents: critic, designer, ui-ux-designer-reviewer
- Severity/confidence: Low-Medium / Medium
- Evidence: `apps/web/src/app/[locale]/error.tsx` and live DB/search failure UX.
- Problem: generic public error copy does not distinguish gallery maintenance, search unavailability, DB outage, or retryable failures.
- Failure scenario: users see a generic shell with no useful next action or expectation.
- Suggested fix: add context-aware error states for public gallery failures.

### AGG-C30-21 - Semantic-search copy is prominent relative to operational maturity

- Source agents: designer, product-marketer-reviewer
- Severity/confidence: Medium / High
- Evidence: README/public copy and search UI positioning.
- Problem: semantic search is honestly gated, but still prominent next to a failing baseline search path and operational setup complexity.
- Failure scenario: visitors infer AI search is a polished core feature while operator state or fallback behavior is not ready.
- Suggested fix: rebalance copy and status indicators after live search and semantic ops validation.

### AGG-C30-22 - Backup completeness remains easy to misunderstand

- Source agents: product-marketer-reviewer
- Severity/confidence: Low-Medium / Medium
- Evidence: top-level README backup/private-original positioning.
- Problem: SQL backup/restore is easy to confuse with full rollback of DB plus mutable file stores.
- Failure scenario: an operator keeps SQL dumps but misses private originals, derivatives, or runtime resources needed for full restore.
- Suggested fix: keep DB-vs-file backup wording prominent in README/deploy docs.

### AGG-C30-23 - Public TLS/header-trust topology needs live validation

- Source agents: security-reviewer, performance-reviewer, tracer
- Severity/confidence: Medium / Medium
- Evidence: `TRUST_PROXY`/nginx topology, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`.
- Problem: source assumes documented trusted-hop topology; production must match it.
- Failure scenario: direct app exposure or forwarded-header chain mismatch can break origin checks or rate-limit identity.
- Suggested fix: validate the deployed edge chain and document the observed hop configuration.

### AGG-C30-24 - Admin DB restore dump provenance and grants are a hard trust boundary

- Source agents: security-reviewer
- Severity/confidence: Medium / Medium
- Evidence: admin DB restore path in `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Problem: restore intentionally imports security-sensitive tables from SQL dumps.
- Failure scenario: an admin imports an untrusted or tampered dump and restores malicious admin/session/settings state.
- Suggested fix: keep restore admin-only, document dump provenance requirements, and validate operational grants.

### AGG-C30-25 - Public map publishes exact GPS for opted-in topics; operator intent must be verified

- Source agents: security-reviewer
- Severity/confidence: Low / High
- Evidence: `apps/web/src/lib/data.ts` map select and admin topic map-visible behavior.
- Problem: the behavior is intentional but privacy-sensitive.
- Failure scenario: an operator toggles map visibility without understanding exact GPS publication.
- Suggested fix: retain explicit admin confirmation/copy and validate operator understanding in UX.

### AGG-C30-26 - Timeline archive date functions need production scale validation

- Source agents: perf-reviewer, performance-reviewer, tracer
- Severity/confidence: Low / Medium
- Evidence: `apps/web/src/lib/data-timeline.ts`.
- Problem: non-sargable date extraction is documented but still scale-dependent.
- Failure scenario: archive routes become slow on larger datasets.
- Suggested fix: run production `EXPLAIN`/slow-query validation before archive scale grows.

### AGG-C30-27 - Queue/deploy shutdown budget may be too small for worst-case image side effects

- Source agents: performance-reviewer
- Severity/confidence: Low / Low
- Evidence: queue/deploy shutdown interactions and image side-effect paths.
- Problem: worst-case shutdown duration is not measured.
- Failure scenario: deploy shutdown truncates long-running image work.
- Suggested fix: measure shutdown under large in-flight processing and tune budget if needed.

## AGENT FAILURES

None. Named specialist roles were not all directly available as native callable agent names, so review lanes were grouped through available native subagents; each required reviewer perspective produced its own provenance file. No lane remained failed after retry.
