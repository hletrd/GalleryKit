# Plan 233 — Cycle 3 review-plan-fix fixes

Status: DONE (archived)
Created: 2026-04-24
Source review: `.context/reviews/_aggregate.md` (Cycle 3/100)

## Repo-policy inputs consulted

- `CLAUDE.md` (stack/security/runtime notes; Node 24+, TS 6; documented permanent 2FA deferral only).
- `AGENTS.md` (commit+push all changes; use gitmoji; keep diffs small/reviewable/reversible; no new dependencies unless explicit).
- `.context/**` and existing `plan/**` (prior carry-forward deferrals for CSP, visual regression, multi-instance runtime, broad test expansion, and storage abstraction).
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/**` style/policy files are absent.

## Master disposition map

Every aggregate finding is either scheduled here or recorded in `plan/plan-234-cycle3-rpf-deferred.md`.

| Finding | Original severity / confidence | Disposition |
|---|---:|---|
| AGG-C3-01 | MEDIUM / High | Scheduled: C3RPF-01 |
| AGG-C3-02 | MEDIUM / High | Deferred: D-C3RPF-01 |
| AGG-C3-03 | HIGH / High | Scheduled: C3RPF-02 |
| AGG-C3-04 | MEDIUM / High | Deferred: D-C3RPF-02 (pre-existing CSP deferral) |
| AGG-C3-05 | LOW / High | Scheduled: C3RPF-03 |
| AGG-C3-06 | MEDIUM / High | Scheduled: C3RPF-04 |
| AGG-C3-07 | MEDIUM / High | Scheduled: C3RPF-05 |
| AGG-C3-08 | MEDIUM / High | Scheduled: C3RPF-06 |
| AGG-C3-09 | MEDIUM / Medium-High | Scheduled: C3RPF-07 |
| AGG-C3-10 | HIGH / High | Deferred: D-C3RPF-03 |
| AGG-C3-11 | HIGH / High | Deferred: D-C3RPF-04 |
| AGG-C3-12 | HIGH / High | Deferred: D-C3RPF-05 |
| AGG-C3-13 | MEDIUM / High | Deferred: D-C3RPF-06 |
| AGG-C3-14 | MEDIUM / Medium | Deferred: D-C3RPF-07 |
| AGG-C3-15 | MEDIUM / Medium | Deferred: D-C3RPF-08 |
| AGG-C3-16 | MEDIUM / High | Deferred: D-C3RPF-09 |
| AGG-C3-17 | MEDIUM / Medium | Deferred: D-C3RPF-10 |
| AGG-C3-18 | HIGH / High | Deferred: D-C3RPF-11 (large schema/UI state-machine; prior broad test/runtime deferral policy) |
| AGG-C3-19 | HIGH / High | Deferred: D-C3RPF-12 (pre-existing single-process runtime deferral) |
| AGG-C3-20 | MEDIUM / High | Deferred: D-C3RPF-13 |
| AGG-C3-21 | MEDIUM / High | Scheduled: C3RPF-08 |
| AGG-C3-22 | MEDIUM / High | Scheduled: C3RPF-09 |
| AGG-C3-23 | LOW-MEDIUM / High | Scheduled: C3RPF-10 |
| AGG-C3-24 | MEDIUM / High | Deferred: D-C3RPF-14 |
| AGG-C3-25 | MEDIUM / High | Scheduled: C3RPF-11 |
| AGG-C3-26 | MEDIUM / High | Scheduled: C3RPF-12 |
| AGG-C3-27 | MEDIUM / High | Scheduled: C3RPF-13 |
| AGG-C3-28 | MEDIUM / High | Scheduled: C3RPF-14 |
| AGG-C3-29 | LOW-MEDIUM / High | Scheduled: C3RPF-15 |
| AGG-C3-30 | LOW / High | Deferred: D-C3RPF-15 |
| AGG-C3-31 | LOW / High | Deferred: D-C3RPF-16 |
| AGG-C3-32 | LOW-MEDIUM / High | Scheduled: C3RPF-16 |
| AGG-C3-33 | LOW / High | Deferred: D-C3RPF-17 |
| AGG-C3-34 | HIGH / High | Scheduled: C3RPF-17 |
| AGG-C3-35 | MEDIUM / High | Scheduled: C3RPF-18 |
| AGG-C3-36 | LOW / High | Scheduled: C3RPF-19 |

## Implementation tasks

### C3RPF-01 — Harden trusted proxy header parsing [AGG-C3-01]
- **Files:** `apps/web/src/lib/request-origin.ts`, `apps/web/src/__tests__/request-origin.test.ts`.
- **Fix:** when `TRUST_PROXY=true`, derive forwarded host/proto from the trusted right-most comma-separated hop instead of the left-most value; keep host/origin source parsing strict and add regression tests for spoofed multi-hop chains.
- **Status:** DONE.

### C3RPF-02 — Block destructive restore SQL and long split scanner bypasses [AGG-C3-03]
- **Files:** `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`.
- **Fix:** block `DROP TABLE`, `DELETE FROM`, and `TRUNCATE TABLE`; improve scanner window/state for long split dangerous constructs and add tests for exact destructive statements plus a >64 KiB split.
- **Status:** DONE.

### C3RPF-03 — Return generic public health details [AGG-C3-05]
- **Files:** `apps/web/src/app/api/health/route.ts`, `apps/web/src/__tests__/health-route.test.ts`.
- **Fix:** preserve HTTP status semantics for probes but return a generic body for public unauthenticated callers so restore/DB details are not disclosed.
- **Status:** DONE.

### C3RPF-04 — Align direct-photo SEO title and timestamp with visible/shared behavior [AGG-C3-06]
- **Files:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, tests if existing metadata helpers allow.
- **Fix:** use default `getPhotoDisplayTitle()` semantics for metadata and JSON-LD; format `publishedTime`/date fields as ISO strings like shared pages.
- **Status:** DONE.

### C3RPF-05 — Stop trusting `/api/og` label/site query params [AGG-C3-07]
- **Files:** `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, tests if present.
- **Fix:** remove public `label`/`site` rendering; derive label from slug and site from trusted config.
- **Status:** DONE.

### C3RPF-06 — Key cumulative upload quota by admin identity [AGG-C3-08]
- **Files:** `apps/web/src/app/actions/images.ts`, upload tracker tests if touched.
- **Fix:** authenticate once, use admin user ID plus client IP (or user ID alone if cleaner) as the upload-tracker key, and keep existing settlement semantics.
- **Status:** DONE.

### C3RPF-07 — Stabilize upload-relevant gallery config during uploads [AGG-C3-09]
- **Files:** `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/settings.ts`, messages/tests.
- **Fix:** snapshot gallery config for each upload action and pass quality/sizes into queue jobs; block output-size/GPS-stripping changes while local upload claims are active and after image rows exist where applicable.
- **Status:** DONE.

### C3RPF-08 — Clarify flat root-admin and single-instance/storage support docs [AGG-C3-19, AGG-C3-20, AGG-C3-21]
- **Files:** `README.md`, `CLAUDE.md`, possibly storage comments.
- **Fix:** state that current multi-user admin means multiple root admins (no roles), shipped deployment is single-instance/single-writer, and storage backend switching is not product-supported until wired end-to-end.
- **Status:** DONE.

### C3RPF-09 — Check affected rows for stale update mutations [AGG-C3-22]
- **Files:** `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/images.ts`.
- **Fix:** treat `affectedRows === 0` as not-found/concurrent-delete before audit/revalidation.
- **Status:** DONE.

### C3RPF-10 — Roll back share quota on deleted-photo race [AGG-C3-23]
- **File:** `apps/web/src/app/actions/sharing.ts`.
- **Fix:** call `rollbackShareRateLimitFull(ip, 'share_photo')` before returning `imageNotFound` from the refreshed-image missing branch.
- **Status:** DONE.

### C3RPF-11 — Complete search combobox/listbox semantics [AGG-C3-25]
- **File:** `apps/web/src/components/search.tsx`.
- **Fix:** use listbox/option roles and `aria-selected` for active rows while preserving link navigation.
- **Status:** DONE.

### C3RPF-12 — Keep topic labels visible with thumbnails [AGG-C3-26]
- **File:** `apps/web/src/components/nav-client.tsx`.
- **Fix:** render text label alongside the thumbnail instead of image-only pills.
- **Status:** DONE.

### C3RPF-13 — Improve admin responsive navigation/dashboard [AGG-C3-27]
- **Files:** `apps/web/src/components/admin-nav.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`.
- **Fix:** add clearer overflow/wrap cues and stack upload/image management until a wider breakpoint.
- **Status:** DONE.

### C3RPF-14 — Improve upload focus and no-topic empty state [AGG-C3-28]
- **File:** `apps/web/src/components/upload-dropzone.tsx`.
- **Fix:** add keyboard `focus-visible` treatment; disable or replace upload controls when no categories/topics exist.
- **Status:** DONE.

### C3RPF-15 — Announce dynamic loading/processing states [AGG-C3-29]
- **Files:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/components/optimistic-image.tsx`, `apps/web/src/components/image-manager.tsx`.
- **Fix:** add localized/accessibility-safe `role=status` / `aria-live=polite` where currently visual-only.
- **Status:** DONE.

### C3RPF-16 — Expose photo-viewer keyboard shortcuts [AGG-C3-32]
- **Files:** `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`.
- **Fix:** add `aria-keyshortcuts` and concise visible/tooltip hints where controls already exist.
- **Status:** DONE.

### C3RPF-17 — Thread Docker build-time env into Next build [AGG-C3-34]
- **Files:** `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, docs/tests if applicable.
- **Fix:** add build args and builder-stage ENV for `IMAGE_BASE_URL` and `UPLOAD_MAX_TOTAL_BYTES` so build-time Next config matches runtime env when provided.
- **Status:** DONE.

### C3RPF-18 — Await DB session bootstrap for pooled query/execute paths [AGG-C3-35]
- **Files:** `apps/web/src/db/index.ts`, `apps/web/src/__tests__/db-pool-connection-handler.test.ts`.
- **Fix:** ensure pool-level `query`/`execute` paths wait for connection initialization before running statements, not just explicit `getConnection()` callers.
- **Status:** DONE.

### C3RPF-19 — Align docs for configurable image sizes and init/runtime secrets [AGG-C3-36]
- **Files:** `CLAUDE.md`, `README.md`.
- **Fix:** describe configurable derivative sizes and split init-time DB/admin credentials from production runtime `SESSION_SECRET`.
- **Status:** DONE.

## Required gates

Run all configured gates against the whole repo before commit/push:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e`

Record gate errors/warnings fixed in the final cycle report.


## Completion evidence

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; known Edge-runtime static-generation warning remains recorded in `plan/cycle3-gate-warnings.md`.
- `npm run test` — passed (57 files / 333 tests).
- `npm run test:e2e` — passed (20 tests) after starting an isolated local MySQL 8.4 container matching `.env.local` credentials.

Archived after implementation in cycle 3/100.
