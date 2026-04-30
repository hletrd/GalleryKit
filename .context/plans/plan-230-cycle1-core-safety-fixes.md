# Plan 230 — Cycle 1 Core Safety, Correctness, Performance, and Verification Fixes

**Status:** TODO
**Source review:** `.context/reviews/_aggregate.md`
**Scope:** Implement the high-signal core findings from AGG-01 through AGG-08, AGG-14 through AGG-17, AGG-22 through AGG-25, and AGG-34 through AGG-42. No finding in this plan is deferred; validation-only items are included with explicit exit criteria.

## Findings covered

| ID | Title | Severity | Confidence | Source citation |
| --- | --- | --- | --- | --- |
| AGG-01 | `getGalleryConfig()` has no DB fallback | HIGH | HIGH | `apps/web/src/lib/gallery-config.ts:33-39, 68-84` |
| AGG-02 | `lib/data.ts` mixes read helpers with lifecycle state | MEDIUM | HIGH | `apps/web/src/lib/data.ts:11-109, 594-669` |
| AGG-03 | `getSharedGroup()` hides a write contract | MEDIUM | HIGH | `apps/web/src/lib/data.ts:594-669` |
| AGG-04 | `image-queue.ts` bootstraps on import | MEDIUM | MEDIUM | `apps/web/src/lib/image-queue.ts:330-411` |
| AGG-05 | Deployment assumes one process owns queue/rate-limit state | MEDIUM | HIGH | `apps/web/src/lib/image-queue.ts:94-123, 164-187, 330-373`, `apps/web/src/lib/data.ts:11-109`, `apps/web/src/lib/rate-limit.ts:22-26, 101-149`, `apps/web/src/lib/restore-maintenance.ts:1-56` |
| AGG-06 | Production CSP still allows inline script execution | LOW | HIGH | `apps/web/next.config.ts:72-75` |
| AGG-07 | Public tag query parsing is unbounded | MEDIUM | MEDIUM | `apps/web/src/lib/tag-slugs.ts:3-19`, `apps/web/src/app/[locale]/(public)/page.tsx:18-33,104-120`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-43,95-132`, `apps/web/src/app/api/og/route.tsx:29-40` |
| AGG-08 | `BASE_URL` fallback can emit localhost site config in production | LOW | LOW | `apps/web/src/site-config.json:1-5`, `apps/web/src/lib/constants.ts:11-14`, `apps/web/src/lib/data.ts:883-890`, `apps/web/src/app/robots.ts:13-21`, `apps/web/src/app/sitemap.ts:8-12,19-55` |
| AGG-14 | Exact counts are computed on hot paths | MEDIUM | HIGH | `apps/web/src/lib/data.ts:253-276`, `apps/web/src/lib/data.ts:359-385`, `apps/web/src/app/[locale]/(public)/page.tsx:108-159`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:121-159`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:14-23` |
| AGG-15 | Deletes rescan upload directories once per file | MEDIUM | HIGH | `apps/web/src/lib/process-image.ts:165-204`, `apps/web/src/app/actions/images.ts:411-419, 517-535` |
| AGG-16 | Zoomed photo interaction reads layout on every move | LOW | MEDIUM | `apps/web/src/components/image-zoom.tsx:24-39, 86-95` |
| AGG-17 | Each admin tag combobox owns its own listener/filter work | LOW | MEDIUM | `apps/web/src/components/tag-input.tsx:45-56, 127-136, 159-220` |
| AGG-22 | Public infinite scroll uses offset pagination and a hard ceiling | HIGH | HIGH | `apps/web/src/app/actions/public.ts:23-40`, `apps/web/src/lib/data.ts:318-385`, `apps/web/src/components/load-more.tsx:29-41`, `apps/web/src/app/[locale]/(public)/page.tsx:118-120`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:130-133`, `README.md:31` |
| AGG-23 | No-op admin updates are misreported as “not found” | HIGH | HIGH | `apps/web/src/app/actions/images.ts:592-621`, `apps/web/src/app/actions/tags.ts:74-87`, `apps/web/src/app/actions/topics.ts:241-270` |
| AGG-24 | `group_concat_max_len` bootstrap is fire-and-forget | MEDIUM | HIGH | `apps/web/src/db/index.ts:28-51` |
| AGG-25 | Non-integer `image_sizes` can produce invalid descriptors | MEDIUM | HIGH | `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/components/photo-viewer.tsx` |
| AGG-34 | Download failures can be cacheable | MEDIUM | MEDIUM | `apps/web/src/app/api/admin/db/download/route.ts` |
| AGG-35 | Probe endpoints can be cached | LOW | MEDIUM | `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/health/route.ts` |
| AGG-36 | OG image route can cache 500s for too long | MEDIUM | MEDIUM | `apps/web/src/app/api/og/route.tsx` |
| AGG-37 | Visual E2E nav check lacks a baseline assertion | MEDIUM | HIGH | `apps/web/e2e/nav-visual-check.spec.ts:4-33` |
| AGG-38 | Origin-guard E2E can false-positive without authenticating the request | HIGH | HIGH | `apps/web/e2e/origin-guard.spec.ts:27-60` |
| AGG-39 | Critical auth/action surfaces lack runtime regression tests | HIGH | HIGH | `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts` |
| AGG-40 | Share-link / backup-restore / SEO write paths are only covered indirectly | MEDIUM | HIGH | `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/seo.ts` |
| AGG-41 | Queue / maintenance behavior still assumes a single-process owner | MEDIUM | HIGH | `apps/web/src/lib/image-queue.ts:94-123, 164-187, 330-373`, `apps/web/src/lib/data.ts:11-109`, `apps/web/src/lib/rate-limit.ts:22-26, 101-149`, `apps/web/src/lib/restore-maintenance.ts:1-56` |
| AGG-42 | Deployment/config fallback behavior still needs operator validation | LOW | LOW | `apps/web/src/site-config.json:1-5`, `apps/web/src/lib/constants.ts:11-14`, `apps/web/src/lib/data.ts:883-890`, `apps/web/src/app/robots.ts:13-21`, `apps/web/src/app/sitemap.ts:8-12,19-55` |

## Implementation tasks

### Task 1 — Restore public/config resilience and remove hidden lifecycle coupling [AGG-01, AGG-02, AGG-03, AGG-04, AGG-05]
**Files:**
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- any startup/entrypoint file needed for explicit queue bootstrap

**Changes:**
1. Catch gallery-config reads and return shared defaults when the DB is unavailable.
2. Split query helpers away from buffered view-count / flush lifecycle state.
3. Split the side-effecting `getSharedGroup()` path from read-only access.
4. Remove queue bootstrap from module import and move it to an explicit startup hook.
5. Keep the single-process contract explicit in code and docs if that remains the intended runtime model.

**Exit criterion:** Public rendering still works when `admin_settings` is unavailable, and importing read helpers does not start background queue work.

### Task 2 — Harden request/public-route inputs and cache semantics [AGG-06, AGG-07, AGG-08, AGG-34, AGG-35, AGG-36]
**Files:**
- `apps/web/next.config.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/site-config.json`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`

**Changes:**
1. Remove permissive inline-script allowance from the production CSP, or replace it with a nonce/hash strategy.
2. Bound tag parsing before splitting/filtering and cap the total work done per request.
3. Fail closed or loudly when the runtime falls back to localhost site config in production.
4. Mark download/probe/OG error paths as explicitly non-cacheable.

**Exit criterion:** Public query handling has bounded work, production metadata cannot silently advertise localhost, and error/probe routes do not cache stale failures.

### Task 3 — Make pagination and image mutation behavior deterministic [AGG-14, AGG-15, AGG-16, AGG-17, AGG-22, AGG-23, AGG-24, AGG-25]
**Files:**
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/db/index.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`

**Changes:**
1. Replace public offset pagination with a cursor/keyset model anchored to the existing sort tuple.
2. Stop rescanning the entire upload tree once per deleted image / format.
3. Reduce per-pointer-move layout reads in image zoom interactions.
4. Consolidate tag-input outside-click / filter work where practical.
5. Make no-op updates report success or no-op rather than “not found.”
6. Apply `group_concat_max_len` synchronously or make connection bootstrap fail closed.
7. Validate configured image sizes as integers before persisting or using them to build `srcset` / derivative names.

**Exit criterion:** Gallery pagination is stable under mutation, deletion paths avoid repeated directory scans, and config / DB bootstrap behavior is deterministic.

### Task 4 — Add direct regression coverage for the highest-risk flows [AGG-37, AGG-38, AGG-39, AGG-40]
**Files:**
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- new or existing test files under `apps/web/src/__tests__/`
- `apps/web/src/app/actions/{auth,settings,sharing,admin-users}.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/seo.ts`

**Changes:**
1. Replace screenshot-only visual checks with semantic or baseline assertions.
2. Make the origin-guard E2E hit the actual authenticated surface.
3. Add focused runtime tests for the critical auth / settings / sharing / admin-user branches.
4. Add end-to-end or integration coverage for share-link, backup/restore/CSV, and gallery/SEO write flows.

**Exit criterion:** The most failure-prone action paths are covered by tests that fail when the actual behavior regresses.

### Task 5 — Confirm deployment and scaling assumptions remain valid [AGG-41, AGG-42]
**Files:**
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `CLAUDE.md` and/or the relevant deploy/runbook docs if clarification is needed

**Changes:**
1. Validate that the runtime really remains single-process for queue and maintenance responsibilities.
2. Verify production startup semantics for `BASE_URL` / site config and document or enforce fail-closed behavior.

**Exit criterion:** The deployment contract matches the code’s real assumptions, or the mismatch is called out explicitly before any scaling changes.

## Deferred items
- None. All findings from this cycle are scheduled here.

## Progress
- [ ] Task 1 — Restore public/config resilience and remove hidden lifecycle coupling
- [ ] Task 2 — Harden request/public-route inputs and cache semantics
- [ ] Task 3 — Make pagination and image mutation behavior deterministic
- [ ] Task 4 — Add direct regression coverage for the highest-risk flows
- [ ] Task 5 — Confirm deployment and scaling assumptions remain valid

## Verification evidence
- Not run yet. This plan is implementation-only.
