# Code-reviewer + debugger + tracer — Run-4 Cycle 5

Angle: logic bugs, latent failure modes, causal tracing with competing
hypotheses, regression review of cycle-4's self-authored commits.

## Inventory (no sampling)

1. **Regression diff review of ALL 10 R4C4 fix commits** (`b313f673..HEAD`):
   `20a20714` (serve-upload SWR), `7887395b`+`c66fed47` (sales convergence),
   `f3d68197` (LR containment), `60fca60e` (tokens Enter guard), `133d51fe`
   (lr-tokens i18n), `5f4f1e4b` (download open-before-claim), `2cf56d8f`
   (smart-collections scalars), `8c03c7d9` (docs), `5908f3f9` (analytics),
   `0fd0c53d` (contract tests), plus both SW_VERSION refreshes.
2. Full reads: `app/[locale]/admin/db-actions.ts` (520 ln),
   `api/admin/db/download/route.ts`, `app/feed.xml/route.ts`,
   `app/sitemap.ts`, `api/og/photo/[id]/route.tsx`,
   `actions/collections.ts`, `actions/embeddings.ts`, `actions/public.ts`
   (387 ln, full), `actions/settings.ts`, `actions/seo.ts`,
   `actions/topics.ts` (create/update/delete/alias/map-visible),
   `actions/tags.ts` (update/delete/link regions), `actions/sharing.ts`
   (revoke/delete regions), `actions/images.ts` (updateImageMetadata
   region), `lib/data.ts` (cursor machinery 560-824 + smart-collection +
   feed regions 1240-1350), `components/load-more.tsx` (full),
   `components/home-client.tsx` (props/LoadMore wiring), current
   `api/download/[imageId]/route.ts` post-fix state.
3. Pattern sweeps (repo-wide, excluding tests):
   `Math.floor(Number(` coercion class (3 sites), `affectedRows === 0`
   class (14 sites), `offsetOrCursor` consumers.
4. **Live MySQL verification** against the running `gk-e2e-mysql`
   container (temp-table session, zero persistent writes) of mysql2
   UPDATE `affectedRows` semantics.

## Findings

### COR-R4C5-01 — Smart-collection load-more re-fetches page 1 forever (cursor coerced to 0) + double-lookahead drops the boundary image — MED / Confidence: High
- **Files:** `apps/web/src/app/actions/public.ts:155-216` (esp. 165, 204),
  `apps/web/src/components/load-more.tsx:44-60`,
  `apps/web/src/components/home-client.tsx:204,380-388`,
  `apps/web/src/lib/data.ts:1274-1301`.
- **Trace (hypothesis competition run to ground):**
  1. `/c/[slug]/page.tsx` renders `HomeClient` with the first 30 images and
     `hasMore=true` for any collection > 30 photos.
  2. `home-client.tsx:204` computes `initialLoadMoreCursor` from the last
     SSR image **unconditionally** — including the smart-collection case —
     and passes it as `initialCursor` (line 385).
  3. `load-more.tsx:44` calls
     `loadMoreSmartCollectionImages(slug, cursor ?? offset, limit)` — the
     cursor OBJECT wins over the numeric offset whenever set, and the
     success handler (lines 53-60) re-arms it after every page.
  4. `public.ts:165`: `safeOffset = Math.max(Math.floor(Number(offsetOrCursor)) || 0, 0)`.
     `Number({id,…})` = `NaN` → `Math.floor(NaN)` = `NaN` → `NaN || 0` =
     `0`. The action silently treats EVERY cursor-bearing request as
     **offset 0**.
  5. Result: the first and every subsequent load-more on a >30-image
     collection returns the SAME first 30 rows. `handleLoadMore` appends
     them (`setAllImages(prev => [...prev, ...newImages])`) → duplicated
     photos, duplicate React keys, and since `hasMore` stays `true` at
     offset 0, the IntersectionObserver sentinel keeps firing → unbounded
     duplicate append loop as the visitor scrolls.
- **Second, masked bug at the same call:** `public.ts:204` passes
  `safeLimit + 1` into `getImagesForSmartCollection`, which ALREADY
  implements the +1 lookahead internally (`data.ts:1293` queries
  `normalizedPageSize + 1`, `normalizePaginatedRows` keys `hasMore` at
  `rows.length > pageSize`). The double lookahead makes `hasMore` false
  when exactly `safeLimit + 1` rows remain while `rows.slice(0, safeLimit)`
  drops the extra row → collections of size ≡ 1 (mod 30) lose their last
  (oldest) photo permanently once the cursor bug is fixed; `totalCount`
  shown by the UI then disagrees with the reachable images.
- **Contrast:** `loadMoreImages` (the topic/tag sibling at
  `public.ts:78-153`) handles both pitfalls: it normalizes the cursor
  (line 83), rejects unparseable object cursors as `invalid` (line 84),
  and computes `hasMore` itself from a single +1 (line 141).
- **Why it shipped:** zero unit tests reference
  `loadMoreSmartCollectionImages` or `getImagesForSmartCollection`
  (verified by grep over `__tests__/`), and the e2e suite has no smart-
  collection fixture.
- **Fix:** give `getImagesForSmartCollection` real cursor support — the
  exported `normalizeImageListCursor` + in-module `buildCursorCondition`
  (`data.ts:629-679`) already produce the exact predicate for the same
  `ORDER BY capture_date DESC, created_at DESC, id DESC` used by the
  collection query; mirror `loadMoreImages`'s normalize/invalid/cursor
  branches in `loadMoreSmartCollectionImages`; pass `safeLimit` (not +1)
  and consume the helper's `hasMore`/rows directly. Add behavioral tests.

### COR-R4C5-04 — Download route leaks the opened FileHandle when `fileHandle.stat()` throws — LOW / Confidence: Medium
- **File:** `apps/web/src/app/api/download/[imageId]/route.ts:200-218`.
- The R4C4-06 fix opens the handle before the single-use claim and closes
  it on the claim-failure / already-used / stream-setup paths, but inside
  the SAME try, `fileSize = (await fileHandle.stat()).size` sits between
  `open()` and the catch. If `stat()` throws (EIO on a failing disk,
  EBADF after an external close), the catch returns 404/500 **without
  closing the just-opened handle** — an fd leak on the paid-download
  path. Extremely rare in practice (fstat on an open fd), but the
  R4C4-06 commit message's own contract is "the handle cannot leak".
- **Fix:** in the lstat/realpath/open catch, `await fileHandle?.close()`
  (guard for the not-yet-assigned case) before returning; extend the
  refund-clears-download-token suite's leak contract.

### LOW-R4C5-05 — `extractTldPlusOne` still records bare TLD for multi-trailing-dot hosts — LOW / Confidence: High (behavior) / Low (impact)
- **File:** `apps/web/src/lib/analytics.ts:103-118`.
- R4C4-09 strips exactly ONE trailing dot. WHATWG URL preserves
  `github.com..` (verified live in Node: `new URL('https://github.com..')`
  → hostname `github.com..`), so a double-dotted Referer still splits
  into a trailing empty label and records `"com."` — the same meaningless
  junk row the R4C4 fix targeted. Attacker-controlled Referer makes this
  trivially reachable, though impact is only analytics noise.
- **Fix:** `host.replace(/\.+$/, '')` (strip ALL trailing dots), extend
  the analytics suite with the `github.com..` case.

## Verified clean (evidence)

- **R4C4 regression review:** all 10 commits sound. The SWR debounce
  rewrite (`20a20714`) was traced through all four states (fresh, stale +
  no inflight, stale + inflight, cold start): the catch's
  `servingHashCache` read is the mutable module var (non-null whenever a
  stale request armed the refresh), the inflight body never rejects, and
  cold-start dedupe holds (second cold request returns the existing
  inflight). The sales convergence (`7887395b`) maps ONLY
  `charge_already_refunded` → `already-refunded` (sales.ts:136) — no
  partial-refund false positive; convergence-UPDATE failure preserves the
  original error. The LR containment (`f3d68197`) settle closure is
  idempotent and post-insert work stays outside the try. The download
  reorder (`5f4f1e4b`) closes the lstat→open race with the token intact
  (modulo COR-R4C5-04 above). Scalar enforcement (`2cf56d8f`) cannot
  break legitimate stored queries — the column allowlist
  (smart-collections.ts:20-41) contains no boolean column.
- **`affectedRows === 0` class — NOT a bug (false hypothesis killed by
  live verification):** mysql2's DEFAULT connection flags INCLUDE
  `FOUND_ROWS` — a no-op `UPDATE t SET label='same'` against the running
  `gk-e2e-mysql` returned `affectedRows = 1, changedRows = 0`, and a
  no-match UPDATE returned 0. Therefore the 14 `affectedRows === 0`
  guards (updateTopic same-slug branch, updateTag rename-to-same,
  updateImageMetadata no-op save, setTopicMapVisible, updateSmartCollection,
  sharing revoke conditional, queue claim, tag link/unlink) all correctly
  mean "row not matched", never "row matched but unchanged". No fix
  needed; recorded so future cycles do not re-litigate. (Note: cycle-4's
  webhook analysis phrase "no CLIENT_FOUND_ROWS flag" was inaccurate as a
  rationale — the webhook gate is correct anyway because a plain INSERT
  reports affectedRows=1 on success under either flag setting. See
  document-specialist file.)
- `Math.floor(Number(...))` coercion sweep: 3 sites; `loadMoreImages` and
  `getImagesLite` guard object cursors first; only the smart-collection
  action lacks the guard (folded into COR-R4C5-01).
- `db-actions.ts` backup/restore: advisory-lock discipline, early-return
  releases, stream-error settle guards, header validation, dangerous-SQL
  scan chunking all hold; `dumpDatabase` close-handler flush/empty-file
  checks correct. Only cosmetic nit: `code: number` annotation on the
  `close` handlers where Node can deliver `null` after a signal kill —
  message renders "code null"; not scheduled (cosmetic, unreachable
  without an operator-issued kill).
- `feed.xml` (root + topic twin), `sitemap.ts`, `api/og/photo/[id]`:
  XML escaping via `escapeXml` on every interpolation, Last-Modified/304
  logic, budget math, rollback discipline on the OG rate limiter — clean.
- `settings.ts` / `seo.ts`: validation order (raw Unicode check →
  normalize → per-field), upload-contract lock scope, transactional
  upserts — clean.
- `topics.ts` create/update/delete/alias: route-segment lock discipline,
  typed error classes, image cleanup on conflict/error paths — clean.
