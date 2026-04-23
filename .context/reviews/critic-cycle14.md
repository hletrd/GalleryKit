# Critic Review — Cycle 14 (2026-04-20)

## Reviewer: critic
## Scope: Multi-perspective critique of the full codebase under `apps/web/src/`
## Prior Cycle Reference: Avoids re-reporting findings from cycles 38–39 (tag slug collision DRY pattern CRI-38-02, Map pruning DRY CRI-38-01, GPS dead code CRI-38-03, CSV GC pattern CRI-38-04, SEC-39-01/02/03, DBG-39-01/02/03, CR-39-01/02/03/04, UX-39-01/02/03)

---

### Overall Assessment

The codebase is in mature, well-hardened shape after 39+ review cycles. Security, privacy, and robustness are consistently strong. My critique focuses on cross-cutting design tensions, semantic inconsistencies, and correctness edge cases that more specialized reviewers (security, debugger, UI/UX) tend to miss because they fall between domains.

---

## New Findings

### CRI-14-01: `selectFields` vs `publicSelectFields` are the same reference — the privacy split is decorative, not enforced [MEDIUM] [HIGH confidence]

- **File**: `apps/web/src/lib/data.ts` line 134
- **Description**: `publicSelectFields` is assigned as `const publicSelectFields = selectFields;` — it's the exact same object reference. The comment says "Using a separate constant makes the privacy intent explicit" but the TypeScript privacy guard (`_AssertNoSensitiveFields`) only checks `selectFields`. If a developer adds `latitude` to `selectFields`, both `selectFields` and `publicSelectFields` will contain it, and the guard catches it. But if a developer creates a *new* object with sensitive fields and assigns it to `publicSelectFields` while leaving `selectFields` clean, the guard won't catch it. The split creates a false sense of defense-in-depth — `publicSelectFields` looks like it has independent guarantees but actually has none.
- **Concrete concern**: The two-name pattern invites the assumption that `publicSelectFields` is a stricter subset, when it's identical. A future developer adding fields to `selectFields` might think they're only affecting admin queries, when in fact they're also exposing the field publicly via `publicSelectFields`.
- **Fix**: Either (a) make `publicSelectFields` a genuinely separate object that explicitly picks from `selectFields` (forcing a conscious choice for each field), or (b) remove `publicSelectFields` entirely and have all public queries use `selectFields` directly with a naming convention like `PUBLIC_SAFE_FIELDS` to make the intent clear. Option (a) provides real defense-in-depth.

### CRI-14-02: `uploadImages` pre-increment tracker adjustment can go negative [LOW] [MEDIUM confidence]

- **File**: `apps/web/src/app/actions/images.ts` lines 269–273
- **Description**: After the upload loop, the tracker adjustment uses additive math:
  ```
  currentTracker.count += (successCount - files.length);
  currentTracker.bytes += (uploadedBytes - totalSize);
  ```
  When `successCount < files.length` (partial failure), the count goes negative relative to the pre-increment. For `bytes`, `uploadedBytes` sums only successful `file.size` values while `totalSize` sums all file sizes — so if some files failed before writing, the adjustment subtracts more than was actually consumed, pushing `bytes` below the pre-increment value. This is correct in the *direction* of the adjustment (rollback failed claims), but if multiple concurrent uploads from the same IP overlap, one upload's negative adjustment can reduce another upload's pre-incremented contribution below zero.
- **Concrete concern**: Under concurrent uploads from the same IP, the `bytes` counter could go negative, allowing the next upload to bypass the cumulative size limit. The `count` field is less susceptible because each file is counted exactly once, but the same principle applies.
- **Fix**: Clamp the adjusted values to zero: `currentTracker.bytes = Math.max(0, currentTracker.bytes + (uploadedBytes - totalSize));` and same for count.

### CRI-14-03: `searchImagesAction` in-memory pre-increment is not rolled back on DB `checkRateLimit` returning "limited" when the Map entry was just created [LOW] [LOW confidence]

- **File**: `apps/web/src/app/actions/public.ts` lines 55–75
- **Description**: When the in-memory entry doesn't exist (first request from an IP), the code creates a new entry with `count: 1` (line 56). If the DB-backed check then returns `limited: true`, the rollback on line 70 checks `currentEntry.count > 1` — but since it was just created with count=1, it falls to the `else` branch and deletes the entry entirely. This is correct for the current request. However, the `incrementRateLimit` DB call on line 82 already ran and succeeded *before* the `checkRateLimit` call returned "limited" — this means the DB counter was incremented but the in-memory counter was deleted, creating a permanent desync for that IP until the window expires. On the next request from that IP, the in-memory counter starts at 0 again while the DB knows about 1+ attempts.
- **Concrete concern**: The in-memory and DB counters diverge for IPs that hit the rate limit on their very first request in a window. In practice, this means the in-memory fast-path undercounts by 1, which is a slightly permissive direction — a user gets one extra search beyond the limit before the DB check catches it. Very low severity since the DB check is authoritative.
- **Fix**: When rolling back on DB `limited`, also roll back the DB increment. Or restructure so `checkRateLimit` runs before `incrementRateLimit`.

### CRI-14-04: `getTagSlug` is duplicated in `actions/tags.ts` and inline in `actions/images.ts` [LOW] [HIGH confidence]

- **Files**: `apps/web/src/app/actions/tags.ts` line 12, `apps/web/src/app/actions/images.ts` line 196
- **Description**: The slug derivation function `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')` exists as `getTagSlug()` in `tags.ts` and as an inline lambda in `images.ts` (uploadImages, line 196). If the slug algorithm changes (e.g., adding Unicode transliteration), it must be updated in both places. This is the same DRY class as CRI-38-01 but specific to the slug function rather than Map pruning.
- **Concrete concern**: The two slug derivations could silently diverge, causing tag lookups to fail inconsistently between the upload path and the tag management actions.
- **Fix**: Extract `getTagSlug` to a shared module (e.g., `lib/validation.ts` or `lib/tag-utils.ts`) and import it from both action files.

### CRI-14-05: `getImageByShareKey` returns full `publicSelectFields` but no `blur_data_url` — inconsistent with `getSharedGroup` and `getImage` [MEDIUM] [MEDIUM confidence]

- **File**: `apps/web/src/lib/data.ts` lines 418–454
- **Description**: `getImageByShareKey` selects `...publicSelectFields` but does NOT include `blur_data_url`. Meanwhile, `getSharedGroup` (line 486) and `getImage` (line 315) both include `blur_data_url`. The `/s/[key]` share page presumably needs the blur placeholder for loading states, just like `/g/[key]` and `/p/[id]`. If the share page component renders a blur placeholder, it will be `undefined` and show no loading state.
- **Concrete concern**: Users viewing a shared photo link (`/s/[key]`) may see no blur placeholder during image load, creating a worse perceived loading experience compared to the group share and direct photo views.
- **Fix**: Add `blur_data_url: images.blur_data_url` to the select in `getImageByShareKey`, matching the `getSharedGroup` pattern.

### CRI-14-06: `processImageFormats` copy-on-same-resize-width optimization bypasses format-specific quality settings [MEDIUM] [HIGH confidence]

- **File**: `apps/web/src/lib/process-image.ts` lines 359–360
- **Description**: When `resizeWidth` equals the previous `lastRendered.resizeWidth` (e.g., original image is 800px wide and both size 640 and size 1536 result in `resizeWidth = 800`), the code uses `fs.copyFile` to duplicate the output from the first format's render to the second format's directory. But this copies the *raw file bytes* from one format to another — e.g., it could copy a WebP file into the AVIF directory.
- **Concrete concern**: Wait — looking more carefully, this optimization is within `generateForFormat`, which is called separately for each format (webp, avif, jpeg). So the copy is within the same format, not across formats. The `lastRendered` is scoped to the `generateForFormat` closure. **Retracted** — this is not a cross-format issue. However, there IS a subtler problem: when two sizes resolve to the same `resizeWidth`, the `copyFile` produces identical pixel content at different size suffixes. The `<source srcSet>` will offer the browser two identical files with different `w` descriptors, wasting bandwidth on double-downloads since the browser may request both for comparison.
- **Revised concern**: Duplicate file content under different size suffixes wastes CDN/storage and can cause the browser to download redundant data. This is a design trade-off, not a bug — the alternative is skipping the size entry entirely, which would break the `srcSet` contract.
- **Fix**: Accept as current design. Optionally, use symlinks instead of copies to save disk space when sizes resolve identically.

### CRI-14-07: `deleteImage` logs audit event after transaction but before file deletion — file deletion failure is not auditable [LOW] [LOW confidence]

- **File**: `apps/web/src/app/actions/images.ts` lines 336–367
- **Description**: The audit log for `image_delete` is written after the DB transaction succeeds (line 343) but before file cleanup (lines 354–363). If file deletion fails silently (all errors are `.catch(() => {})`), the audit log records a successful deletion even though orphaned files remain on disk. The converse — `deleteImages` (batch) — logs *before* the transaction (line 428), which has the opposite inconsistency.
- **Concrete concern**: There is no way to audit for orphaned files on disk. The single-delete and batch-delete functions also use different audit timing patterns, which is inconsistent.
- **Fix**: Normalize audit timing across both functions. Post-transaction is more accurate for DB state, but consider adding a separate audit entry for file cleanup failures if they occur.

### CRI-14-08: `isValidTopicAlias` regex allows `&` in `[^/\\\s?\x00#<>"'&]+$` but also disallows it — contradiction [LOW] [HIGH confidence]

- **File**: `apps/web/src/lib/validation.ts` line 25
- **Description**: The regex is `/^[^/\\\s?\x00#<>"'&]+$/`. The character class `[^/\\\s?\x00#<>"'&]` excludes `&`. This is correct per the comment ("disallow &"). However, the `+` quantifier and `$` anchor mean the regex rejects any alias containing `&`, which is the intended behavior. There's no actual bug here — the character class correctly lists `&` as disallowed. **Retracted on closer inspection** — the regex is correct.

### CRI-14-09: `shareRateLimit` pre-increment check in `checkShareRateLimit` returns `true` (rate-limited) *after* incrementing, so the first request from a new IP always passes but the count is already 1 [LOW] [LOW confidence]

- **File**: `apps/web/src/app/actions/sharing.ts` lines 42–54
- **Description**: The `checkShareRateLimit` function pre-increments the counter, then checks if `count > SHARE_MAX_PER_WINDOW`. For a new IP, the first call sets count=1, which is ≤ 20, so it passes. This is correct behavior. However, the function name `checkShareRateLimit` is misleading — it doesn't just *check*, it *mutates*. A developer calling it twice would double-increment. In `createPhotoShareLink` and `createGroupShareLink`, it's called once each, so there's no double-call issue. But the mutation side effect is hidden in a function named "check".
- **Concrete concern**: Misleading function name could cause future double-invocation bugs.
- **Fix**: Rename to `incrementAndCheckShareRateLimit` or separate into `incrementShareRateLimit` + `isShareRateLimited`.

### CRI-14-10: `db-actions.ts` env passthrough for child processes includes `LANG` and `LC_ALL` which could leak locale info to mysqldump/mysql [LOW] [LOW confidence]

- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 121, 313
- **Description**: The `env` object passed to `spawn` for both mysqldump and mysql includes `LANG` and `LC_ALL` from the Node.js process. These are needed for proper character encoding in the child process output. However, they could also influence mysqldump's behavior in subtle ways (e.g., `LC_ALL=C` could cause ASCII-only output). This is a very minor concern — the same passthrough was already reviewed in SEC-39-02 for the `HOME` var. `LANG`/`LC_ALL` are actually more important to pass than `HOME` for correct UTF-8 handling.
- **Fix**: No action needed — passing `LANG`/`LC_ALL` is correct for UTF-8 dumps.

---

## Summary of Actionable Findings

| ID | Severity | Confidence | File(s) | Description |
|----|----------|------------|---------|-------------|
| CRI-14-01 | MEDIUM | HIGH | `lib/data.ts:134` | `publicSelectFields` is same reference as `selectFields` — privacy split is decorative |
| CRI-14-02 | LOW | MEDIUM | `actions/images.ts:269-273` | Pre-increment tracker adjustment can go negative under concurrent uploads |
| CRI-14-03 | LOW | LOW | `actions/public.ts:55-75` | In-memory/DB rate limit counter desync on first-hit rate-limit |
| CRI-14-04 | LOW | HIGH | `actions/tags.ts:12`, `actions/images.ts:196` | `getTagSlug` duplicated between action files |
| CRI-14-05 | MEDIUM | MEDIUM | `lib/data.ts:418-454` | `getImageByShareKey` missing `blur_data_url` — inconsistent with other image queries |
| CRI-14-06 | — | — | `lib/process-image.ts:359-360` | Retracted — copy-within-format is correct |
| CRI-14-07 | LOW | LOW | `actions/images.ts:336-367` | Audit timing inconsistency between single/batch delete |
| CRI-14-08 | — | — | `lib/validation.ts:25` | Retracted — regex is correct |
| CRI-14-09 | LOW | LOW | `actions/sharing.ts:42-54` | `checkShareRateLimit` has hidden mutation side effect |
| CRI-14-10 | — | — | `db-actions.ts:121,313` | Retracted — `LANG`/`LC_ALL` passthrough is correct |

**Top recommendations**:
1. **CRI-14-01**: Make `publicSelectFields` a genuinely independent subset of fields to provide real defense-in-depth for the privacy boundary.
2. **CRI-14-05**: Add `blur_data_url` to `getImageByShareKey` for consistency with other public image queries.
3. **CRI-14-02**: Clamp tracker adjustments to zero to prevent negative counters under concurrent uploads.
