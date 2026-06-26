# Code Review — GalleryKit Cycle 15 (R15C15)

**HEAD:** 2f886351 · **Agent:** code-reviewer (sonnet) · **Scope:** server actions, lib/, components/, db/, api routes.

**One-line summary:** No CRITICAL/HIGH; two MEDIUM (BoundedMap shallow-copy mutation freezes in-memory rate-limit fast paths; upload-tracker key-namespace divergence between LR and browser paths) + seven LOW. The BoundedMap defect is the most actionable — three files, five functions, and the correct `.set()` pattern already exists in the same codebase.

## By severity
- CRITICAL: 0 · HIGH: 0 · MEDIUM: 2 · LOW: 7

---

### [MEDIUM] BoundedMap shallow-copy mutation — in-memory rate-limit counters never advance
**Files:** `apps/web/src/app/actions/sharing.ts:48` (`checkShareRateLimit`), `:57` (`rollbackShareRateLimit`); `apps/web/src/app/actions/admin-users.ts:39` (`checkUserCreateRateLimit`), `:44-48` (`rollback`). Confidence HIGH.
`BoundedMap.get()` returns a shallow copy (`{ ...value }`, see `bounded-map.ts:64`). These call sites do `const entry = map.get(key); entry.count++;` — mutating the discarded copy, never the stored entry. The stored `count` is frozen at the value set by the `!entry` branch (1), so the in-memory check `> MAX` (20 / 10) can never fire. Both consumers DO have a DB-backed second layer (`incrementRateLimit`/`checkRateLimit`, sharing.ts:112-113/226-227, admin-users.ts:128-129), so the limits ARE enforced — the in-memory fast path is dead, costing a DB round-trip on every request that the fast path was meant to short-circuit. Rollback functions have the symmetric defect.
**Fix:** mirror the reference pattern (`public.ts:56,264,333`): `map.set(key, { count: entry.count + 1, resetAt: entry.resetAt })`; rollback via `.set()` or `.delete()`.

### [MEDIUM→LOW by-design] Upload-tracker key namespace divergence — LR and browser paths have independent quota windows
**Files:** `lr/upload/route.ts:210` (`lr:${tokenUserId ?? ip}`) vs `images.ts:~174` (`${userId}:${uploadIp}`). Confidence HIGH.
The two ingress paths key the cumulative upload tracker differently, so an authenticated admin can exhaust the browser quota then continue via the LR plugin with a fresh window — `UPLOAD_MAX_TOTAL_BYTES`/`UPLOAD_MAX_FILES_PER_WINDOW` doubled across surfaces.
**LEAD VERIFICATION:** the divergence is DOCUMENTED INTENT — `route.ts:200-210` (DEF-C4-03) deliberately keys the LR window on the verified token user as a SEPARATE window. Combined with the trusted multi-root-admin model, BY-DESIGN, not a security gap. Downgraded to LOW/by-design.

### [LOW] BoundedMap shallow-copy — CLIP embeddings backfill rate-limit entirely non-functional
**File:** `embeddings.ts:40` (`preIncrementBackfillAttempt`). Confidence HIGH. Same defect; `return (map.get(key)?.count ?? 0) > 1` always reads the frozen stored `1` → `1 > 1 = false`. NO DB fallback here, but the action requires `isAdmin()` + `requireSameOriginAdmin()`, so LOW. Fix via `.set()`.

### [LOW] Log-level inconsistency on login-success rate-limit reset
**File:** `auth.ts:189` (IP reset → `console.error`) vs `:194` (account reset → `console.debug`). Same operational significance; the account-bucket failure won't reach log shippers. Fix: `console.debug`→`console.error`/`warn`.

### [LOW] Stale `viewCountRetryCount` entry on buffer capacity-drop path
**File:** `data.ts` re-buffer capacity-drop branch (~140-143). On a capacity drop the retry-count entry for the dropped groupId is left stale; a later re-entry inherits an inflated count, prematurely nearing eviction. Fix: delete (or increment) the `viewCountRetryCount` entry in the drop branch.

### [LOW] TagInput `filteredTags` uses `toLowerCase()` without NFKC normalization
**File:** `tag-input.tsx` `filteredTags` useMemo. The filter uses plain `.toLowerCase()` while `hasSelectedTag`/`resolveCanonicalTagName` use `normalizeTagInputValue()` (`.normalize('NFKC').toLocaleLowerCase()`). Fullwidth/composed Unicode tags can appear in the dropdown after selection. Confidence MEDIUM. Fix: apply `normalizeTagInputValue()` to both sides.

### [LOW] LoadMore `'invalid'` status returned with no user feedback
**File:** `load-more.tsx:72-83`. `loadMoreImages` can return `{ status: 'invalid' }` for a malformed cursor; the dispatch handles rateLimited/maintenance/error but `'invalid'` silently `setHasMore(false)` with no toast. Fix: add a default branch `toast.error(...)`.

### [LOW] `copyColorMetadata` clipboard copies admin-only fields without explicit `isAdmin` gate
**Files:** `color-details-section.tsx:274-284`, `lightbox-color-pip.tsx:88-100`. Clipboard JSON includes `transfer_function`/`matrix_coefficients`/`color_pipeline_decision`/`is_hdr`/`has_gain_map` ungated. Null for public today (data-layer omission), but inconsistent with the render-path `isAdmin &&` guards. Confidence MEDIUM. Fix: gate admin-only keys on `isAdmin`. (Folds into SEC-15-01 / Critic-F2 admin-gating task.)

### [LOW] Clipboard `execCommand` fallback absent in `lightbox-color-pip.tsx`
**File:** `lightbox-color-pip.tsx:105-107`. The sibling `color-details-section.tsx` has a `document.execCommand('copy')` fallback for HTTP (non-secure-context) LAN installs; the pip throws instead. CLAUDE.md lists HTTP LAN as supported. Fix: copy the fallback or extract a shared `@/lib/clipboard.ts`.

## Positives
Two-layer (in-memory + DB) rate-limit architecture is sound; BoundedMap itself is correct + documents the shallow-copy semantic; the icc-extractor `dataSize < 16` mluc guard and load-more dual-ref race guard are tight; `isViewRecordRateLimited`/`preIncrementLoadMoreAttempt` are the correct reference `.set()` implementations.

**Recommendation:** COMMENT — no blocking issues; BoundedMap fix is the highest-value (clear correct pattern already present).
