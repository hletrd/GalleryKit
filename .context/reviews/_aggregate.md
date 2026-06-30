# Cycle 22 Review Aggregate

Date: 2026-06-30
Base reviewed: current `master` after cycle 21 plus cycle-22 review artifact commits.

## Agent Coverage

Callable native agent roles in this environment were `default`, `explorer`, and `worker`; the requested specialist names were therefore executed as worker lanes with specialist prompts. The environment allowed five concurrent child agents in practice, so the fan-out ran in bounded waves. No requested lane failed after retry.

Completed review lanes:

- `code-reviewer`
- `perf-reviewer`
- `security-reviewer`
- `critic`
- `verifier`
- `test-engineer`
- `tracer`
- `architect`
- `debugger`
- `document-specialist`
- `designer`
- discovered reviewer prompt: `product-marketer-reviewer`
- discovered reviewer prompt: `ui-ux-designer-reviewer`

UI review was in scope because this is a Next/React app. The designer lane used `agent-browser` against a local app on `http://localhost:3001`, recorded the local DB `ECONNREFUSED` fallback, and backed findings with browser/source/test evidence.

## Findings Summary

Total deduped findings: 31

- High: 4
- Medium: 17
- Low / Low-Medium: 10

Cross-agent agreement is noted below. Items reported by multiple agents should be treated as higher signal than their raw severity alone.

## High

### AGG22-01 - Advisory-lock callers can leak acquired MySQL locks

Severity: High  
Confidence: High  
Status: confirmed  
Reported by: `code-reviewer` (`CR22-CR-01`), `verifier` (`V22-01`)

Evidence: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, and `apps/web/scripts/backfill-color-pipeline.ts` use advisory-lock result checks that accept numeric `1` but reject `BigInt(1)`, while sibling lock code treats both as acquired.

Failure scenario: a MySQL driver returns `1n`; the app has acquired the lock but the helper throws before releasing it, pinning lock state to the pooled session and making later work fail or serialize incorrectly.

Suggested fix: normalize advisory-lock scalar values through one helper that accepts `1`, `1n`, and equivalent driver string forms where appropriate; use it at every `GET_LOCK` / `RELEASE_LOCK` call site and add regression tests for `bigint`.

### AGG22-02 - Settings exposes site-wide derivative re-encode as a one-click action

Severity: High  
Confidence: High  
Status: confirmed UX risk  
Reported by: `designer`, `ui-ux-designer-reviewer`; related marketing truthfulness issue in `product-marketer-reviewer`

Evidence: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` exposes the re-encode/backfill trigger without an explicit confirmation step.

Failure scenario: an admin intending to save ordinary settings starts a CPU/disk intensive gallery-wide re-encode, slowing the single web instance and creating operational surprise.

Suggested fix: require an explicit confirmation dialog with scope, cost, and cancel/confirm language before starting re-encode. Keep the existing server-side maintenance guards.

### AGG22-03 - README "without handing analytics to SaaS" conflicts with optional Google Analytics

Severity: High  
Confidence: High  
Status: confirmed documentation/positioning mismatch  
Reported by: `product-marketer-reviewer`

Evidence: `apps/web/README.md` positions GalleryKit as avoiding SaaS analytics, while `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`, and runtime config support `google_analytics_id`.

Failure scenario: privacy-focused users trust the README claim, deploy with inherited config, and unintentionally enable third-party analytics.

Suggested fix: make the README precise: self-hosted analytics are built in; optional Google Analytics exists and is disabled unless configured.

### AGG22-04 - Public P3 badge is visually present but hidden from assistive tech

Severity: High/Medium (highest reported Medium, escalated by accessibility impact)  
Confidence: High  
Status: confirmed  
Reported by: `ui-ux-designer-reviewer`

Evidence: public masonry/card P3 badge markup in `apps/web/src/components/grid-picture.tsx` or its badge rendering path is visual-only / `aria-hidden` while it communicates color-delivery information.

Failure scenario: screen-reader users cannot discover wide-gamut/HDR delivery state that sighted users see.

Suggested fix: add an accessible label or screen-reader text for meaningful color badges while preserving decorative hidden status only for duplicated icons.

## Medium

### AGG22-05 - Smart-collection tag predicates accept numeric values but compile as tag-name strings

Severity: Medium  
Confidence: High  
Status: confirmed correctness issue  
Reported by: `code-reviewer` (`CR22-CR-02`), `verifier` (`V22-02`)

Evidence: smart-collection validation accepts numeric tag predicate values while query compilation treats them as tag-name strings.

Failure scenario: a stored predicate using a numeric tag id returns no matches or wrong matches, making dynamic public collections silently incomplete.

Suggested fix: align validator and compiler. Either reject non-string tag values at parse time or compile numeric values as ids. Add regression tests.

### AGG22-06 - `CLAUDE.md` still documents stale Docker compose commands

Severity: Medium  
Confidence: High  
Status: confirmed doc/operator mismatch  
Reported by: `architect`, `critic`, `verifier`, `document-specialist`

Evidence: `CLAUDE.md` still includes lower-level `docker compose -f apps/web/docker-compose.yml up -d --build` commands despite repo policy that deploys go through `npm run deploy` and `.env.deploy`.

Failure scenario: an operator follows stale docs and bypasses the remote deploy helper or required env-driven build/deploy path.

Suggested fix: update lower-level commands to clearly mark local/manual use only and point normal production deployment to `npm run deploy`.

### AGG22-07 - Upload ingest has multiple implementation owners

Severity: Medium  
Confidence: High  
Status: architecture risk  
Reported by: `architect`, `critic`

Evidence: browser upload and Lightroom/PAT upload paths duplicate ingest logic around original persistence, quota, validation, metadata, and queue creation.

Failure scenario: a future privacy, quota, or image-processing fix lands in one ingest owner and not the other.

Suggested fix: extract a shared ingest service with route-specific auth/body parsing only at the edge.

### AGG22-08 - Queue workers can pin most shared MySQL pool connections during image encoding

Severity: Medium  
Confidence: High  
Status: performance/architecture risk  
Reported by: `architect`, `critic`

Evidence: queue/backfill workers hold DB/advisory-lock resources around Sharp work on the same pool used by live requests.

Failure scenario: long image processing saturates the shared 10-connection pool and causes live gallery/admin traffic to queue behind background work.

Suggested fix: shorten lock/connection hold time or move long-running image encode coordination to dedicated connections/pools with explicit budget tests.

### AGG22-09 - Single-process topology is documented but not enforced

Severity: Medium  
Confidence: High  
Status: deployment architecture risk  
Reported by: `architect`, `critic`

Evidence: process-local queues/rate limits/maintenance state assume one web instance, but code/config do not fail closed if scaled.

Failure scenario: an operator scales the web service horizontally and weakens rate limits, upload coordination, and maintenance state.

Suggested fix: add a startup/config guard or explicit instance-count contract, and document how to migrate to shared coordination before scale-out.

### AGG22-10 - Mutable `topics.slug` natural key requires manual fan-out

Severity: Medium  
Confidence: High  
Status: data consistency risk  
Reported by: `architect`, `critic`

Evidence: topic slug is used as a natural key across images/views/routes and rename paths manually update dependents.

Failure scenario: an interrupted rename or missed future table leaves orphaned topic references.

Suggested fix: move to immutable topic ids for relational state or centralize transactional rename fan-out with regression coverage for every dependent table.

### AGG22-11 - Upload quota settlement still depends on hand-maintained settle points

Severity: Medium  
Confidence: High  
Status: correctness/testability risk  
Reported by: `critic`, `debugger`, `test-engineer`

Evidence: quota claim/settle/release invariants are protected by source topology checks and comments more than stateful failure-path tests.

Failure scenario: a future early return after quota claim leaks quota and blocks later uploads.

Suggested fix: wrap upload claim lifecycle in a structured scope/helper and add stateful failure tests around all error paths.

### AGG22-12 - Public error boundary drops the site shell and can strand users

Severity: Medium  
Confidence: High  
Status: confirmed UI risk  
Reported by: `designer`, `ui-ux-designer-reviewer`

Evidence: `apps/web/src/app/[locale]/error.tsx` renders an error state without the normal public navigation shell and routes retry/back behavior toward the same failing route.

Failure scenario: a transient home/gallery error leaves visitors without navigation to working topic/share/privacy pages.

Suggested fix: render the public shell/navigation in the route error boundary and provide a stable home/link escape.

### AGG22-13 - Token plaintext dialog shows dismiss controls that intentionally do nothing

Severity: Medium  
Confidence: High  
Status: confirmed UX issue  
Reported by: `designer`, `ui-ux-designer-reviewer`

Evidence: token creation dialog keeps a close affordance visible even while dismissal is blocked until acknowledgment.

Failure scenario: admins click close/Escape, nothing happens, and the modal feels broken at the exact moment a secret must be copied.

Suggested fix: hide/disable misleading dismiss controls or make them open an explicit acknowledgment path.

### AGG22-14 - Lightroom upload route lacks route-behavior regression coverage

Severity: Medium  
Confidence: High  
Status: test gap  
Reported by: `test-engineer`

Evidence: scanner/source-text fixtures guard route shape, but the external upload API lacks enough behavioral tests proving auth scope, limits, and route responses.

Failure scenario: a refactor satisfies source scanners while route behavior regresses for Lightroom clients.

Suggested fix: add route-level tests for accepted/rejected token scopes, body limits where feasible, and successful queued upload response shape.

### AGG22-15 - CLIP inference pool tests rely on string matching instead of concurrency behavior

Severity: Medium  
Confidence: Medium/High  
Status: test gap  
Reported by: `test-engineer`

Evidence: tests assert structural strings rather than exercising queue saturation, abort removal, timeout, and concurrency bounds.

Failure scenario: semaphore/pending-queue behavior regresses while string fixtures remain unchanged.

Suggested fix: add deterministic fake-inference concurrency tests.

### AGG22-16 - Real CLIP/offline model smoke coverage is skipped by default

Severity: Medium  
Confidence: Medium/High  
Status: test/ops gap  
Reported by: `test-engineer`

Evidence: production semantic search path depends on offline model weights, but default gates use mocks.

Failure scenario: deployment goes green while the real offline model cannot load on the production platform.

Suggested fix: add an opt-in smoke test/runbook gate for seeded model environments.

### AGG22-17 - Admin image management remains desktop-table-only on narrow screens

Severity: Medium  
Confidence: High  
Status: UI responsiveness issue  
Reported by: `ui-ux-designer-reviewer`; similar cycle-21 issue carried forward

Evidence: admin image management uses a table/horizontal panning layout as the only management surface.

Failure scenario: mobile or narrow-window admins must horizontally pan to perform repeated management tasks.

Suggested fix: add responsive card/list rows or a shared responsive data-surface primitive.

### AGG22-18 - Route/file comments overstate Next.js route-handler extension support

Severity: Medium/Low  
Confidence: High  
Status: documentation mismatch  
Reported by: `document-specialist`

Evidence: route-file extension comments include unsupported or overstated extension claims compared with official Next.js route handler docs.

Failure scenario: future contributors add files the framework will not route or scanners will not cover.

Suggested fix: align comments with official Next.js route-handler file conventions and keep scanner scope explicit.

### AGG22-19 - Settings re-encode CTA overpromises for settings-only changes

Severity: Medium  
Confidence: High  
Status: documentation/UX mismatch  
Reported by: `product-marketer-reviewer`; related to AGG22-02

Evidence: Settings copy implies re-encode fixes all color/quality setting effects, while static-path cache invalidation and actual byte rewrites have caveats.

Failure scenario: admin expects immediate global consistency after one action but sees stale derivatives until backfill/static cache behavior catches up.

Suggested fix: tighten copy to describe what re-encode does, when it is needed, and what remains cache-dependent.

### AGG22-20 - README positioning lacks proof-led "for/not for" clarity

Severity: Medium  
Confidence: Medium/High  
Status: product documentation gap  
Reported by: `product-marketer-reviewer`

Evidence: README states features but does not foreground that GalleryKit is finished-photo publishing, not editing/culling/proofing SaaS, nor attach proof points to core claims.

Failure scenario: wrong-fit users adopt expecting editing/proofing workflows that the repo explicitly does not support.

Suggested fix: add a concise "For / not for" and proof-points section.

## Low / Low-Medium

### AGG22-21 - Dynamic public gallery first pages still pay grouped exact-count work

Severity: Medium (performance), considered deferrable if scoped  
Confidence: High  
Reported by: `perf-reviewer`

Suggested fix: avoid exact counts on initial public pages or cache/count asynchronously.

### AGG22-22 - Infinite masonry keeps all loaded cards mounted

Severity: Medium (performance)  
Confidence: High  
Reported by: `perf-reviewer`

Suggested fix: add virtualization/windowing once gallery size and UX constraints justify it.

### AGG22-23 - CSV export materializes the full export in server and browser memory

Severity: Medium (performance)  
Confidence: High  
Reported by: `perf-reviewer`

Suggested fix: stream CSV server-side and download progressively.

### AGG22-24 - Admin analytics fans out aggregate scans on shared DB pool

Severity: Low-Medium  
Confidence: Medium  
Reported by: `perf-reviewer`

Suggested fix: cache/materialize heavy aggregate metrics or sequence queries with pool-budget awareness.

### AGG22-25 - Timeline/date archive filters are non-sargable

Severity: Low  
Confidence: High  
Reported by: `perf-reviewer`

Suggested fix: use generated columns/indexable date bounds or range predicates.

### AGG22-26 - Shared topic lists compute per-topic latest timestamps on common renders

Severity: Low  
Confidence: Medium  
Reported by: `perf-reviewer`

Suggested fix: cache or denormalize latest-topic timestamps where traffic warrants.

### AGG22-27 - Audit retention deletes all expired rows in one statement

Severity: Low  
Confidence: High  
Reported by: `critic`, `debugger`

Suggested fix: use chunked retention deletion matching view-retention patterns.

### AGG22-28 - Upload fallback serving validates one path and opens a later path by name

Severity: Low  
Confidence: Medium  
Reported by: `critic`, `debugger`

Suggested fix: open by file descriptor after validation or revalidate immediately before streaming.

### AGG22-29 - Docker image and apt inputs are mutable

Severity: Low  
Confidence: High  
Reported by: `security-reviewer`

Suggested fix: pin runtime base images or apt package versions where operationally acceptable.

### AGG22-30 - Deploy helper executes shell from trusted but unchecked env file

Severity: Low  
Confidence: Medium  
Reported by: `security-reviewer`

Suggested fix: document trust boundary and validate command override format if this becomes multi-operator.

### AGG22-31 - Nginx template unsafe if exposed directly as public edge

Severity: Low  
Confidence: Medium  
Reported by: `security-reviewer`

Suggested fix: document reverse-proxy boundary prominently or harden the template for public-edge TLS/HSTS use.

## Additional Low Documentation / UI Findings

The following were recorded in per-agent files and should be planned/deferred explicitly even where they are not separately expanded above:

- `DOC22-01`: `CLAUDE.md` still hardcodes deploy host despite config-driven deploy behavior.
- `DOC22-02`: `.env.local.example` omits several documented operator controls.
- `DOC22-03`: lower-level comments still imply a bundled Lightroom plugin.
- `DOC22-04`: historical CLIP plan contains obsolete snippets.
- `TEST22-04`: deployment command drift is not caught by deployment contract tests.
- `V22-04`: cycle-22 tests pass without proving exact regression edges.
- `UI22-06`: upload staging becomes cramped on phones.
- `UI22-07`: admin navigation is a flat ten-link wrap with no task grouping.

## Agent Failures

None. The only orchestration constraint was the runtime child-agent limit; review lanes were completed in waves.
