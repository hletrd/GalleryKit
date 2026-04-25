# Cycle 7 RPF Aggregate Review

Date: 2026-04-25
Repo: `/Users/hletrd/flash-shared/gallery`

## Agent roster / coverage

Spawned and completed review agents:

- `code-reviewer` → `.context/reviews/code-reviewer-cycle7-rpf.md`
- `security-reviewer` → `.context/reviews/security-reviewer-cycle7-rpf.md`
- `critic` → `.context/reviews/critic-cycle7-rpf.md`
- `verifier` → `.context/reviews/verifier-cycle7-rpf.md`
- `test-engineer` → `.context/reviews/test-engineer-cycle7-rpf.md`
- `architect` → `.context/reviews/architect-cycle7-rpf.md` (leader persisted the returned markdown because the role reported a read-only write failure)
- `debugger` / tracer coverage → `.context/reviews/debugger-cycle7-rpf.md`
- `designer` → `.context/reviews/designer-cycle7-rpf.md`
- `document-specialist` coverage via `writer` role → `.context/reviews/document-specialist-cycle7-rpf.md`
- `perf-reviewer` / dependency coverage via `dependency-expert` role → `.context/reviews/perf-dependency-reviewer-cycle7-rpf.md`

Exact `perf-reviewer`, `tracer`, and `document-specialist` agent types were not registered as native spawn roles in this environment, so equivalent available specialist roles covered those review angles. The designer found UI/UX present and attempted browser-based review; live page inspection was limited by missing local DB credentials, but code/a11y/static review and targeted gates were run.

## AGENT FAILURES

- Initial `architect` spawn failed once because the active child-agent cap was reached. Retried after another agent completed; the architect review completed and was persisted by the leader.
- No review agent failed after retry.

## Aggregate findings

### AGG-C7RPF-01 — Action-origin lint accepts a guard call whose result is ignored
- **Severity / confidence:** HIGH / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** critic
- **Citations:** `apps/web/scripts/check-action-origin.ts:107-139,169-187`; `apps/web/src/lib/action-guards.ts:19-43`; `apps/web/src/__tests__/check-action-origin.test.ts:29-39,103-111`.
- **Problem:** `requireSameOriginAdmin()` returns `string | null`; it does not throw. The scanner only checks that the call appears in the top-level body, so a future action can call it and still mutate after ignoring the return value.
- **Failure scenario:** CI passes a new mutating action that includes `const originError = await requireSameOriginAdmin();` but forgets `if (originError) return ...`, weakening the CSRF/origin defense-in-depth gate.
- **Suggested fix:** require an effective guard pattern and add a regression fixture for the ignored-result shape.

### AGG-C7RPF-02 — Load-more transient throttle/maintenance states are returned as terminal pagination
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** code-reviewer, critic, verifier
- **Citations:** `apps/web/src/app/actions/public.ts:67-110`; `apps/web/src/components/load-more.tsx:30-42,89-98`; `apps/web/src/__tests__/public-actions.test.ts:95-121`.
- **Problem:** rate-limit and restore-maintenance paths return `{ images: [], hasMore: false }`, the same shape as a genuine end-of-list response. The client unconditionally sets `hasMore` from that value and removes the retry sentinel.
- **Failure scenario:** a user scrolls quickly, hits the limiter, and the button disappears until full page reload even after the one-minute window resets.
- **Suggested fix:** return a discriminated load-more result and keep pagination alive on transient states while surfacing a retry message.

### AGG-C7RPF-03 — Search transient throttle/maintenance states are returned as empty successful searches
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** code-reviewer
- **Citations:** `apps/web/src/app/actions/public.ts:112-163`; `apps/web/src/components/search.tsx:53-80,224-233,270-273`; `apps/web/src/__tests__/public-actions.test.ts:135-145`.
- **Problem:** `searchImagesAction()` returns `[]` for rate-limit, restore maintenance, invalid/short queries, and genuine zero-match searches. The client renders `search.noResults` for all empty arrays.
- **Failure scenario:** during restore or after hitting the limiter, a query with matches is displayed as “No results,” masking operational state.
- **Suggested fix:** return a discriminated search result and reserve “no results” for successful empty searches only.

### AGG-C7RPF-04 — Upload duplicate-replacement UI/copy is a stale contract
- **Severity / confidence:** LOW / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** code-reviewer
- **Citations:** `apps/web/src/components/upload-dropzone.tsx:196-267`; `apps/web/src/app/actions/images.ts:351-356`; `apps/web/messages/en.json:139`; `apps/web/messages/ko.json:139`; `apps/web/src/db/schema.ts:28,65`.
- **Problem:** the UI and translations promise duplicate replacement, but `uploadImages()` always returns `replaced: []` and there is no unique filename/content-hash replacement path.
- **Failure scenario:** admins re-upload the same filename expecting replacement and instead accumulate duplicate image rows.
- **Suggested fix:** either implement real duplicate replacement or remove the stale UI/copy branch.

### AGG-C7RPF-05 — SEO locale validation accepts arbitrary locales while UI/copy implies the shipped locale set
- **Severity / confidence:** LOW / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** critic
- **Citations:** `apps/web/src/app/actions/seo.ts:93-98`; `apps/web/src/lib/locale-path.ts:45-66`; `apps/web/messages/en.json:328-329,450`; `apps/web/messages/ko.json:328-329,450`.
- **Problem:** values like `fr_FR` pass regex validation although the product ships only English/Korean Open Graph locale mappings and the copy examples imply `en_US`/`ko_KR`.
- **Failure scenario:** an admin saves `fr_FR`, causing English/Korean pages to emit a French OG locale.
- **Suggested fix:** either restrict overrides to supported Open Graph locales or broaden the copy to describe any valid `ll_RR` pattern.

### AGG-C7RPF-06 — CLAUDE still documents getter auto-exemptions that the action-origin scanner no longer honors
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** verifier
- **Citations:** `CLAUDE.md:241-244`; `apps/web/scripts/check-action-origin.ts:28-32,170-183`; `apps/web/src/__tests__/check-action-origin.test.ts`.
- **Problem:** docs say `get*` exports auto-exempt, but scanner now requires explicit `@action-origin-exempt` comments.
- **Failure scenario:** a maintainer follows docs, adds a read-only `getFoo()` action without an exemption comment, and CI fails unexpectedly.
- **Suggested fix:** update docs or reintroduce auto-exempt behavior.

### AGG-C7RPF-07 — Rate-limit rollback can target the wrong MySQL bucket across a window boundary
- **Severity / confidence:** LOW / MEDIUM
- **Status:** likely
- **Cross-agent agreement:** verifier
- **Citations:** `apps/web/src/app/actions/public.ts:89-95`; `apps/web/src/lib/rate-limit.ts:184-227,251-277`.
- **Problem:** increment and decrement each compute `Date.now()` independently, so rollback near a window boundary can decrement the new bucket instead of the old bucket.
- **Failure scenario:** a request increments bucket A just before rollover and rolls back in bucket B, leaving bucket A inflated.
- **Suggested fix:** pin the bucket start for increment/check/decrement within a request or add bucket-aware helpers.

### AGG-C7RPF-08 — Remote admin E2E helper bypasses the repo’s MySQL TLS policy
- **Severity / confidence:** MEDIUM / MEDIUM
- **Status:** likely
- **Cross-agent agreement:** security-reviewer
- **Citations:** `apps/web/e2e/helpers.ts:91-98,123-130`; `apps/web/src/db/index.ts:6-12`; `apps/web/scripts/mysql-connection-options.js:11-23`.
- **Problem:** remote admin E2E DB helper opens raw `mysql.createConnection(...)` without the TLS options used by production/script helpers.
- **Failure scenario:** remote admin tests connect to a routed MySQL host without TLS when the server does not force TLS.
- **Suggested fix:** reuse the same TLS decision logic as production/scripts.

### AGG-C7RPF-09 — Shipped nginx proxy config does not sanitize `X-Forwarded-Host`
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** document-specialist
- **Citations:** `README.md:148`; `apps/web/nginx/default.conf:45-56,61-72,112-121`; `apps/web/src/lib/request-origin.ts:19-24,55-69,83-106`.
- **Problem:** same-origin code trusts `X-Forwarded-Host` when `TRUST_PROXY=true`, but the shipped nginx config does not overwrite it.
- **Failure scenario:** a proxy chain forwards a client-supplied `X-Forwarded-Host`; origin validation receives attacker-controlled host data.
- **Suggested fix:** set `proxy_set_header X-Forwarded-Host $host;` in every proxy location and document the requirement.

### AGG-C7RPF-10 — Committed lockfile still contains vulnerable nested PostCSS under Next
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed risk
- **Cross-agent agreement:** security-reviewer, perf/dependency reviewer
- **Citations:** `package.json:7-10`; `apps/web/package.json:45-66`; `package-lock.json:8116-8120,8566-8569`.
- **Problem:** root overrides and app deps request PostCSS `^8.5.10`, but the lockfile still materializes `next/node_modules/postcss@8.4.31`; `npm audit --omit=dev` reports GHSA-qx2v-qp2m-jg93.
- **Failure scenario:** clean installs reproduce the vulnerable subtree until Next/lockfile is updated.
- **Suggested fix:** upgrade/regenerate dependencies so the nested copy disappears or is patched, then re-run audit.

### AGG-C7RPF-11 — Visual E2E checks only write screenshots instead of asserting visual baselines
- **Severity / confidence:** HIGH / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** test-engineer
- **Citations:** `apps/web/e2e/nav-visual-check.spec.ts:5-40`.
- **Problem:** tests call `page.screenshot(...)` but do not compare against a golden or assert layout-specific metrics.
- **Failure scenario:** nav spacing/alignment regresses and tests still pass because PNG writing succeeds.
- **Suggested fix:** use `toHaveScreenshot(...)` with committed baselines or explicit visual/layout assertions.

### AGG-C7RPF-12 — Critical regressions rely on source-text tests instead of behavior
- **Severity / confidence:** HIGH / HIGH
- **Status:** confirmed test gap
- **Cross-agent agreement:** test-engineer
- **Citations:** `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:19-139`; `auth-rethrow.test.ts:16-52`; `client-source-contracts.test.ts:9-35`; `settings-image-sizes-lock.test.ts:10-22`; `db-pool-connection-handler.test.ts:22-67`; `images-delete-revalidation.test.ts:10-24`.
- **Problem:** source/regex tests can pass with strings in comments/dead branches and fail on harmless refactors.
- **Failure scenario:** runtime behavior regresses while the expected string remains in source.
- **Suggested fix:** migrate high-value contracts to behavior-level tests with mocks/spies.

### AGG-C7RPF-13 — Auth actions lack direct behavioral tests
- **Severity / confidence:** HIGH / HIGH
- **Status:** confirmed test gap
- **Cross-agent agreement:** test-engineer
- **Citations:** `apps/web/src/app/actions/auth.ts:70-267,270-428`; auth-related tests under `apps/web/src/__tests__/`.
- **Problem:** `login`, `logout`, and `updatePassword` success/error branches are not directly executed in tests.
- **Failure scenario:** session rotation, cookie flags, or same-origin rejection regress without behavioral coverage.
- **Suggested fix:** add focused action tests with mocked `cookies`, `headers`, DB, argon2, audit, and rate-limit helpers.

### AGG-C7RPF-14 — Sharing/settings mutation branches lack behavioral coverage
- **Severity / confidence:** HIGH / HIGH
- **Status:** confirmed test gap
- **Cross-agent agreement:** test-engineer
- **Citations:** `apps/web/src/app/actions/sharing.ts:92-187,189-260+`; `apps/web/src/app/actions/settings.ts:39-163`; `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`.
- **Problem:** rate-limit rollback, duplicate-key retry, normalized settings, and upload/image locks have little/no behavioral coverage.
- **Failure scenario:** state/error branches drift and admins receive incorrect failures or charged attempts.
- **Suggested fix:** add dedicated sharing/settings action tests.

### AGG-C7RPF-15 — Playwright server reuse can hide fixture drift
- **Severity / confidence:** MEDIUM / MEDIUM
- **Status:** likely
- **Cross-agent agreement:** test-engineer
- **Citations:** `apps/web/playwright.config.ts:59-65`.
- **Problem:** `reuseExistingServer: true` can bypass the configured init/seed/build command when an old local server is running.
- **Failure scenario:** local E2E passes/fails against stale fixtures instead of the current checkout.
- **Suggested fix:** default reuse off or gate reuse behind an explicit opt-in env var.

### AGG-C7RPF-16 — Unit suite has no coverage threshold or aggregate verify script
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** risk
- **Cross-agent agreement:** test-engineer
- **Citations:** `apps/web/vitest.config.ts:4-12`; `apps/web/package.json:8-22`.
- **Problem:** tests run without coverage collection/thresholds and there is no single app-level script combining lint/typecheck/test/security lint gates.
- **Failure scenario:** coverage erodes while current tests remain green.
- **Suggested fix:** add coverage floors or a unified verification script when repo policy accepts that scope.

### AGG-C7RPF-17 — Process-local coordination is not technically enforced for singleton deployment
- **Severity / confidence:** HIGH / HIGH
- **Status:** confirmed architecture risk
- **Cross-agent agreement:** architect
- **Citations:** `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/app/[locale]/admin/db-actions.ts:271-311`; `apps/web/src/lib/image-queue.ts:67-132,382-489`; `apps/web/src/lib/upload-tracker-state.ts:7-21,52-61`; `apps/web/src/app/actions/settings.ts:74-78`; `apps/web/src/app/api/health/route.ts:7-16`; `README.md:145-146`.
- **Problem:** restore flags, queue state, upload claims, and readiness are process-local; docs require a singleton writer, but code does not enforce it.
- **Failure scenario:** two app instances accept conflicting writes during restore/processing windows.
- **Suggested fix:** enforce singleton ownership or externalize coordination.

### AGG-C7RPF-18 — Storage abstraction is not an authoritative boundary
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed architecture risk
- **Cross-agent agreement:** architect
- **Citations:** `apps/web/src/lib/storage/index.ts:4-12`; `apps/web/src/lib/storage/types.ts:4-15`; `apps/web/src/app/actions/images.ts:7-8,202-245,301-316`; `apps/web/src/lib/process-image.ts:12,45-60,224-253`; `apps/web/src/lib/image-queue.ts:236-285`; `apps/web/src/lib/serve-upload.ts:6,32-115`.
- **Problem:** storage backend switching exists as a conceptual abstraction while live paths still use direct local filesystem calls.
- **Failure scenario:** future object-storage work writes to two different authorities and images vanish or fail to process.
- **Suggested fix:** delete/quarantine the abstraction or finish the end-to-end storage migration.

### AGG-C7RPF-19 — Shared-group view counts are best-effort but not clearly presented as approximate
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** likely
- **Cross-agent agreement:** architect
- **Citations:** `apps/web/src/lib/data.ts:11-20,28-40,32-35,52-77,83-94,660-664`; `apps/web/src/instrumentation.ts:8-35`.
- **Problem:** view increments can be lost on crash/outage/buffer overflow, but the persisted field can look authoritative.
- **Failure scenario:** admins see lower counts than actual traffic after a DB outage or kill.
- **Suggested fix:** either label/document view counts as approximate or persist increments durably.

### AGG-C7RPF-20 — Settings localization still advertises removed admin controls
- **Severity / confidence:** LOW / HIGH
- **Status:** confirmed
- **Cross-agent agreement:** document-specialist
- **Citations:** `apps/web/messages/en.json:544-569`; `apps/web/messages/ko.json:544-569`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:90-187`; `apps/web/src/app/actions/settings.ts:11-12,49-77,113-130`.
- **Problem:** message catalogs contain copy for queue concurrency, gallery display, upload limits, and storage backend controls that are no longer rendered/supported.
- **Failure scenario:** translators/support docs advertise controls admins cannot find.
- **Suggested fix:** remove dead message keys or restore supported UI/server behavior.

### AGG-C7RPF-21 — Historical real secrets remain exposed in git history
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed operational risk
- **Cross-agent agreement:** security-reviewer
- **Citations:** historical commit `d7c3279:apps/web/.env.local.example`; current warnings in `README.md`, `CLAUDE.md`, `apps/web/.env.local.example`.
- **Problem:** old public git history contains real-looking bootstrap credentials/session secret.
- **Failure scenario:** an operator seeded from the old example and never rotated; attackers know the old values.
- **Suggested fix:** continue treating the values as compromised and rotate; consider coordinated history rewrite only under an explicit operational process.

### AGG-C7RPF-22 — Infinite-scroll load-more path pays persistent DB rate-limit I/O on every batch
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** confirmed performance issue
- **Cross-agent agreement:** perf/dependency reviewer; related to AGG-C7RPF-02
- **Citations:** `apps/web/src/app/actions/public.ts:23-110`; `apps/web/src/components/home-client.tsx:239-246`; `apps/web/src/components/load-more.tsx:30-52,68-84`.
- **Problem:** every automatic scroll batch does headers/IP work, persistent rate-limit increment, and a second DB check before the content query.
- **Failure scenario:** large-gallery mobile scrolling amplifies DB writes and latency in the same hot path as image loading.
- **Suggested fix:** collapse increment/check to one atomic operation or keep low-risk load-more limiting on the in-memory fast path.
