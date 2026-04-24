# code-reviewer — cycle 2 rpl

HEAD: `00000006e` (post cycle 1 rpl).

## Scope
Reviewed full server-action surface (`apps/web/src/app/actions/*.ts`), middleware (`proxy.ts`), auth library (`lib/session.ts`, `lib/rate-limit.ts`, `lib/request-origin.ts`), image pipeline (`lib/process-image.ts`, `lib/image-queue.ts`), admin UI (`admin-nav.tsx`, seo-client, settings-client, image-manager), API routes, and the db-actions restore/backup path.

## Findings

### CR2R-01 — `updatePassword` lacks `unstable_rethrow` on its outer catch
- **Citation:** `apps/web/src/app/actions/auth.ts:382-393`.
- **Severity / confidence:** MEDIUM / HIGH.
- **Why it matters:** the `login` path in the same file (`auth.ts:218,223`) correctly calls `unstable_rethrow(e)` before returning the generic error. `updatePassword`'s outer catch swallows *all* errors — including internal Next.js control-flow signals (e.g., `NEXT_REDIRECT`, `NEXT_NOT_FOUND`, rendering abort) that Next.js expects to propagate. If an internal signal is ever thrown from `db.transaction`, `getCurrentUser`, `logAuditEvent`, or a downstream await inside the `try`, the user will see the generic "failed to update password" toast instead of the redirect.
- **Failure scenario:** a future revision adds a `redirect(...)` after the transaction commits (e.g., to re-auth after password change) or `notFound()` is rethrown by `getCurrentUser` under race; the user lands on a generic error page with a silently-rolled-back counter instead of the intended redirect.
- **Fix:** add `unstable_rethrow(e);` as the first line of the outer `catch (e)` block at line 382, mirroring the login path.

### CR2R-02 — Same-origin provenance is NOT enforced on mutating server actions outside `auth.ts`
- **Citation:** grep shows `hasTrustedSameOrigin` imported only in `apps/web/src/app/actions/auth.ts:19`. All other mutating actions (`admin-users.ts`, `images.ts`, `tags.ts`, `topics.ts`, `sharing.ts`, `seo.ts`, `settings.ts`, `[locale]/admin/db-actions.ts`) rely on `isAdmin()` alone.
- **Severity / confidence:** MEDIUM / MEDIUM.
- **Why it matters:** while Next.js server actions include a framework-level CSRF guard, the repo already admits (C1R-01 + AGG1R-11/D1-02) that the auth path needs a belt-and-suspenders check. Mutations like `deleteImage`, `deleteTopic`, `updateSeoSettings`, `restoreDatabase`, `createAdminUser` are equally privileged and have no explicit provenance check. The admin-only `lint:api-auth` gate wraps API routes with `withAdminAuth`, but server actions bypass that path entirely.
- **Failure scenario:** a CSRF bypass via a reflected `Origin`/`Referer` injection, a stale/loosened framework default, or a misconfigured reverse proxy could let an authenticated admin's browser be coerced into issuing a `deleteImages` / `restoreDatabase` action on a crafted page.
- **Fix:** extract a helper `requireSameOrigin(t)` that reuses `hasTrustedSameOrigin(headers)` and returns `{ error: t('unauthorized') }` on failure; call it on every mutating action after the `isAdmin()` check. Add a test asserting the helper runs on each entry point. This is exactly the carry-forward D1-02, now bumped with an explicit call path.

### CR2R-03 — `admin-nav.tsx` horizontally overflows on narrow viewports without visible scroll affordance
- **Citation:** `apps/web/src/components/admin-nav.tsx:27` (`overflow-x-auto scrollbar-hide`).
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** `scrollbar-hide` removes the default scrollbar and the nav has no fade/gradient on the right edge, so on narrow viewports (admin mobile) later items (`users`, `db`) are discoverable only by horizontal swipe with no visual hint. This duplicates the earlier D1-03 deferral but is worth re-confirming here — admin content is already operator-only so the visual nit remains low severity.
- **Fix:** leave deferred as D1-03, or add a fade mask (`[mask-image:linear-gradient(...)]` or `before/after` shadows) as a small purely-CSS change.

### CR2R-04 — `uploadImages` returns `replaced: []` without documenting that it is always empty
- **Citation:** `apps/web/src/app/actions/images.ts:323-328`.
- **Severity / confidence:** LOW / HIGH.
- **Why it matters:** the returned object declares `replaced: []` unconditionally, and no caller checks for non-empty `replaced`. This is dead shape left from an earlier de-dup feature. Keeping it breeds confusion — a new contributor assumes the server may report replaced originals, which is not wired end-to-end.
- **Fix:** remove `replaced` from the return shape in a follow-up cleanup cycle; deferrable.

### CR2R-05 — Duplicate in-memory rate-limit maps — similar maintenance shape across four files
- **Citation:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/sharing.ts:24-76`, `apps/web/src/app/actions/admin-users.ts:22-54`, `apps/web/src/app/actions/images.ts:63-80` (upload tracker).
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** each file owns a parallel Map + prune + pre-increment + rollback implementation. There is an existing deferred plan (142) for consolidation; current HEAD still carries all four.
- **Fix:** refactor into a single generic utility — already tracked as deferred, no new plan item needed.

### CR2R-06 — CSV export builds the full string in memory for up to 50,000 rows
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:41-105`.
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** already tracked as `D6-05` (streaming CSV). Unchanged this cycle.

## Summary
Two new meaningful findings (CR2R-01, CR2R-02) + three re-confirmations of pre-existing deferred items.
