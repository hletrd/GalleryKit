# GalleryKit Code Review — Cycle 13

**Date:** 2026-06-27
**Reviewer:** code-reviewer agent (Sonnet 4.6)
**Scope:** Full repository review, verification of cycle-12 fixes, focus on new issues

---

## Summary

**Files Reviewed:** ~35 core source files across lib/, app/actions/, app/api/, app/[locale]/, db/

**Total Issues:** 2

### By Severity
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 2

**Verdict:** APPROVE

---

## Cycle-12 Fix Verification

All 7 tasks scheduled in cycle-12-plan.md have been confirmed landed in commits ee9b2a7d–247382d8:

| Task | File | Status |
|------|------|--------|
| Graceful shutdown timer leak | `instrumentation.ts` | VERIFIED — `shutdownTimer.unref()`, `clearTimeout` in finally, `process.exit(exitCode)` |
| `_verifyAvifNclx` partial read | `process-image.ts:255` | VERIFIED — `handle.read(head, 0, 4096, 0)` (not full slurp) |
| DB init-race timer leak | `db/index.ts:94–111` | VERIFIED — `initTimer.unref()`, `clearTimeout` in finally, stale promise cleared on timeout |
| Image-queue shape guard | `image-queue.ts:182` | VERIFIED — validates `queue.add` method + `instanceof Set`, not just key presence |
| Stale comments | Various | VERIFIED — comments updated to match implementation |
| `prioritizeSecurityFields` export | `audit.ts:20` | VERIFIED — exported; test locks ordering contract |
| `prioritizeSecurityFields` test | `__tests__/audit-prioritize-security-fields.test.ts` | VERIFIED — export presence confirmed |

---

## Issues

### CR-13-01 [LOW] Inconsistent shallow-copy contract in `getPasswordChangeRateLimitEntry`
**File:** `apps/web/src/lib/auth-rate-limit.ts:114`
**Confidence:** HIGH

`getPasswordChangeRateLimitEntry` returns the raw `entry` from `passwordChangeRateLimit.get()` without an explicit object spread, while the sibling helper `getLoginRateLimitEntry` (lines 32–34) performs `return { ...entry }`.

**Why it is safe today:** `passwordChangeRateLimit` is a `BoundedMap<string, RateLimitEntry>`. `BoundedMap.get()` already returns a shallow copy via `{ ...value }` at `bounded-map.ts:66–68` for every non-null object result. So the caller receives a copy regardless of whether the action-side helper spreads again.

**Why it is still a maintenance hazard:** The asymmetry creates a documentation gap. A future reader of `getPasswordChangeRateLimitEntry` may not realize the copy is provided by `BoundedMap`, and a refactor that switches the backing store to a plain `Map` would silently introduce mutation aliasing without a test failure.

**Fix:** Add `return { ...entry };` at line 114 to make the contract explicit and symmetric with the sibling helper, or add an inline comment that the copy is already provided by `BoundedMap.get()`.

---

### CR-13-02 [LOW] Redundant double-copy in `getLoginRateLimitEntry`
**File:** `apps/web/src/lib/auth-rate-limit.ts:33`
**Confidence:** HIGH

`getLoginRateLimitEntry` performs `return { ...entry }` after a `loginRateLimit.get()` call. Because `BoundedMap.get()` at `bounded-map.ts:66–68` already returns `{ ...value }` for non-null objects, this is a second identity spread that allocates a new object with no effect.

**No correctness impact.** The overhead is negligible (a 2-field object spread on a rate-limit read path). The issue is the signal confusion it creates — it implies that `BoundedMap.get()` does not already copy, which is incorrect.

**Fix (option A):** Remove the `{ ...entry }` at line 33 and add a comment: `// BoundedMap.get() already returns a shallow copy`.

**Fix (option B):** Leave the explicit spread in both `getLoginRateLimitEntry` AND add it to `getPasswordChangeRateLimitEntry` (CR-13-01 fix), and add a comment to `BoundedMap.get()` that the caller-side spread is redundant but kept for documentation. Consistent code is easier to maintain than optimally minimal code.

---

## Open Questions

None. No low-confidence CRITICAL/HIGH findings to escalate.

---

## Positive Observations

The codebase is in excellent shape. The following patterns stand out as particularly well executed:

**Security architecture:**
- `requireSameOriginAdmin()` centralizes Origin/Referer + Host CSRF provenance in one place; every mutating server action uses the triple guard: `getRestoreMaintenanceMessage` + `isAdmin` + `requireSameOriginAdmin`. Verified for actions/images.ts, topics.ts, sharing.ts, settings.ts, admin-users.ts, collections.ts, admin-backfill.ts.
- `hasTrustedSameOrigin` fails closed: requires explicit `Origin` or `Referer` match; `allowMissingSource` defaults to false.
- `stripDefaultPort` in `request-origin.ts` handles proxy-appended `:443`/`:80` edge cases correctly.
- Session cookie attributes (`httpOnly`, `secure`, `sameSite: lax`) plus constant-time `timingSafeEqual` comparison — correct.
- All `dangerouslySetInnerHTML` usages go through `safeJsonLd()` which escapes `<`, `>`, U+2028, and U+2029 — standard JSON-LD XSS prevention pattern.

**Smart collections SQL safety:**
- `smart-collections.ts` uses a column allowlist (`ALLOWED_COLUMNS`), `MAX_DEPTH=4`, `MAX_IN_VALUES=100`, `isScalarValue` enforcement, Drizzle parameterized bindings for all leaf values, LIKE wildcard escaping, and per-column operator narrowing for tag predicates. No SQL injection surface.

**Input validation:**
- `UNICODE_FORMAT_CHARS` regex uses `\uXXXX` escape sequences (not literal Unicode) for editor/CI invariance.
- `UNICODE_FORMAT_CHARS_GLOBAL` derived from `.source` with `/g` to prevent stateful regex reuse bugs.
- `safeInsertId` throws on BigInt overflow, negative, and non-finite `Number` values — closes a common silent truncation class.
- `validateBidiAndInvisible` rejects all Trojan-Source categories (bidi overrides, zero-width chars, interlinear anchors) at validation boundaries.

**JSON-LD sanitization:**
- `sanitizeForOg` is a shared single helper imported by all three consumers (both OG routes + the photo page JSON-LD), preventing drift. The comment at `p/[id]/page.tsx:9–14` accurately documents the AGG-R8c3-02 lineage.

**Database schema:**
- All FK constraints have explicit `onDelete` policies appropriate to their semantics: `cascade` for owned records (sessions, adminTokens, imageViews, topicViews, sharedGroupViews, imageEmbeddings, imageTags, sharedGroupImages, topicAliases), `restrict` for shared references (images→topics), `set null` for attribution (images.uploaded_by). No orphan-accumulation risks.
- Composite indexes cover all primary query access patterns documented in CLAUDE.md.

**Graceful shutdown:**
- `instrumentation.ts` uses `process.on` (not `process.once`) with a `shutdownInProgress` guard, `.unref()` on the sentinel timer, `clearTimeout` in finally, and `process.exit(exitCode)` to force termination of MySQL connection refs. Clean.

**DB connection init:**
- `db/index.ts` patches `poolConnection.getConnection` to await the `SET group_concat_max_len` init promise on every connection acquisition, with a 10s timeout that clears the stored promise on failure so the next call retries. `initTimer.unref()` and `clearTimeout` in finally prevent timer leaks. The Symbol-based marker survives the callback→promise wrapper hop.

**Audit log:**
- `prioritizeSecurityFields` reorders forensic fields to the front of the JSON object before truncation. `[...str].slice(0, 4000)` is code-point-safe. `purgeOldAuditLog` guards against negative/non-finite retention values.

**Partial reads:**
- Both `_verifyAvifNclx` (4 KB) and `_verifyWebpIcc` (1 KB) open a file handle, read only a head buffer, and close the handle in finally — correct resource management at minimal memory cost.

**Rate limiting:**
- All public mutating API routes have rate-limit pre-increment helpers. Semantic search routes use `preIncrementSemanticAttempt` / `rollbackSemanticAttempt` budget. OG routes use `preIncrementOgAttempt`. The LR upload route has its own body-size location in nginx that wins by longest-prefix match.

**BoundedMap:**
- `BoundedMap.get()` returning a shallow copy prevents mutation aliasing of stored rate-limit entries — a subtle but correct choice.

**Image pipeline:**
- Per-format fresh `sharp(inputPath, …)` instances for format fan-out (no shared-state contamination). 10-bit AVIF gated on a Promise-singleton libheif probe. Wide-gamut sources downscaled before the rgb16 fan-out to prevent OOM.

---

## Recommendation

**APPROVE** — The codebase has no CRITICAL or HIGH issues. The two LOW findings (CR-13-01, CR-13-02) are cosmetic consistency fixes in the rate-limit helper layer. All cycle-12 scheduled fixes have landed and are functioning correctly.

The primary work item for cycle 14 is the two LOW findings above (which can be addressed in a single commit to `auth-rate-limit.ts`).
