# Code Reviewer Deep Review Slice — Prompt 1 fan-out A

Date: 2026-04-28  
Repo: `/Users/hletrd/flash-shared/gallery`  
Role angle: `code-reviewer` — code quality, correctness, maintainability, SOLID, logic edge cases.  
Mode: review-only. I did not edit source/config/test files; this report replaces stale content in `.context/reviews/code-reviewer.md`.

## Inventory built before review

Commands used first: `git status --short`, `git diff --name-status`, `git diff --cached --name-status`, `git ls-files`, and a generated review inventory excluding vendor/build/generated artifacts (`node_modules`, `.next`, `test-results`, `*.tsbuildinfo`, screenshots/binary image fixtures, runtime logs/state unless referenced as artifact evidence).

Implementation review inventory: **293 tracked source/config/test/docs files**:

- `apps/web/src/**`: 228 files (app routes/actions, components, lib, db, i18n, tests, proxy/instrumentation, site config contract).
- App config/deploy/docs: 24 files (`apps/web/package.json`, `next.config.ts`, `playwright.config.ts`, `vitest.config.ts`, Docker/compose/nginx, env examples, README, tsconfig/eslint/tailwind/drizzle config).
- Root/CI/docs/scripts: 14 files (`package.json`, `README.md`, `AGENTS.md`, `.github/workflows/quality.yml`, `.dockerignore`, `.gitignore`, deployment script, etc.).
- App scripts: 14 files (`init-db`, migrations, scanners, seed scripts, env helpers).
- Drizzle SQL/meta: 7 files.
- E2E specs/helpers: 6 files.

Uncommitted files included in scope at review start:

- Review artifacts: `.context/reviews/_aggregate.md`, `architect.md`, `code-reviewer.md`, `critic.md`, `designer.md`, `perf-reviewer.md`, staged `security-reviewer.md`, `test-engineer.md`, `tracer.md`, `verifier.md`.
- Source/config/test changes: `.gitignore`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/components/lightbox.tsx`.

Generated/binary/runtime artifacts intentionally excluded from semantic line review: `node_modules/`, `.next/`, build outputs, `*.tsbuildinfo`, screenshots/fixture media, `test-results/`, `.omx/.omc` runtime logs except where artifact leakage is discussed by the critic report.

Verification/checks run during review (read-only):

- `npm run lint:api-auth --workspace=apps/web` — passed (`OK: src/app/api/admin/db/download/route.ts`).
- `npm run lint:action-origin --workspace=apps/web` — passed; all mutating server actions reported `OK` or documented read-only exemption.
- Static sweeps for: `dangerouslySetInnerHTML`, raw SQL, server-action guards, file/path operations, rate limits, CSP/script sources, tag canonicalization, image queue retry paths, Docker/nginx deployment wiring, timeout env parsing, and uncommitted diffs.

## Findings

### CR-01 — Production CSP and rendered Google Analytics use different configuration sources

- **Location:** `apps/web/src/app/[locale]/layout.tsx:118-126`, `apps/web/src/lib/content-security-policy.ts:58-69`, `apps/web/src/proxy.ts:41-44`, test gap at `apps/web/src/__tests__/content-security-policy.test.ts:6-23`
- **Severity:** Medium
- **Confidence:** High
- **Type:** Confirmed issue

**Why this is a problem**

The root layout renders Google Analytics when `siteConfig.google_analytics_id` is configured:

- `layout.tsx:118-120` loads `https://www.googletagmanager.com/gtag/js?id=...`.
- `layout.tsx:121-126` emits the inline GA bootstrap script with the CSP nonce.

The production CSP is generated independently in `content-security-policy.ts` and only adds GA hosts when `process.env.NEXT_PUBLIC_GA_ID` is set:

- `content-security-policy.ts:58-60` adds `https://www.googletagmanager.com` only from `NEXT_PUBLIC_GA_ID`.
- `content-security-policy.ts:66-68` adds `https://www.google-analytics.com` only from `NEXT_PUBLIC_GA_ID`.
- `proxy.ts:41-44` installs that CSP on production requests.

The checked configuration/docs path uses `site-config.json` (`src/site-config.example.json:10`, `README.md:55`), so the renderer and CSP can disagree.

**Concrete failure scenario**

An operator sets `src/site-config.json` to `{ "google_analytics_id": "G-ABC123" }` but does not also export `NEXT_PUBLIC_GA_ID`. Production HTML contains the GA `<Script>` tags with a nonce, but the CSP still has only self script/connect sources, so browsers block `gtag/js` and GA network calls. Analytics silently fails even though the app appears configured.

**Suggested fix**

Use one canonical GA source for both rendering and CSP. Either:

1. Make `buildContentSecurityPolicy` accept an explicit `googleAnalyticsId`/`enableGoogleAnalytics` option and pass the same site-config value used by layout, or
2. Render GA only from `NEXT_PUBLIC_GA_ID` if the env var is intended to be canonical.

Add a regression test that configures the chosen canonical source and asserts the CSP allows the exact domains required by the rendered script/connect behavior.

---

### CR-02 — Load-more tag handling drifts from SSR canonicalization; duplicate tags can make later pages empty

- **Location:** `apps/web/src/app/actions/public.ts:65-77`, `apps/web/src/lib/data.ts:323-335`, `apps/web/src/lib/tag-slugs.ts:6-27`, `apps/web/src/app/[locale]/(public)/page.tsx:135-140`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:162-166`, current tests at `apps/web/src/__tests__/public-actions.test.ts:87-92`
- **Severity:** Medium
- **Confidence:** High for duplicate-tag failure; Medium for invalid-tag broadening
- **Type:** Confirmed issue / adjacent risk

**Why this is a problem**

Initial SSR page rendering canonicalizes tag query strings:

- `tag-slugs.ts:6-27` trims, drops blanks, caps, and de-duplicates requested slugs.
- `page.tsx:135-140` and `[topic]/page.tsx:162-166` pass canonical `tagSlugs` to `getImagesLitePage`.

The load-more server action does not reuse that helper. It slices, trims, and filters valid slugs only:

- `public.ts:73-77` builds `safeTags` without de-duplicating and silently drops invalid slugs.
- `data.ts:323-335` then requires `COUNT(DISTINCT tags.slug) = validTagSlugs.length`.

For `['cat', 'cat']`, the SQL can count at most one distinct matching tag but requires two, so no image can match.

**Concrete failure scenario**

The first page for `/en?tags=cat,cat` works because SSR de-dupes to `['cat']`. A stale client, manual server-action call, or future UI change calls `loadMoreImages(undefined, ['cat', 'cat'], 30, 30)`. The action passes both slugs to the data layer, the `HAVING COUNT(DISTINCT ...) = 2` condition filters out every row, and infinite scroll reports no more images despite matching images existing.

For `['cat', '<bad>']`, the action silently broadens to `['cat']` instead of rejecting the caller's invalid filter, which makes client/server state harder to reason about.

**Suggested fix**

Create a shared server-safe helper for tag-array canonicalization and use it from both SSR parsing and `loadMoreImages`: trim, validate, cap, de-duplicate preserving order, and return an explicit invalid status if any submitted tag is invalid. Also harden `buildTagFilterCondition` by de-duplicating before computing the `HAVING` count so future callers cannot reintroduce this edge case.

---

### CR-03 — Missing original upload files leave images pending without retry or operator-visible failure state

- **Location:** `apps/web/src/lib/image-queue.ts:244-250`, retry branch at `apps/web/src/lib/image-queue.ts:312-326`, cleanup at `apps/web/src/lib/image-queue.ts:331-335`, bootstrap completion at `apps/web/src/lib/image-queue.ts:430-436`
- **Severity:** Medium
- **Confidence:** High
- **Type:** Confirmed issue

**Why this is a problem**

When a queued image row still exists and is unprocessed, the worker resolves the original upload path and checks filesystem access:

- `image-queue.ts:244-250` logs `File not found for job ...` and returns when `fs.access(originalPath)` fails.

That return bypasses the `catch` branch that increments `retryCounts`, marks `state.bootstrapped = false`, and schedules a bootstrap retry:

- Processing errors at `image-queue.ts:312-326` retry or rescan.
- Missing-original errors return before that path.

The `finally` block then removes the id from in-memory state as if the job were finished/skipped:

- `image-queue.ts:331-335` clears `enqueued`, `retryCounts`, and claim retry state.

If the bootstrap batch was smaller than `BOOTSTRAP_BATCH_SIZE`, the process marks itself fully bootstrapped:

- `image-queue.ts:430-436` sets `state.bootstrapped = true` and resets the cursor.

The DB row remains `processed = false`, but no retry timer or explicit failure state exists.

**Concrete failure scenario**

An upload inserts an image row, then the original file is deleted/moved or temporarily unavailable before background processing runs (volume mount race, operator cleanup, storage hiccup). The queue logs one error and drops the in-memory job. The image remains permanently pending/unpublished in the same running process until restart or an unrelated queue failure happens to reset bootstrap state.

**Suggested fix**

Do not treat missing originals as a successful skip. Route this path through the same failure/retry branch as `processImageFormats` exceptions: increment retry counts, mark bootstrap stale, and schedule a retry scan. Longer term, add an explicit processing failure state or audited cleanup path so operators can remediate permanently missing originals instead of silently carrying pending rows.

---

### CR-04 — Paginated listing helper can exceed its documented 100-row safety cap

- **Location:** `apps/web/src/lib/data.ts:371-373`, `apps/web/src/lib/data.ts:435-464`, coverage gap at `apps/web/src/__tests__/data-pagination.test.ts:1-30`
- **Severity:** Low
- **Confidence:** High
- **Type:** Confirmed latent issue

**Why this is a problem**

The data layer documents a 100-row listing cap:

- `data.ts:371` defines `LISTING_QUERY_LIMIT = 100`.
- `data.ts:373` defines `LISTING_QUERY_LIMIT_PLUS_ONE = 101` for has-more detection.

`getImagesLitePage` caps the requested visible page size at `LISTING_QUERY_LIMIT_PLUS_ONE` and then queries one additional sentinel row:

- `data.ts:447` allows `normalizedPageSize = 101`.
- `data.ts:463` executes `limit(normalizedPageSize + 1)`, which can query 102 rows and return 101 visible rows via `normalizePaginatedRows`.

**Concrete failure scenario**

A future admin/public caller passes `pageSize=999` expecting the helper to enforce the documented 100-row cap. The helper returns up to 101 visible rows and asks MySQL for 102 rows. Current public callers pass smaller page sizes, so this is latent, but the helper contract is brittle.

**Suggested fix**

Cap visible page size at `LISTING_QUERY_LIMIT`, then query `effectivePageSize + 1` for has-more detection. Add a regression test that calls `getImagesLitePage(..., 999, ...)` or extracts the query shape to assert the visible cap remains 100.

---

### CR-05 — Client tag creation accepts values the server rejects, causing late whole-upload failures

- **Location:** `apps/web/src/components/tag-input.tsx:24-35`, `apps/web/src/components/tag-input.tsx:67-84`, `apps/web/src/components/upload-dropzone.tsx:212-215`, `apps/web/src/app/actions/images.ts:150-156`, `apps/web/src/lib/validation.ts:76-87`, `apps/web/src/lib/tag-records.ts:5-12`
- **Severity:** Low
- **Confidence:** High for rejected-character drift; Medium for locale-sensitive casing drift
- **Type:** Confirmed issue / adjacent risk

**Why this is a problem**

The client tag input allows any trimmed non-empty tag that does not contain a comma and is not an exact existing tag match:

- `tag-input.tsx:67-71` enables the create option.
- `tag-input.tsx:79-84` adds it to selected state.

The upload path serializes selected tags into a comma-separated field:

- `upload-dropzone.tsx:212-215` appends `allTags.join(',')`.

The server enforces stricter validation:

- `images.ts:150-156` aborts the upload if any candidate fails `isValidTagName` or `isValidTagSlug(getTagSlug(t))`.
- `validation.ts:76-87` rejects `<`, `>`, quotes, ampersands, NUL, Unicode formatting, empty slugs, and overlong values.
- `tag-records.ts:5-12` uses deterministic `toLowerCase()` and slug transformations, while `tag-input.tsx:24-35` uses browser `toLocaleLowerCase()` for comparisons.

**Concrete failure scenario**

An admin selects several files and creates a tag like `family & friends` or `kids <2026>`. The UI accepts and displays it. Every upload call carrying that tag then returns `invalidTagNames`, causing the affected files to fail after the batch has started. In Turkish-locale browsers, locale-sensitive case folding can also make client duplicate detection disagree with server slug/collision handling.

**Suggested fix**

Expose a client-safe copy of tag validation/normalization (or a deliberately duplicated tested helper) and run it before adding a new tag. Show inline errors for characters/lengths the server will reject. Replace `toLocaleLowerCase()` with deterministic `toLowerCase()` unless locale-aware matching is intentionally part of the persisted tag contract.

---

### CR-06 — Drizzle CLI config constructs malformed DB URLs instead of failing fast on missing env

- **Location:** `apps/web/drizzle.config.ts:4-12`, contrast with runtime DB defaults at `apps/web/src/db/index.ts:8-18`
- **Severity:** Low
- **Confidence:** High
- **Type:** Confirmed maintainability/operability issue

**Why this is a problem**

`drizzle.config.ts` loads `.env.local` and constructs a MySQL URL with optional env values:

- `drizzle.config.ts:4` loads `.env.local`.
- `drizzle.config.ts:11` interpolates `DB_HOST`, `DB_PORT`, and `DB_NAME` directly, and defaults only user/password to empty strings.

If required variables are missing, the config produces URLs like `mysql://:@undefined:undefined/undefined` instead of a clear validation error. Runtime DB setup in `src/db/index.ts:8-18` has different defaults and option handling, so CLI and app behavior can diverge.

**Concrete failure scenario**

A developer runs `npm run db:push --workspace=apps/web` before creating `.env.local`, or CI runs with a partial environment. Drizzle receives a malformed URL and fails with opaque parsing/DNS/connection errors. With inherited shell variables from another project, the CLI can also target an unintended host/database more easily than a fail-fast config would allow.

**Suggested fix**

Add a `requiredEnv(name)` helper in `drizzle.config.ts` and validate `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` before constructing the URL. Prefer reusing the same connection-option helper used by scripts where possible so CLI/runtime semantics stay aligned.

## Final sweep notes

- No critical/high-confidence security exploit was found from this angle.
- Mutating server actions and the admin DB download API passed the repository scanner gates during this review.
- `dangerouslySetInnerHTML` call sites reviewed are JSON-LD only and use `safeJsonLd` plus nonces.
- The uncommitted lightbox touch-target change appears to fix the specific 40 px close/fullscreen control issue: current `lightbox.tsx:310` and `lightbox.tsx:329` use `h-11 w-11`; the audit comment matches.
- Highest priority code-quality fixes from this slice: CR-01, CR-02, and CR-03.
