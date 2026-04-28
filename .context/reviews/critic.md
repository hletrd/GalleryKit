# Critic Review — Prompt 1 fan-out A

Date: 2026-04-28  
Repo: `/Users/hletrd/flash-shared/gallery`  
Role angle: `critic` — skeptical multi-perspective critique of whole repository and current uncommitted change surface.  
Mode: review-only. I did not edit source/config/test files; this report replaces stale content in `.context/reviews/critic.md`.

## Inventory and review method

I built the inventory before critique using `git status --short`, `git diff --name-status`, `git diff --cached --name-status`, `git ls-files`, targeted line-number reads, and static sweeps. Semantic review excluded vendor/build/generated artifacts (`node_modules`, `.next`, `test-results`, `*.tsbuildinfo`, binary screenshots/media) except where they affect deployment/build-context risk.

Current uncommitted changes included in critique:

- Review/report files: `_aggregate.md`, `architect.md`, `code-reviewer.md`, `critic.md`, `designer.md`, `perf-reviewer.md`, staged `security-reviewer.md`, `test-engineer.md`, `tracer.md`, `verifier.md`.
- Functional/config/test files: `.gitignore`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/components/lightbox.tsx`.

Cross-checks performed:

- Deployment wiring: `.dockerignore`, `.gitignore`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `README.md`, `apps/web/README.md`, upload path helpers.
- Test-gate changes: Playwright and Vitest configs plus current diff.
- Review-loop artifact handling: aggregate and per-agent review files/diffs.
- App correctness hot spots: CSP/analytics, load-more/tag filters, queue processing, public/privacy query fields, server action/API auth guard scanners.
- Read-only gate evidence: `npm run lint:api-auth --workspace=apps/web` passed; `npm run lint:action-origin --workspace=apps/web` passed.

## Findings

### C-01 — Docker build context still includes agent/runtime artifacts that Git now hides

- **File/region:** `.dockerignore:1-16`, `.gitignore:16-19`, `apps/web/Dockerfile:42`, `apps/web/docker-compose.yml:4-6`; local artifact evidence includes `.context/**`, `.omx/**`, `.omc/**`, `.agent/**`, AppleDouble `._*`, and `*.tsbuildinfo` classes.
- **Severity:** Medium
- **Confidence:** High
- **Label:** Confirmed issue

**Why this is a problem**

The current uncommitted `.gitignore` adds `._*` and already ignores `.omc`, `.omx/`, and `.context/`, but root `.dockerignore` does not. Compose builds from repo root (`docker-compose.yml:4-6`) and the Dockerfile copies the whole build context (`Dockerfile:42` `COPY . .`). Root `.dockerignore:1-16` excludes some broad classes but not `.context/`, `.omx/`, `.omc/`, `.agent/`, `**/._*`, or `**/*.tsbuildinfo`.

**Concrete failure scenario**

A production Docker build sends local review reports, screenshots, agent runtime JSON/logs, AppleDouble metadata, and TypeScript incremental caches to the Docker daemon or remote build cache. Even if the final runner stage does not copy all artifacts, they are still in the transmitted context and builder stage, creating avoidable bloat and possible leakage of local automation traces/screenshots.

**Suggested fix**

Add a root `.dockerignore` artifact section aligned with `.gitignore`: `.context/`, `.omx/`, `.omc/`, `.agent/`, `**/.omc/`, `**/._*`, `**/*.tsbuildinfo`, test reports/results, and other generated state. Keep `!apps/web/README.md` only if that file is required inside the image.

---

### C-02 — Host nginx static upload shortcut can 404 processed images in the documented topology

- **File/region:** `apps/web/nginx/default.conf:96-103`, `apps/web/docker-compose.yml:13-24`, `apps/web/src/lib/upload-paths.ts:12-22`, deployment docs at `README.md:168-176`
- **Severity:** High
- **Confidence:** Medium
- **Label:** Likely issue / deployment risk needing operator validation

**Why this is a problem**

The documented compose topology uses host networking and says nginx runs as the host reverse proxy (`docker-compose.yml:13-15`, `README.md:168-176`). Processed public uploads are bind-mounted into the container at `/app/apps/web/public` (`docker-compose.yml:22-24`), and app defaults resolve uploads under `apps/web/public/uploads` relative to the app process (`upload-paths.ts:12-22`).

The host nginx config intercepts `/uploads/(jpeg|webp|avif)/...` and serves from `root /app/apps/web/public` (`nginx/default.conf:96-103`). If nginx is actually running on the host, that absolute path must exist on the host too; the container bind mount does not create `/app/apps/web/public` on the host.

**Concrete failure scenario**

An operator follows the documented Linux host-network + host-nginx setup with the repo checked out at `/srv/gallery/apps/web`. Requests like `/en/uploads/jpeg/photo_1536.jpg` match the nginx regex location, nginx tries `/app/apps/web/public/uploads/jpeg/photo_1536.jpg` on the host, returns 404, and never proxies to the Next.js upload route that would serve the file from the app's filesystem.

**Suggested fix**

Make the static upload location operator-configurable and host-accurate, e.g. `alias /srv/gallery/apps/web/public/uploads/;`, or proxy uploads to Next.js by default. If nginx is intended to run in a container, document/compose that topology and mount the same public volume into nginx at the configured path.

---

### C-03 — Review-loop artifacts overwrite high-signal reports with timeout/failure notes

- **File/region:** `.context/reviews/_aggregate.md:11-15`, `.context/reviews/designer.md:1-5`, and the current uncommitted per-agent review diffs; this report and `code-reviewer.md` now replace two of those lanes with actual reviews, but the pattern remains in the worktree.
- **Severity:** Medium
- **Confidence:** High
- **Label:** Confirmed process/repository-state issue

**Why this is a problem**

The current aggregate records that multiple specialist lanes timed out (`_aggregate.md:11-15`). Several per-agent files were overwritten with short failure notes, deleting prior detailed findings/resolution status from the same stable filenames. Stable filenames like `.context/reviews/designer.md` look like the latest specialist evidence to humans and automation.

**Concrete failure scenario**

A later review-plan-fix cycle or human triager consumes the current `.context/reviews/*.md` set as the latest complete evidence. Because timed-out lanes occupy the canonical filenames, previous high-signal findings can be masked as intentionally superseded rather than unavailable. The loop may converge on the fallback aggregate while missing unresolved security/performance/test/design concerns.

**Suggested fix**

Preserve previous successful specialist reports under cycle-stamped filenames, write timeouts to separate `*-failure.md` or `*-timeout.md` files, and mark the aggregate status incomplete/failed when required lanes time out. Do not replace canonical high-signal reports with timeout stubs unless the aggregate explicitly carries forward or closes those findings.

---

### C-04 — Test-gate timeouts were widened enough to hide hangs and accept invalid env values

- **File/region:** `apps/web/playwright.config.ts:31-67`, `apps/web/vitest.config.ts:10-12`
- **Severity:** Medium
- **Confidence:** High
- **Label:** Risk from current uncommitted change

**Why this is a problem**

The current Playwright config parses `E2E_WEB_SERVER_TIMEOUT_MS` with bare `Number(...)` and defaults to `1,800,000` ms (30 minutes):

- `playwright.config.ts:31-32` computes `webServerTimeout`.
- `playwright.config.ts:61-67` applies it to the web server command.

The same uncommitted surface sets a global Vitest per-test timeout of 120 seconds:

- `vitest.config.ts:10-12` sets `testTimeout: 120_000`.

**Concrete failure scenario**

A broken `npm run init`, seed, production build, or standalone server start can burn 30 minutes before Playwright fails, making a deterministic regression look like CI slowness. If `E2E_WEB_SERVER_TIMEOUT_MS=foo` is set, `Number('foo')` becomes `NaN`, yielding a confusing config/runtime failure instead of a clear validation error. The 120-second global Vitest timeout similarly lets accidental unit-test hangs linger across the suite instead of requiring explicit opt-ins for known slow tests.

**Suggested fix**

Parse timeout env vars with a finite positive integer guard and a sane upper bound. Prefer a shorter default plus a documented CI override for slow production-build E2E. Move long-running unit tests to per-test/per-suite timeout overrides rather than raising the global Vitest allowance.

---

### C-05 — Analytics configuration split undermines production observability despite valid-looking config

- **File/region:** `apps/web/src/app/[locale]/layout.tsx:118-126`, `apps/web/src/lib/content-security-policy.ts:58-69`, `apps/web/src/proxy.ts:41-44`, config contract at `apps/web/src/site-config.example.json:10` and `README.md:55`
- **Severity:** Medium
- **Confidence:** High
- **Label:** Confirmed product/ops risk

**Why this is a problem**

From an operator/product perspective, the app exposes `google_analytics_id` in site config, renders GA when that field is set, but production CSP only permits GA domains when the separate env var `NEXT_PUBLIC_GA_ID` is set. This creates a configuration trap: the UI/source looks configured, but production browsers block the analytics script/connect calls.

**Concrete failure scenario**

A site owner enables analytics through the documented `site-config.json` field and deploys. No tracking data appears. The failure is not obvious in app logs because the browser enforces CSP client-side; the site owner must inspect browser devtools to discover blocked `googletagmanager.com`/`google-analytics.com` requests.

**Suggested fix**

Unify analytics configuration so one setting drives both rendered scripts and CSP. Add docs and tests for the exact deployment-time source of truth.

---

### C-06 — Public load-more and SSR tag filters are not semantically identical

- **File/region:** `apps/web/src/app/actions/public.ts:73-91`, `apps/web/src/lib/data.ts:323-335`, `apps/web/src/lib/tag-slugs.ts:6-27`, `apps/web/src/__tests__/public-actions.test.ts:87-92`
- **Severity:** Low
- **Confidence:** Medium
- **Label:** Likely issue / client-server contract risk

**Why this is a problem**

The SSR pages canonicalize tag query strings through `parseRequestedTagSlugs` and `filterExistingTagSlugs`; load-more trims and filters valid-looking slugs but does not de-duplicate or reject mixed invalid input. The data helper then uses a distinct-tag count equal to the raw valid array length.

**Concrete failure scenario**

A bookmark, extension, or future UI bug requests the initial page with duplicate tags. SSR renders correctly after de-duping, but infinite scroll sends a duplicate array and receives an empty page. A mixed invalid list can also silently broaden to a valid subset, so later pages may not match the user's apparent filter semantics.

**Suggested fix**

Share canonicalization between SSR and server actions, and make invalid tag submissions explicit rather than silently dropping bad entries. De-dupe inside the data helper as defense in depth.

## Cross-check notes / non-findings

- The current lightbox change is directionally correct: close/fullscreen controls now use `h-11 w-11` at `apps/web/src/components/lightbox.tsx:310` and `:329`, matching the audit comment at `touch-target-audit.test.ts:81-87`.
- The server-action provenance scanner and admin API auth scanner passed during this review.
- JSON-LD `dangerouslySetInnerHTML` call sites reviewed use `safeJsonLd` and CSP nonces.
- Public data privacy guard patterns remain visible in `apps/web/src/lib/data.ts`; no current public query was found leaking original filenames/GPS/unprocessed rows from this critic pass.

## Final sweep

Searched for commonly missed issue classes: unguarded mutating actions, route/API auth drift, raw SQL/string interpolation hazards, restore/backup file containment, CSP/script mismatches, client/server validation drift, queue retry state, Docker/deploy path mismatches, timeout/env parsing pitfalls, JSON-LD/XSS hazards, and current uncommitted diff regressions. No source fixes were implemented.
