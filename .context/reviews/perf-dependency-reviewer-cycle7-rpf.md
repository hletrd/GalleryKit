# Perf / Dependency Review — Cycle 7 RPF

## Verdict

I reviewed the full Cycle 7 diff plus the adjacent hot-path support files that affect performance, concurrency, dependency posture, and framework/API assumptions.

Overall, the patch set is mostly a security/correctness cleanup, but I found:
- 1 confirmed performance regression on the public gallery infinite-scroll path
- 1 confirmed dependency risk in the committed lockfile / installed tree

## Inventory / coverage

### Changed files reviewed in `ff0d2f9`
- Workspace / tooling: `CLAUDE.md`, `package.json`, `apps/web/package.json`, `apps/web/playwright.config.ts`
- Public/admin pages: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- Server actions: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/admin-users.ts`
- Client components: `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/home-client.tsx`
- Core libs: `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/upload-paths.ts`
- Tests / guards: `apps/web/e2e/admin.spec.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/client-source-contracts.test.ts`, `apps/web/src/__tests__/content-security-policy.test.ts`, `apps/web/src/__tests__/images-actions.test.ts`, `apps/web/src/__tests__/locale-path.test.ts`, `apps/web/src/__tests__/public-actions.test.ts`, `apps/web/src/__tests__/rate-limit.test.ts`, `apps/web/src/__tests__/topics-actions.test.ts`
- Messages / i18n surface: `apps/web/messages/en.json`, `apps/web/messages/ko.json`

### Adjacent support files inspected for cross-file effects
I also traced the surrounding hot paths and support layers that those changes depend on, including the gallery data/accessor layer, upload/queue/storage helpers, revalidation, origin checks, and related runtime config. No relevant file in those supporting paths was skipped during the final sweep.

## Findings

### 1) Infinite-scroll pagination now pays a DB-backed rate-limit tax on every batch
**Severity:** Medium
**Status:** Confirmed
**Confidence:** High

**Files / regions**
- `apps/web/src/app/actions/public.ts:23-110`
- `apps/web/src/components/home-client.tsx:239-246`
- `apps/web/src/components/load-more.tsx:30-52, 68-84`

**Why this is a problem**
`loadMoreImages()` now does all of the following before it queries the next page of images:
- fetches request headers (`headers()`)
- derives the client IP (`getClientIp()`)
- increments the persistent rate-limit bucket
- performs a second DB-backed rate-limit check

That means the public gallery’s infinite-scroll path now pays extra latency and extra DB round-trips on top of the image query itself. The client component drives this automatically through an `IntersectionObserver`, so the overhead repeats as users scroll.

**Concrete failure scenario**
A mobile user browsing a gallery with many pages triggers multiple load-more requests while scrolling. Instead of one database read for the next image slice, each batch now includes additional rate-limit I/O. On a higher-latency database or under load, this shows up as slower scroll-to-content response and higher server pressure; under concurrency it also amplifies DB contention because the rate-limit writes happen on the same hot path as the content query.

**Suggested fix**
- Collapse the load-more limit into a single atomic operation instead of separate increment + check round-trips.
- Or keep load-more on the in-memory fast path and reserve the persistent DB rate-limit for rarer actions.
- If persistence must stay, at least avoid the second DB check after increment and use one query that returns the updated count.

**Confirmed vs likely**
This is confirmed by code path, not just a theoretical concern: the extra awaits are present in the hot path and the client automatically invokes it during scroll.

---

### 2) The committed lockfile still contains a vulnerable nested PostCSS copy under Next
**Severity:** Medium
**Status:** Confirmed
**Confidence:** High

**Files / regions**
- `package.json:7-10`
- `apps/web/package.json:45-66`
- `package-lock.json:8116-8120, 8566-8569`

**Why this is a problem**
The repo declares a root override for `postcss` at `^8.5.10`, and `apps/web/package.json` also requests `postcss ^8.5.10`. But the committed lockfile still contains a nested `node_modules/next/node_modules/postcss@8.4.31` entry alongside the direct `node_modules/postcss@8.5.10` entry.

That mismatch matters because `npm audit --omit=dev` still reports a moderate PostCSS advisory in the nested Next subtree. In other words, the repository state as committed is not fully aligned with the intended override, and the vulnerable copy remains reproducible from the lockfile.

**Concrete failure scenario**
A clean CI or production install that consumes the committed lockfile continues to materialize the vulnerable nested PostCSS copy inside Next. Any build-time CSS handling that flows through that subtree remains on the affected version until the lockfile is regenerated or Next is upgraded to a release that no longer pulls the vulnerable range.

**Suggested fix**
- Regenerate the lockfile after upgrading to a Next release that resolves the nested PostCSS copy.
- Re-run `npm audit --omit=dev` and confirm the nested `next/node_modules/postcss` entry is gone or upgraded.
- If the package manager/Next release still resists deduping, add the smallest compatible override or upgrade path that actually affects the nested subtree.

**Confirmed vs likely**
Confirmed: the vulnerable subtree is present in the committed lockfile, and `npm audit` reports the moderate advisory on that exact nested path.

## Final sweep / missed-file check

I did a final pass across the public gallery flow, admin mutations, upload/queue/storage helpers, SEO/OG metadata helpers, origin/rate-limit utilities, and the changed test/guard surface.

I did not find any additional performance or dependency issues that were strong enough to promote to findings, and I did not skip any relevant changed file in the Cycle 7 diff.
