# Aggregate Review - Cycle 4/100

Date: 2026-06-29
HEAD reviewed: `0fa5beb1` plus review-artifact-only commits created during the review wave

## Agent Coverage

Prompt 1 requested all available review agents. This environment exposed only native `default`, `explorer`, and `worker` agent types, plus two registered prompt files in `~/.codex/agents`. I therefore spawned `default` agents with explicit reviewer-role prompts and included both registered custom reviewers:

- `code-reviewer` -> `.context/reviews/code-reviewer.md`
- `perf-reviewer` -> `.context/reviews/perf-reviewer.md`
- `security-reviewer` -> `.context/reviews/security-reviewer.md`
- `critic` -> `.context/reviews/critic.md`
- `verifier` -> `.context/reviews/verifier.md`
- `test-engineer` -> `.context/reviews/test-engineer.md`
- `tracer` -> `.context/reviews/tracer.md`
- `architect` -> `.context/reviews/architect.md`
- `debugger` -> `.context/reviews/debugger.md`
- `document-specialist` -> `.context/reviews/document-specialist.md`
- `designer` -> `.context/reviews/designer.md`
- `ui-ux-designer-reviewer` -> `.context/reviews/ui-ux-designer-reviewer.md`
- `product-marketer-reviewer` -> `.context/reviews/product-marketer-reviewer.md`

The child-agent concurrency cap prevented a literal one-batch fan-out of all 13 roles; agents were run in parallel waves and every role returned successfully. No agent failures.

## Summary

Unique new findings: 21

- Active implementation findings: 15
- Deferred findings: 6
- Zero-finding reports: `code-reviewer`, `debugger`, `ui-ux-designer-reviewer`

Cross-agent agreement raised confidence for:

- Public-route rate-limit scanner false negative: `critic` + `test-engineer`
- Lightroom upload restore/quota ordering: `architect` + `tracer`
- Broad-public-mount documentation drift: `verifier` + `document-specialist`

## Active Findings

### AGG-C4-01 - Public mutating-route rate-limit scanner accepts unreachable helper calls

- Sources: `critic` CRIT-C4-01, `test-engineer` TE-C4-01
- Original severity/confidence: Medium/High
- Status: Confirmed
- File+line: `apps/web/scripts/check-public-route-rate-limit.ts:125-153`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:167-205`
- Problem: A helper call inside an unreachable branch such as `if (false) { preIncrement... }` can satisfy the lint gate before a mutation.
- Failure scenario: A future public mutating route passes CI while performing DB writes without charging a public rate-limit bucket.
- Fix: Add dead-branch fixtures and make the scanner fail closed for conditional helper calls that do not dominate the later mutation.

### AGG-C4-02 - Playwright nav specs still query the removed static theme-toggle name

- Source: `critic` CRIT-C4-02
- Original severity/confidence: Medium/High
- Status: Confirmed
- File+line: `apps/web/e2e/test-fixes.spec.ts:24-40`, `apps/web/e2e/nav-visual-check.spec.ts:66-76`, `apps/web/src/components/nav-client.tsx:41-46`
- Problem: Specs still locate `"Toggle theme"` while the component now exposes a stateful accessible name.
- Failure scenario: `npm run test:e2e --workspace=apps/web` fails despite correct UI behavior.
- Fix: Use a regex or stable test selector and assert the stateful accessible name changes after click.

### AGG-C4-03 - Topic cover uploads are not persisted after the narrowed public mount

- Source: `tracer` TRC-C4-01
- Original severity/confidence: Medium/High
- Status: Confirmed
- File+line: `apps/web/src/lib/process-topic-image.ts:20-28`, `apps/web/src/lib/process-topic-image.ts:72-89`, `apps/web/docker-compose.yml:23-26`
- Problem: Runtime topic covers are written under `public/resources`, but deployment now bind-mounts only `public/uploads`.
- Failure scenario: A topic cover uploaded by an admin disappears after container replacement while the DB still points at its filename.
- Fix: Persist `public/resources` in Docker/compose/deploy/docs/tests or move topic resources under a durable data-backed route.

### AGG-C4-04 - Lightroom upload checks restore maintenance only after multipart parsing and topic DB read

- Sources: `architect` ARCH-C4-01, `tracer` TRC-C4-02
- Original severity/confidence: Medium/High
- Status: Confirmed
- File+line: `apps/web/src/app/api/admin/lr/upload/route.ts:70-148`
- Problem: The route parses a large multipart body and queries `topics` before the restore-maintenance entry guard.
- Failure scenario: A Lightroom retry during restore spends memory/bandwidth and can hit table-restore timing errors before returning a retryable maintenance response.
- Fix: Move an authenticated restore-maintenance check before `request.formData()` and before topic lookup; keep late cleanup checks for mid-request restore races.

### AGG-C4-05 - Lightroom upload cumulative quota is enforced after full multipart parsing

- Source: `architect` ARCH-C4-02
- Original severity/confidence: Medium/High
- Status: Confirmed
- File+line: `apps/web/src/app/api/admin/lr/upload/route.ts:70-80`, `apps/web/src/app/api/admin/lr/upload/route.ts:210-238`, `apps/web/nginx/default.conf:122-144`
- Problem: The upload tracker rejects only after Next/Node has materialized the multipart body.
- Failure scenario: A compromised token or retry loop can force several 216 MiB parses before quota rejects later requests.
- Fix: Validate `Content-Length` / transfer encoding and pre-claim a conservative upload budget before `request.formData()`, then settle to actual file size afterward.

### AGG-C4-06 - Scoped PAT authorization updates `last_used_at` before scope acceptance

- Source: `tracer` TRC-C4-03
- Original severity/confidence: Low/High
- Status: Confirmed
- File+line: `apps/web/src/lib/admin-tokens.ts:136-165`, `apps/web/src/lib/api-auth.ts:63-84`
- Problem: Valid but wrong-scope PAT attempts update "Last used" even though authorization fails.
- Failure scenario: An admin sees recent token usage and mistakes denied probes for successful Lightroom upload activity.
- Fix: Split token verification from usage marking and update `last_used_at` only after required scope passes.

### AGG-C4-07 - Deploy/disk-hygiene docs still describe the old broad `./public` bind mount

- Sources: `verifier` V-C4-01, `document-specialist` DOC-C4-01
- Original severity/confidence: Low/High
- Status: Confirmed
- File+line: `AGENTS.md:19`, `CLAUDE.md:460`, `CLAUDE.md:475`, `apps/web/deploy.sh:39-42`, `apps/web/deploy.sh:60`
- Problem: Authoritative docs/comments still say `./public` is persisted even though code/test now require `./public/uploads`.
- Failure scenario: A future deploy edit restores the broad mount and reopens service-worker/generated-asset drift.
- Fix: Update docs/comments/output to say persistence is `./data`, `./public/uploads`, `./public/resources` if AGG-C4-03 persists it, and `./src/site-config.json`; immutable public assets come from the image.

### AGG-C4-08 - Shipped CLIP superpowers docs still encode pre-implementation state

- Source: `document-specialist` DOC-C4-02
- Original severity/confidence: Low/High
- Status: Confirmed
- File+line: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4-63`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:15-96`
- Problem: The docs simultaneously say CLIP is shipped and that production is rejected/stub-only, with unchecked executable implementation steps.
- Failure scenario: A future agent/operator follows the stale plan and redoes completed work or changes thresholds away from current code.
- Fix: Convert those docs to post-implementation records with explicit historical boundaries and completed-status annotations.

### AGG-C4-09 - 404 pages render a duplicate skip link before navigation

- Source: `designer` DES-C4-01
- Original severity/confidence: Low/High
- Status: Confirmed by source
- File+line: `apps/web/src/app/[locale]/layout.tsx:123-128`, `apps/web/src/app/[locale]/not-found.tsx:20-23`
- Problem: Locale layout and `not-found.tsx` both render a skip link to `#main-content`.
- Failure scenario: Keyboard users encounter two identical bypass links on a dead URL before reaching navigation or recovery actions.
- Fix: Remove the local skip link from `not-found.tsx` while preserving `main#main-content`.

### AGG-C4-10 - Lightroom token dates ignore the selected app locale

- Source: `designer` DES-C4-02
- Original severity/confidence: Low/High
- Status: Confirmed by source
- File+line: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:22`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:123-128`
- Problem: Token dates use bare `toLocaleDateString()` instead of the app locale.
- Failure scenario: Korean UI on an English-configured browser shows English/US dates in the token table.
- Fix: Destructure `locale` from `useTranslation()` and pass it into date formatting.

### AGG-C4-11 - Lightroom token list loading state is a silent spinner

- Source: `designer` DES-C4-03
- Original severity/confidence: Low/High
- Status: Confirmed by source
- File+line: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:107-110`
- Problem: Initial token loading has only a spinner, no `role="status"`, `aria-live`, or text alternative.
- Failure scenario: Screen-reader users get no loading state while the token list is fetching.
- Fix: Wrap the loading state in `role="status" aria-live="polite"`, hide the spinner from AT, and add localized sr-only text.

### AGG-C4-12 - RAW rejection copy recommends HEIF though HEIF is not reliably accepted

- Source: `product-marketer-reviewer` PM-C4-01
- Original severity/confidence: Medium/High
- Status: Confirmed
- File+line: `apps/web/messages/en.json:560-561`, `apps/web/messages/ko.json:560-561`, `apps/web/src/app/actions/images.ts:523-560`
- Problem: The RAW rejection guidance recommends HEIF, but the picker no longer advertises HEIF and the installed Sharp build does not reliably decode `.heif` / `.heic`.
- Failure scenario: A photographer exports RAWs to HEIF based on product guidance and then cannot select or process them.
- Fix: Remove HEIF from RAW recovery copy unless HEIF support is runtime-gated end-to-end.

### AGG-C4-13 - Deploy disk-hygiene and data-safety contract has no regression test

- Source: `test-engineer` TE-C4-02
- Original severity/confidence: Medium/High
- Status: Confirmed coverage gap
- File+line: `apps/web/deploy.sh:31-56`, `scripts/deploy-remote.sh:22-72`
- Problem: Load-bearing deploy prune ordering, prune flags, and config-driven SSH behavior are untested.
- Failure scenario: A future edit moves prune before `up -d`, adds destructive `volume prune -a`, removes builder prune, or hardcodes a remote target while CI stays green.
- Fix: Add a deploy script source-contract test.

### AGG-C4-14 - Production site-config validator lacks failure-path tests

- Source: `test-engineer` TE-C4-03
- Original severity/confidence: Medium/High
- Status: Confirmed coverage gap
- File+line: `apps/web/scripts/ensure-site-config.mjs:4-43`, `.github/workflows/quality.yml:27-34`
- Problem: CI only exercises the happy path for canonical URL validation.
- Failure scenario: A refactor weakens production URL validation and CI still passes.
- Fix: Add subprocess tests for missing config, missing production URL, placeholder host, invalid scheme/relative URL, and valid BASE_URL override.

### AGG-C4-15 - Smart-collection cursor pagination computes a discarded total count

- Source: `perf-reviewer` PERF-C4-05
- Original severity/confidence: Low/High
- Status: Confirmed
- File+line: `apps/web/src/lib/data.ts:1388-1428`, `apps/web/src/app/actions/public.ts:161-225`
- Problem: Cursor load-more callers discard `total`, but the shared query still computes `COUNT(*) OVER()`.
- Failure scenario: Infinite-scroll smart collections pay extra DB work on every page.
- Fix: Split the cursor query shape and add a test that the load-more path does not include `COUNT(*) OVER()`.

## Deferred Findings

These findings are recorded for future work and are not implemented in this cycle. Security/correctness/data-loss findings are not deferred unless the repo's own rules explicitly establish the current bounded topology or the finding is performance-only.

### DEF-C4-01 - Timeline and on-this-day queries are non-sargable

- Source: `perf-reviewer` PERF-C4-01
- File+line: `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/lib/data-timeline.ts:129-141`, `apps/web/src/lib/data-timeline.ts:186-207`
- Original severity/confidence: Medium/High
- Reason for deferral: Performance-only schema redesign requiring generated columns or query-shape migration; no data-loss/security impact. It is already tracked as prior performance debt, but this cycle preserves the new review finding.
- Exit criterion: Re-open when library size or query telemetry shows timeline/on-this-day latency scaling with total processed image count, or when adding the next schema/index migration batch.

### DEF-C4-02 - Public map lacks a map/GPS access path and renders too many markers

- Source: `perf-reviewer` PERF-C4-02
- File+line: `apps/web/src/lib/data.ts:1624-1660`, `apps/web/src/components/map/map-client.tsx:76-143`
- Original severity/confidence: Medium/High
- Reason for deferral: Performance-only map architecture/indexing work. Current personal-gallery deployment remains bounded by `MAP_MAX_MARKERS`, and no data-loss/security issue is claimed.
- Exit criterion: Re-open when geotagged public photos approach the marker cap, map route latency becomes visible, or a map endpoint/index migration is planned.

### DEF-C4-03 - Production CLIP embedding work escapes image-queue backpressure

- Source: `perf-reviewer` PERF-C4-03
- File+line: `apps/web/src/lib/image-queue.ts:512-567`, `apps/web/src/lib/clip-model.ts:151-199`
- Original severity/confidence: Medium/High
- Reason for deferral: Availability/performance architecture work requiring a dedicated embedding queue or durable job model. This is already recorded as prior cycle-3 deferred debt.
- Exit criterion: Re-open before raising upload concurrency, when production semantic ingestion volume grows, or when adding queue/drain observability.

### DEF-C4-04 - Semantic/similar search scan and sort embeddings synchronously on request path

- Source: `perf-reviewer` PERF-C4-04
- File+line: `apps/web/src/app/api/search/semantic/route.ts:240-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`
- Original severity/confidence: Medium/Medium
- Reason for deferral: Performance/recall architecture work requiring vector indexing or a bounded top-K rewrite. The current route has explicit scan caps and same-origin/rate-limit controls.
- Exit criterion: Re-open when `SEMANTIC_SCAN_LIMIT` is raised above the default, search latency exceeds budget, or a vector-index backend is introduced.

### DEF-C4-05 - Color-pipeline backfill filters on unindexed `pipeline_version`

- Source: `perf-reviewer` PERF-C4-06
- File+line: `apps/web/src/lib/admin-backfill-runner.ts:370-410`, `apps/web/scripts/backfill-color-pipeline.ts:326-332`
- Original severity/confidence: Low/Medium
- Reason for deferral: Performance-only admin maintenance optimization. A proper fix needs an index migration or progress UX redesign.
- Exit criterion: Re-open on the next pipeline-version bump, when backfill discovery becomes slow, or when adding a schema migration for operational indexes.

### DEF-C4-06 - Process-local security state is unsafe if production is horizontally scaled

- Source: `security-reviewer` SEC-C4-01
- File+line: `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-79`, `apps/web/src/lib/rate-limit.ts:68-108`, `apps/web/src/lib/rate-limit.ts:314-318`, `apps/web/docker-compose.yml:14-21`
- Original severity/confidence: Medium/High
- Reason for deferral: The repo explicitly defines the current production topology as single-instance. CLAUDE.md states: "The shipped Docker Compose deployment is a single web-instance / single-writer topology" and "do not horizontally scale the web service unless those coordination states are moved to a shared store." Under that repo rule, this is an operator-scale-out guardrail rather than a current deployment defect.
- Exit criterion: Re-open before any multi-process, multi-replica, worker split, or load-balanced deployment; or if adding Redis/DB-backed shared state.

## Agent Findings Count

- `code-reviewer`: 0
- `perf-reviewer`: 6
- `security-reviewer`: 1
- `critic`: 2
- `verifier`: 1
- `test-engineer`: 3
- `tracer`: 3
- `architect`: 2
- `debugger`: 0
- `document-specialist`: 2
- `designer`: 3
- `ui-ux-designer-reviewer`: 0
- `product-marketer-reviewer`: 1

