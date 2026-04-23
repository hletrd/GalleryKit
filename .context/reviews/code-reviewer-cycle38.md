# Code Review — Cycle 38 (2026-04-19)

## Reviewer: code-reviewer
## Scope: Full codebase — code quality, logic, SOLID, maintainability

### File Inventory
- apps/web/src/app/actions/ (auth.ts, images.ts, topics.ts, tags.ts, sharing.ts, admin-users.ts, public.ts)
- apps/web/src/lib/ (session.ts, rate-limit.ts, auth-rate-limit.ts, data.ts, process-image.ts, image-queue.ts, serve-upload.ts, sql-restore-scan.ts, validation.ts, audit.ts, api-auth.ts, etc.)
- apps/web/src/db/schema.ts
- apps/web/src/proxy.ts
- apps/web/src/components/ (photo-viewer.tsx, image-manager.tsx, home-client.tsx, nav-client.tsx, upload-dropzone.tsx, etc.)
- apps/web/src/app/[locale]/ (pages, layouts, routes)
- apps/web/src/app/api/ (health, og, admin/db/download)

### Findings

**Finding CR-38-01: `flushGroupViewCounts` re-buffers failed increments without bound**
- **File**: `apps/web/src/lib/data.ts` lines 46-62
- **Severity**: MEDIUM | **Confidence**: HIGH
- **Description**: When `db.update()` fails in `flushGroupViewCounts`, the catch block re-buffers the failed increment back into `viewCountBuffer`. If the DB is persistently down, the buffer will keep re-buffering the same failed increments every flush cycle, with `consecutiveFlushFailures` only increasing the interval but never dropping data. This is a known deferred item (C30-03/C36-03) but remains a real concern: a prolonged DB outage could cause the buffer to fill up and drop new view counts while old ones keep cycling.
- **Fix**: Add a per-entry retry counter to buffered increments; after N failed flushes for the same groupId, drop the increment with a warning log.

**Finding CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU**
- **File**: `apps/web/src/app/actions/images.ts` lines 27-44
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The `pruneUploadTracker()` function evicts the oldest entries by Map insertion order when the hard cap is exceeded. A burst of uploads from one IP could evict entries from an active user who started earlier. This is a known deferred item (C32-03) and the practical impact is low (2000-key cap is generous).
- **Fix**: Use an LRU eviction strategy or evict entries with the oldest `windowStart` timestamp.

**Finding CR-38-03: `removeTagFromImage` uses slug-based lookup that can match wrong tag**
- **File**: `apps/web/src/app/actions/tags.ts` lines 151-181
- **Severity**: MEDIUM | **Confidence**: MEDIUM
- **Description**: `removeTagFromImage` derives a slug from `tagName` and looks up the tag by slug. If two tags with different names produce the same slug (slug collision), this will remove the wrong tag-image association. The `addTagToImage` function already warns about slug collisions, but `removeTagFromImage` silently removes by slug, potentially removing the wrong tag.
- **Scenario**: Admin adds tags "SEO" and "S-E-O" (both slug to "s-e-o"). Adding "SEO" warns about collision. Removing "S-E-O" would actually remove the "SEO" tag association since both share the same slug.
- **Fix**: Look up by tag name first (exact match), and only fall back to slug if no name match is found. Or use the tag ID instead of name for removal.

**Finding CR-38-04: `createGroupShareLink` doesn't validate `insertId` before using it**
- **File**: `apps/web/src/app/actions/sharing.ts` lines 162-169
- **Severity**: MEDIUM | **Confidence**: HIGH
- **Description**: After inserting a `sharedGroup`, the code does `Number(result.insertId)` and uses it as `groupId` for the `sharedGroupImages` insert. The Drizzle MySQL driver returns `insertId` as `BigInt` on 64-bit systems. While the code does `Number(result.insertId)`, the subsequent `Number.isFinite(groupId)` check would pass even for very large BigInt values that lose precision during the `Number()` coercion. This is a known deferred item (C30-04/C36-02).
- **Fix**: Use `BigInt` comparison or validate that `insertId` is within the safe integer range before coercion.

**Finding CR-38-05: `db-actions.ts` `restoreDatabase` env passthrough is overly broad**
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 121, 313
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: The `spawn` calls for `mysqldump` and `mysql` pass `PATH`, `HOME`, `NODE_ENV`, `MYSQL_PWD`, `LANG`, `LC_ALL` to the child process. While `MYSQL_PWD` is correctly used instead of the `-p` flag (avoiding the password in process arguments), `HOME` could be used by mysqldump to locate configuration files (`~/.my.cnf`) that might override connection parameters. In a Docker container this is less risky, but in a development or bare-metal deployment, a malicious `~/.my.cnf` could redirect the dump.
- **Fix**: Consider passing only the minimal required env vars, or document the security assumption.

**Finding CR-38-06: `photo-viewer.tsx` uses `image.filename_jpeg.replace(/\.jpg$/i, '_640.jpg')` without null-safety**
- **File**: `apps/web/src/components/photo-viewer.tsx` line 488
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The `Histogram` component receives `imageUrl(...)` with `image.filename_jpeg?.replace(...)`. If `filename_jpeg` is somehow null/undefined (shouldn't happen in practice due to DB schema constraints), the optional chain would result in `imageUrl(undefined)`, which would produce an invalid URL. The `imageUrl` function doesn't handle `undefined` input.
- **Fix**: Add a null guard before passing to `Histogram`, or validate in `imageUrl`.

**Finding CR-38-07: `home-client.tsx` reorderForColumns may miss items in edge cases**
- **File**: `apps/web/src/components/home-client.tsx` lines 13-77
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: The `reorderForColumns` function has a fallback at lines 66-74 that appends missed items. This is defensive but suggests the main algorithm can produce gaps. The issue is that `cssColSizes` determines how many items CSS columns expect per column, but `columns[col].items` may have fewer items than `cssColSizes[col]` if the greedy distribution produced fewer items than expected. This is a theoretical edge case that would only manifest with very small arrays (1-2 items) and multiple columns.
- **Fix**: Add a unit test for edge cases (1 item, 2 items with 4 columns, etc.).

### Review Coverage
All server actions, middleware, data layer, image processing pipeline, auth/session management, rate limiting, upload security, DB schema, admin pages, public pages, API routes, frontend components, validation, audit logging, i18n.
