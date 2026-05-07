# Debugger — Cycle 39

## Review Scope

Latent bug surface, failure modes, edge cases, and potential regressions across the full codebase.

## New Findings

### DBG-39-01: `batchUpdateImageTags` remove path has same slug collision bug as fixed C38-01 [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/tags.ts` lines 309-318
- **Description:** The `removeTagFromImage` function was fixed in C38-01 to look up by exact tag name first, then fall back to slug. However, the remove loop inside `batchUpdateImageTags` (lines 309-318) still uses slug-only lookup: `const [tagRecord] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug))`. When two tags produce the same slug (e.g., "SEO" and "S-E-O"), this will remove the wrong tag-image association. This is the same root cause as C38-01 but in a different code path.
- **Failure scenario:** Admin uses the image manager to remove tag "SEO" from an image that has both "SEO" and "S-E-O" tags. The `batchUpdateImageTags` function derives slug "s-e-o" for "SEO", finds the "S-E-O" tag record (whichever was inserted first), and removes the wrong association.
- **Fix:** Apply the same name-first lookup pattern from `removeTagFromImage` to the remove loop in `batchUpdateImageTags`.

### DBG-39-02: `processImageFormats` unlink-before-link race window [LOW] [LOW confidence]
- **File:** `apps/web/src/lib/process-image.ts` lines 381-389
- **Description:** When creating the base filename for the 2048 size, the code does `await fs.unlink(basePath).catch(() => {})` before `await fs.link(outputPath, basePath)`. Between the unlink and the link, the base file doesn't exist, which could cause a 404 for a concurrent request. Since the processing queue has concurrency 1 and the base filename is unique (UUID-based), this is practically impossible but theoretically present.
- **Fix:** Write to a temp file and rename atomically.

### DBG-39-03: `admin-user-manager.tsx` form labels not connected to inputs [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/admin-user-manager.tsx` lines 93-98
- **Description:** Same as CR-39-03 — labels without `htmlFor`, inputs without `id`. This is a functional bug: clicking the label text does nothing rather than focusing the input.

## Previously Deferred Items Confirmed

No changes to previously deferred items.
