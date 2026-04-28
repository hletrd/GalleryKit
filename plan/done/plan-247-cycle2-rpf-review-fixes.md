# Plan 247 — Cycle 2 RPF review fixes
Status: complete

## Source reviews
- Aggregate: `.context/reviews/_aggregate.md` (Cycle 2/100, 2026-04-28)
- Per-agent provenance: `.context/reviews/{code-reviewer,critic,perf-reviewer,architect,security-reviewer,verifier,test-engineer,debugger,tracer,document-specialist,designer}.md`

## Repo rules read before planning
- `CLAUDE.md`: Next.js 16 / React 19 / TypeScript 6 baseline; Docker single-web-instance/single-writer topology; local filesystem storage only; Node 24+; security lint gates; no unsupported S3/MinIO admin surface.
- `AGENTS.md`: always commit/push; use gitmoji; keep diffs small/reviewable/reversible; no new dependencies without explicit request; run lint/typecheck/build/tests/static analysis.
- `.context/**` and `plan/**`: existing deferrals and prior loop artifacts reviewed to avoid silently dropping carried findings.
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/**` style/policy files: absent.

## Disposition map

Every aggregate finding is either scheduled here or recorded in `plan/plan-248-cycle2-rpf-deferred.md`.

| Finding | Severity / confidence | Disposition |
|---|---:|---|
| AGG2-01 | High / High | Scheduled P247-01 |
| AGG2-02 | High / High | Scheduled P247-02 |
| AGG2-03 | High / High | Scheduled P247-03 |
| AGG2-04 | High / Medium | Scheduled P247-04 |
| AGG2-05 | High / High | Scheduled P247-05 |
| AGG2-06 | High / High | Scheduled P247-06 |
| AGG2-07 | High / High | Scheduled P247-07 |
| AGG2-08 | Medium / High | Scheduled P247-08 |
| AGG2-09 | Medium / High | Scheduled P247-09 |
| AGG2-10 | Medium / High | Scheduled P247-10 |
| AGG2-11 | Medium / High | Scheduled P247-11 |
| AGG2-12 | Medium / High | Deferred D247-12 |
| AGG2-13 | Medium / High | Deferred D247-13 |
| AGG2-14 | Medium / Medium | Deferred D247-14 |
| AGG2-15 | Medium / High | Scheduled P247-12 |
| AGG2-16 | Medium / High | Deferred D247-16 |
| AGG2-17 | Medium / High | Deferred D247-17 |
| AGG2-18 | Medium / High | Scheduled P247-13 |
| AGG2-19 | Medium / High | Scheduled P247-14 |
| AGG2-20 | Medium / Medium | Deferred D247-20 |
| AGG2-21 | Medium / High | Scheduled P247-15 |
| AGG2-22 | Medium / High | Scheduled P247-16 |
| AGG2-23 | Medium / High | Deferred D247-23 |
| AGG2-24 | Medium / High | Scheduled P247-17 |
| AGG2-25 | Medium / High | Scheduled P247-07 |
| AGG2-26 | Low / High | Deferred D247-26 |
| AGG2-27 | Low / High | Scheduled P247-18 |
| AGG2-28 | Low / High | Deferred D247-28 |
| AGG2-29 | Low / High | Scheduled P247-19 |
| AGG2-30 | Low / High | Deferred D247-30 |
| AGG2-31 | Low / High | Deferred D247-31 |
| AGG2-32 | Low / Medium | Scheduled P247-20 |
| AGG2-33 | Low / High | Deferred D247-33 |
| AGG2-34 | Low / Medium | Deferred D247-34 |
| AGG2-35 | Low / Medium | Deferred D247-35 |
| AGG2-36 | Low / High | Deferred D247-36 |
| AGG2-37 | Low / High | Scheduled P247-21 |
| AGG2-38 | Low / Medium | Scheduled P247-22 |
| AGG2-39 | Low / Medium | Deferred D247-39 |

## Implementation tasks

### P247-01 — Serialize client uploads until the server lock contract supports concurrent readers
- **Findings:** AGG2-01.
- **Files:** `apps/web/src/components/upload-dropzone.tsx`; upload-dropzone tests if a suitable seam exists.
- **Plan:** Replace the client fan-out queue with a sequential loop (or `UPLOAD_CONCURRENCY = 1`) so a multi-file drop cannot make sibling requests fight the exclusive `gallerykit_upload_processing_contract` lock.
- **Acceptance:** Upload progress still advances per file; no parallel upload requests are intentionally launched from the client.
- **Status:** complete.

### P247-02 — Reduce default image-processing CPU oversubscription
- **Findings:** AGG2-02, AGG2-37.
- **Files:** `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/.env.local.example`, `CLAUDE.md` if needed.
- **Plan:** Default the queue to one concurrent image job and clarify that `SHARP_CONCURRENCY` is an upper bound capped by host CPU. Keep env overrides for operators who intentionally size larger hosts.
- **Acceptance:** Default `QUEUE_CONCURRENCY` is 1 and docs/env examples describe the combined budget honestly.
- **Status:** complete.

### P247-03 — Bound batch derivative cleanup fan-out
- **Findings:** AGG2-03.
- **Files:** `apps/web/src/app/actions/images.ts`; relevant delete/revalidation tests.
- **Plan:** Stop launching all batch variant deletions in one unbounded `Promise.all`. Delete variant files sequentially per image (or through a tiny bounded helper) while preserving the existing scan-all-variants convention.
- **Acceptance:** Batch delete no longer starts one cleanup promise per image × format at once; existing delete tests pass.
- **Status:** complete.

### P247-04 — Clarify static upload serving paths for nginx/Docker deployment
- **Findings:** AGG2-04.
- **Files:** `README.md`, `apps/web/README.md`, `apps/web/nginx/default.conf` if safe.
- **Plan:** Document that the checked-in nginx config path is container-internal and host-side reverse proxies must point to the host bind mount or proxy `/uploads` to the app/container. Avoid a config rewrite that would break container deployments.
- **Acceptance:** Deployment docs no longer imply host nginx can copy the container path unchanged.
- **Status:** complete.

### P247-05 — Replace broad gate timeout workarounds with validated, bounded timeouts
- **Findings:** AGG2-05.
- **Files:** `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`.
- **Plan:** Remove the global 120s Vitest timeout, or reduce it to the previous default unless a targeted suite needs it. Parse `E2E_WEB_SERVER_TIMEOUT_MS` with finite/positive validation and restore a reasonable default close to the original 180s.
- **Acceptance:** Bad timeout env values fail clearly; default Playwright webServer timeout is not 30 minutes; Vitest no longer hides unit-test hangs globally.
- **Status:** complete.

### P247-06 — Expand touch-target audit coverage to 40 px controls
- **Findings:** AGG2-06 and current uncommitted lightbox 44 px fix.
- **Files:** `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/components/lightbox.tsx`.
- **Plan:** Keep the lightbox close/fullscreen controls at `h-11 w-11` and update the audit regex fixtures to catch `h-10`, `w-10`, and `size-10` on button components and raw buttons.
- **Acceptance:** Audit fixtures fail for 40 px controls and pass for 44 px+ controls; full test gate passes.
- **Status:** complete.

### P247-07 — Make error boundaries recoverable and touch-friendly
- **Findings:** AGG2-07, AGG2-25.
- **Files:** `apps/web/src/app/[locale]/error.tsx`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx`, possibly messages/tests.
- **Plan:** Restore basic landmarks/wayfinding (`main`, accessible card/shell) and give recovery controls `min-h-11`/44 px targets.
- **Acceptance:** Error pages preserve a recoverable structure and controls meet the 44 px floor.
- **Status:** complete.

### P247-08 — Tie GA CSP allow-list to the same site-config value used for rendering
- **Findings:** AGG2-08.
- **Files:** `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/proxy.ts`, `apps/web/src/__tests__/content-security-policy.test.ts`.
- **Plan:** Add an explicit `googleAnalyticsId` option to `buildContentSecurityPolicy`; include GA domains when that value or `NEXT_PUBLIC_GA_ID` is valid; pass `siteConfig.google_analytics_id` from middleware so the render and CSP paths agree.
- **Acceptance:** Tests cover site-config GA without env and no-GA omission.
- **Status:** complete.

### P247-09 — Canonicalize load-more tag filters like SSR
- **Findings:** AGG2-09.
- **Files:** `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/tag-slugs.ts`, `apps/web/src/__tests__/public-actions.test.ts`.
- **Plan:** Reuse the same dedupe/trim/validation semantics as SSR parsing for action-provided tag arrays, including duplicate removal before limit/sentinel calculation.
- **Acceptance:** Duplicate tag requests call `getImagesLite` with a canonical tag list and do not produce empty later pages.
- **Status:** complete.

### P247-10 — Route missing originals through the queue retry/bootstrap path
- **Findings:** AGG2-10.
- **Files:** `apps/web/src/lib/image-queue.ts`, `apps/web/src/__tests__/image-queue.test.ts` if feasible.
- **Plan:** Replace the early return on missing original files with a thrown processing error so the existing bounded retry and bootstrap retry logic can recover if a volume/file appears later, rather than silently clearing in-memory state after one attempt.
- **Acceptance:** Missing originals no longer return from the job as if successfully skipped.
- **Status:** complete.

### P247-11 — Keep AppleDouble/runtime artifacts out of Docker contexts and remove current strays
- **Findings:** AGG2-11.
- **Files:** `.gitignore`, `.dockerignore`, `apps/web/.dockerignore`, current `apps/web/._data`, `apps/web/public/._uploads`.
- **Plan:** Add Docker ignore rules for AppleDouble and local agent/runtime artifacts where missing; delete the current AppleDouble files because they are metadata detritus, not project source.
- **Acceptance:** `git status` and Docker contexts no longer include AppleDouble metadata.
- **Status:** complete.

### P247-12 — Validate base/image URL configuration consistently
- **Findings:** AGG2-15, AGG2-21.
- **Files:** `apps/web/scripts/ensure-site-config.mjs`, README files, tests if existing.
- **Plan:** Validate `BASE_URL` when provided so docs and build guard agree; keep `IMAGE_BASE_URL` guidance explicit about build-time use.
- **Acceptance:** Production build guard rejects placeholder/non-absolute `BASE_URL` instead of only validating the file fallback.
- **Status:** complete.

### P247-13 — Remove or gate legacy short share-key acceptance
- **Findings:** AGG2-18.
- **Files:** share routes/actions/tests after inspection.
- **Plan:** Locate the short-key compatibility path and remove it if no documented compatibility rule exists; otherwise gate it with a clear env compatibility flag and tests.
- **Acceptance:** Unauthenticated share routes no longer accept weak legacy keys by default.
- **Status:** complete.

### P247-14 — Make public health output less useful to unauthenticated probes
- **Findings:** AGG2-19.
- **Files:** `apps/web/src/app/api/health/route.ts`, `apps/web/src/__tests__/health-route.test.ts`, deployment docs if needed.
- **Plan:** Keep a minimal liveness response by default and make DB probing opt-in via an explicit env flag for deployments that use it as a readiness gate.
- **Acceptance:** Default unauthenticated `/api/health` does not perform DB work or expose DB readiness.
- **Status:** complete.

### P247-15 — Harden origin-guard E2E semantics
- **Findings:** AGG2-22.
- **Files:** `apps/web/e2e/origin-guard.spec.ts`, `apps/web/e2e/helpers.ts` if needed.
- **Plan:** Ensure the test distinguishes unauthenticated auth smoke coverage from authenticated origin-guard coverage; skip only with an explicit note/env or make protected CI require credentials.
- **Acceptance:** The test name/assertions no longer imply the origin guard fired when the request stopped at auth.
- **Status:** complete.

### P247-16 — Normalize photo swipe coordinates
- **Findings:** AGG2-24.
- **Files:** `apps/web/src/components/photo-navigation.tsx`.
- **Plan:** Use one coordinate system (client coordinates) consistently across touch start/move/end.
- **Acceptance:** Swipe threshold logic no longer mixes `screen*` and `client*` values.
- **Status:** complete.

### P247-17 — Align client tag creation validation with server validation
- **Findings:** AGG2-27.
- **Files:** `apps/web/src/components/tag-input.tsx`, existing tests if practical.
- **Plan:** Apply the same control/unicode-format rejection or server-friendly normalization to client-created tags before upload.
- **Acceptance:** Users get immediate client-side rejection for tag names the server would reject.
- **Status:** complete.

### P247-18 — Narrow Next image localPatterns to supported asset paths
- **Findings:** AGG2-29.
- **Files:** `apps/web/next.config.ts`, `apps/web/src/__tests__/next-config.test.ts`.
- **Plan:** Replace site-wide `/**` localPatterns with `/uploads/**` and `/resources/**` (with query variants for retry URLs) matching the public upload/resource contract.
- **Acceptance:** Next image optimizer no longer allows arbitrary local paths.
- **Status:** complete.

### P247-19 — Reduce lightbox pointer-move timer churn
- **Findings:** AGG2-32.
- **Files:** `apps/web/src/components/lightbox.tsx`, existing lightbox test if helper seam is useful.
- **Plan:** Avoid resetting auto-hide timers and state on every `mousemove` by throttling resets or only resetting when controls are hidden/stale.
- **Acceptance:** Pointer movement still reveals controls, but repeated moves do less timer/state work.
- **Status:** complete.

### P247-20 — Add visible loading-state context
- **Findings:** AGG2-38.
- **Files:** `apps/web/src/app/[locale]/loading.tsx`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`.
- **Plan:** Keep `role="status"` and add visible loading copy so reduced-motion users are not left with a static ring only.
- **Acceptance:** Loading states communicate visible status without relying solely on animation.
- **Status:** complete.

### P247-21 — Update docs for `SHARP_CONCURRENCY` semantics
- **Findings:** AGG2-37.
- **Files:** `apps/web/.env.local.example`, possibly `CLAUDE.md`.
- **Plan:** Reword the example to say the env var is an upper bound capped by CPU parallelism minus one.
- **Acceptance:** Docs match `Math.min(envConcurrency, maxConcurrency)` behavior.
- **Status:** complete.

## Gate requirements

Run and pass the configured gates against the whole repo before final commit/push:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e`
- `npm run lint:api-auth`
- `npm run lint:action-origin`

## Progress

- [x] P247-01 serialize client uploads
- [x] P247-02 reduce image-processing CPU oversubscription
- [x] P247-03 bound batch derivative cleanup
- [x] P247-04 clarify nginx upload serving docs
- [x] P247-05 fix gate timeout root cause
- [x] P247-06 expand touch-target audit coverage
- [x] P247-07 recoverable 44 px error boundaries
- [x] P247-08 align GA CSP/render configuration
- [x] P247-09 canonicalize load-more tags
- [x] P247-10 retry missing originals
- [x] P247-11 Docker/AppleDouble cleanup
- [x] P247-12 base/image URL validation docs
- [x] P247-13 short share-key default hardening
- [x] P247-14 default health liveness without DB probe
- [x] P247-15 origin-guard E2E semantics
- [x] P247-16 photo swipe coordinate normalization
- [x] P247-17 client/server tag validation alignment
- [x] P247-18 narrow image localPatterns
- [x] P247-19 lightbox pointer-move timer throttle
- [x] P247-20 visible loading copy
- [x] P247-21 SHARP_CONCURRENCY docs


## Completion evidence

- Implemented all scheduled P247 tasks and kept unscheduled findings in `plan/plan-248-cycle2-rpf-deferred.md` with preserved severity/confidence and exit criteria.
- Final gates passed on 2026-04-28: `npm run lint`; `npm run typecheck`; `npm run build`; `npm run test` (71 files / 474 tests); `npm run test:e2e` (20 passed, 2 local/CI credential checks skipped as designed); `npm run lint:api-auth`; `npm run lint:action-origin`.
- Build emitted the known sitemap fallback warning when DB credentials were absent; recorded as `D247-GW01` in the deferred plan.
