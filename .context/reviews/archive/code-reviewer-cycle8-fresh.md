# Code Reviewer — Cycle 8 (Fresh, broad sweep)

**Cycle:** 8/100, review-plan-fix loop, broad-surface sweep.
**HEAD:** `0d3916b refactor(uploads): single-source tagsString split in uploadImages`
**Scope:** broad re-read of frontend, backend, infra, dependencies, observability.

## File inventory examined (high-signal)

- `next.config.ts`, `proxy.ts`, `instrumentation.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`
- `lib/{rate-limit,session,data,process-image,image-queue,csv-escape,validation,sanitize,api-auth,action-guards,request-origin,upload-paths,serve-upload,audit,content-security-policy,safe-json-ld}.ts`
- `app/actions/{auth,images,public,sharing,admin-users,topics,seo,settings}.ts`
- `app/[locale]/admin/db-actions.ts`
- `app/api/og/route.tsx`, `app/api/health/route.ts`, `app/api/live/route.ts`, `app/api/admin/db/download/route.ts`
- `app/[locale]/(public)/{page,[topic]/page,p/[id]/page}.tsx`, `app/sitemap.ts`, `app/global-error.tsx`
- `db/{index,schema}.ts`

## Findings

### CR8F-01 — `app/api/og/route.tsx` always returns `Cache-Control: no-store`
**Where:** `apps/web/src/app/api/og/route.tsx:38, 140, 151`
**What:** The `/api/og` endpoint generates a 1200×630 social preview SVG/PNG via `next/og`. Both the success path AND the error path emit `Cache-Control: 'no-store, no-cache, must-revalidate'`. The image is fully derived from a topic slug + tag list, validated and clamped — there is no per-user content. Every Twitter / Slack / Discord / Open Graph crawler fetch re-runs the React-tree → SVG → PNG pipeline, defeating CDN/edge caching and inflating server CPU.
**Failure scenario:** A photo from a popular topic gets shared on Twitter; every link unfurl across timelines triggers full regeneration instead of a single edge cache. Under bursty social traffic this is a self-inflicted DoS amplifier.
**Suggested fix:** Use `public, max-age=3600, stale-while-revalidate=86400` (or longer) for the success path. Keep `no-store` on the 4xx/5xx error branch.
**Confidence:** High.

### CR8F-02 — `app/sitemap.ts` mixes `force-dynamic` with `revalidate = 3600`
**Where:** `apps/web/src/app/sitemap.ts:7-8`
```ts
export const dynamic = 'force-dynamic';
export const revalidate = 3600;
```
**What:** Per Next.js docs, `dynamic = 'force-dynamic'` opts the route out of all caching/revalidation; the `revalidate` value is dead. Operators reading the file will think the sitemap is cached for an hour when it actually rebuilds on every crawler hit, including the `getImageIdsForSitemap` LIMIT 24000 query (50k cap). For a multi-thousand-image gallery this is a measurable hit per Googlebot pull.
**Failure scenario:** Crawler with multiple sitemap fetches per minute pegs the DB pool when other concurrent traffic is happening; admin sees mysterious latency spikes correlated with crawler windows.
**Suggested fix:** Drop `force-dynamic` and let `revalidate = 3600` take effect (Next.js will lazily revalidate after hour); OR drop `revalidate` and document why dynamic is required.
**Confidence:** High.

### CR8F-03 — `global-error.tsx` imports the entire `site-config.json` into the client bundle
**Where:** `apps/web/src/app/global-error.tsx:4`
```ts
import siteConfig from '@/site-config.json';
```
**What:** `global-error.tsx` is `'use client'`. The whole `site-config.json` (title, description, nav_title, footer links, every SEO default…) ships into every browser, even though only `nav_title` and `title` are used. There is no tree-shaking on JSON imports.
**Failure scenario:** First-paint payload bloat for a file that is only consulted on a fatal-error fallback render. Smaller installs are fine; an operator who customizes the file with extensive metadata grows the user-facing JS bundle proportionally.
**Suggested fix:** Pass `nav_title` / `title` from a server component, or copy just the two needed fields into a small constants file imported here.
**Confidence:** Medium.

### CR8F-04 — Audit-log entries never bound metadata size at write time across hot mutations
**Where:** `apps/web/src/lib/audit.ts:15-29`, `apps/web/src/app/actions/images.ts:407-412` (passes `tags: tagNames.join(',')` after the 1000-char tagsString check).
**What:** `logAuditEvent` truncates serialized metadata to 4096 chars at insert time, but the build site (`uploadImages`) still produces objects with 1000-char `tags` strings, full topic, and counts. Combined with `requestedIds` arrays in `deleteImages` (up to 100 ids), some single audit rows approach the 4096 cap and silently fall into the `truncated: true, preview` path, dropping evidence.
**Failure scenario:** An admin investigates a reported deletion; the audit row only contains the truncated preview because metadata was 4500 bytes. They cannot see exactly what `requestedIds` were targeted.
**Suggested fix:** Either lift the 4096 cap (the column is `text`, MySQL TEXT supports 64K) OR explicitly truncate at the call site with a structured drop reason (e.g. `requestedCount: N, truncated: true`).
**Confidence:** Medium.

### CR8F-05 — `Permissions-Policy` header is missing modern privacy signals
**Where:** `apps/web/next.config.ts:45`, `apps/web/nginx/default.conf:39,110`
**What:** Header is fixed at `camera=(), microphone=(), geolocation=()`. Modern browsers honor `interest-cohort=()` (Topics API opt-out), `browsing-topics=()`, `attribution-reporting=()`, and `idle-detection=()` for privacy-leaning sites. A photo gallery that exists at `gallery.atik.kr` has a clear opt-out story.
**Failure scenario:** Chromium uses page visit history for Topics inference even on a photo gallery; admin who chose a personal-privacy posture for a personal site has not communicated that to the browser.
**Suggested fix:** Append `interest-cohort=(), browsing-topics=(), attribution-reporting=()` to both the Next config and the nginx config. Keep them aligned.
**Confidence:** Medium.

### CR8F-06 — `images.view_count` column is `int` (signed) — overflow at 2.1B
**Where:** `apps/web/src/db/schema.ts:90`
```ts
view_count: int("view_count").default(0).notNull(),
```
**What:** A shared group's `view_count` is buffered (`bufferGroupViewCount`) and increment-flushed; a lifetime view counter on a single popular share would saturate INT_MAX (2,147,483,647). Replacement is a one-line schema change to `bigint`.
**Failure scenario:** Personal-gallery scope makes this LOW — but a viral share shared on a major platform could overflow during a single year of life. MySQL silently saturates without raising an error in default sql_mode unless STRICT mode is enabled.
**Suggested fix:** `bigint("view_count", { mode: 'number' })` with explicit migration, OR document the int cap as acceptable.
**Confidence:** Low (theoretical for personal use case).

### CR8F-07 — `adminUsers.created_at` lacks `.notNull()` while every other timestamp has it
**Where:** `apps/web/src/db/schema.ts:106-111`
```ts
created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
```
**What:** Compare with `images.created_at` (`.default(sql`CURRENT_TIMESTAMP`).notNull()`). Result of an explicit `INSERT … (created_at) VALUES (NULL)` would persist NULL, breaking ordering queries on `adminUsers` (already used: `desc(adminUsers.created_at)` in `getAdminUsers`). Default protects normal inserts; explicit-null inserts would not be guarded.
**Failure scenario:** Migration script bug or future code path passes `created_at: null` and silently corrupts ordering. No exploit; cosmetic schema asymmetry.
**Suggested fix:** Add `.notNull()` to align with the other tables. Cheap, low-risk.
**Confidence:** Low.

### CR8F-08 — `app/global-error.tsx` recomputes brand title from DOM via `resolveErrorShellBrand(document, …)` on every render
**Where:** `apps/web/src/app/global-error.tsx:42`, `lib/error-shell.ts` (callee).
**What:** Cosmetic; the function is presumably cheap, but in the fatal-error code path the DOM may itself be partially broken. A try/catch around the DOM read would harden the fallback so a fatal error in the brand-detection logic does not yield a blank page on top of the original fatal error.
**Suggested fix:** Wrap the `resolveErrorShellBrand` call in try/catch and fall back to the JSON value on exception.
**Confidence:** Low.

## Cross-cutting observations

- The codebase is genuinely disciplined. Most "quick wins" cycles 1–7 already landed. The remaining surface is mostly cosmetic / micro-perf / future-scale.
- Nothing material in the auth, upload, or restore surfaces this cycle. Defensive controls are layered consistently (`requireSameOriginAdmin`, `withAdminAuth`, `containsUnicodeFormatting`, sanitize-before-validate, advisory locks).
- Findings above are net-new categories (delivery caching, schema longevity, browser privacy headers) rather than sequels to the Unicode-formatting / rate-limit themes that have dominated recent cycles.
