# Aggregate Review — Cycle 5/100 (2026-04-23)

## Agent coverage
Requested reviewer lanes for this cycle:
- code-reviewer
- security-reviewer
- critic
- verifier
- test-engineer
- architect
- debugger
- designer
- perf-reviewer
- tracer
- document-specialist

Platform availability notes:
- Registered and successfully completed fresh cycle-5 reviews: `code-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`
- Requested but not registered in the current catalog: `perf-reviewer`, `tracer`, `document-specialist`
- Registered but failed to deliver fresh cycle-5 output after retry and wrap-up attempt: `architect`, `debugger`, `designer`

## Aggregation method
1. Enumerated available reviewer lanes in `.context/reviews/cycle5-agent-manifest.json`.
2. Spawned fresh parallel review agents for the registered lanes.
3. Aggregated the fresh reviewer outputs that completed successfully.
4. Re-validated the concrete claims below against current HEAD before keeping them actionable.
5. Preserved agent failures below for provenance; stale prior-cycle lane files were **not** treated as fresh cycle-5 review output.

## CONFIRMED FINDINGS

### AGG5-01 — `createAdminUser()` trusts client-only password confirmation
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/src/components/admin-user-manager.tsx:31-43`, `apps/web/src/app/actions/admin-users.ts:68-159`
- **Why this is a problem:** The client form checks `confirmPassword`, but the server action never reads or validates that field. A direct server-action submission can create an admin user even when the intended password confirmation mismatches.
- **Concrete failure scenario:** A malformed request submits `password=A` and `confirmPassword=B`; the action still hashes `A` and creates the account, defeating the confirmation safety check.
- **Suggested fix:** Validate `confirmPassword` server-side inside `createAdminUser()` and add direct regression coverage for a mismatched submission.

### AGG5-02 — Upload UI collapses distinct files that share the same metadata-derived ID
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `verifier`
- **Source citations:** `.context/reviews/verifier.md`, `apps/web/src/components/upload-dropzone.tsx:39-40,47-71,116-129,200-209,281-345`
- **Why this is a problem:** `getFileId(file)` uses only `name-size-lastModified`, which is not unique for distinct `File` objects. Preview URLs, per-file tags, React keys, and removal logic all key off that derived value.
- **Concrete failure scenario:** Two different files with the same filename, byte size, and modified timestamp overwrite each other's preview/tag state; one file can inherit the other's tags or cause unstable card updates.
- **Suggested fix:** Generate a true per-item ID when files are accepted (for example `crypto.randomUUID()` or a `WeakMap<File, string>`) and use that stable ID everywhere in the component.

### AGG5-03 — Backup download route treats missing provenance headers as trusted
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `security-reviewer`
- **Source citations:** `.context/reviews/security-reviewer.md`, `apps/web/src/lib/request-origin.ts:50-78`, `apps/web/src/app/api/admin/db/download/route.ts:13-29`, `apps/web/src/__tests__/request-origin.test.ts:94-99`
- **Why this is a problem:** `hasTrustedSameOrigin()` returns `true` when both `Origin` and `Referer` are absent, and the authenticated backup download route relies on that helper for same-origin enforcement.
- **Concrete failure scenario:** A logged-in admin follows a crafted top-level request that suppresses provenance headers; the request still passes the route check and forces a sensitive DB-backup download.
- **Suggested fix:** Require a positively validated `Origin` or `Referer` for the backup-download route (or add one-time signed download tokens) instead of allowing the empty-header fallback.

### AGG5-04 — `IMAGE_BASE_URL` allows plaintext `http:` origins in production configuration
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `security-reviewer`
- **Source citations:** `.context/reviews/security-reviewer.md`, `apps/web/next.config.ts:7-27`, `README.md:123-135`, `apps/web/README.md:27-29`
- **Why this is a problem:** The config parser accepts both `http:` and `https:` origins for remote image hosting. In production this makes it easy to accidentally serve gallery assets and metadata-linked images over plaintext transport.
- **Concrete failure scenario:** An operator sets `IMAGE_BASE_URL=http://cdn.example.com`; the site then emits plaintext asset URLs even when the main app is HTTPS.
- **Suggested fix:** Reject non-HTTPS `IMAGE_BASE_URL` values in production (or entirely outside local development) and document the stricter contract.

### AGG5-05 — Vulnerable `drizzle-kit` / `esbuild` dev-tool chain remains in the lockfile
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `security-reviewer`
- **Source citations:** `.context/reviews/security-reviewer.md`, `apps/web/package.json:54-68`, `package-lock.json`, `npm audit --json`
- **Why this is a problem:** The installed toolchain still resolves an `esbuild` advisory via `drizzle-kit` / `@esbuild-kit/*`. This is primarily a dev/CI host risk, but those environments routinely hold credentials and internal network access.
- **Concrete failure scenario:** A developer or CI worker runs the affected tooling in an environment reachable by attacker-controlled content or requests, exposing local responses or internal resources.
- **Suggested fix:** Upgrade/replace the vulnerable dependency chain so the lockfile no longer contains the affected `esbuild` range, then re-run `npm audit`.

### AGG5-06 — Topic slug/alias namespace is only checked optimistically, not serialized atomically
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `critic`
- **Source citations:** `.context/reviews/critic.md`, `apps/web/src/app/actions/topics.ts:15-32,34-107,110-245,305-361`, `apps/web/src/lib/data.ts:672-705`, `apps/web/src/__tests__/topics-actions.test.ts:138-148,175-217,238-242`
- **Why this is a problem:** Topic slugs and aliases share one route namespace, but enforcement is only done through preflight reads across two tables. There is no shared lock/constraint that serializes competing slug/alias writes.
- **Concrete failure scenario:** One admin creates topic `travel` while another concurrently creates alias `travel` for another topic; both checks can pass and both writes can commit, leaving one route shadowed and unreachable.
- **Suggested fix:** Serialize slug/alias mutations through a shared DB authority (for example a dedicated route-segment table or advisory lock) and add a regression test for the concurrent case.

### AGG5-07 — OG-image same-origin restriction disappears when `BASE_URL` is unset
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `critic`
- **Source citations:** `.context/reviews/critic.md`, `apps/web/src/app/actions/seo.ts:88-125`, `README.md:113-137`, `apps/web/README.md:25-32`
- **Why this is a problem:** The code comment promises same-origin-only external OG image URLs, but origin enforcement only runs when `BASE_URL` is set. Without `BASE_URL`, any `http/https` URL is accepted.
- **Concrete failure scenario:** A deployment relies on `site-config.json` for the base origin and leaves `BASE_URL` unset; an admin then saves a third-party OG image URL that ends up on every public page.
- **Suggested fix:** Derive the allowed origin from the effective base URL (`process.env.BASE_URL || site-config.json.url`) rather than only from `BASE_URL`, and add tests for both modes.

### AGG5-08 — Production build paths silently fall back to the example site config
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `critic`
- **Source citations:** `.context/reviews/critic.md`, `apps/web/package.json:8-10`, `apps/web/Dockerfile:40-45`, `README.md:153-167`, `CLAUDE.md:225-233`, `apps/web/deploy.sh:21-25`
- **Why this is a problem:** Docs and deployment instructions say a real `src/site-config.json` is required, but build paths still auto-copy the example file when the real file is missing.
- **Concrete failure scenario:** A container build or fresh deployment forgets the real config, still builds successfully, and ships placeholder/local metadata until someone notices.
- **Suggested fix:** Make the example fallback development-only and fail production/CI/deploy builds when the real config is absent.

### AGG5-09 — Public infinite scroll hard-stops after offset 10,000
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `code-reviewer`
- **Source citations:** `.context/reviews/code-reviewer.md`, `apps/web/src/app/actions/public.ts:11-28`
- **Why this is a problem:** `loadMoreImages()` returns an empty page once `offset > 10000`, silently making older photos unreachable in large libraries.
- **Concrete failure scenario:** A gallery with more than ~10k browsable items stops loading older photos even though more processed images exist.
- **Suggested fix:** Replace the hard offset ceiling with cursor/keyset pagination or another bounded strategy that does not hide older content.

### AGG5-10 — Sitemap omits images beyond 24,000 with no pagination/index fallback
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `code-reviewer`
- **Source citations:** `.context/reviews/code-reviewer.md`, `apps/web/src/app/sitemap.ts:12-42`, `apps/web/src/lib/data.ts:835-844`
- **Why this is a problem:** The sitemap is intentionally capped to stay under a single-file URL limit, but the remainder of the gallery is never emitted through additional sitemap files.
- **Concrete failure scenario:** Large galleries lose a primary crawler-discovery path for every image beyond the first 24,000.
- **Suggested fix:** Generate paginated sitemaps plus a sitemap index instead of truncating the dataset.

### AGG5-11 — CSV export still truncates at 50,000 rows and materializes the whole export in memory
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `code-reviewer`
- **Source citations:** `.context/reviews/code-reviewer.md`, `apps/web/src/app/[locale]/admin/db-actions.ts:41-104`
- **Why this is a problem:** The action hard-caps exports at 50,000 rows, warns only after generating the output, and still builds the whole CSV payload in memory.
- **Concrete failure scenario:** An admin expects a complete export from a larger library but silently gets only the first 50,000 rows while the server still allocates a large in-memory string.
- **Suggested fix:** Stream/page the CSV and either export the full dataset or surface the hard limit explicitly before generation.

### AGG5-12 — Restore maintenance state is process-local
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Status:** Likely risk
- **Flagged by:** `code-reviewer`
- **Source citations:** `.context/reviews/code-reviewer.md`, `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/app/[locale]/admin/db-actions.ts:248-289`
- **Why this is a problem:** Restore maintenance lives in `globalThis`, so only the process performing the restore enters maintenance mode.
- **Concrete failure scenario:** In a multi-instance deployment, one process runs restore while another continues accepting writes, racing the restore with live mutations.
- **Suggested fix:** Move restore-maintenance state to a shared authority visible to all workers/replicas.

### AGG5-13 — “Visual check” Playwright specs save screenshots but assert nothing
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/e2e/nav-visual-check.spec.ts:5-29`
- **Why this is a problem:** The specs call `page.screenshot(...)` without snapshot or diff assertions, so they always pass even if the UI regresses visually.
- **Concrete failure scenario:** Navigation layout overlaps or disappears and the test suite still reports green.
- **Suggested fix:** Convert the checks to `toHaveScreenshot()` or another committed visual-diff assertion path.

### AGG5-14 — Default E2E run skips the entire admin surface
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/e2e/admin.spec.ts:4-7`, `apps/web/e2e/helpers.ts:15`, `apps/web/playwright.config.ts:13-16`, `apps/web/package.json:14`
- **Why this is a problem:** `npm run test:e2e` does not cover login, admin navigation, uploads, password change, or DB UI unless an opt-in flag is set.
- **Concrete failure scenario:** A regression breaks admin login or upload flows while the default E2E suite remains green.
- **Suggested fix:** Add a seeded, non-destructive admin smoke lane that runs by default.

### AGG5-15 — Auth server actions lack direct regression coverage
- **Severity:** CRITICAL
- **Confidence:** HIGH
- **Status:** Likely risk
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/src/app/actions/auth.ts:70-389`, `apps/web/src/lib/session.ts:16-145`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/auth-rate-limit.ts:10-107`
- **Why this is a problem:** The repo tests helper utilities but not the actual login/logout/password-change server actions that compose origin checks, cookies, DB state, and rollback logic.
- **Concrete failure scenario:** A change breaks same-origin enforcement or stale-session invalidation and the current suite misses it.
- **Suggested fix:** Add focused action-level tests for successful and failing auth flows.

### AGG5-16 — Backup/restore orchestration is high-risk and largely untested
- **Severity:** CRITICAL
- **Confidence:** HIGH
- **Status:** Likely risk
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/src/app/[locale]/admin/db-actions.ts:107-436`
- **Why this is a problem:** The code shells out to DB tools, manages maintenance state, temp files, and queue pause/resume, but only a narrow slice is under regression protection.
- **Concrete failure scenario:** A restore stdin failure or SQL-scan rejection leaves temp files or queue state inconsistent without tests catching it.
- **Suggested fix:** Extract the orchestration seams behind injectable helpers and add focused tests for dump/restore failure paths and maintenance symmetry.

### AGG5-17 — Sharing create/revoke flows have no dedicated concurrency regression coverage
- **Severity:** HIGH
- **Confidence:** MEDIUM
- **Status:** Likely risk
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/src/app/actions/sharing.ts:78-344`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:27-188`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:32-129`
- **Why this is a problem:** Share actions contain rate limiting, collision retries, conditional revokes, and transaction-sensitive group creation, but those paths are not locked by tests.
- **Concrete failure scenario:** A conditional revoke reports success while leaving a share key live, or a transaction partial failure yields a broken shared group.
- **Suggested fix:** Add unit tests for share create/reuse/retry/revoke and a smoke E2E that opens a generated share.

### AGG5-18 — Image queue/bootstrap/retry behavior lacks direct regression coverage
- **Severity:** HIGH
- **Confidence:** MEDIUM
- **Status:** Likely risk
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/src/lib/image-queue.ts:136-373`, `apps/web/src/lib/process-topic-image.ts:42-106`, `apps/web/src/lib/upload-paths.ts:48-93`
- **Why this is a problem:** The highest-complexity async processing logic in the repo is almost entirely untested.
- **Concrete failure scenario:** Retry exhaustion or restore resume behavior drops pending images without any regression test failing.
- **Suggested fix:** Add fake-layer queue tests for claim contention, retry exhaustion, delete-during-processing cleanup, and restore quiesce/resume.

### AGG5-19 — Settings/SEO persistence and metadata coupling are under-tested
- **Severity:** HIGH
- **Confidence:** MEDIUM
- **Status:** Likely risk
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/src/app/actions/settings.ts:36-129`, `apps/web/src/app/actions/seo.ts:50-156`, `apps/web/src/lib/gallery-config.ts:33-88`, `apps/web/src/lib/data.ts:870-894`
- **Why this is a problem:** Admin settings drive public metadata and validation-sensitive behavior, but the server actions and downstream metadata effects are barely covered.
- **Concrete failure scenario:** A sanitization or OG URL validation change stores a bad value that only surfaces after deployment.
- **Suggested fix:** Add unit tests for allowed/disallowed keys, image-size locking, same-origin OG URL validation, and metadata generation after config changes.

### AGG5-20 — Metadata/OG/public-route generators have substantial branching with little direct test coverage
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Status:** Likely risk
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, `apps/web/src/app/[locale]/(public)/page.tsx:18-162`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-162`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:24-243`, `apps/web/src/app/api/og/route.tsx:27-157`
- **Why this is a problem:** Canonical URLs, OG tags, invalid-ID branches, alias behavior, and custom OG overrides have meaningful branching but minimal direct tests.
- **Concrete failure scenario:** A metadata regression changes canonical or OG output and escapes the current suite.
- **Suggested fix:** Add lightweight metadata tests covering invalid IDs, alias redirects, and custom OG URL behavior.

### AGG5-21 — No repository-level CI workflow enforces the documented test/build surface
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Flagged by:** `test-engineer`
- **Source citations:** `.context/reviews/test-engineer.md`, repository `.github/` contents, `README.md`, `CLAUDE.md`, `apps/web/package.json:8-15`
- **Why this is a problem:** The repo documents lint, build, unit, and E2E commands, but there is no checked-in workflow to run them automatically on change.
- **Concrete failure scenario:** Regressions merge unnoticed because nothing in-repo executes the declared verification surface before merge.
- **Suggested fix:** Add a CI workflow that runs install, lint, unit tests, build, and the default Playwright smoke lane.

## CROSS-AGENT AGREEMENT
- No fresh cycle-5 finding was independently repeated by more than one successfully completed reviewer. All retained findings are single-lane discoveries that were manually re-validated against current HEAD during aggregation.

## AGENT FAILURES
- `architect` fresh spawn attempt hit the platform concurrency ceiling on the initial batch; retry agent `019db9ad-6041-7b63-806a-4fa50d4e757a` was launched, nudged to wrap up, but still failed to produce a fresh cycle-5 markdown review before shutdown.
- `debugger` fresh spawn attempt hit the platform concurrency ceiling on the initial batch; retry agent `019db9ae-6082-7b61-ab87-0c09e42878e8` was launched, nudged to wrap up, but still failed to produce a fresh cycle-5 markdown review before shutdown.
- `designer` fresh spawn attempt hit the platform concurrency ceiling on the initial batch; retry agent `019db9ae-f1f7-7a90-b85e-6e249857bf06` was launched, nudged to wrap up, but still failed to produce a fresh cycle-5 markdown review before shutdown.
- `perf-reviewer`, `tracer`, and `document-specialist` were requested but are not registered in the current agent catalog.

## Final actionable count
- **Confirmed / likely findings retained for planning:** 21
- **Fresh reviewer lanes completed:** 5
- **Fresh reviewer lanes failed after retry:** 3
