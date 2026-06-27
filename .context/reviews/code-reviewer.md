# cycle 17 / HEAD 7b5c1943 — Code-Reviewer findings

## Scope

Cycle-17 deep code-quality pass (logic bugs, SOLID, maintainability, error handling,
edge cases, data-flow/state consistency). Priority: verify cycle-16 commits landed
correctly and completely; secondary: broad sweep of actions/**, lib/**, api/**,
components/**.

---

## Files Reviewed

| Area | Files |
|------|-------|
| Actions | `images.ts`, `topics.ts`, `tags.ts`, `settings.ts`, `seo.ts`, `sharing.ts`, `public.ts` |
| Lib | `bounded-map.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `og-photo-fetch.ts`, `upload-tracker.ts`, `image-queue.ts`, `smart-collections.ts`, `view-retention.ts`, `settings-hash.ts` |
| Migration | `migrate.js`, `0024_drop_reactions.sql`, `meta/_journal.json` |
| Components | `color-details-section.tsx`, `lightbox-color-pip.tsx`, `photo-viewer.tsx`, `info-bottom-sheet.tsx` |
| API routes | `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts` (privacy guard) |
| Tests | `search-route-privacy.test.ts`, `process-image-metadata.test.ts`, `migrate-reconcile-coverage.test.ts`, `settings-hash.test.ts`, `bounded-map.ts` |

---

## Code Review Summary

**Files Reviewed:** ~30 core files plus supporting tests
**Total Issues:** 1
**Severity Breakdown:**
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 1

---

## Issues

### [LOW] Upload tracker claim leaks on unexpected DB exception at topic existence check

**File:** `apps/web/src/app/actions/images.ts:256`
**Confidence:** HIGH

**Issue:** The upload quota claim is made synchronously at lines 226-228 (before any
`await`, correctly closing the TOCTOU). However, the DB query at line 256 that checks
topic existence sits OUTSIDE any try/catch:

```js
// line 226-228 — claim is live from here
uploadTracker.set(uploadTrackerKey, tracker);

// ...line 233-251: inner try/catch handles disk-space check, settles on error

// line 256 — NO try/catch around this await
const [topicRow] = await db.select({ slug: topics.slug })
    .from(topics)
    .where(eq(topics.slug, topic))
    .limit(1);
if (!topicRow) {
    settleUploadTrackerClaim(..., 0, 0);   // controlled path: fine
    return { error: t('topicNotFound') };
}
```

If the DB connection drops or MySQL throws unexpectedly at line 256, the exception
propagates to the outer `try` (line 175). The `finally` at line 561 releases only
`uploadContractLock` — it does NOT call `settleUploadTrackerClaim`. The claim remains
"pending" until the window expires naturally.

**Concrete failure scenario:** A transient DB hiccup on a busy upload window causes the
`db.select()` at line 256 to throw. The user is shown an unhandled server error; their
upload quota is over-debited for the window duration (typically 60s or per
`UPLOAD_WINDOW_MS`).

**Severity rationale:** LOW — the claim is time-bounded (self-heals on window expiry).
DB connection errors at this specific point are rare in practice. No data loss or
security impact.

**Suggested fix:** Wrap lines 256-263 in a try/catch that settles on throw, or add a
`settled` boolean flag to the `finally` block to call `settleUploadTrackerClaim` if
not yet settled:

```js
// Option A: wrap the topic DB check
let topicRow: { slug: string } | undefined;
try {
    [topicRow] = await db.select({ slug: topics.slug })
        .from(topics)
        .where(eq(topics.slug, topic))
        .limit(1);
} catch (err) {
    settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, 0, 0);
    throw err;
}
```

---

## Cycle-16 Verification Results (all PASS)

### DBG-16-01 — topic_views updated in slug-rename transaction

`apps/web/src/app/actions/topics.ts:292`

Confirmed: The slug-rename transaction at lines 250-323 follows the correct
"insert new slug / re-point FK children / delete old slug" order:
1. Line 276: `INSERT INTO topics` with new slug first (prevents FK violation)
2. Line 283: `UPDATE images SET topic = newSlug`
3. Line 284: `UPDATE topicAliases SET topicSlug = newSlug`
4. Line 292: `UPDATE topicViews SET topic = newSlug` ← the DBG-16-01 fix
5. Lines 301-319: `smart_collections` JSON remapping (DBG-16-03)
6. Line 321: `DELETE FROM topics WHERE slug = oldSlug` (last, after all FK children moved)

All three FK children of `topics.slug` are covered. No "fix one sibling, miss the
next" regression here.

### CR-16-01 — Upload tracker TOCTOU closed

`apps/web/src/app/actions/images.ts:226-228`

Confirmed: The synchronous `uploadTracker.set(uploadTrackerKey, tracker)` claim at
lines 226-228 occurs BEFORE the first `await` (the disk-space `statfs` at line 235).
Two concurrent cold-IP requests share the same object reference and serialize quota
checks correctly. The LOW issue above (line 256 ungarded DB query) is a separate,
narrower gap that the CR-16-01 fix intentionally did not address.

### DBG-16-02 — OG photo Content-Length finite guard

`apps/web/src/lib/og-photo-fetch.ts:61-63`

Confirmed: The `Number.isFinite(len)` guard correctly rejects non-numeric
`Content-Length` headers (e.g., `"chunked"`, `""`) that would have produced `NaN`,
causing the pre-check `NaN > OG_PHOTO_MAX_BYTES` to silently pass. The post-buffer cap
at line 66 remains as defense-in-depth.

### DBG-16-03 — smart_collections JSON remapping on slug rename

`apps/web/src/app/actions/topics.ts:301-319` + `apps/web/src/lib/smart-collections.ts:remapTopicSlugInQuery`

Confirmed: `remapTopicSlugInQuery` correctly handles `eq` and `in` topic predicates,
recurses into `and`/`or` groups, and deliberately skips `contains` (substring filters
are not identity references — correct by design). The smart-collection remap runs
inside the rename transaction.

### PERF-16-01 — Bootstrap config reads consolidated in image-queue.ts

`apps/web/src/lib/image-queue.ts`

Confirmed: Bootstrap jobs (no `quality`/`imageSizes`) resolve `resolvedSemanticMode`
once from the bootstrap config read and store it in a closure variable; the embedding
IIFE reuses it via `let semanticMode = resolvedSemanticMode ?? 'disabled'` without a
second DB SELECT. Normal upload jobs (with `quality`/`imageSizes` set) still fetch
`semanticMode` separately in the IIFE — correct because they bypass the bootstrap config
path.

### Bit_depth + isP3Pipeline admin gating — all 4 UI components

Confirmed for each component:
- `color-details-section.tsx:481` — `bit_depth` gated `{isAdmin && ...}`
- `color-details-section.tsx:570` — `isHdr` gated `{isAdmin && isHdr && ...}`
- `lightbox-color-pip.tsx:83` — `isHdr = isAdmin && (tf === 'pq' || tf === 'hlg')`
- `lightbox-color-pip.tsx:196,202` — `transfer_function`, `color_pipeline_decision` each gated `{isAdmin && ...}`
- `photo-viewer.tsx:890` — `bit_depth` gated `{isAdmin && hasExifData(image.bit_depth) && ...}`
- `photo-viewer.tsx:961` — `isP3Pipeline` gated `{isAdmin && isP3Pipeline(image.color_pipeline_decision) ...}`
- `info-bottom-sheet.tsx:443` — `bit_depth` gated `{isAdmin && hasExifData(image.bit_depth) && ...}`
- `info-bottom-sheet.tsx:500` — `isP3Pipeline` gated `{isAdmin && isP3Pipeline(image.color_pipeline_decision) ...}`

No sibling-miss regression.

### Migration 0024 + migrate.js + _journal.json

Confirmed:
- `0024_drop_reactions.sql` is BASELINED-NOT-RUN (documented pattern, mirroring 0023).
  The bare `ALTER TABLE images DROP COLUMN reaction_count` (unguarded, no MySQL 8.0
  `IF EXISTS`) never executes via drizzle.migrate().
- `reconcileLegacySchema` carries the guarded equivalents:
  `dropTableIfPresent(connection, 'image_reactions')` (line 638) and
  `dropColumnIfPresent(connection, dbName, 'images', 'reaction_count')` (line 639).
- `migrate-reconcile-coverage.test.ts` (new tests at lines 219-235) pins both drop
  paths with regex assertions so a future refactor cannot silently remove them.
- `_journal.json` entry 24 `when: 1782100000000` > entry 23 `when: 1782000000000`:
  monotonicity satisfied. The historical non-monotonic range (entries 7-17) is a
  known pre-existing condition covered by the hash-based post-condition assertion in
  `runMigrations`.

### CR-16-02 — BoundedMap.entries() live-reference warning added

`apps/web/src/lib/bounded-map.ts`

Confirmed: Warning comment added to `entries()`. Grep of all production code confirms
no caller uses `.entries()` to mutate yielded values. `upload-tracker-state.ts` uses
`.values()` (not `.entries()`) for the active-claim scan. The `.data` getter
(which exposes the raw internal Map) has no callers in production code.

---

## Open Questions (low-confidence findings — surfaced, not blocking)

None identified.

---

## Positive Observations

- **A16-01 search-route-privacy.test.ts**: The new fixture scan of
  `api/search/semantic/route.ts` and `api/search/similar/[id]/route.ts` for any
  reference to PII `images.<col>` columns is exactly the right pattern — a future
  `latitude: images.latitude` addition would fail the test immediately. Coverage fills
  a real gap since these inline selects lack the `publicSelectFields` compile guard.

- **TE-16-05 GPS coordinate edge cases**: `extractExifForDb` already had
  `Number.isFinite` and `Math.abs(dd) > maxDegrees` guards; the new tests
  (Infinity DMS array, out-of-range degrees) confirm the existing code handles them
  correctly. Tests added to document confirmed behavior, not to fix a bug.

- **Rate-limit BoundedMap mutation safety**: All call sites (ogRateLimit,
  shareRateLimit, semanticRateLimit, loadMoreRateLimit) follow the correct pattern:
  `const entry = map.get(ip)` (shallow copy) → `map.set(ip, { count: entry.count + 1,
  ... })` (new object). No site reads a live reference and mutates it in place.

- **view-retention.ts**: `Number.isFinite(retentionDays) && retentionDays > 0`
  guard correctly falls back to the default for negative, zero, NaN, and Infinity
  inputs. Matches the COR-R4C6-10 invariant documented in CLAUDE.md.

- **settleUploadTrackerClaim math**: `Math.max(0, count + (successCount - claimedCount))`
  correctly handles partial success, full success, full failure, and the edge case
  where `successCount > claimedCount` (no under-floor). Implementation matches spec.

- **settings-hash.ts COLOR_IMPACTING_KEYS export (TE-16-04)**: Exporting the constant
  for test-pinning is the right call; the compile-time `_ColorKeysAreSettingKeys` guard
  only verifies membership (no typos), not completeness. The unit test can now verify
  the exact set, catching a future omission the compile guard cannot.

- **Slug-rename transaction ordering**: The "insert new / re-point FK children / delete
  old" pattern avoids any FK violation window without needing ON UPDATE CASCADE (which
  is not set on `topics.slug` references). This is a robust approach that handles
  all three FK child tables (`images.topic`, `topicAliases.topicSlug`,
  `topicViews.topic`) atomically.

---

## Recommendation

**COMMENT** — no CRITICAL or HIGH issues at HIGH confidence. One LOW finding (tracker
claim leak on unexpected DB throw at `images.ts:256`) worth a defensive fix but not
blocking. All cycle-16 priority items verified correct and complete; the "fix one
sibling, miss the next" failure theme is not repeated in this cycle's changes.
