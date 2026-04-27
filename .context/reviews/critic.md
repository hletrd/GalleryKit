# Critic — Cycle 1 Fresh Review (2026-04-27)

## Multi-Perspective Critique

Reviewed the full codebase with a skeptical eye, challenging assumptions and looking for systemic weaknesses that individual specialist reviews might miss.

---

## Findings

### C1-CT-01: In-memory rate-limit Maps create a restart-window attack opportunity
**File:** `apps/web/src/lib/rate-limit.ts:36-38`, `apps/web/src/app/actions/public.ts:38`
**Severity:** Medium | **Confidence:** High

All in-memory rate-limit Maps (`loginRateLimit`, `searchRateLimit`, `loadMoreRateLimit`, `ogRateLimit`, `passwordChangeRateLimit`) reset on process restart. While `loginRateLimit` and `searchRateLimit` have DB-backed persistence, the `loadMoreRateLimit` and `ogRateLimit` Maps are purely in-memory. An attacker who can trigger a server restart (e.g., by exploiting an unhandled error that crashes the process) gets a fresh rate-limit budget for all surfaces.

The DB-backed rate limits for login/search mitigate the worst case, but the load-more endpoint (120 requests/minute) has no persistence. A targeted restart attack could then scrape the entire gallery via load-more pagination.

**Fix:** Consider adding DB-backed persistence for `loadMoreRateLimit` similar to the login/search pattern, or at minimum document the restart-window risk.

---

### C1-CT-02: `uploadImages` does not validate MIME type of uploaded files
**File:** `apps/web/src/app/actions/images.ts:129`, `apps/web/src/lib/process-image.ts:227-265`
**Severity:** Low | **Confidence:** Medium

The upload flow validates file extension (`getSafeExtension`) and file size, but does not validate the MIME type reported by the browser (`file.type`). Sharp performs its own format detection when reading the file, so a mismatched MIME type would be caught by Sharp's metadata validation at line 260. However, the error message would be "Invalid image file" rather than a more specific "MIME type mismatch" error.

Additionally, `file.type` comes from the browser and is client-controlled, so relying on it would be unreliable anyway. The current defense (extension validation + Sharp format detection) is sufficient.

**Status:** Not a real vulnerability — Sharp's format detection is the authoritative check, and it runs unconditionally.

---

### C1-CT-03: `deleteImage` and `deleteImages` perform file cleanup outside the DB transaction
**File:** `apps/web/src/app/actions/images.ts:486-517,589-628`
**Severity:** Low | **Confidence:** Medium

File cleanup (unlink) happens after the DB transaction commits. If the process crashes between the transaction commit and file cleanup, orphaned files remain on disk. The reverse (DB delete fails but files are removed) is not possible because files are cleaned up only after the transaction succeeds. Orphaned files are a disk-space concern, not a data integrity concern. The `cleanOrphanedTmpFiles` bootstrap function handles a related class of orphans.

**Fix:** This is an accepted trade-off. The alternative (deleting files before DB commit) risks data loss if the transaction fails. The current approach is correct. Consider adding a periodic orphan-cleanup job for variant files that have no corresponding DB row.

---

### C1-CT-04: `en.json` / `ko.json` uncommitted changes are UI text only — no security impact
**File:** `apps/web/messages/en.json`, `apps/web/messages/ko.json`
**Severity:** Info | **Confidence:** High

The uncommitted changes in `en.json` and `ko.json` are phrasing simplifications (e.g., "Adds a full-access root administrator..." to "Creates a full-access root admin..."). These are purely cosmetic text changes with no functional or security impact.

**Status:** No action needed — cosmetic changes only.

---

### C1-CT-05: `processImageFormats` atomic rename fallback chain is complex
**File:** `apps/web/src/lib/process-image.ts:437-452`
**Severity:** Low | **Confidence:** Medium

The atomic rename path for the base filename has a 3-level fallback chain:
1. `link` + `rename` (hard link + atomic rename)
2. `copyFile` + `rename` (copy + atomic rename)
3. `copyFile` (direct copy, non-atomic)

The final fallback (direct `copyFile`) re-introduces the window where the base filename doesn't exist, which is what the atomic rename was trying to avoid. This only happens if both `link` and `rename` fail, which would indicate a severe filesystem issue (e.g., cross-device, permissions). The `.tmp` file cleanup in the `finally` block is best-effort.

**Fix:** Document the fallback chain and its trade-offs. The likelihood of reaching fallback 3 is extremely low (only on severely broken filesystems), and the consequence is a brief 404 on the base filename during processing.

---

### C1-CT-06: No explicit limit on `description` field for `images.description` column
**File:** `apps/web/src/app/actions/images.ts:696-698`
**Severity:** Low | **Confidence:** High

```ts
if (sanitizedDescription && sanitizedDescription.length > 5000) {
    return { error: t('descriptionTooLong') };
}
```

The `description` column in the schema is `text("description")` which can hold up to 65,535 bytes in MySQL. The application limits it to 5,000 characters. This is a reasonable limit, but there's no documentation of why 5,000 was chosen. The `title` column is `varchar(255)` and limited to 255 characters, which matches the schema. The `description` limit of 5,000 is well within the `TEXT` column capacity but far below the maximum.

**Status:** Not a real issue — the 5,000 character limit is reasonable for a photo description.

---

### C1-CT-07: `pruneRetryMaps` eviction is first-insertion-order, not least-recently-used
**File:** `apps/web/src/lib/image-queue.ts:74-85`
**Severity:** Low | **Confidence:** Medium

```ts
for (const key of map.keys()) {
    if (evicted >= excess) break;
    map.delete(key);
    evicted++;
}
```

The eviction iterates `Map.keys()` in insertion order and deletes the oldest entries. This is FIFO eviction, not LRU. If a low-id job that has been retried recently is at the head of the Map, it gets evicted even though it was recently accessed. With `MAX_RETRY_MAP_SIZE = 10000` and a single-writer topology, this is unlikely to matter in practice.

**Fix:** For personal-gallery scale, FIFO eviction is acceptable. If the gallery grows, consider LRU eviction using a `delete` + `set` pattern to move recently-accessed entries to the end of iteration order.
