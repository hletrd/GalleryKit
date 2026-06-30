# Cycle 31 Aggregate Review

Date: 2026-06-30 KST
Reviewed HEAD at fan-out start: `f1dd39eb`
Current cycle note: `architect.md` and `document-specialist.md` were committed by a review lane as `b59280cc` while the fan-out was running; all other review files remained local artifacts for aggregation.

## Review Lanes

- `code-reviewer.md` and `critic.md`: code quality and critique.
- `perf-reviewer.md`, `debugger.md`, and `tracer.md`: performance, latent bugs, and causal tracing.
- `security-reviewer.md`: security and guardrail review.
- `verifier.md` and `test-engineer.md`: evidence and test coverage review.
- `architect.md` and `document-specialist.md`: architecture and docs/source consistency.
- `designer.md`, `product-marketer-reviewer.md`, and `ui-ux-designer-reviewer.md`: UI/UX plus available custom reviewer prompts.

## Deduped Findings

### C31-AGG-01 - Search mode toggle can commit stale results

- Severity: Medium
- Confidence: High
- Reported by: code-reviewer, critic
- Citations: `apps/web/src/components/search.tsx:151`, `apps/web/src/components/search.tsx:167`, `apps/web/src/components/search.tsx:240`, `apps/web/src/components/search.tsx:503`, `apps/web/src/__tests__/search-semantic-toggle-source.test.ts:14`
- Problem: the semantic toggle resets visible state but does not synchronously invalidate request ownership or abort an in-flight semantic fetch.
- Failure scenario: a visitor switches search modes while an old request is in flight, and the old mode repopulates results during the debounce gap.
- Fix: invalidate request ownership in the toggle handler and lock it with a source-contract test.

### C31-AGG-02 - File-level public-route exemption can hide an expensive GET

- Severity: Medium
- Confidence: High
- Reported by: code-reviewer, critic
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:505`, `apps/web/scripts/check-public-route-rate-limit.ts:527`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:197`
- Problem: a reasoned exemption for one handler can return before expensive GET analysis runs.
- Failure scenario: a future file combines an exempt webhook-style `POST` with an unmetered DB-backed `GET`, and the custom gate passes.
- Fix: fail closed when a file-level exemption coexists with more than one protected surface, including expensive GET handlers.

### C31-AGG-03 - Public expensive-GET gate misses local helper DB/CPU work

- Severity: Low
- Confidence: High
- Reported by: security-reviewer
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:57`, `apps/web/scripts/check-public-route-rate-limit.ts:279`, `apps/web/scripts/check-public-route-rate-limit.ts:527`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:132`
- Problem: expensive GET detection scans the exported handler text but does not trace local helper calls the way mutating detection does.
- Failure scenario: a future `GET` calls `await loadRows()` before the limiter; `loadRows()` performs `db.select()`, but the gate treats the route as cheap.
- Fix: compute local expensive helper closures and include those calls in expensive GET detection.

### C31-AGG-04 - Public expensive-GET gate ignores catch/finally expensive work

- Severity: Medium
- Confidence: High
- Reported by: verifier, test-engineer
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:352`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:163`
- Problem: `bodyCallsRateLimitBeforeExpensiveGetWork()` recurses only into `tryBlock`, ignores catch/finally, and discards the returned failure value at the top level.
- Failure scenario: a future public GET performs DB/file/image work in `catch` before any limiter; the gate passes because a limiter exists later in the try block.
- Fix: inspect catch/finally or fail closed when those branches contain expensive work before a dominating limiter.

### C31-AGG-05 - Atom feed routes perform full DB work before 304 and sit outside the public-route gate

- Severity: Medium
- Confidence: Medium
- Reported by: code-reviewer, critic
- Citations: `apps/web/src/app/feed.xml/route.ts:29`, `apps/web/src/app/feed.xml/route.ts:144`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:50`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:146`, `apps/web/scripts/check-public-route-rate-limit.ts:25`
- Problem: feeds compose rows and settings before honoring `If-Modified-Since`; the scanner only walks `src/app/api`.
- Failure scenario: direct feed pollers repeatedly request with a valid conditional header, and the app still does full public feed DB work.
- Fix: add a cheap freshness query before full feed composition and document/test the conditional fast path.

### C31-AGG-06 - CLIP inference slot handoff can exceed the configured concurrency cap

- Severity: Medium
- Confidence: High
- Reported by: perf-reviewer, debugger, tracer
- Citations: `apps/web/src/lib/clip-model.ts:53`, `apps/web/src/lib/clip-model.ts:117`, `apps/web/src/lib/clip-model.ts:148`, `apps/web/src/app/api/search/semantic/route.ts:247`, `apps/web/scripts/backfill-clip-embeddings.ts:179`
- Problem: a release decrements `activeInferenceCount` before resolving a waiter, so a fresh caller can steal the visible free slot before the waiter resumes.
- Failure scenario: with `CLIP_INFERENCE_CONCURRENCY=1`, two ONNX inferences can run concurrently during semantic search or production backfill bursts.
- Fix: make release transfer a reserved slot to one waiter, and add a contract test for the handoff shape.

### C31-AGG-07 - Semantic retrieval is brute-force newest-window scoring on the public request path

- Severity: Medium
- Confidence: High
- Reported by: architect
- Citations: `apps/web/src/lib/clip-embeddings.ts:36`, `apps/web/src/app/api/search/semantic/route.ts:263`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`, `README.md:42`, `CLAUDE.md:553`
- Problem: semantic and similar search scan newest embeddings from MySQL and score vectors in the web process.
- Failure scenario: when embeddings exceed `SEMANTIC_SCAN_LIMIT`, older relevant photos are unretrievable; raising the limit increases request-path CPU/DB work.
- Fix: defer to a search-owned boundary/vector-index plan; add operator warning or health visibility before larger galleries.

### C31-AGG-08 - Firefox HDR/dynamic-range docs are stale

- Severity: Medium
- Confidence: High
- Reported by: document-specialist
- Citations: `CLAUDE.md:367`, `apps/web/src/lib/use-display-capability.ts:72`, `apps/web/src/lib/use-display-capability.ts:91`
- Problem: docs say Firefox does not implement `(dynamic-range: high)` and always reports non-HDR, while current compatibility data says Firefox supports the media feature and the code feature-detects it.
- Failure scenario: future reviewers suppress valid Firefox HDR checks based on stale docs.
- Fix: update the docs/comments to split Firefox `color-gamut` caveats from `dynamic-range` capability.

### C31-AGG-09 - Embedded source line references in `CLAUDE.md` have drifted

- Severity: Low
- Confidence: High
- Reported by: document-specialist
- Citations: `CLAUDE.md:127`, `CLAUDE.md:161`, `CLAUDE.md:172`, `CLAUDE.md:308`
- Problem: several long-lived source line references point one or more lines away from current symbols.
- Failure scenario: agents and contributors inspect the wrong region or treat a navigation mismatch as a source/docs defect.
- Fix: replace brittle line references with symbol/search-string pointers.

### C31-AGG-10 - Mobile home delays photo-first experience behind tag filters

- Severity: Medium
- Confidence: High
- Reported by: designer, product-marketer-reviewer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/home-client.tsx:255`, `apps/web/src/components/home-client.tsx:273`, `apps/web/src/components/tag-filter.tsx:63`, `apps/web/src/components/tag-filter.tsx:120`
- Problem: at `390x844`, wrapped tag chips consume roughly 200px before the first photo card.
- Failure scenario: first-time mobile visitors see taxonomy controls before photography.
- Fix: collapse, horizontally scroll, or cap mobile filters while preserving the active filter.

### C31-AGG-11 - Idle lightbox can hide all actionable controls from the accessibility tree

- Severity: Medium
- Confidence: Medium
- Reported by: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/lightbox.tsx:201`, `apps/web/src/components/lightbox.tsx:371`, `apps/web/src/components/lightbox.tsx:546`, `apps/web/src/components/lightbox.tsx:555`
- Problem: when controls auto-hide, essential modal controls are `aria-hidden` and `tabIndex=-1`.
- Failure scenario: a screen-reader, switch, or voice-control user idles in the modal and only sees an image in the dialog.
- Fix: keep close and navigation controls in the accessibility tree while visually hidden, or add a persistent accessible command group.

### C31-AGG-12 - Search status is announced twice to assistive tech

- Severity: Low
- Confidence: High
- Reported by: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:473`
- Problem: the same search status appears in an `sr-only` live region and visible text.
- Failure scenario: screen-reader users hear duplicate failure/status messages.
- Fix: keep one live announcement path and hide the duplicate visible status from AT.

### C31-AGG-13 - Photo card links can expose repetitive accessible text

- Severity: Low
- Confidence: Medium
- Reported by: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/home-client.tsx:323`, `apps/web/src/components/home-client.tsx:353`, `apps/web/src/components/home-client.tsx:395`, `apps/web/src/components/home-client.tsx:401`
- Problem: card link `aria-label`, image alt, and overlay text can repeat title/topic text.
- Failure scenario: screen-reader traversal of masonry cards becomes verbose.
- Fix: keep one authoritative accessible name per card and make duplicate overlay copy decorative for AT.

### C31-AGG-14 - Live production search failed for a visible tag term

- Severity: Medium
- Confidence: High
- Reported by: designer, product-marketer-reviewer
- Citations: `apps/web/src/components/search.tsx:160`, `apps/web/src/components/search.tsx:270`, `apps/web/src/components/search.tsx:473`
- Problem: live `https://gallery.atik.kr/en` returned a generic unavailable state for `jihoon` while `JIHOON` was visible as a tag.
- Failure scenario: users searching an obvious performer name lose trust in gallery discovery.
- Fix: investigate backend/runtime cause; add a graceful tag/local fallback if full search is unavailable.

### C31-AGG-15 - RTL readiness is partial

- Severity: Low
- Confidence: High
- Reported by: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/app/[locale]/layout.tsx:94`, `apps/web/src/components/nav-client.tsx:19`, `apps/web/src/components/lightbox.tsx:555`, `apps/web/src/components/nav-client.tsx:100`
- Problem: `dir` is wired, but exposed locales are English/Korean and several controls use physical direction utilities.
- Failure scenario: adding Arabic/Hebrew later would flip text direction without correct spatial affordances.
- Fix: defer until an RTL locale is planned, then convert directional layout to logical utilities and add RTL snapshots.

### C31-AGG-16 - Routine UI transition timings are slow for repeated browsing

- Severity: Low
- Confidence: High
- Reported by: ui-ux-designer-reviewer
- Citations: `apps/web/src/app/globals.css:253`, `apps/web/src/components/home-client.tsx:357`, `apps/web/src/components/photo-viewer.tsx:718`
- Problem: reduced motion exists, but default hover/sidebar transitions use `duration-500`.
- Failure scenario: repeated browsing feels slightly sluggish for power users.
- Fix: reduce routine transitions to 150-250ms while keeping longer motion for deliberate viewer transitions.

### C31-AGG-17 - Brand signal under-explains specialist value

- Severity: Low
- Confidence: Medium
- Reported by: product-marketer-reviewer
- Citations: `apps/web/src/components/nav-client.tsx:91`, `apps/web/src/components/home-client.tsx:255`, `apps/web/src/components/footer.tsx:34`
- Problem: the public UI communicates "gallery" but not the color-aware, photographer-authored specialist value.
- Failure scenario: new visitors do not understand why the gallery differs from generic photo hosting.
- Fix: add a quiet support line near the home H1 or footer.

### C31-AGG-18 - Search failures lack a helpful recovery action

- Severity: Low
- Confidence: High
- Reported by: product-marketer-reviewer
- Citations: `apps/web/src/components/search.tsx:473`, `apps/web/src/components/home-client.tsx:426`
- Problem: whole-page failures provide recovery actions, but command-level search failures only show a generic unavailable message.
- Failure scenario: partial search outage is a dead end.
- Fix: provide a recovery path such as clearing the query, opening visible tags, or browsing latest photos.

### C31-AGG-19 - Restore regression test is source-order only

- Severity: Low
- Confidence: Medium
- Reported by: test-engineer
- Citations: `apps/web/src/__tests__/restore-upload-lock.test.ts:103`, `apps/web/src/app/[locale]/admin/db-actions.ts:493`
- Problem: the test searches source ordering rather than executing the partial prepare failure path.
- Failure scenario: a refactor preserves strings/order but breaks resume behavior after quiesce succeeds and drain fails.
- Fix: add an executable module-level test with mocks for queue, background writes, maintenance, locks, and connection acquisition.

### C31-AGG-20 - Cycle-30 plan files fail whitespace check

- Severity: Low
- Confidence: High
- Reported by: verifier, test-engineer
- Citations: `.context/plans/cycle-30-2026-06-30-plan.md:3`, `.context/plans/cycle-30-2026-06-30-deferred.md:3`
- Problem: `git show --check HEAD` reports trailing whitespace in committed plan artifacts.
- Failure scenario: static whitespace checks fail on HEAD and create noise for future automation.
- Fix: remove trailing spaces.

## Manual Validation Risks

### C31-AGG-MV-01 - Public TLS/header-trust topology must match the internal-hop nginx design

- Severity: Medium
- Confidence: Medium
- Reported by: security-reviewer
- Citations: `apps/web/nginx/default.conf:21`, `apps/web/nginx/default.conf:67`, `apps/web/docker-compose.yml:20`, `apps/web/src/lib/request-origin.ts:45`, `apps/web/src/lib/rate-limit.ts:166`
- Required validation: confirm production cleartext traffic is redirected or terminated before nginx, only trusted proxies can reach the app, and `TRUSTED_PROXY_HOPS` matches the actual chain.

### C31-AGG-MV-02 - Admin DB restore trusts dump provenance and DB grants

- Severity: Medium
- Confidence: Medium
- Reported by: security-reviewer
- Citations: `apps/web/src/lib/sql-restore-scan.ts:12`, `apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:620`
- Required validation: verify production MySQL grants are limited to the app schema and treat restore dumps as privileged artifacts.

### C31-AGG-MV-03 - Public map exact-GPS publication depends on operator intent

- Severity: Low
- Confidence: High
- Reported by: security-reviewer
- Citations: `apps/web/src/lib/data.ts:410`, `apps/web/src/lib/data.ts:1660`, `apps/web/src/app/actions/topics.ts:600`
- Required validation: confirm the admin UX/runbook makes exact coordinate publication clear before enabling map visibility.

### C31-AGG-MV-04 - Some public expensive-route limits remain process-local

- Severity: Low
- Confidence: Medium
- Reported by: security-reviewer
- Citations: `apps/web/src/lib/rate-limit.ts:78`, `apps/web/src/lib/rate-limit.ts:320`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:98`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:104`
- Required validation: keep production single-instance or move these limits to shared/edge storage before horizontal scaling.

## AGENT FAILURES / RETRIES

- Initial designer/custom reviewer spawn failed with `agent thread limit reached`; it was retried after another lane completed and then produced `designer.md`, `product-marketer-reviewer.md`, and `ui-ux-designer-reviewer.md`.
- No reviewer failed after retry.

## Validation Evidence Reported By Reviewers

- `npm run lint:api-auth --workspace=apps/web`: passed in security lane.
- `npm run lint:action-origin --workspace=apps/web`: passed in security lane.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed in multiple lanes.
- `npm audit --workspace=apps/web --audit-level=high`: passed in security lane.
- Targeted Vitest slices passed in code-reviewer, verifier, test-engineer, and security lanes.
- UI/UX lane exercised production with `agent-browser`; local dev rendered but data was blocked by MySQL `ECONNREFUSED`.
