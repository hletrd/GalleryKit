# Cycle 2 Prompt 1 Aggregate Review — 2026-04-28

## Review fan-out provenance

UI/UX is present (Next.js App Router frontend under `apps/web/src/app`, TSX components, Tailwind, public assets), so the designer lane was included. The native child-agent surface allowed six concurrent agents; the requested reviewer list was covered through six composite lanes and a second retry batch after the first batch hit the agent-thread cap. All required review files were ultimately written.

Per-agent artifacts:

| Agent artifact | Findings |
|---|---:|
| `.context/reviews/code-reviewer.md` | 6 |
| `.context/reviews/critic.md` | 6 |
| `.context/reviews/perf-reviewer.md` | 12 |
| `.context/reviews/architect.md` | 8 |
| `.context/reviews/security-reviewer.md` | 5 |
| `.context/reviews/verifier.md` | 2 |
| `.context/reviews/test-engineer.md` | 6 |
| `.context/reviews/debugger.md` | 4 |
| `.context/reviews/tracer.md` | 4 |
| `.context/reviews/document-specialist.md` | 2 |
| `.context/reviews/designer.md` | 4 |

## AGENT FAILURES

None after retry. The first attempt to spawn verifier/writer/designer lanes hit the platform child-agent cap (`agent thread limit reached (max 6)`); those lanes were retried after closing completed agents and returned successfully.

## Deduped aggregate findings

Signal column lists cross-agent agreement. Highest severity/confidence is preserved across duplicates.

| ID | Severity | Confidence | Signal | Finding | Primary citations | Disposition guidance |
|---|---|---|---|---|---|---|
| AGG2-01 | High | High | perf-reviewer, debugger, tracer | Client upload concurrency can self-fail because three parallel upload requests contend on the same exclusive upload/settings MySQL lock. | `apps/web/src/components/upload-dropzone.tsx:185-254`; `apps/web/src/app/actions/images.ts:171-244`; `apps/web/src/lib/upload-processing-contract-lock.ts:10-57`; `apps/web/src/app/actions/settings.ts:75-86` | Schedule; correctness/UX failure under normal multi-file uploads. |
| AGG2-02 | High | High | perf-reviewer | Image conversion can oversubscribe CPU because queue concurrency, per-format `Promise.all`, and Sharp/libvips concurrency multiply. | `apps/web/src/lib/process-image.ts:17-26`; `apps/web/src/lib/image-queue.ts:121-129`; `apps/web/src/lib/image-queue.ts:271-279`; `apps/web/src/lib/process-image.ts:389-478` | Schedule bounded CPU-budget fix or defer only as performance with preserved severity. |
| AGG2-03 | High | High | perf-reviewer | Batch deletion can launch hundreds of full derivative-directory scans concurrently. | `apps/web/src/app/actions/images.ts:612-632`; `apps/web/src/lib/process-image.ts:173-214` | Schedule; high I/O/timeout risk during admin batch delete. |
| AGG2-04 | High | Medium | critic, architect, perf-reviewer | Documented/static nginx upload serving can 404 or fall back to slower Node streaming if host/container paths drift. | `apps/web/nginx/default.conf:96-105`; `apps/web/docker-compose.yml:13-25`; `apps/web/src/lib/upload-paths.ts:12-22`; `README.md:168-176` | Schedule docs/config clarification; deployment risk. |
| AGG2-05 | High | High | critic, perf-reviewer, architect, test-engineer | Gate timeout changes are too broad: Vitest defaults to 120s and Playwright webServer defaults to 30 minutes with unvalidated env parsing. | `apps/web/vitest.config.ts:10-12`; `apps/web/playwright.config.ts:31-68` | Schedule immediately; current uncommitted gate workaround masks hangs. |
| AGG2-06 | High | High | test-engineer | Touch-target audit still misses `h-10`, `w-10`, `size-10`, and other 40 px controls. | `apps/web/src/__tests__/touch-target-audit.test.ts:204-247`; `apps/web/src/__tests__/touch-target-audit.test.ts:486-590`; `apps/web/src/components/lightbox.tsx:310,329` | Schedule with the existing lightbox 44 px fix. |
| AGG2-07 | High | High | designer | Error boundaries strip the site/admin shell and landmarks, making transient route failures a dead end. | `apps/web/src/app/[locale]/error.tsx:7-35`; `apps/web/src/app/[locale]/admin/(protected)/error.tsx:7-35` | Schedule UX/accessibility recovery fix. |
| AGG2-08 | Medium | High | code-reviewer, critic, architect, tracer, verifier | Google Analytics rendering uses file-backed site config while CSP allows Google only when `NEXT_PUBLIC_GA_ID` is set. | `apps/web/src/app/[locale]/layout.tsx:118-128`; `apps/web/src/lib/content-security-policy.ts:58-69`; `apps/web/src/proxy.ts:41-44`; `apps/web/src/site-config.example.json:10` | Schedule; cross-agent agreement indicates high signal. |
| AGG2-09 | Medium | High | code-reviewer, critic | Public load-more tag filtering can drift from SSR canonicalization; duplicate tags can make later pages empty or broaden invalid-tag behavior. | `apps/web/src/app/actions/public.ts:65-91`; `apps/web/src/lib/data.ts:323-335`; `apps/web/src/lib/tag-slugs.ts:6-27`; `apps/web/src/app/[locale]/(public)/page.tsx:135-140`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:162-166` | Schedule correctness fix. |
| AGG2-10 | Medium | High | code-reviewer, debugger | Missing original upload files leave image rows permanently pending instead of entering retry/failure state. | `apps/web/src/lib/image-queue.ts:236-250`; `apps/web/src/lib/image-queue.ts:327-339`; `apps/web/src/lib/image-queue.ts:430-436` | Schedule correctness/operability fix. |
| AGG2-11 | Medium | High | critic, verifier | Docker build contexts still include `.context`, OMX/runtime artifacts, AppleDouble files, and generated metadata that Git now hides. | `.dockerignore:1-16`; `apps/web/.dockerignore:1-11`; `.gitignore:1-7`; `apps/web/._data`; `apps/web/public/._uploads`; `apps/web/Dockerfile:42` | Schedule; current worktree already adds Git ignore but not Docker ignore/cleanup. |
| AGG2-12 | Medium | High | perf-reviewer | Hot public listing pages perform exact grouped counts on uncached requests. | `apps/web/src/lib/data.ts:435-464`; `apps/web/src/app/[locale]/(public)/page.tsx:14-16`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17` | Defer as scale performance unless chosen in this cycle. |
| AGG2-13 | Medium | High | perf-reviewer | Public search uses leading-wildcard LIKE scans across images, tags, and aliases. | `apps/web/src/app/actions/public.ts:103-158`; `apps/web/src/lib/data.ts:810-916` | Defer as scale performance unless search load is a current problem. |
| AGG2-14 | Medium | Medium | perf-reviewer | Prev/next image lookups use OR-expanded keyset predicates without an index that includes the `id` tie-breaker. | `apps/web/src/lib/data.ts:547-619`; `apps/web/src/db/schema.ts:61-66`; `apps/web/drizzle/0001_sync_current_schema.sql:77-81` | Defer as scale performance/indexing unless DB slow-query evidence exists. |
| AGG2-15 | Medium | High | architect | `IMAGE_BASE_URL` is split between build-time Next optimizer policy and runtime URL generation. | `apps/web/next.config.ts:28,64-75`; `apps/web/src/lib/constants.ts:6-7`; `apps/web/src/lib/image-url.ts:4-9`; `apps/web/Dockerfile:35-38`; `README.md:142-144` | Schedule docs/validation if touching config; otherwise defer with exit criterion. |
| AGG2-16 | Medium | High | architect, debugger | Deployment-critical coordination state is process-local and not enforced at runtime. | `README.md:146-148`; `apps/web/src/lib/data.ts:11-23`; `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/lib/upload-tracker-state.ts:7-20`; `apps/web/src/lib/image-queue.ts:121-140,469-498` | Defer per documented single-writer topology unless adding runtime enforcement. |
| AGG2-17 | Medium | High | architect | Experimental storage abstraction still implies public originals and conflicts with the current private-original/public-derivative boundary. | `apps/web/src/lib/storage/index.ts:1-12`; `apps/web/src/lib/storage/types.ts:11-14`; `apps/web/src/lib/storage/local.ts:20,123-126`; `apps/web/src/lib/upload-paths.ts:24-40,82-102` | Schedule cleanup or clearly mark/dead-code; security boundary drift. |
| AGG2-18 | Medium | High | security-reviewer | Legacy short share keys remain accepted on unauthenticated share routes. | `.context/reviews/security-reviewer.md:SEC-01`; related share routes/actions under `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` and `apps/web/src/app/actions/sharing.ts` | Schedule only if legacy compatibility can be removed; otherwise defer with explicit compatibility reason. |
| AGG2-19 | Medium | High | security-reviewer | Public `/api/health` reveals DB readiness and performs unauthenticated DB work. | `.context/reviews/security-reviewer.md:SEC-02`; `apps/web/src/app/api/health/route.ts` | Schedule or defer as intentional health-check exposure with exit criterion. |
| AGG2-20 | Medium | Medium | security-reviewer | Public nginx deployment config relies on an external TLS terminator not enforced in repo. | `.context/reviews/security-reviewer.md:SEC-03`; `apps/web/nginx/default.conf`; `README.md` deployment section | Defer as deployment-policy risk or document stronger requirement. |
| AGG2-21 | Medium | High | document-specialist | README claims production base-URL validation is stricter than the build script actually enforces. | `README.md:142-143`; `apps/web/README.md:36-38`; `apps/web/scripts/ensure-site-config.mjs:12-39` | Schedule docs/script alignment. |
| AGG2-22 | Medium | High | test-engineer, tracer | Origin-guard E2E can pass without proving the same-origin guard fired when admin credentials are absent. | `apps/web/e2e/origin-guard.spec.ts:28-67`; `apps/web/e2e/admin.spec.ts:6-13`; `apps/web/e2e/helpers.ts:28-45`; `apps/web/src/app/api/admin/db/download/route.ts:13-32` | Schedule test hardening if admin E2E credentials are expected in CI. |
| AGG2-23 | Medium | High | test-engineer | `process-topic-image.ts` is only indirectly covered because topic-action tests mock the real Sharp/temp-file path. | `apps/web/src/lib/process-topic-image.ts:42-106`; `apps/web/src/__tests__/topics-actions.test.ts:111-114,183-260` | Schedule focused unit tests if quick; otherwise deferred test gap. |
| AGG2-24 | Medium | High | debugger, tracer | Photo swipe navigation mixes `screenX/screenY` and `clientX/clientY` coordinate systems. | `apps/web/src/components/photo-navigation.tsx:46-99`; `apps/web/src/components/info-bottom-sheet.tsx:56-98` | Schedule correctness/UX fix. |
| AGG2-25 | Medium | High | designer | Error-state recovery controls are below the repo's 44 px touch-target floor on mobile. | `apps/web/src/app/[locale]/error.tsx:16-34`; `apps/web/src/app/[locale]/admin/(protected)/error.tsx:16-34` | Schedule with AGG2-07. |
| AGG2-26 | Low | High | code-reviewer | Paginated listing helper can exceed its documented 100-row safety cap. | `apps/web/src/lib/data.ts:371-373`; `apps/web/src/lib/data.ts:435-464`; `apps/web/src/__tests__/data-pagination.test.ts:1-30` | Defer unless touching pagination. |
| AGG2-27 | Low | High | code-reviewer | Client tag creation accepts values the server rejects, causing late whole-upload failures. | `apps/web/src/components/tag-input.tsx:24-35,67-84`; `apps/web/src/components/upload-dropzone.tsx:212-215`; `apps/web/src/app/actions/images.ts:150-156`; `apps/web/src/lib/validation.ts:76-87` | Schedule small UX validation fix if quick. |
| AGG2-28 | Low | High | code-reviewer | Drizzle CLI config constructs malformed DB URLs instead of failing fast on missing env. | `apps/web/drizzle.config.ts:4-12`; `apps/web/src/db/index.ts:8-18` | Defer/schedule as operability polish. |
| AGG2-29 | Low | High | architect, security-reviewer | Next image optimizer local allowlist is broader than the public upload-serving contract. | `apps/web/next.config.ts:64-75`; `apps/web/src/lib/serve-upload.ts:7-49`; `apps/web/nginx/default.conf:92-105` | Schedule narrow allowlist if compatible; otherwise defer with compatibility reason. |
| AGG2-30 | Low | High | security-reviewer | `npm audit` reports a vulnerable nested PostCSS under Next. | `.context/reviews/security-reviewer.md:SEC-04`; `package-lock.json` | Defer only as upstream dependency advisory if no safe upgrade. |
| AGG2-31 | Low | High | perf-reviewer | CSV export materializes up to 50k rows and the full CSV in memory. | `apps/web/src/app/[locale]/admin/db-actions.ts:53-124` | Defer as bounded performance risk. |
| AGG2-32 | Low | Medium | perf-reviewer | Lightbox mouse movement recreates timers and calls state on every pointer movement. | `apps/web/src/components/lightbox.tsx:112-130,260-268` | Schedule small performance polish if touching lightbox. |
| AGG2-33 | Low | High | perf-reviewer | CI builds the Next app twice around E2E. | `.github/workflows/quality.yml:75-79`; `apps/web/playwright.config.ts:61-68` | Defer as CI efficiency unless editing workflow. |
| AGG2-34 | Low | Medium | perf-reviewer | Startup permission repair can become O(file-count) on large upload trees. | `apps/web/scripts/entrypoint.sh:4-22`; `apps/web/docker-compose.yml:22-25` | Defer as deployment performance risk. |
| AGG2-35 | Low | High | architect | Server-action origin lint gate relies on file topology rather than scanning all server-action-capable files. | `apps/web/scripts/check-action-origin.ts:13-21,86-97,221-262`; `apps/web/src/proxy.ts:96-101` | Defer as lint architecture risk. |
| AGG2-36 | Low | High | test-engineer | Nav "visual" checks capture screenshots but perform no baseline visual comparison. | `apps/web/e2e/nav-visual-check.spec.ts:5-40` | Defer as test-quality gap or rename tests. |
| AGG2-37 | Low | High | document-specialist | `SHARP_CONCURRENCY` example reads as direct override though runtime caps it at CPU parallelism minus one. | `apps/web/.env.local.example:32-34`; `apps/web/src/lib/process-image.ts:17-26` | Schedule doc correction if touching image-processing docs. |
| AGG2-38 | Low | Medium | designer | Loading states are spinner-only and lack visible context, especially with reduced motion. | `apps/web/src/app/[locale]/loading.tsx:3-10`; `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:3-10` | Schedule minor UX polish if touching shells. |
| AGG2-39 | Low | Medium | designer | RTL support is not wired into the current locale model. | `apps/web/src/app/[locale]/layout.tsx:88-95`; `apps/web/src/i18n/request.ts:4-14` | Defer; current locales are LTR (`en`, `ko`), reopen before adding RTL locale. |

## High-signal clusters

1. **Immediate gate/root-cause work:** AGG2-05 and AGG2-06 directly address the cycle continuation context: broad timeouts and incomplete touch-target guard coverage.
2. **Small correctness/UX fixes suitable for this cycle:** AGG2-07/25 (error boundaries), AGG2-08 (GA/CSP), AGG2-09 (load-more tags), AGG2-11 (Docker/AppleDouble ignores), AGG2-21 (base URL validation), AGG2-24 (swipe coordinates), AGG2-27/32/37/38 if low risk.
3. **Larger/backlog risks:** AGG2-01/02/03/10/12/13/14/16/17/18/19/20/23/29/30/31/33/34/35/36/39 need explicit plan disposition if not implemented this cycle.

## Final sweep confirmation

The aggregate preserves every current per-agent finding as either a unique aggregate item or a duplicate signal on another item. No per-agent review file was dropped. Build artifacts, `node_modules`, `.next`, and generated tsbuildinfo were treated as non-source except where findings specifically cited build-context inclusion.
