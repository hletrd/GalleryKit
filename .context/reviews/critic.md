# Critic Review - Cycle 3

Role: `critic`
Scope: current HEAD only
HEAD: `3f24038b04f48c73f5dac079cd3276fecbd48282`
Timestamp: 2026-06-29 13:21:36 KST
Status: review artifact written for review-plan-fix cycle 3

## Inventory And Method

Required context read first:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- existing `.context/reviews/critic.md`
- `.context/plans/cycle-2-2026-06-29-plan.md`
- `.context/plans/cycle-2-2026-06-29-deferred.md`
- `.context/plans/user-injected/pending-next-cycle.md`
- `.context/plans/README.md`

Repo inventory:
- 756 tracked files at current HEAD.
- 482 files under `apps/web/src`.
- 2230 review/plan files under `.context/reviews` and `.context/plans` were inventoried by path, with the current aggregate, critic, active/deferred plans, and pending user-injected plan read for recurring-pattern routing.

Relevant implementation surfaces reviewed:
- Runtime/deploy edge: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `.dockerignore`, `scripts/deploy-remote.sh`.
- Auth/origin/rate limits: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/proxy.ts`, admin and public API routes.
- Upload/restore/data paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/data.ts`.
- Timeline/search/semantic surfaces: `apps/web/src/lib/data-timeline.ts`, `apps/web/src/components/on-this-day-widget.tsx`, `apps/web/src/components/search.tsx`, semantic and similar search API routes, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/image-queue.ts`, schema indexes.
- Test and lint gates: API-auth/action-origin/public-route scanners, nginx config tests, Playwright specs, upload/header tests, semantic route tests, privacy/touch-target conventions.

Validation evidence gathered during this pass:
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Static line-numbered inspection was performed for every cited region below.

Recurring-pattern handling:
- I did not repeat prior fixed claims about `.claude` leaking into Docker context, SQL restore re-injection, semantic disabled-route charging, production semantic empty-index handling, per-photo OG fallback origin trust, nginx upload proxy rooting, or focus-visible scanner path handling.
- Deferred cycle-2 risks were rechecked against current code before being carried forward. Where still current, this report marks them as confirmed or likely rather than treating the prior cycle as proof.

## Findings

### CRIT-C3-01 - Timeline and On-This-Day queries remain non-sargable, and one comment now states the opposite

Severity: Medium
Confidence: High
Risk type: Confirmed
Perspectives: product correctness, documentation honesty, performance, maintainability

Evidence:
- `apps/web/src/lib/data-timeline.ts:88-94` says `MONTH() + DAY()` keeps the query within the `(processed, capture_date)` index prefix and avoids a full table scan.
- `apps/web/src/lib/data-timeline.ts:95-114` implements `getOnThisDayImages()` with `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:127-140` implements timeline years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:176-205` implements yearly/monthly timeline pages with `YEAR(capture_date)` and optional `MONTH(capture_date)`.
- `apps/web/src/db/schema.ts:111-117` indexes `processed`, `capture_date`, and `processed_capture_date`, but has no generated month/day/year columns or functional index that would make those function predicates sargable.

Concrete failure scenario:
- A larger gallery grows to tens or hundreds of thousands of processed images. The home page On-This-Day widget and public timeline pages repeatedly evaluate functions over many `capture_date` rows. Operators see the comment at `data-timeline.ts:88-94` and assume the query shape is already index-friendly, so the issue is not prioritized until public pages become slow.

Fix:
- First make the documentation honest: replace the `MONTH() + DAY()` index-prefix claim with an explicit note that this is non-sargable and acceptable only at current personal-gallery scale.
- Then fix the query shape: use range predicates for year pages, and add generated/stored `capture_month` and `capture_day` columns plus a composite index such as `(processed, capture_month, capture_day, capture_date)` for On-This-Day. Add migration, schema update, reconciliation path, and query-plan regression coverage.

### CRIT-C3-02 - Semantic search still scans a newest-first capped candidate set, so older relevant photos can be unreachable

Severity: Medium
Confidence: High
Risk type: Confirmed
Perspectives: product correctness, UX, performance, architecture

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:240-249` selects embeddings ordered by newest images and caps the scan with `SEMANTIC_SCAN_LIMIT`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-150` uses the same newest-first capped scan for similar-photo search.
- `apps/web/src/lib/clip-embeddings.ts:39-40` makes `SEMANTIC_SCAN_LIMIT` an env-tunable cap with a default of 2000.
- `apps/web/src/db/schema.ts:282-285` indexes image embeddings by `(model_version, updated_at)` but does not provide any vector index or recall-preserving nearest-neighbor strategy.

Concrete failure scenario:
- A production gallery has 15,000 embedded images. A visitor searches for a rare older image that is outside the newest 2000 embeddings. The route returns no result or a weaker newer result even though a high-similarity match exists in the database. Raising `SEMANTIC_SCAN_LIMIT` increases DB transfer and CPU work on the request path instead of fixing recall.

Fix:
- Move semantic retrieval off request-path brute force: add a real vector search backend/index, or build an offline/worker-maintained candidate index with recall-aware pagination.
- Until then, surface an operator warning when total eligible embeddings exceed `SEMANTIC_SCAN_LIMIT`, and make public UI copy honest that search covers only the scanned candidate window.

### CRIT-C3-03 - Process-local state remains a scale-out and restart correctness boundary

Severity: Medium
Confidence: High
Risk type: Likely
Perspectives: operator safety, architecture, security posture, product correctness

Evidence:
- `apps/web/src/lib/restore-maintenance.ts:1-18` stores restore-maintenance state in `globalThis`.
- `apps/web/src/lib/restore-maintenance.ts:44-56` begins/ends maintenance by toggling that process-local boolean.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota windows in a `globalThis` `Map`.
- `apps/web/src/lib/data.ts:12-33` stores shared-group view-count buffers and retry counters in module-level maps.
- `apps/web/src/lib/rate-limit.ts:314-318` stores semantic rate-limit counters in a process-local bounded map.
- `apps/web/docker-compose.yml:14-21` documents a single host-networked app behind host nginx, but the code does not actively reject accidental multi-process or multi-replica deployment.

Concrete failure scenario:
- An operator starts a second app process during maintenance or a future deployment moves to two replicas. One process enters restore maintenance while the other still accepts uploads. Upload quotas, semantic rate limits, and view-count buffers split across processes; rate limits are easier to bypass and maintenance protection is inconsistent.

Fix:
- Make the single-instance contract executable: add a startup guard or deployment health check that fails if more than one writer process is active, or move these state machines to shared storage with DB/Redis-backed locks, counters, and queues.
- Document which process-local states are intentional and add tests around the startup/deploy guard so future orchestration changes cannot silently widen the topology.

### CRIT-C3-04 - The direct-exposure hardening fix has no regression guard

Severity: Medium
Confidence: High
Risk type: Confirmed
Perspectives: operator safety, security posture, test strategy

Evidence:
- `apps/web/Dockerfile:83-84` sets `PORT=3000` and `HOSTNAME="127.0.0.1"`.
- `apps/web/docker-compose.yml:14-21` uses host networking and sets `HOSTNAME: 127.0.0.1`.
- `apps/web/nginx/default.conf:1-4`, `apps/web/nginx/default.conf:56-60`, `apps/web/nginx/default.conf:72-76`, and `apps/web/nginx/default.conf:131-150` contain the intended host-nginx rate/body-limit envelope.
- `apps/web/src/__tests__/nginx-config.test.ts:7-36` asserts nginx hardening details, but it does not assert that the app binds only to loopback under Docker/Compose.
- A current repo search for `direct-exposure` and `HOSTNAME` found docs/plans/config only; there is no dedicated test such as `direct-exposure-guard.test.ts`.

Concrete failure scenario:
- A future Dockerfile or compose edit drops `HOSTNAME=127.0.0.1` or sets it to `0.0.0.0`. The container again listens directly on the host network, bypassing nginx rate limits, upload body limits, HSTS/header policy, and proxy header normalization. Current nginx tests still pass because nginx remains configured correctly.

Fix:
- Add a static regression test that reads `apps/web/Dockerfile` and `apps/web/docker-compose.yml` and asserts loopback binding for the production runner and compose service.
- Consider a runtime startup assertion in production that refuses host-network startup unless the configured bind host is loopback, with a documented explicit override for local diagnostics.

### CRIT-C3-05 - Upload quota settlement relies on a manually maintained invariant across many awaited branches

Severity: Medium
Confidence: Medium
Risk type: Likely
Perspectives: maintainability, operator safety, product correctness

Evidence:
- `apps/web/src/app/actions/images.ts:224-228` pre-claims upload count/bytes before disk, topic, file, DB, and cleanup work.
- `apps/web/src/app/actions/images.ts:233-250` manually rolls back the claim for disk pre-check failures.
- `apps/web/src/app/actions/images.ts:257-265` documents that every await between claim and final settlement must roll back on throw.
- `apps/web/src/app/actions/images.ts:266-278` manually catches and rolls back topic lookup failures.
- `apps/web/src/app/actions/images.ts:507-522` documents another post-claim await whose safety depends on `deleteOriginalUploadFile()` never rejecting.
- `apps/web/src/app/actions/images.ts:540-564` performs final settlement only after the file loop.
- `apps/web/src/app/actions/images.ts:590-592` has an outer `finally`, but it releases only the upload contract lock and does not settle the quota claim.

Concrete failure scenario:
- A future maintainer adds a new awaited validation or cleanup between the pre-claim and final settlement, and that path returns or throws without calling `settleUploadTrackerClaim()`. The admin/IP upload window is inflated until expiry even though no files were accepted, producing confusing "limit reached" failures during a live upload session.

Fix:
- Replace the informal invariant with a scoped claim object, for example `const claim = uploadTracker.claim(...)`, whose `finally` automatically settles or rolls back unless explicitly committed.
- Add a focused regression test that injects a failure after the quota claim and verifies the tracker is restored.

### CRIT-C3-06 - Client search imports a server-oriented CLIP module that reads process env at module scope

Severity: Low
Confidence: High
Risk type: Confirmed
Perspectives: maintainability, architectural coherence, bundle hygiene

Evidence:
- `apps/web/src/components/search.tsx:1` marks the file as a client component.
- `apps/web/src/components/search.tsx:19` imports `SEMANTIC_TOP_K_DEFAULT` from `@/lib/clip-embeddings`.
- `apps/web/src/lib/clip-embeddings.ts:18-40` parses server env values and references `process.env` at module scope, while the same file also contains Buffer-based embedding encode/decode helpers at `apps/web/src/lib/clip-embeddings.ts:85-149`.
- The module comment at `apps/web/src/lib/clip-embeddings.ts:4` says it is safe for server-only lib modules, not browser components.

Concrete failure scenario:
- A future edit exports another helper from `clip-embeddings.ts` or changes bundling behavior, pulling Buffer-heavy or process-env logic into the client search bundle. The client only needs a display/default value, but it is coupled to server semantic internals.

Fix:
- Move shared UI-safe constants such as `SEMANTIC_TOP_K_DEFAULT` into a small `clip-constants` or `semantic-search-shared` module with no `process`, `Buffer`, or server-only imports.
- Keep `clip-embeddings.ts` server-only and add an import-boundary lint/test so client components cannot import it.

### CRIT-C3-07 - Visual Playwright screenshots are artifacts, not visual regression assertions

Severity: Low
Confidence: High
Risk type: Manual-validation risk
Perspectives: UX, test strategy, documentation honesty

Evidence:
- `apps/web/e2e/nav-visual-check.spec.ts:22-35` now asserts touch-target size and non-overlap for navigation, so this is not the old "no assertions at all" finding.
- `apps/web/e2e/nav-visual-check.spec.ts:49`, `apps/web/e2e/nav-visual-check.spec.ts:63`, and `apps/web/e2e/nav-visual-check.spec.ts:76` still call `page.screenshot({ path: ... })` without `expect(page).toHaveScreenshot(...)` or another automated visual comparison.

Concrete failure scenario:
- A CSS change makes the navigation visually misaligned, low contrast, or cramped while preserving 44 px targets and non-overlap. CI still passes; the only evidence is an updated screenshot artifact that nobody is required to compare.

Fix:
- Either convert these captures to Playwright visual snapshots with a tight threshold, or rename/scope the spec as manual artifact capture and add DOM/CSS assertions for the visual invariants the project actually wants to enforce.

### CRIT-C3-08 - Calendar features depend on server/runtime timezone interpretation of stored capture dates

Severity: Low
Confidence: Medium
Risk type: Likely
Perspectives: product correctness, UX, documentation honesty

Evidence:
- `apps/web/src/components/on-this-day-widget.tsx:15-17` derives today's month/day from `new Date()` on the server.
- `apps/web/src/components/on-this-day-widget.tsx:51-52` derives the displayed capture year with `new Date(photo.capture_date).getFullYear()`.
- `apps/web/src/lib/data-timeline.ts:233-241` groups Year-in-Review months with `new Date(img.capture_date).getMonth() + 1`.
- `CLAUDE.md` documents the app's photo-color/HDR intent carefully, but the calendar semantics for timezone-less EXIF/MySQL dates remain an implementation convention rather than an explicit product contract.

Concrete failure scenario:
- The server runs in a timezone different from the photographer/viewer, or a stored MySQL `DATETIME` is parsed differently by Node. On-This-Day can show yesterday/tomorrow's anniversary near midnight, and Year-in-Review can place photos in the wrong month for dates near UTC boundaries.

Fix:
- Define the product timezone contract explicitly: gallery-local timezone, server timezone, or pure stored-date semantics.
- For photo capture dates, avoid `new Date()` where only calendar parts are needed. Extract year/month/day from the stored `YYYY-MM-DD` portion or add normalized date-part columns and query/render those consistently.

## Missed-Issues Sweep

Security posture:
- Admin API scanner passed; current admin API exports are wrapped by `withAdminAuth(...)`.
- Mutating server-action same-origin scanner passed.
- Public mutating route rate-limit scanner passed.
- Rechecked public share/group and OG routes for known prior issues; prior same-origin/rate-limit/host-trust claims appear fixed and are not repeated here.

Operator safety:
- Nginx body-limit and proxy-header hardening tests exist and passed by inspection.
- The remaining operator risk is not the nginx config itself; it is that the application binding and single-instance assumptions are not enforced as executable deployment contracts.

Maintainability and architecture:
- The most fragile current pattern is still comment-enforced invariants: upload quota settlement and process-local topology assumptions.
- The clearest layer leak is the client import of `clip-embeddings.ts`.

UX/product:
- Current high-risk UX issues are search recall honesty and calendar/date semantics. The nav visual spec has useful geometry assertions but does not enforce visual snapshots.

Documentation honesty:
- The timeline query comment is actively misleading relative to the SQL shape.
- Existing CLIP comments are unusually explicit about stub/prod model honesty; the remaining semantic honesty gap is result-window coverage once the corpus exceeds the scan cap.

## Finding Count

Total findings: 8
- Confirmed: 5
- Likely: 2
- Manual-validation risk: 1
