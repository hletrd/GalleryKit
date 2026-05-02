# Cycle 1 Aggregate Review

Date: 2026-05-02
Repo: `/Users/hletrd/flash-shared/gallery`

## Agent inventory and fan-out status

Available `spawn_agent` roles in this runtime were `default`, `explorer`, and `worker`; no repo-local `.claude/agents/*` or custom reviewer-agent files were registered. The review therefore used `default` agents with specialist reviewer prompts for the required roles plus additional reviewer-style roles found in prior repo review provenance: `api-reviewer`, `quality-reviewer`, and `style-reviewer`.

UI/UX was present (Next.js App Router TSX components, Tailwind/shadcn UI, messages, public/admin pages), so the `designer` reviewer was included and used `agent-browser` where feasible.

The environment enforced an agent thread cap, so the initial all-at-once fan-out accepted the first four reviewers and rejected later spawns with `agent thread limit reached (max 6)`. Those rejected reviewer roles were retried as slots freed. No reviewer remained failed; all required and additional reviewers returned a report.

## Source reports

- `.context/reviews/code-reviewer.md` — 6 findings (1 High, 3 Medium, 2 Low)
- `.context/reviews/perf-reviewer.md` — 9 findings (2 High, 6 Medium, 1 Low)
- `.context/reviews/security-reviewer.md` — 6 findings (1 High, 3 Medium, 2 Low)
- `.context/reviews/critic.md` — 7 findings (1 High, 2 Medium, 4 Low)
- `.context/reviews/verifier.md` — 4 findings (1 High, 1 Medium, 2 Low)
- `.context/reviews/test-engineer.md` — 10 findings (3 High, 5 Medium, 2 Low)
- `.context/reviews/tracer.md` — 6 findings (1 High, 3 Medium, 2 Low)
- `.context/reviews/architect.md` — 9 findings (3 High, 5 Medium, 1 Low)
- `.context/reviews/debugger.md` — 6 findings (1 High, 3 Medium, 2 Low)
- `.context/reviews/document-specialist.md` — 8 findings (3 Medium, 5 Low)
- `.context/reviews/designer.md` — 10 findings (4 Medium, 6 Low)
- `.context/reviews/api-reviewer.md` — 6 findings (1 High, 4 Medium, 1 Low)
- `.context/reviews/quality-reviewer.md` — 15 findings (3 High, 8 Medium, 4 Low)
- `.context/reviews/style-reviewer.md` — 9 findings (3 Medium, 6 Low)

Raw findings produced: **111**. Deduped aggregate findings below: **62**.

## Deduped findings

### AGG-C1-01 — High — Admin-user deletion can race to zero admins
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** code-reviewer, security-reviewer, critic, verifier, tracer, architect, debugger, api-reviewer.
- **Primary citations:** `apps/web/src/lib/advisory-locks.ts:26-32`; `apps/web/src/app/actions/admin-users.ts:198-215`; `apps/web/src/app/actions/admin-users.ts:227-247`.
- **Problem:** The code documents serialization of the “last admin” invariant, but the advisory lock is target-user scoped. Two admins can delete each other under different locks.
- **Failure scenario:** With exactly two admins A and B, A deletes B while B deletes A. Both observe `COUNT(*) = 2`, both delete, and the installation can have zero admins.
- **Suggested fix:** Use a single global admin-deletion lock or lock a shared admin set/guard row transactionally; add a concurrent regression test.

### AGG-C1-02 — High — Share-key `generateMetadata` DB lookups bypass route lookup rate limiting
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** security-reviewer, critic, tracer, architect, debugger, api-reviewer.
- **Primary citations:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-55,101-112`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37-51,111-121`; `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:32-50`.
- **Problem:** Metadata generation skips the share lookup limiter but still queries by share key before the page body can throttle.
- **Failure scenario:** Random-key bots continue forcing unauthenticated DB lookups even after page rendering would return over-limit/not-found; valid keys may disclose metadata before the explicit lookup budget is enforced.
- **Suggested fix:** Use generic no-DB metadata for share pages or enforce one request-level guard before metadata and page body.

### AGG-C1-03 — High — Docker production builds are not lockfile reproducible
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** security-reviewer, critic, architect, quality-reviewer.
- **Primary citations:** `apps/web/Dockerfile:21-36`; `.github/workflows/quality.yml:48-49`; `apps/web/package.json:38-58`.
- **Problem:** CI installs from `package-lock.json`, but production Docker builds omit the lockfile and run `npm install` with broad semver ranges.
- **Failure scenario:** A later deploy resolves a dependency tree that CI never built, tested, or audited.
- **Suggested fix:** Copy the root lockfile into dependency stages and use `npm ci` for workspace installs.

### AGG-C1-04 — High — Remote deploy script can falsely report success after failed commands
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `scripts/deploy-remote.sh:1-3`; `apps/web/deploy.sh:1-34`.
- **Problem:** The remote deploy script lacks `set -euo pipefail`; failed `git pull` or `docker compose` can be followed by success `echo`s and exit 0.
- **Failure scenario:** Automation and operators believe a deployment succeeded when the remote image was not updated or started.
- **Suggested fix:** Add fail-fast shell options, quote variables, and optionally trap failing steps.

### AGG-C1-05 — High — Admin user creation success path rolls back the documented creation/CPU rate limit
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** security-reviewer, critic, tracer, debugger, quality-reviewer.
- **Primary citations:** `apps/web/src/app/actions/admin-users.ts:113-154`; `apps/web/src/__tests__/admin-users.test.ts:150-161`.
- **Problem:** The `user_create` bucket is described as creation/CPU protection but successful unique user creations are rolled back.
- **Failure scenario:** A compromised or malicious admin can create many accounts and force Argon2/DB work without consuming the hourly budget.
- **Suggested fix:** Count successful creations against the budget, or explicitly redefine the budget and add another success quota.

### AGG-C1-06 — High — Touch-target audit misses `global-error.tsx`, which has a 40px button
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** test-engineer, document-specialist (coverage overclaim), designer/style-reviewer (touch target risks).
- **Primary citations:** `apps/web/src/__tests__/touch-target-audit.test.ts:49-52,257-260`; `apps/web/src/app/global-error.tsx:71-75`.
- **Problem:** The blocking touch-target gate scans only components/admin roots and misses app-level error UI.
- **Failure scenario:** Fatal error recovery ships a sub-44px primary button while the accessibility gate stays green.
- **Suggested fix:** Expand scan roots/patterns and fix the error reset target to a 44px hit area.

### AGG-C1-07 — High — Image queue shares CPU/memory budget with SSR/API web process
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/instrumentation.ts:1-6`; `apps/web/Dockerfile:93-94`; `apps/web/src/lib/image-queue.ts:138-145`; `apps/web/src/lib/process-image.ts:17-26,537-542`.
- **Problem:** Background Sharp processing starts in the same Node process that handles SSR, admin actions, auth, and public routes.
- **Failure scenario:** Large upload bursts or higher queue concurrency can starve page rendering and API responsiveness.
- **Suggested fix:** Move processing to a worker or bound format/Sharp concurrency and add metrics.

### AGG-C1-08 — High — Uncached public listing pages run expensive join/group/window-count queries on every request
- **Status/confidence:** likely / High.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/app/[locale]/(public)/page.tsx:14-16,138-140`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17,164-166`; `apps/web/src/lib/data.ts:653-668`.
- **Problem:** Fresh public pages compute tag aggregation and `COUNT(*) OVER()` for each request.
- **Failure scenario:** Large galleries and crawler traffic can repeatedly force DB temp-table/sort work on hot routes.
- **Suggested fix:** Split page ID lookup from tag aggregation and use `pageSize + 1` or cached counts.

### AGG-C1-09 — Medium — Existing photo-share no-op decrements rate-limit counters before any increment
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** code-reviewer, security-reviewer, critic, tracer, debugger, api-reviewer, quality-reviewer.
- **Primary citations:** `apps/web/src/app/actions/sharing.ts:55-76,95-120`; `apps/web/src/lib/rate-limit.ts:344-363`; `apps/web/src/__tests__/sharing-source-contracts.test.ts:7-16`.
- **Problem:** Already-shared photo branch calls rollback before the current request pre-increments.
- **Failure scenario:** Repeated no-op share calls can erase real share-write pressure and bypass the intended write budget.
- **Suggested fix:** Remove rollback from the initial existing-key branch; keep rollbacks only after a known increment.

### AGG-C1-10 — Medium — `/api/og` nonexistent-topic requests rollback budget after DB work
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** api-reviewer.
- **Primary citations:** `apps/web/src/app/api/og/route.tsx:38-77`; `apps/web/src/__tests__/og-rate-limit.test.ts:15-44`.
- **Problem:** Valid-looking missing topics consume DB reads and then rollback the OG limiter.
- **Failure scenario:** An unauthenticated script can issue unlimited random-topic OG requests without reaching 429.
- **Suggested fix:** Count post-DB 404s as attempts; only free syntactic validation failures.

### AGG-C1-11 — Medium — Spoofed `X-Forwarded-For` can bypass per-IP limits in documented nginx trust-proxy topology
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** security-reviewer.
- **Primary citations:** `apps/web/docker-compose.yml:18-20`; `apps/web/src/lib/rate-limit.ts:72-75,116-145`; `apps/web/nginx/default.conf:67-69,84-86,101-103,117-119,134-136,169-171`.
- **Problem:** Nginx appends incoming `X-Forwarded-For`; with one trusted hop the app can select attacker-controlled leftmost values.
- **Failure scenario:** Attackers rotate spoofed headers to evade public/admin IP-scoped budgets.
- **Suggested fix:** Overwrite forwarded IP at the trusted edge (`$remote_addr`) or adjust trust logic/tests.

### AGG-C1-12 — Medium — Upload tag parsing strips rejected control/formatting chars instead of rejecting them
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** api-reviewer.
- **Primary citations:** `apps/web/src/app/actions/images.ts:131-158`; contrast `apps/web/src/app/actions/tags.ts:56-65`, `apps/web/src/app/actions/images.ts:729-737`.
- **Problem:** Upload tag string sanitization can silently persist a different tag than the direct caller submitted.
- **Failure scenario:** A Server Action caller submits hidden Unicode formatting/control characters; upload strips rather than rejects, unlike other admin string surfaces.
- **Suggested fix:** Reject when tag/topic sanitization changes raw input; add upload action tests for C0/bidi/zero-width inputs.

### AGG-C1-13 — Medium — `admin_users.updated_at` exists in schema but not migrations/reconcile
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `apps/web/src/db/schema.ts:106-113`; `apps/web/drizzle/0001_sync_current_schema.sql:1-8`; `apps/web/scripts/migrate.js:276-289`.
- **Problem:** Runtime schema exposes a column fresh DBs do not create.
- **Failure scenario:** A future code path selects `adminUsers.updated_at` and fails in production with `Unknown column`.
- **Suggested fix:** Add migration/reconcile column creation or remove the schema field.

### AGG-C1-14 — Medium — Restore/maintenance state is process-local while scaling paths are easy to enable
- **Status/confidence:** risk / High.
- **Cross-agent agreement:** tracer, architect.
- **Primary citations:** `README.md:146-148`; `CLAUDE.md:160`; `apps/web/src/lib/restore-maintenance.ts:1-22`; `apps/web/src/app/[locale]/admin/db-actions.ts:310-343`.
- **Problem:** `globalThis` maintenance flags only coordinate one Node process.
- **Failure scenario:** A second replica can accept mutations or reads while another replica restores the DB.
- **Suggested fix:** Move maintenance state to a shared DB/advisory-lock lease, or enforce/document single-instance deployment.

### AGG-C1-15 — Medium — Startup migrations lack cross-process migration locking
- **Status/confidence:** risk / Medium.
- **Cross-agent agreement:** architect.
- **Primary citations:** `apps/web/Dockerfile:90-94`; `apps/web/scripts/migrate.js:525-542`; `apps/web/src/lib/advisory-locks.ts:17-39`.
- **Problem:** App startup runs DDL and seeding without a DB-level migration lock.
- **Failure scenario:** Rolling deploys or accidental replicas can race migrations and fail/start partially.
- **Suggested fix:** Externalize migrations or wrap startup migration/seed in an advisory lock.

### AGG-C1-16 — Medium — Storage abstraction is not the actual upload/process/serve boundary
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** architect, document-specialist.
- **Primary citations:** `apps/web/src/lib/storage/types.ts:1-15,50-72,89-93`; `apps/web/src/lib/storage/index.ts:1-12`; `apps/web/src/lib/process-image.ts:329-542`; `apps/web/src/lib/serve-upload.ts:63-105`.
- **Problem:** Comments and abstraction imply future/live pipeline usage but production still writes/reads direct filesystem paths.
- **Failure scenario:** Future S3/MinIO work can produce split-brain local and remote storage.
- **Suggested fix:** Reword comments as future intent or wire a single image storage service end to end.

### AGG-C1-17 — Medium — Auth/API layering imports server-action modules as lower-level services
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** architect.
- **Primary citations:** `apps/web/src/lib/api-auth.ts:1-5`; `apps/web/src/app/actions/auth.ts:1-55`; `apps/web/src/app/actions.ts:1-30`.
- **Problem:** API/lib/action layers couple to App Router Server Action modules and broad client action barrels.
- **Failure scenario:** Background jobs or API routes inherit Server Action compilation/request semantics unintentionally.
- **Suggested fix:** Move request-scoped auth services to a server-only library and keep action files as thin wrappers.

### AGG-C1-18 — Medium — Schema/table contracts are duplicated across Drizzle, restore scanner, and legacy migrator
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** architect.
- **Primary citations:** `apps/web/src/db/schema.ts:4-145`; `apps/web/src/lib/sql-restore-scan.ts:2-21`; `apps/web/scripts/migrate.js:247-464`.
- **Problem:** Table allowlists and compatibility DDL can drift from schema/migrations.
- **Failure scenario:** A future table is accepted by migrations but rejected during restore or missed in legacy reconciliation.
- **Suggested fix:** Centralize/generate a table manifest and add contract tests.

### AGG-C1-19 — Medium — Locale identifiers are centralized in TS but hard-coded as two lowercase letters in proxy/nginx
- **Status/confidence:** risk / High.
- **Cross-agent agreement:** architect.
- **Primary citations:** `apps/web/src/lib/constants.ts:1-4`; `apps/web/src/proxy.ts:91-115`; `apps/web/nginx/default.conf:57-60,74-77,91-94,107-110,146-149`; `apps/web/src/__tests__/nginx-config.test.ts:14-19`.
- **Problem:** Adding `en-US`/`zh-Hant` can miss body/rate/static upload routing rules.
- **Failure scenario:** Security/body-limit behavior becomes locale-dependent.
- **Suggested fix:** Generate locale regexes from `LOCALES` or enforce `[a-z]{2}` explicitly.

### AGG-C1-20 — Medium — Search uses leading-wildcard LIKE scans and stale requests are not aborted
- **Status/confidence:** likely / High.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/lib/data.ts:1094-1201`; `apps/web/src/components/search.tsx:63-100`; `apps/web/src/app/actions/public.ts:160-209`.
- **Problem:** Every query scans text fields and possibly tag/alias joins; debounced stale requests still run server-side.
- **Failure scenario:** Large galleries and typing bursts can keep DB CPU high.
- **Suggested fix:** Use full-text/search index, short TTL cache, and/or abort/coalesce requests.

### AGG-C1-21 — Medium — Upload tag persistence repeats per-file/per-tag DB lookups
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/app/actions/images.ts:265-385`; `apps/web/src/lib/tag-records.ts:29-68`.
- **Problem:** Uploading many files with the same tags repeats identical tag lookup chains.
- **Failure scenario:** Batch uploads issue thousands of sequential DB operations before queue enqueue.
- **Suggested fix:** Resolve unique request tags once and reuse IDs across files.

### AGG-C1-22 — Medium — Upload/settings contract lock is held across expensive upload I/O/CPU work
- **Status/confidence:** risk / Medium.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/app/actions/images.ts:172-180,265-455`; `apps/web/src/lib/process-image.ts:347-391`; `apps/web/src/components/upload-dropzone.tsx:239-245`.
- **Problem:** The upload-processing contract lock covers long-running file saves, metadata extraction, tags, and enqueue.
- **Failure scenario:** One large/slow upload blocks all uploads and settings/output-size operations for minutes.
- **Suggested fix:** Narrow lock scope with a config snapshot/version or reader/writer semantics; add lock hold telemetry.

### AGG-C1-23 — Medium — Batch delete scans derivative directories once per image per format
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/app/actions/images.ts:650-670`; `apps/web/src/lib/process-image.ts:181-213`.
- **Problem:** Deleting N images scans derivative directories roughly `N × 3` times.
- **Failure scenario:** Large batch deletes saturate slow disks/NAS and delay admin operations.
- **Suggested fix:** Scan each derivative directory once per batch and unlink matched bases.

### AGG-C1-24 — Medium — Infinite scroll retains all loaded image cards in React state and DOM
- **Status/confidence:** likely / High.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/components/home-client.tsx:105-110,179-180,274-282`; `apps/web/src/components/load-more.tsx:97-107`.
- **Problem:** Every loaded photo remains mounted.
- **Failure scenario:** Scrolling through hundreds/thousands of photos creates mobile memory/jank issues.
- **Suggested fix:** Add virtualization/windowing, page retention limits, or explicit pagination after N pages.

### AGG-C1-25 — Medium — Admin CSV export materializes large data multiple times
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:36-116`; `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-107`.
- **Problem:** Rows, line arrays, final CSV string, Server Action payload, and browser Blob coexist for large exports.
- **Failure scenario:** 50k-row exports can pause the server, exceed body limits, or freeze the admin tab.
- **Suggested fix:** Implement authenticated streaming CSV route.

### AGG-C1-26 — Medium — Same-origin action lint can accept guards after mutations
- **Status/confidence:** scanner false-negative risk / High.
- **Cross-agent agreement:** code-reviewer.
- **Primary citations:** `apps/web/scripts/check-action-origin.ts` scanner; future pattern described in `code-reviewer.md`.
- **Problem:** The scanner requires a guard/return but not necessarily guard-before-effect ordering.
- **Failure scenario:** Future actions can mutate then guard and pass lint.
- **Suggested fix:** Enforce guard-before-effect ordering or initial allowed-prefix placement; add negative fixture.

### AGG-C1-27 — Medium — Drizzle DB TLS behavior diverges from runtime and migration scripts
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `apps/web/src/db/index.ts:6-12`; `apps/web/scripts/mysql-connection-options.js:1-23`; `apps/web/drizzle.config.ts:4-12`.
- **Problem:** Runtime/scripts can enable TLS for hosted DBs while Drizzle Kit only builds a URL.
- **Failure scenario:** `db:push`/Drizzle commands fail or connect with different TLS semantics.
- **Suggested fix:** Share connection-option logic or add explicit Drizzle SSL handling/tests.

### AGG-C1-28 — Medium — Critical JS deploy/migration scripts receive only syntax checking
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `apps/web/package.json:15-25`; `apps/web/scripts/check-js-scripts.mjs:38-40`; `apps/web/scripts/migrate.js`; `apps/web/scripts/run-e2e-server.mjs`.
- **Problem:** `node --check` catches syntax but not type/property/import errors in critical JS scripts.
- **Failure scenario:** Production migration/startup fails from a semantically invalid but syntactically valid JS script.
- **Suggested fix:** Convert to TS or enable `// @ts-check`/checkJs/ESLint for scripts.

### AGG-C1-29 — Medium — CI initializes/builds around E2E redundantly
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `.github/workflows/quality.yml:65-79`; `apps/web/scripts/run-e2e-server.mjs:75-84`.
- **Problem:** CI runs init/build outside Playwright, then the Playwright server script does init/seed/build again.
- **Failure scenario:** Slower CI, lower timeout headroom, and harder failure triage.
- **Suggested fix:** Build/init/seed once or add skip flags for prepared CI.

### AGG-C1-30 — Medium — Runtime Node is 24 while `@types/node` is 25
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `.nvmrc:1`; `apps/web/package.json:5-7,59-63`.
- **Problem:** Types can expose APIs not available on runtime Node.
- **Failure scenario:** Future code compiles but fails on Node 24.
- **Suggested fix:** Pin `@types/node` to major 24 or upgrade runtime/CI together.

### AGG-C1-31 — Medium — `.context/` is ignored while required review reports are tracked
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `.gitignore:16-20`; tracked `.context` files.
- **Problem:** Required reports are easy to miss because new files are ignored unless force-added.
- **Failure scenario:** Review artifacts required by loop are silently absent from commits.
- **Suggested fix:** Add `.gitignore` exceptions for required `.context/reviews/**` or untrack/archive generated context.

### AGG-C1-32 — Medium — Password-change behavior lacks behavioral coverage
- **Status/confidence:** confirmed coverage gap / High.
- **Cross-agent agreement:** test-engineer.
- **Primary citations:** `apps/web/e2e/admin.spec.ts:36-38`; `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:20-103`; `apps/web/src/app/actions/auth.ts:281-425`; `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:29-38`.
- **Problem:** Tests mostly check route visibility/static source strings.
- **Failure scenario:** `PasswordForm` or `updatePassword` behavior can regress while source-text assertions still pass.
- **Suggested fix:** Add mocked behavioral action tests and TSX component tests.

### AGG-C1-33 — Medium — Settings persistence path lacks save/reload/action behavior coverage
- **Status/confidence:** confirmed coverage gap / High.
- **Cross-agent agreement:** test-engineer.
- **Primary citations:** `apps/web/e2e/admin.spec.ts:45-63`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:34-87,175-179`; `apps/web/src/app/actions/settings.ts:40-166`.
- **Problem:** E2E toggles local switch state but does not save/reload; server action behavior is mostly source-sliced.
- **Failure scenario:** Persistence, same-origin, lock, audit, or revalidation can regress undetected.
- **Suggested fix:** Add mocked action tests and an E2E save/reload flow.

### AGG-C1-34 — Medium — Critical invariants rely on source-text tests
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** test-engineer.
- **Primary citations:** `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`; `resolved-stream-source.test.ts`; `data-view-count-flush.test.ts`; `settings-image-sizes-lock.test.ts`.
- **Problem:** String presence/order can pass with dead/commented code or fail harmless refactors.
- **Failure scenario:** Load-bearing auth/path/rate-limit invariants drift while tests remain green.
- **Suggested fix:** Replace with behavioral tests or AST-aware assertions.

### AGG-C1-35 — Medium — Visual E2E screenshots are artifacts, not assertions
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** test-engineer.
- **Primary citations:** `apps/web/e2e/nav-visual-check.spec.ts:14,27,39`; `apps/web/playwright.config.ts:58-60`.
- **Problem:** The visual spec writes screenshots but never compares baselines.
- **Failure scenario:** Layout/overflow regressions ship while screenshots are merely emitted.
- **Suggested fix:** Use `toHaveScreenshot` or explicit layout assertions and upload artifacts on failure.

### AGG-C1-36 — Medium — No jsdom/TSX render-event test lane for complex client components
- **Status/confidence:** confirmed risk / High.
- **Cross-agent agreement:** test-engineer, verifier (image zoom copied math test).
- **Primary citations:** `apps/web/vitest.config.ts:10-12`; `apps/web/src/components/image-zoom.tsx:12-356`; `apps/web/src/__tests__/image-zoom-math.test.ts:3-39`.
- **Problem:** Complex client event behavior is not directly rendered/tested; image-zoom math test duplicates private implementation.
- **Failure scenario:** DOM events/focus/ARIA/style transforms regress while copied helper tests pass.
- **Suggested fix:** Add TSX/jsdom or Playwright component lane; extract pure math helpers and test production code.

### AGG-C1-37 — Medium — Local E2E gate cannot list/run public smoke tests without DB fixtures
- **Status/confidence:** confirmed locally / High.
- **Cross-agent agreement:** test-engineer.
- **Primary citations:** `apps/web/playwright.config.ts:71-78`; `apps/web/scripts/run-e2e-server.mjs:75-78`; `apps/web/package.json:20`.
- **Problem:** Playwright server startup always init/seed/builds against DB.
- **Failure scenario:** Developers without DB env cannot even list tests or run public/nav smokes.
- **Suggested fix:** Add preflight messages and scripts for list/public/admin scopes.

### AGG-C1-38 — Medium — Admin upload E2E can leave DB/filesystem fixture drift on failure
- **Status/confidence:** likely / Medium.
- **Cross-agent agreement:** test-engineer.
- **Primary citations:** `apps/web/e2e/admin.spec.ts:73-88`; `apps/web/e2e/helpers.ts:151-172`; `apps/web/scripts/seed-e2e.ts:168-253`.
- **Problem:** Upload test cleanup is not in `try/finally`.
- **Failure scenario:** Timeout/selector failure leaves uploaded rows/files that affect retries.
- **Suggested fix:** Ensure cleanup by unique filename in `finally`.

### AGG-C1-39 — Medium — Public route error boundary strands users outside information architecture
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** designer.
- **Primary citations:** `apps/web/src/app/[locale]/error.tsx:16-37`; `apps/web/src/app/[locale]/not-found.tsx:19-52`.
- **Problem:** Error boundary has only Try Again/Return actions, no nav/footer/search/topics, and can have empty title.
- **Failure scenario:** A transient DB/metadata failure leaves visitors without wayfinding and a fallback route that may also fail.
- **Suggested fix:** Reuse public shell elements and meaningful title/recovery affordances.

### AGG-C1-40 — Medium — Admin/design-system touch targets remain compact by default
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** designer, style-reviewer, document-specialist.
- **Primary citations:** `apps/web/src/components/ui/button.tsx:23-29`; `apps/web/src/components/ui/input.tsx:10-13`; `apps/web/src/components/ui/select.tsx:27-40`; `apps/web/src/components/ui/switch.tsx:13-24`; `apps/web/src/__tests__/touch-target-audit.test.ts:120-190`.
- **Problem:** Primitives default to 32–40px controls and tests document exemptions.
- **Failure scenario:** Touch admins miss edit/delete/logout/add controls.
- **Suggested fix:** Introduce touch-safe sizing and retire exemptions where mobile admin is supported.

### AGG-C1-41 — Medium — Custom controls bypass touch-target guard with tiny hit areas
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** style-reviewer.
- **Primary citations:** `apps/web/src/components/tag-input.tsx:169-176,219-240`; `apps/web/src/components/info-bottom-sheet.tsx:181-214`; `apps/web/src/components/histogram.tsx:293-326`.
- **Problem:** Some non-primitive buttons/options are 24–32px or text-sized.
- **Failure scenario:** Mobile users miss close/remove/toggle controls.
- **Suggested fix:** Expand hit boxes and audit custom-control patterns.

### AGG-C1-42 — Medium — Comboboxes reference listboxes that often do not exist
- **Status/confidence:** likely / High.
- **Cross-agent agreement:** designer.
- **Primary citations:** `apps/web/src/components/search.tsx:195-203,246-288`; `apps/web/src/components/tag-input.tsx:183-244`.
- **Problem:** `aria-controls` can point at absent listbox elements.
- **Failure scenario:** Assistive tech users hear relationships that cannot be navigated.
- **Suggested fix:** Always render stable listboxes for empty states or remove controls/activedescendant when absent.

### AGG-C1-43 — Medium — Admin validation is often toast-only or not field-associated
- **Status/confidence:** likely / High.
- **Cross-agent agreement:** designer.
- **Primary citations:** `topic-manager.tsx:59-94,172-190,259-279`; `seo-client.tsx:39-68,95-174`; `settings-client.tsx:35-68,100-155`; `upload-dropzone.tsx:145-176`.
- **Problem:** Failures are announced by transient toasts without field errors/focus summaries.
- **Failure scenario:** Keyboard/screen-reader admins cannot identify the failing field after toast dismissal.
- **Suggested fix:** Return structured field errors, focus a summary, set `aria-invalid`, and connect hints/errors.

### AGG-C1-44 — Medium — Filtered page metadata/OG cards show raw tag slugs rather than display labels
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** style-reviewer.
- **Primary citations:** `apps/web/src/app/[locale]/(public)/page.tsx:37-43`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:67-86`; `apps/web/src/app/api/og/route.tsx:80-86,182-195`.
- **Problem:** UI uses friendly tag names, but metadata/social previews expose machine slugs.
- **Failure scenario:** Shared links look machine-generated/localization-poor.
- **Suggested fix:** Resolve tag labels for metadata and OG generation.

### AGG-C1-45 — Medium — Docker build docs imply `BASE_URL` from runtime env works at image build
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** document-specialist.
- **Primary citations:** `README.md:117-143`; `apps/web/README.md:36`; `apps/web/scripts/ensure-site-config.mjs:11-37`; `apps/web/docker-compose.yml:7-20`; `apps/web/Dockerfile:39-42`.
- **Problem:** Compose passes `BASE_URL` only at runtime, not as a build arg.
- **Failure scenario:** Users set `.env.local` `BASE_URL` and Docker build still fails placeholder URL guard.
- **Suggested fix:** Add/pass a build arg or update docs to require non-placeholder site config for Docker builds.

### AGG-C1-46 — Medium — Deploy docs point to root `.env.deploy`, script defaults to home-secret path
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** code-reviewer, quality-reviewer, document-specialist.
- **Primary citations:** `README.md:103-113`; `CLAUDE.md:287-294`; `.env.deploy.example:1-4`; `scripts/deploy-remote.sh:4-6,47-50`.
- **Problem:** Documented `cp .env.deploy.example .env.deploy; npm run deploy` path fails.
- **Failure scenario:** Operators create the wrong secret file and cannot deploy.
- **Suggested fix:** Align docs and script; prefer root fallback or update docs to the home-secret path.

### AGG-C1-47 — Medium — Upload body-cap docs conflict with nginx/app behavior
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** verifier, quality-reviewer, document-specialist.
- **Primary citations:** `README.md:142-146`; `CLAUDE.md:219-220`; `apps/web/nginx/default.conf:29-31,72-76,89-93`; `apps/web/src/lib/upload-limits.ts:1-17`; `apps/web/next.config.ts:69-77`.
- **Problem:** Docs claim 2 GiB general nginx cap while shipped config uses 2 MiB default and 216 MiB dashboard upload.
- **Failure scenario:** Operators misconfigure proxies and troubleshoot 413s with wrong assumptions.
- **Suggested fix:** Document current per-location caps and app-level cumulative limits.

### AGG-C1-48 — Low — Settings UI lets admins toggle write-once GPS setting after uploads
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** code-reviewer, verifier, tracer.
- **Primary citations:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:142-185`; `apps/web/src/app/actions/settings.ts:115-132`.
- **Problem:** Server rejects changed `strip_gps_on_upload` after images exist, but the switch remains enabled.
- **Failure scenario:** Admin stages an impossible save and sees avoidable server failure.
- **Suggested fix:** Disable the switch and connect it to the lock hint.

### AGG-C1-49 — Low — Duplicate tag slugs can make internal data-layer filtering overconstrained
- **Status/confidence:** risk / Medium.
- **Cross-agent agreement:** code-reviewer.
- **Primary citations:** `apps/web/src/lib/data.ts` tag filter builder.
- **Problem:** Duplicate slugs are compared against `COUNT(DISTINCT ...)` count.
- **Failure scenario:** A caller passing `['portrait','portrait']` gets no results despite matching images.
- **Suggested fix:** Deduplicate tag slugs inside data-layer filter construction.

### AGG-C1-50 — Low — Home metadata may run an extra listing-shaped query for OG image
- **Status/confidence:** likely / Medium.
- **Cross-agent agreement:** perf-reviewer.
- **Primary citations:** `apps/web/src/app/[locale]/(public)/page.tsx:78-80,138-140`; `apps/web/src/lib/data.ts:589-615`.
- **Problem:** Default home metadata and body can each run listing-style queries.
- **Failure scenario:** Hot home requests pay duplicate DB work.
- **Suggested fix:** Use a cheap latest-image OG query or stable configured OG URL.

### AGG-C1-51 — Low — Argon2id policy is not centralized/explicitly parameterized
- **Status/confidence:** risk / Medium.
- **Cross-agent agreement:** security-reviewer.
- **Primary citations:** `apps/web/src/app/actions/auth.ts:379`; `apps/web/src/app/actions/admin-users.ts:138`; `apps/web/scripts/seed-admin.ts:46-49`; `apps/web/scripts/migrate-admin-auth.ts:45-50`; `apps/web/scripts/migrate.js:515-520`.
- **Problem:** Hash resistance depends on package defaults at each call site.
- **Failure scenario:** Defaults drift or cannot be tuned centrally after DB compromise review.
- **Suggested fix:** Define shared explicit Argon2 options and use everywhere.

### AGG-C1-52 — Low — Default health/build behavior can mask DB misconfiguration
- **Status/confidence:** confirmed / Medium.
- **Cross-agent agreement:** critic, designer.
- **Primary citations:** `apps/web/src/db/index.ts:13-25`; `apps/web/src/app/sitemap.ts:24-46`; `apps/web/src/app/api/health/route.ts:18-25`; `apps/web/src/app/api/live/route.ts:1-9`; `apps/web/scripts/ensure-site-config.mjs:6-42`.
- **Problem:** Build and default health can pass while DB env is absent.
- **Failure scenario:** First real DB-backed route fails after health appears green.
- **Suggested fix:** Add readiness mode/startup validation or clearer docs/logging.

### AGG-C1-53 — Low — Upload action comment incorrectly says `images.topic` lacks an FK
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** critic, document-specialist.
- **Primary citations:** `apps/web/src/app/actions/images.ts:239-243`; `apps/web/src/db/schema.ts:30`; `apps/web/scripts/migrate.js:456`.
- **Problem:** Comment contradicts schema/migrations.
- **Failure scenario:** Maintainers misread the data integrity model.
- **Suggested fix:** Update the comment to describe friendly pre-insert error plus DB FK backstop.

### AGG-C1-54 — Low — Invalid `photoId` suppresses shared-group view counting while rendering grid
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** debugger.
- **Primary citations:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-147`; `apps/web/src/lib/data.ts:1014-1019`.
- **Problem:** Any non-empty `photoId` disables group view increment before validity is known.
- **Failure scenario:** Malformed copied links/crawlers undercount group analytics.
- **Suggested fix:** Validate selected photo before suppressing group view increment or canonicalize invalid params.

### AGG-C1-55 — Low — Dangerous restore-dump cleanup can leak temp file on Windows-like unlink semantics
- **Status/confidence:** risk / Medium.
- **Cross-agent agreement:** debugger.
- **Primary citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:408-433`.
- **Problem:** Dangerous SQL branch unlinks before closing the scan fd and swallows unlink errors.
- **Failure scenario:** Windows-like volumes can retain rejected dumps.
- **Suggested fix:** Close descriptor before unlinking or unlink after `finally`.

### AGG-C1-56 — Low — E2E cross-browser/mobile coverage and CI artifacts are limited
- **Status/confidence:** risk/confirmed / Medium.
- **Cross-agent agreement:** test-engineer.
- **Primary citations:** `apps/web/playwright.config.ts:58-70`; `.github/workflows/quality.yml:71-79`.
- **Problem:** Only Chromium is installed, mobile uses manual viewports, and traces/videos are not uploaded on CI failure.
- **Failure scenario:** Safari/mobile quirks and flaky diagnostics are missed.
- **Suggested fix:** Add small WebKit/mobile project and failure artifact upload.

### AGG-C1-57 — Low — Admin login required-field validation is native and not app-localized
- **Status/confidence:** confirmed / Medium.
- **Cross-agent agreement:** designer.
- **Primary citations:** `apps/web/src/app/[locale]/admin/login-form.tsx:51-80`.
- **Problem:** Required-field validation uses browser/OS messages rather than app locale messages.
- **Failure scenario:** Korean UI can surface English or mismatched validation bubbles.
- **Suggested fix:** Add localized inline validation or document native validation as intentional.

### AGG-C1-58 — Low — Shared-group cards lack the home gallery focus affordance
- **Status/confidence:** likely / Medium.
- **Cross-agent agreement:** designer.
- **Primary citations:** `apps/web/src/components/home-client.tsx:192-201`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:188-209`.
- **Problem:** Shared album image links do not mirror visible focus rings.
- **Failure scenario:** Keyboard users cannot reliably identify focused photo links.
- **Suggested fix:** Mirror `focus-within`/`focus-visible` card rings.

### AGG-C1-59 — Low — RTL is hard-coded out despite i18n architecture
- **Status/confidence:** future risk / High.
- **Cross-agent agreement:** designer.
- **Primary citations:** `apps/web/src/app/[locale]/layout.tsx:89-98`.
- **Problem:** Layout sets `dir="ltr"` unconditionally.
- **Failure scenario:** Future RTL locales render with wrong reading/order affordances.
- **Suggested fix:** Add locale-to-dir helper before adding RTL locales.

### AGG-C1-60 — Low — Loading/completion/error announcements and mobile nav relationships are inconsistent
- **Status/confidence:** likely / Medium.
- **Cross-agent agreement:** designer.
- **Primary citations:** `apps/web/src/components/optimistic-image.tsx:70-78`; `apps/web/src/components/load-more.tsx:91-124`; `apps/web/src/components/nav-client.tsx:86-161`; `apps/web/src/app/[locale]/globals.css:148-151`.
- **Problem:** Some loading starts are announced but completion/error states and nav `aria-controls`/scroll affordance are weaker.
- **Failure scenario:** Screen-reader/touch users miss load completion, failures, or expandable nav relationships.
- **Suggested fix:** Add polite completion/error statuses and `aria-controls`/discoverable overflow cues.

### AGG-C1-61 — Low — Copy/style/docs consistency issues
- **Status/confidence:** confirmed / High.
- **Cross-agent agreement:** style-reviewer, document-specialist.
- **Primary citations:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:33-41`; `apps/web/messages/en.json`; `apps/web/messages/ko.json`; `apps/web/src/app/[locale]/globals.css:117-158`; `apps/web/components.json:6-10`; `CLAUDE.md:185`; `apps/web/src/lib/process-image.ts:393-397`; `CLAUDE.md:281-282`.
- **Problem:** Hardcoded English DB error, mixed `...`/`…`, dead/stale CSS selectors, shadcn CSS path drift, stale line references, and stale `db:push` deploy checklist.
- **Failure scenario:** Localized UX and maintainer guidance become inconsistent or misleading.
- **Suggested fix:** Localize copy, normalize ellipses, clean global CSS/config paths, and update stale docs/comments.

### AGG-C1-62 — Low — Maintainability/dependency hygiene issues
- **Status/confidence:** confirmed/risk / Medium.
- **Cross-agent agreement:** quality-reviewer.
- **Primary citations:** `apps/web/vitest.config.ts:10-12`; `.github/dependabot.yml:3-12`; `apps/web/src/lib/data.ts:227-307`; `apps/web/src/lib/upload-limits.ts:1-6`; `apps/web/src/lib/process-image.ts:46`; `apps/web/nginx/default.conf:72-93`.
- **Problem:** Narrow Vitest discovery, Dependabot only targeting `/apps/web`, noisy select-field omission pattern, and upload/restore size constants spread across layers.
- **Failure scenario:** Tests/updates are silently missed and future limit/privacy edits become error-prone.
- **Suggested fix:** Broaden/document test discovery, add root Dependabot entry, simplify select-field omission helpers, and centralize/generate limit constants.

## AGENT FAILURES

None unrecovered. Initial `spawn_agent` calls beyond the runtime thread cap failed with `agent thread limit reached (max 6)`; those reviewer roles were retried later and all reports were produced.
