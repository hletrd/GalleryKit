# Cycle 14 Verifier + Test-Engineer Review

Date: 2026-07-07
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `14d31ea4`
Mode: read-only static review, except this report file.

I did not implement fixes, commit, push, deploy, stop/remove containers, or modify CI/deploy pipeline files. I did not run the blocking gates because the prompt is read-only and the requested role is review/report generation. Evidence below is from source, test, workflow, and repository-state inspection.

## Inventory Reviewed

Review-relevant inventory built before findings:

- Project instructions: `AGENTS.md`, `CLAUDE.md`, cycle 13 aggregate/deferred plan context under `.context/reviews/` and `.context/plans/`.
- Current cycle changed files from `d8fcb3d6..HEAD`: `.context/*` review/plan files; `apps/web/messages/{en,ko}.json`; `apps/web/scripts/run-e2e-server.mjs`; source-contract and behavior tests; `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`; `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`; `apps/web/src/app/[locale]/admin/db-actions.ts`; `apps/web/src/app/sitemap.ts`; `apps/web/src/components/{footer,info-bottom-sheet,nav-client,photo-viewer,search}.tsx`; `apps/web/src/db/index.ts`; `apps/web/src/lib/content-security-policy.ts`; `scripts/check-proxy-topology.mjs`.
- Broader source and test surface: 608 TS/TSX/JS/MJS files under `apps/web/src`; 348 Vitest test files; 10 Playwright E2E files; no `.only` focused tests found. The only `.skip` usage found is conditional opt-in/environment gating in `apps/web/e2e/admin.spec.ts` and `apps/web/e2e/origin-guard.spec.ts`.
- Cross-file scans covered server actions, public/admin API auth and rate-limit contracts, E2E harness behavior, migration/reconcile tests, Docker/CI gates, public route sitemap/robots tests, and high-risk upload/restore/token flows.

## Confirmed Issues

### VER-14-01 - Proxy topology check still cannot prove forwarded-client-IP safety

Severity: Medium
Confidence: High
Status: Confirmed issue in validation tooling

Evidence:

- `scripts/check-proxy-topology.mjs:7-12` claims the probe reaches same-origin and client-IP/rate-limit handling, and that a safe edge overwrites inbound `X-Forwarded-For`.
- `scripts/check-proxy-topology.mjs:102-123` sends exactly one baseline POST and one spoofed POST with `X-Forwarded-For: 198.51.100.44, 203.0.113.99`, then only classifies the HTTP status.
- `apps/web/src/app/api/search/semantic/route.ts:173-184` does call `getClientIp()` and pre-increments the semantic limiter before disabled-mode/body validation.
- `apps/web/src/lib/rate-limit.ts:175-198` selects the client IP from `x-forwarded-for` when `TRUST_PROXY=true`; with the default trusted-hop count, a forwarded spoof chain can influence the selected limiter key if the edge passes inbound XFF through.

Problem:

The revised probe now reaches limiter code, but it still observes only response status. A status of `400`, `429`, or `503` cannot distinguish "edge overwrote XFF" from "app accepted attacker-supplied XFF and charged a spoofed bucket." The check can therefore print "Proxy topology check passed" while the condition it documents is false for client-IP/rate-limit safety.

Concrete failure scenario:

Production runs with `TRUST_PROXY=true` behind an edge that forwards inbound `X-Forwarded-For` instead of replacing it. The spoofed request in the checker reaches `getClientIp`, is charged to `198.51.100.44`, returns a normal disabled-mode or validation status, and the script passes. A client can rotate XFF values to split semantic-search or login-related budgets across attacker-chosen keys.

Suggested fix:

Make the check observe the selected limiter bucket, not just route reachability. Options: add a diagnostic-only same-origin/admin probe that reports the effective client key; run repeated valid semantic probes that must share one rate-limit bucket across baseline/spoofed requests; or narrow the script wording to say it validates same-origin header handling only and not XFF overwrite/client-IP correctness. Add a regression test for the script's false-positive class.

### VER-14-02 - CI quality gates still do not build the production Docker image

Severity: Medium
Confidence: High
Status: Confirmed gate gap

Evidence:

- `.github/workflows/quality.yml:48-83` runs `npm ci`, lint, typecheck, security lints, `npm audit`, unit tests, DB init, Playwright E2E, and `npm run build`; it never executes `docker build`.
- `apps/web/Dockerfile:50-62` has Linux-native optional dependency installation logic for Sharp, SWC, Parcel watcher, Next SWC, and Lightning CSS.
- `apps/web/Dockerfile:76-85` repeats runtime native dependency installation and only then verifies `require('sharp')`.

Problem:

The required release artifact has a separate dependency/materialization path that CI does not exercise. The normal Next build can pass while the Docker image fails due to target architecture handling, optional native package drift, lockfile resolution, or the explicit `--no-save` native package versions.

Concrete failure scenario:

A package update changes the required `@next/swc-*`, `@img/sharp-*`, or `lightningcss-*` version. `npm run build` on the CI host succeeds, but Docker build fails at the explicit native install or runtime `require('sharp')` step. The failure is discovered only during deploy/build on the constrained host, after all quality gates were green.

Suggested fix:

Add a non-deploying CI step that builds the production image for the supported target architecture, or at least a scheduled/PR gate that runs the Dockerfile through the native dependency stages. Keep it non-publishing and separate from deployment.

## Confirmed Test Coverage Gaps

### VER-14-03 - Lightroom upload route has many high-value rejection and cleanup paths without behavior tests

Severity: Medium
Confidence: High
Status: Confirmed coverage gap

Evidence:

- The route has distinct branches for chunked/content-length/total-size/file-size guards (`apps/web/src/app/api/admin/lr/upload/route.ts:101-158`), multipart parse failure (`178-186`), missing file and invalid filename/topic/title/description (`188-250`), late restore guard and upload lock denial (`252-279`), topic DB errors and missing topic (`285-299`), config read failure (`303-313`), disk-space errors (`322-344`), save/RAW failures (`346-370`), HDR/GPS/late-restore cleanup (`396-440`), insert/post-save cleanup (`500-509`), and post-commit bookkeeping isolation (`521-540` and following).
- Current behavioral tests cover late HDR cleanup, PAT success/audit/queue behavior, entry restore guard, missing `Content-Length`, file-count cap, and low disk (`apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`).

Problem:

The route is a critical external ingest API with quota, lock, filesystem, DB, privacy, and audit side effects. Several branches that must settle preclaimed quota, release locks, delete originals, or return parseable JSON are not behavior-tested. Existing tests are good but still sparse against the route's current branch matrix.

Concrete failure scenario:

A future edit moves `settleTrackerToActual(false)` below the invalid filename/topic/title branch, skips `releaseMultipartParseSlot()` after a malformed multipart body, forgets original deletion after GPS stripping failure, or lets post-commit `revalidateAllAppData()` throw into a 500. The current route tests can still pass because they do not exercise those branches.

Suggested fix:

Add table-driven route tests for every branch with side effects: chunked upload, invalid/oversize `Content-Length`, body parse failure, missing file, invalid filename, invalid/missing topic slug, overlong title/description, late restore after parse, lock denial, topic SELECT throw, topic not found, config read failure, save `RawFileError`, generic save failure, GPS strip failure, late restore after save, insert failure, and post-commit enqueue/audit/revalidate throw behavior. For each case assert response status/body plus tracker settlement, lock release, parse slot release, cleanup calls, DB insert/queue/audit non-calls or calls as appropriate.

### VER-14-04 - DB restore child-process cleanup is guarded mostly by source-string tests

Severity: Medium
Confidence: High
Status: Confirmed coverage gap

Evidence:

- Runtime cleanup/error handling is concentrated in `failRestore`, watchdog, stream handlers, child `close`, and child `error` paths (`apps/web/src/app/[locale]/admin/db-actions.ts:807-873`).
- The current test for this critical path reads `db-actions.ts` as text and asserts strings/order snippets such as `readStream.destroy()`, `restore.stdin.destroy()`, `restore.kill()`, and `cleanupTempFile()` (`apps/web/src/__tests__/db-restore.test.ts:47-74`).

Problem:

Source-string tests can confirm that important tokens appear, but they cannot prove runtime behavior under child-process, stream, timeout, or event-order failures. This restore path intentionally keeps maintenance active on failure; a runtime regression here has operational impact.

Concrete failure scenario:

A refactor keeps the same strings but changes event ordering, forgets to await or schedule cleanup reliably, calls `resolve` twice, misses a child `error` emitted before pipe setup, or leaves the watchdog armed after a close event. The source-string test remains green because it does not execute a fake child, fake streams, or fake timers.

Suggested fix:

Extract the restore runner behind injectable `spawn`, `createReadStream`, temp-file cleanup, and watchdog dependencies. Add fake-child/fake-stream tests for timeout, read error, stdin error, spawn error, nonzero close, zero close plus migration failure, zero close success, ignorable stdin `EPIPE`, and double-event races. Keep a small source-contract tripwire only for unextracted wiring if needed.

### VER-14-05 - Admin token UI has no browser-level coverage for one-time plaintext, copy, create, or revoke flows

Severity: Medium
Confidence: High
Status: Confirmed coverage gap

Evidence:

- The token client performs real hydrated UI flows: `createLrToken` then one-time plaintext state (`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-103`), clipboard copy/acknowledgement (`119-128`), plaintext dialog close gating (`250-299`), and revoke confirmation (`303-324`).
- The Playwright admin spec covers login/navigation, wrong password, GPS setting toggle, topic create/delete, and dashboard upload (`apps/web/e2e/admin.spec.ts:20-165`), but it does not navigate to or exercise `/admin/tokens`.
- Existing token tests are action/domain or source-contract focused: server action behavior appears in `apps/web/src/__tests__/lr-tokens-action.test.ts`, while one-time plaintext UI is pinned by source strings in `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:49-59`.

Problem:

The highest-risk token UX property is browser-stateful: the plaintext secret is shown once, cannot be dismissed before acknowledgement, can be copied, and revoke works from the rendered table. Server action tests and source-string assertions do not prove the hydrated UI can complete those flows.

Concrete failure scenario:

A component or dialog refactor breaks the acknowledgement checkbox, copy button, revoke confirmation, disabled state, or post-create list refresh. The server action tests still pass because token creation/revocation works directly, and the source test still passes if the relevant strings remain.

Suggested fix:

Add an opt-in admin E2E flow for `/admin/tokens`: create a uniquely labeled token, assert the plaintext dialog appears and the done button is disabled until acknowledgement, exercise copy with a clipboard mock or permission-aware fallback, close the dialog, assert the token row appears without plaintext, revoke it, and assert the row disappears. Ensure cleanup runs in `finally`.

### VER-14-06 - No coverage report or coverage ratchet exists for critical changed code

Severity: Low
Confidence: High
Status: Confirmed test-strategy gap

Evidence:

- `apps/web/package.json:13-29` defines `test`, lint, typecheck, auth/origin/rate-limit lints, and E2E scripts, but no coverage script.
- `apps/web/vitest.config.ts:16-39` configures include/exclude and timeout only; no coverage provider, thresholds, include/exclude policy, or changed-file ratchet exists.
- `.github/workflows/quality.yml:69-83` runs unit tests, E2E, and build, but no coverage collection or threshold gate.

Problem:

The repository has a large and valuable test suite, but there is no quantitative signal for whether high-risk changed areas are behavior-tested versus source-string-tested or untested. That makes coverage regressions hard to detect across cycles.

Concrete failure scenario:

A new public API branch, admin action branch, or migration/reconcile edge case lands with only a source-contract test or no behavioral test. The suite remains green and reviewers must rediscover the missing coverage manually in later cycles.

Suggested fix:

Introduce a non-blocking Vitest coverage report first, then ratchet only critical directories (`app/api`, `app/actions`, `scripts/migrate.js`, `lib/rate-limit`, upload/restore paths). Avoid a blunt repo-wide threshold until generated/source-contract-heavy areas are accounted for.

## Likely Issues

### VER-14-07 - Sitemap omits public footer-linked `/map` pages while tests only expect `/timeline`

Severity: Low
Confidence: Medium
Status: Likely issue

Evidence:

- Footer exposes public localized links to about, timeline, map, and privacy (`apps/web/src/components/footer.tsx:41-52`).
- Sitemap reserves only one localized static public page beyond the homepage (`apps/web/src/app/sitemap.ts:54-55`) and emits only `/timeline` in `staticPublicEntries` (`apps/web/src/app/sitemap.ts:98-103`).
- Sitemap tests assert localized `/timeline` but not `/map`, `/privacy`, or `/about-gallerykit` (`apps/web/src/__tests__/sitemap-robots.test.ts:46-58`, fallback expectation at `67-79`).

Problem:

The app now makes `/map` a first-class public footer destination, but sitemap coverage and sitemap output still treat timeline as the only static public experience page. This is either an SEO/discoverability mismatch or an undocumented policy choice.

Concrete failure scenario:

Sitemap-first crawlers or feed/search integrations discover home, topics, photos, feeds, and timeline but not the public map, even though users can navigate to it from every footer. The current tests would pass because they only lock `/timeline`.

Suggested fix:

Decide the policy explicitly. If `/map`, `/privacy`, and `/about-gallerykit` are intended sitemap pages, model static public paths as a shared array used by both reservation arithmetic and entry emission, then update tests for all paths. If they should be excluded, document the reason and add an assertion that only timeline is intentionally included.

## Risks Needing Manual Validation

### VER-14-08 - Migration reconcile parity still relies mainly on name/source tripwires, not schema equivalence

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation

Evidence:

- The reconcile coverage test explicitly says it is a source tripwire and cannot verify types/defaults (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`).
- It checks table creation and column-name mention by source text (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-103`), index-name mention (`157-172`), selected binary/vector pins (`175-180`), and FK-name repair calls (`216-225`).
- The actual reconcile body spans many DDL/repair operations in `apps/web/scripts/migrate.js` and is the authoritative path for legacy/fresh baseline repairs.

Problem:

The tests are useful guardrails, but they do not prove structural equivalence between a database created by the full Drizzle migration journal and a database repaired/baselined through `reconcileLegacySchema`. Column type, nullability, default, collation, generated expression, FK action, index column order, and unique/nonunique mismatches can pass name-presence checks.

Concrete failure scenario:

A migration changes a column from nullable to non-null with a default, adds an index with the right name but different column order, or changes `ON DELETE` behavior. `migrate.js` mentions the table/column/index/FK name, so the source tripwires pass, while fresh or legacy installs receive a schema that behaves differently from normally migrated databases.

Suggested fix:

Add an integration validation lane that creates two disposable MySQL schemas: one through the full Drizzle journal and one through the reconcile/baseline path. Diff `information_schema` for columns, defaults, nullability, indexes, FK actions, and table options. Keep the source tripwires as fast unit checks, but make schema-equivalence the authoritative periodic or CI gate.

## Final Sweep

- No focused `.only` tests were found.
- Conditional E2E skips are environment guards, not accidental disabled tests.
- The previous cycle's E2E `BASE_URL` production-branch risk appears closed by `apps/web/scripts/run-e2e-server.mjs`, which separates build-time `E2E_PUBLIC_BASE_URL` from runtime server `BASE_URL`.
- The previous cycle's DB pool init-timeout leak appears closed by `apps/web/src/db/index.ts` using `connection.destroy()` on init timeout.
- Admin API auth, server-action same-origin, and public route rate-limit lint coverage are present as blocking scripts in `apps/web/package.json`.
- This review found 8 findings total: 2 confirmed issues, 4 confirmed coverage gaps, 1 likely issue, and 1 risk needing manual validation.
