# Critic Review — Cycle 2 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Multi-perspective critique of the whole change surface

### Verified fixes from Cycle 1

The following AGG1-* findings from cycle 1 have been confirmed as fixed in the current codebase:

1. **AGG1-08** (File-serving TOCTOU): `serve-upload.ts` now streams from `resolvedPath` (line 95). Verified.
2. **AGG1-09** (Settings Record<string,string> runtime safety): `normalizeStringRecord()` introduced and used in both `settings.ts` and `seo.ts`. Verified.
3. **AGG1-10** (`batchUpdateImageTags` Array.isArray guard): Guard present at tags.ts. Verified.
4. **AGG1-12** (nginx admin mutation throttling): nginx config includes `/admin/seo` and `/admin/settings`. Verified.
5. **AGG1-05** (Light destructive button contrast): `globals.css` and `button.tsx` updated. Verified.
6. **AGG1-39** (Concurrent photo-share rate limit rollback): `rollbackShareRateLimitFull` rolls back both counters. Verified.

### Still-open findings from Cycle 1

1. **AGG1-07** (Shared-group view count inflation): Still present. `g/[key]/page.tsx` still calls `getSharedGroupCached(key)` without `incrementViewCount: false` for photo detail views. Severity Medium/High.
2. **AGG1-01** (Photo prev/next navigation across NULL capture_date): Complex cursor logic in `data.ts:447-465` has subtle edge cases. The implementation uses multi-clause OR conditions for NULL handling. While the logic appears correct for the documented sort order, the complexity makes it fragile.
3. **AGG1-40** (Deleting all images from a group share leaves live empty share URL): Still present. No cascade cleanup when all images in a shared group are deleted.

### New findings

#### C2-CRIT-01 (Medium / High). `deleteImages` sequential file cleanup is unnecessarily slow

- Location: `apps/web/src/app/actions/images.ts:618-636`
- Same finding as C2-CR-01. The for-of loop serializes cleanup across all images. For batches > 20 this is noticeably slow.
- The comment mentions bounding the outer batch, but the implementation is fully sequential, not bounded-parallel.

#### C2-CRIT-02 (Low / Medium). OG route `tags` param allows unvalidated tag names in response

- Location: `apps/web/src/app/api/og/route.tsx:70`
- The `tags` query parameter is split and filtered through `isValidTagName`, which is correct. However, the tag names are rendered directly into JSX without HTML escaping. Since `@vercel/og` (satori) renders to SVG/PNG, there is no script injection risk. But extremely long or special-character tag names could cause layout issues in the OG image. The existing `clampDisplayText` is only applied to `topicLabel`, not to individual tag names.
- Concrete scenario: an attacker crafts a URL with `?topic=photos&tags=` containing a 100-character tag name. The OG image renders with that tag name consuming all horizontal space.
- Suggested fix: apply `clampDisplayText` (or a shorter clamp) to each tag in `tagList.map()`.

#### C2-CRIT-03 (Low / Low). `restoreDatabase` has double `uploadContractLock?.release()` in finally blocks

- Location: `apps/web/src/app/[locale]/admin/db-actions.ts:360-366`
- The inner `finally` block at line 360 calls `await uploadContractLock?.release()` and sets `uploadContractLock = null`. The outer `finally` at line 364 calls `await uploadContractLock?.release()` again. Since the inner finally already nulls `uploadContractLock`, the outer call is a no-op. This is not a bug, but the double-release pattern is confusing and could mislead future maintainers into thinking there's a leak if they see the outer release without realizing the inner one already ran.
- Suggested fix: Remove the redundant outer `uploadContractLock?.release()` since the inner finally already handles it, or add a comment explaining the redundancy is intentional defense-in-depth.
