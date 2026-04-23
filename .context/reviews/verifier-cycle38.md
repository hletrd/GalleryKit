# Verifier Review — Cycle 38 (2026-04-19)

## Reviewer: verifier
## Scope: Evidence-based correctness check against stated behavior

### Verification Targets
1. Auth flow: login, logout, session management, password change
2. Upload flow: upload, process, serve
3. Rate limiting: login, search, upload, share, password change
4. Privacy: GPS coordinates excluded from public queries
5. Sharing: photo share links, group share links
6. Admin: user management, topic management, tag management

### Findings

**Finding VER-38-01: `removeTagFromImage` removes by slug, not by exact tag name**
- **File**: `apps/web/src/app/actions/tags.ts` lines 159-181
- **Severity**: MEDIUM | **Confidence**: HIGH
- **Verification**: Reading the code: `const slug = getTagSlug(cleanName)` then `db.select().from(tags).where(eq(tags.slug, slug))`. This selects the tag by slug, not by name. If two tags share the same slug (collision), the wrong tag's image association could be removed. The stated behavior is "remove a tag from an image" — but the actual behavior is "remove the tag that matches the slug derived from the given name from the image". This is a correctness gap.
- **Fix**: Look up by name first (`eq(tags.name, cleanName)`), fall back to slug only if no name match.

**Finding VER-38-02: `searchImages` does not rate-limit via DB-backed check**
- **File**: `apps/web/src/app/actions/public.ts` lines 24-98
- **Severity**: LOW | **Confidence**: HIGH
- **Verification**: The `searchImagesAction` function does: (1) in-memory Map prune, (2) in-memory check, (3) in-memory pre-increment, (4) DB check via `checkRateLimit`, (5) DB increment via `incrementRateLimit`. If the DB check at step 4 shows limited, the in-memory counter is rolled back. This is correct. If the DB increment at step 5 fails, the in-memory counter is also rolled back. This is correct. The search rate limiting is properly implemented with DB-backed accuracy.

**Finding VER-38-03: `getImage` prev/next navigation queries may return wrong results when capture_date is NULL**
- **File**: `apps/web/src/lib/data.ts` lines 334-394
- **Severity**: LOW | **Confidence**: MEDIUM
- **Verification**: The prev/next queries handle NULL capture_date with explicit `image.capture_date ? ... : sql\`...\`` conditions. For the "prev" query (newer image): when capture_date is NULL, it uses `sql\`${images.capture_date} IS NOT NULL\`` — meaning all dated images are considered "newer". For the "next" query (older image): when capture_date is NULL, it uses `sql\`FALSE\`` — meaning there are no older images by capture_date, only created_at/id tiebreakers. This matches the MySQL DESC sort order where NULLs sort last. The logic is correct.

### Summary
One correctness gap found (VER-38-01: removeTagFromImage removes by slug instead of name). All other verified behaviors match their stated intent.
