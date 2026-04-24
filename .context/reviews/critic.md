# Critic deep code review — 2026-04-24

## Scope / inventory

Reviewed the tracked, review-relevant text/code/config surface under the current repo:

- Root docs/config/workflow: `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.dockerignore`, `.nvmrc`, `.github/workflows/quality.yml`, `.github/dependabot.yml`, `.vscode/*`, root/package manifests, deploy helper.
- App docs/deploy/config: `apps/web/README.md`, `Dockerfile`, `docker-compose.yml`, nginx config, env example, Next/Vitest/Playwright/TS/Tailwind/ESLint/PostCSS/Drizzle configs.
- Runtime code: all tracked files under `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/lib/**`, `apps/web/src/db/**`, `apps/web/src/i18n/**`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`.
- Scripts/migrations: all tracked files under `apps/web/scripts/**` and `apps/web/drizzle/*.sql` plus journal.
- Tests: all tracked files under `apps/web/src/__tests__/**` and `apps/web/e2e/**`.
- Messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

Skipped as non-review-relevant artifacts after final sweep: `.context/**`, `.omx/**`, `plan/**`, `test-results/**`, generated `.tsbuildinfo`, `drizzle/meta/*.json` snapshots, binary fixtures/assets (`.png`, `.jpg`, `.avif`, `.webp`, `.woff2`, uploaded derivatives), and historical review/plan logs.

## Verification run

- `npm run lint --workspace=apps/web` ✅
- `npm run typecheck --workspace=apps/web` ✅
- `npm run test --workspace=apps/web` ✅ (54 files / 316 tests)
- `npm run test:e2e --workspace=apps/web` ❌ blocked by missing local MySQL (`ECONNREFUSED 127.0.0.1:3306`)

## Findings

### 1) [CONFIRMED] Host-nginx deployment docs contradict the checked-in nginx static upload config
- **Severity:** HIGH
- **Confidence:** High
- **Evidence:**
  - `README.md:139,161-169` documents a **host-network + host nginx** deployment.
  - `apps/web/README.md:33-34` repeats the same host-nginx assumption.
  - `apps/web/docker-compose.yml:10-22` runs only the app container and mounts `./public` into the **container** at `/app/apps/web/public`.
  - `apps/web/nginx/default.conf:89-95` serves `/uploads/**` with `root /app/apps/web/public;`.
- **Why this is a problem:** that root path exists inside the container, not on the host nginx process described by the docs. A host nginx using this file will look for uploads in a path it does not own.
- **Failure scenario:** deployment follows the README exactly, nginx starts on the host, HTML works, but all upload URLs 404 because nginx cannot read `/app/apps/web/public/...` on the host filesystem.
- **Concrete fix:** choose one model and make docs/config agree:
  1. either mount the uploads directory into the host nginx-visible path and update `root`,
  2. or stop serving uploads directly from host nginx and proxy `/uploads/**` to Next,
  3. or ship a companion nginx container and document that instead of host nginx.

### 2) [CONFIRMED] “Fail fast if site-config is missing” is defeated by a tracked localhost placeholder
- **Severity:** HIGH
- **Confidence:** High
- **Evidence:**
  - `apps/web/.gitignore:49` says `src/site-config.json` should be local-only.
  - `apps/web/src/site-config.json:4-5` is nevertheless tracked, and its canonical URLs are `http://localhost:3000`.
  - `apps/web/scripts/ensure-site-config.mjs:4-8` only checks **existence**, not whether the file is still a placeholder.
  - `README.md:162-169` and `apps/web/README.md:34` claim build/deploy now fail fast when the real file is missing.
  - `.github/workflows/quality.yml:51-52` explicitly copies the example into place in CI, so CI also never proves that the config is real/customized.
- **Why this is a problem:** the repo mixes two incompatible models: “site-config.json is local-only and must be supplied” vs “a tracked placeholder already exists”. That means the advertised fail-fast guarantee is mostly illusory.
- **Failure scenario:** operator forgets to customize `apps/web/src/site-config.json`, build still succeeds, and production emits localhost canonical URLs/sitemap/OG links/robots sitemap references.
- **Concrete fix:**
  - untrack `apps/web/src/site-config.json` for real,
  - keep only `site-config.example.json`,
  - have CI create the file explicitly,
  - and make `ensure-site-config.mjs` reject obvious placeholder values like `http://localhost:3000` in production/deploy builds.

### 3) [CONFIRMED] The same-origin action lint gate has real blind spots and can provide false confidence
- **Severity:** HIGH
- **Confidence:** High
- **Evidence:**
  - `apps/web/scripts/check-action-origin.ts:46-67` only discovers `.ts` files and excludes any basename `auth.ts` / `public.ts` at **any depth**.
  - `apps/web/src/__tests__/check-action-origin.test.ts:165-199` locks that exact behavior in.
  - `apps/web/scripts/check-action-origin.ts:109-125,171-178` treats *any* AST call named `requireSameOriginAdmin` as success; it does not verify that the result is checked before mutation.
- **Why this is a problem:** the repo treats this script as a security gate, but today it can miss valid Next action files (`.tsx`, `.js`, etc.), skip unrelated nested files just because they are named `auth.ts`/`public.ts`, or pass a dead-code / no-op `requireSameOriginAdmin()` call.
- **Failure scenario:**
  - a future mutating server action lands in `app/actions/foo.tsx` or `app/actions/nested/public.ts` and bypasses the lint entirely, or
  - a refactor leaves `await requireSameOriginAdmin()` in unreachable code and the scanner still reports green.
- **Concrete fix:**
  - scan all supported action extensions (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` if supported),
  - exclude only the exact top-level files that are intentionally special-cased,
  - strengthen the check so it requires the standard “call + early return on error” pattern (or an explicit approved helper),
  - add regression fixtures for `.tsx`, nested `public.ts`, and dead-code/no-op call cases.

### 4) [LIKELY] Restore maintenance is process-local, but the rest of the system treats it like a global maintenance mode
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Evidence:**
  - `apps/web/src/lib/restore-maintenance.ts:1-18,44-55` stores maintenance state in `globalThis` only.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:271-301` sets/clears that flag around restore work.
  - Many runtime guards consume that flag as if it were authoritative (`apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/api/health/route.ts`).
  - `apps/web/src/__tests__/restore-maintenance.test.ts:5-52` only verifies single-process behavior.
- **Why this is a problem:** the MySQL advisory lock is global for restore exclusivity, but the “maintenance mode” that blocks uploads/search/view buffering/health is not. In any multi-process, rolling deploy, or horizontally scaled setup, one process can be restoring while another keeps accepting work.
- **Failure scenario:** a restore starts on process A; process B still serves public actions and accepts admin mutations/uploads because its own `globalThis` flag never flipped. You get a partially “paused” system during a destructive restore.
- **Concrete fix:** move restore-maintenance state into a shared store (DB row / dedicated table / lock-backed status check) and have health/actions/query code consult that shared state instead of a process-local symbol.

### 5) [RISK] The admin API gate enforces authentication but not same-origin for future mutating routes
- **Severity:** MEDIUM
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/lib/api-auth.ts:10-26` wraps handlers with `isAdmin()` only.
  - `apps/web/scripts/check-api-auth.ts:64-72,122-124` only checks that exports are wrapped with something named `withAdminAuth(...)`.
  - Middleware explicitly excludes `/api/*` from its matcher (`apps/web/src/proxy.ts:59-64`).
- **Why this is a problem:** the current repo has only one admin API route and it manually adds origin checks, but the architectural guardrail for *future* `/api/admin/*` mutations is incomplete. A future POST/DELETE route can pass CI with auth-only wrapping and still miss the origin/confused-deputy protection that server actions now enforce.
- **Failure scenario:** a new `POST /api/admin/...` lands, uses `withAdminAuth`, passes `lint:api-auth`, and ships without same-origin validation because nothing in the wrapper or lint gate requires it.
- **Concrete fix:** add a dedicated mutating-route wrapper (for example `withAdminMutationAuth`) that combines auth + origin validation, and make the lint gate require it for non-GET/HEAD handlers.

## Representative task simulations

1. **Operator follows documented host-nginx deploy path**
   - Uses `apps/web/docker-compose.yml` as documented.
   - Starts host nginx with `apps/web/nginx/default.conf`.
   - Requests `/uploads/jpeg/...`.
   - nginx resolves against `/app/apps/web/public` on the host, not inside the app container.
   - Result: broken image serving despite a “successful” deploy.

2. **Contributor adds a new mutating server action in `app/actions/foo.tsx`**
   - Current `check-action-origin.ts` ignores it because discovery is `.ts`-only.
   - CI passes.
   - The file can omit `requireSameOriginAdmin()` entirely.
   - Result: the repo’s documented security gate silently stops applying.

3. **Restore runs during a rolling deploy / multi-process setup**
   - Process A sets the in-memory maintenance symbol and starts restore.
   - Process B keeps `active=false`, so public/admin guards still run normally there.
   - Result: writes, queue activity, or view-count buffering can continue during the restore window.

## Final sweep

- No additional **current** auth bypass or unit-test failure surfaced after the repo-wide source/config/test sweep.
- The strongest problems are architectural/operational confidence gaps: deployment docs vs config drift, placeholder config defeating “fail fast”, and security lint gates that are narrower than their documentation suggests.
- E2E verification is still outstanding because the local MySQL dependency was unavailable during this run.
