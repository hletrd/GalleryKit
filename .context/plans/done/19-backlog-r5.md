# Plan 19: Backlog — Round 5 (Low Priority) ✅ PARTIAL (Docker split, tsconfig, site-config volume, OG rate limit, e2e guard deferred)

**Priority:** P3 — Fix when convenient
**Sources:** All reviews, items too small or low-impact for dedicated plans, R5 review findings (H-06, M-10–M-13, L-07–L-12)

---

## Security

1. **Process.env leaked to child processes** — `db-actions.ts` spawns `mysqldump`/`mysql` with `env: { ...process.env, MYSQL_PWD }`. Pass only needed env vars: `PATH`, `HOME`, `MYSQL_PWD`, `LANG`, `LC_ALL`. Low risk (admin-only, local), but reduces attack surface.

2. **Restore temp file permissions** — `db-actions.ts` temp file is world-readable (0644 default). Set `umask(0o077)` or `chmod(0o600)` after writing. Contains full DB dump with password hashes.

3. **CSV formula injection** — `escapeCsvField` only prefixes formula characters at string start. Embedded `\n` could allow bypass (`foo\n=CMD`). Strip `\r` and `\n` from CSV fields, or prefix lines starting with formula chars after newline.

4. **Login catch block masks server errors** — `auth.ts` catch block returns "Invalid credentials" for all errors, including DB connection failures. Consider logging the real error while still returning a generic message to the client.

## Correctness

5. **Rate limit eviction not LRU** — `rate-limit.ts:69-78` evicts oldest-inserted entries, not least-recently-used. An active early-inserted IP gets evicted before a stale recent one. Fix: delete-and-reinsert on access, or use LRU Map.

6. **Rate limit delete+set not atomic** — `auth.ts:111-114` does `loginRateLimit.delete(ip)` then `loginRateLimit.set(ip)`. Between these, a concurrent request sees no entry. Since Node.js is single-threaded for sync code, this only matters if the intervening code yields. Low priority.

7. **RevokePhotoShareLink returns success for non-existent images** — `sharing.ts:114-126` returns `{ success: true }` when `affectedRows === 0`. Should return error or validate existence.

8. **Dashboard pagination `page` param not validated** — `dashboard/page.tsx` reads `page` from searchParams without validating it's a positive integer. `page=-1` or `page=abc` could cause issues.

## i18n

9. **Shared group page metadata hardcoded English** — `g/[key]/page.tsx:91,109` uses raw `"← "` Unicode arrow instead of a translation key. Some metadata strings are hardcoded English.

10. **Sitemap/robots locale variants** — Verify `sitemap.ts` generates locale-prefixed URLs for both `en` and `ko`. Verify `robots.ts` disallows locale-prefixed share/admin paths.

## Code Quality

11. **`adminExtraFields` exported but unused** — `data.ts:43-47` exports `adminExtraFields` which is never imported. Dead code.

12. **`displayTags` computed every render** — `home-client.tsx:175-178` computes `displayTags` O(n*m) without `useMemo`. Low impact with small tag counts.

13. **Statfs check only on original dir** — `images.ts:41-51` checks disk space on `UPLOAD_DIR_ORIGINAL` but not variant dirs. Unlikely to matter since all dirs share the same filesystem root.

## New from R5 Review

14. **Docker image build tools in runner stage** — H-06. Split `base` into `base-build` (python3/make/g++) and `base-runtime` (gosu/mariadb-client only). Reduces attack surface and image size by ~100MB.

15. **CLAUDE.md inaccurate documentation** — M-10. Update connection pool (10, not 8), upload limit (2GB, not 10GB), remove "100 files max" claim.

16. **Dead SQLite migration scripts** — M-11, M-12. Delete `migrate-sharing.ts` (bun:sqlite import), `migrate-sharing.js`, `migrate-exif.js`, `migrate-topic-image.ts`, `migrate-data.ts`. Remove `better-sqlite3` from devDependencies.

17. **Sitemap force-dynamic → ISR** — M-13. Change `export const dynamic = 'force-dynamic'` to `export const revalidate = 86400` (daily). Avoids expensive per-request DB query.

18. **`seed-admin.ts` logs partial Argon2 hash** — L-07. Remove hash value from log output.

19. **`tsconfig.json` excludes scripts/** — L-08. Create `tsconfig.scripts.json` for active scripts.

20. **`site-config.json` baked into Docker image** — L-09. Mount as volume in docker-compose.yml.

21. **OG image route no rate limiting** — L-10. Add lightweight rate limit or validate topic exists before rendering.

22. **`seed-e2e.ts` no environment guard** — L-11. Add `NODE_ENV === 'production'` check.

23. **`prebuild` script non-POSIX `cp -n`** — L-12. Use `test -f ... || cp ...` instead.

24. **`searchRateLimit` no hard eviction cap** — M-09. Already in Plan 14 item 9. Listed here for completeness.

25. **Admin loading.tsx missing role/aria-label** — L-15. Add `role="status"` and `aria-label`.

## Permanently Deferred

- **2FA/WebAuthn** — documented in CLAUDE.md. Not planned.
- **Full virtual masonry** — CSS content-visibility is sufficient.
- **Cursor-based pagination** — deferred to Plan 15 item 8; offset-based works for current gallery size.
- **Redis-based rate limiting** — MySQL-backed solution is implemented and sufficient.
