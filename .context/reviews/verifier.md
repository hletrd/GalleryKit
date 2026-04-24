# Verifier review — cycle 1

## Inventory reviewed
I swept the repo surface that affects stated behavior and user-visible correctness:
- Docs and contracts: `README.md`, `CLAUDE.md`, `AGENTS.md`
- Public render paths: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/*`
- Public paging and gallery data: `apps/web/src/lib/data.ts`, `apps/web/src/components/load-more.tsx`, `apps/web/src/app/actions/public.ts`
- Gallery settings and metadata: `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/data.ts` (`getSeoSettings`)
- Persistence and DB bootstrap: `apps/web/src/db/index.ts`
- Admin mutation actions: `apps/web/src/app/actions/images.ts`, `tags.ts`, `topics.ts`
- Related security / utility code reviewed for cross-file effects: auth, rate limiting, request origin, storage, upload, revalidation, and tests

## Findings

### 1) Public infinite scroll is built on offset pagination, so it can duplicate/skip items and hits a hard 10k ceiling
**Files / regions**
- `apps/web/src/app/actions/public.ts:23-40`
- `apps/web/src/lib/data.ts:318-335`, `359-385`
- `apps/web/src/components/load-more.tsx:29-41`
- `apps/web/src/app/[locale]/(public)/page.tsx:118-120`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:130-133`
- `README.md:31`

**Why this is a problem**
The public gallery is documented as having “infinite scroll” (`README.md:31`), but the actual implementation pages through a mutable dataset using offset/limit. The query order is by `capture_date`, `created_at`, and `id`, yet new uploads or deletions can shift every later offset between requests. The client increments `offset` blindly after each batch, so it has no protection against reordering between pages. In addition, `loadMoreImages()` returns early once `safeOffset > 10000`, which makes older content unreachable even if the user keeps scrolling.

**Concrete failure scenario**
A visitor scrolls to page 8 of the home feed. While they are reading, an admin uploads or deletes a photo near the top. The next `loadMoreImages()` request now starts from a different offset than the one the client expects, so some cards are repeated and others are skipped. If the gallery is large enough to push past the 10,000-offset cutoff, scrolling simply stops loading older items at all.

**Suggested fix**
Switch the public feed to cursor/keyset pagination using the existing sort tuple (`capture_date`, `created_at`, `id`) so the next page is anchored to the last seen row instead of a numeric offset. If a DoS guard is still needed, cap the cursor window or request rate rather than imposing a fixed 10k offset ceiling.

**Confidence**: High

---

### 2) No-op UPDATEs are reported as “not found” in admin edit flows
**Files / regions**
- `apps/web/src/app/actions/images.ts:592-610`
- `apps/web/src/app/actions/tags.ts:74-80`
- `apps/web/src/app/actions/topics.ts:242-257`

**Why this is a problem**
Each action first verifies the row exists, then performs an UPDATE and treats `affectedRows === 0` as a missing record. In MySQL, an UPDATE that writes the same values back can legitimately return zero affected rows even when the row exists. That means a valid admin action can be misclassified as “not found.”

**Concrete failure scenario**
An admin opens a photo, tag, or topic edit form and submits without changing any values. The pre-read finds the record, but the UPDATE is a no-op, so `affectedRows` is `0` and the UI shows `imageNotFound`, `tagNotFound`, or `topicNotFound`. The same false error can appear whenever normalization results in values identical to what is already stored.

**Suggested fix**
Trust the pre-read existence check and stop treating `affectedRows === 0` as a missing row. If the code needs to distinguish “matched but unchanged” from “missing,” inspect the MySQL result’s matched/changed semantics instead of using `affectedRows` as a proxy for existence.

**Confidence**: High

---

### 3) `getGalleryConfig()` has no database fallback, so transient `admin_settings` failures can take down public pages
**Files / regions**
- `apps/web/src/lib/gallery-config.ts:33-39`, `68-84`
- `apps/web/src/lib/data.ts:870-891` (`getSeoSettings()` fallback pattern)
- `apps/web/src/app/[locale]/layout.tsx:73-76`
- `apps/web/src/app/[locale]/(public)/page.tsx:64-67`, `104-120`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:122-133`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-35`, `89-94`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:34-40`, `89-95`

**Why this is a problem**
`getSeoSettings()` already catches DB read failures and falls back to `site-config.json` defaults (`apps/web/src/lib/data.ts:870-891`). `getGalleryConfig()` does not: `getSettingsMap()` throws directly, and every public page that depends on the config will fail if `admin_settings` is temporarily unavailable or locked. That makes a recoverable metadata/config outage turn into a user-facing page failure.

**Concrete failure scenario**
The database briefly locks `admin_settings` during maintenance or a restore. The homepage, topic pages, and shared pages all call `getGalleryConfig()`, so they throw before rendering even though they could have used default image sizes and GPS settings. Visitors see a 500 instead of a degraded-but-functional gallery.

**Suggested fix**
Mirror the SEO settings pattern: wrap the DB read in `try/catch`, log a warning, and return `getSettingDefaults()`-based values when the table cannot be read. That preserves public rendering while still surfacing the outage for operators.

**Confidence**: High

---

### 4) The `group_concat_max_len` bootstrap is fire-and-forget, so the first pooled query can still run with the default 1024-byte limit
**Files / regions**
- `apps/web/src/db/index.ts:28-51`

**Why this is a problem**
The pool’s `connection` handler starts `SET group_concat_max_len = 65535` through an async Promise and immediately returns. That means the pool does not wait for the session variable to be applied before the connection becomes usable. On a fresh pool connection, the first query can therefore execute before the limit is raised, which reintroduces the default 1024-byte `GROUP_CONCAT` ceiling the code is trying to avoid.

**Concrete failure scenario**
A new pooled connection is created right before a CSV export, tag aggregation, or SEO-related query that relies on `GROUP_CONCAT`. If the query wins the race against the async `SET`, the result is truncated output even though no error is raised.

**Suggested fix**
Make the session initialization synchronous from the caller’s point of view: either use a connection-init path that completes before the connection is released to the pool, or explicitly await a setup step before the pool is allowed to serve requests. If that is not possible with the current hook, destroy/retry connections that have not yet had the session variable confirmed.

**Confidence**: Medium

## Notes
- I did not file any additional correctness issues that were only speculative or already marked as intentional deferred tradeoffs elsewhere in the repo.
- No implementation changes were made in this cycle; this file is the review artifact.
