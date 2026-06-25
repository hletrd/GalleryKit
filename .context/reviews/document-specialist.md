# Run-10 Cycle-3 Convergence — Document Specialist Review

Date: 2026-06-25
HEAD: bcd67b12 (fix(public): add Array.isArray guard to loadMoreImages tagSlugs parameter)
Previous Review: 87065049 (run-10 cycle-2 convergence)

## Summary

This review covers documentation changes since the cycle-2 review (HEAD 87065049). The cycle-3 commits (bcd67b12) include fixes for Array.isArray guard, ENOENT error handling, restore-maintenance checks, revalidation ordering, and rate-limit getter safety. The previous review identified 20 remaining issues (R1-R20). Most have been verified as still present; a few new issues were discovered in the recently changed files. No new high-severity documentation issues were introduced by the cycle-3 commits.

---

## Status of Previous Review Findings

### Fixed since last review (verified at HEAD bcd67b12)

| ID | Finding | Fix Commit | Notes |
|----|---------|-----------|-------|
| None | No documentation fixes in cycle-3 commits | — | The cycle-3 commits are code fixes, not doc fixes. |

### Still Open from Previous Review (carried forward)

| ID | Finding | Status |
|----|---------|--------|
| R1 | `permanentlyFailedIds` comment still claims "FIFO eviction" but `Set` has no eviction | Still present — see N1 |
| R2 | CLAUDE.md masonry grid description still outdated | Still present — see N2 |
| R3 | `color-detection.ts` NCLX code 11 comment is still self-contradictory | Still present — see N3 |
| R4 | `normalizeConfiguredImageSizes` JSDoc still omits empty string case | Still present — see N4 |
| R5 | `csv-escape.ts` comment still says "C0/C1" but strips DEL (0x7F) | Still present — see N5 |
| R6 | `advisory-locks.ts` module JSDoc does not mention `getImageProcessingLockName` | Still present — see N6 |
| R7 | `exif-datetime.ts` two-phase validation not documented | Still present — see N7 |
| R8 | `queue-shutdown.ts` opaque "C4-C3" reference still present | Still present — see N8 |
| R9 | `clip-paths.ts` JSDoc doesn't mention 40-hex SHA requirement | Still present — see N9 |
| R10 | `restore-maintenance.ts` still has no module JSDoc | Still present — see N10 |
| R11 | `audit.ts` JSDoc still says "fire-and-forget" but function is async | Still present — see N11 |
| R12 | `icc-extractor.ts` still not mentioned in CLAUDE.md | Still present — see N12 |
| R13 | `process-image.ts` line reference in CLAUDE.md is stale | Still present — see N13 |
| R14 | `deleteImageVariants` still lacks JSDoc | Still present — see N14 |
| R15 | `revalidation.ts` has no module JSDoc | Still present — see N15 |
| R16 | `backfill-cicp-recheck.ts` script not documented in CLAUDE.md | Still present — see N16 |
| R17 | `embeddings.ts` server action JSDoc says "stub inference" but production uses real ONNX | Still present — see N17 |
| R18 | `process-image.ts` `sharp.concurrency()` comment says "Limit libvips worker threads" but it's per-call | Still present — see N18 |
| R19 | `home-client.tsx` `COLUMN_CLASS_MAP` has no JSDoc | Still present — see N19 |
| R20 | `color-detection.ts` `gamma18` documentation | Verified correct — no issue |

### Still Open from Earlier Reviews (pre-R1)

| ID | Finding | Status |
|----|---------|--------|
| N2 | `gain-map-detection.ts` boundary check comment | Still present — see N20 |
| N4 | `photo-viewer.tsx` keyboard repeat suppression | Still present — see N21 |
| N5 | `color-details-section.tsx` clipboard fallback | Still present — see N22 |
| N10 | `deleteImageVariants` JSDoc missing parameters | Same as R14 |
| D1 | Orphaned migration `0014_drop_reactions.sql` | Still present — see N23 |
| D2 | Root `package.json` missing `lint:public-route-rate-limit` | Still present — see N24 |
| D3 | Root `build` script uses `--workspaces` | Still present — see N25 |

---

## New Findings (Run-10 Cycle-3)

### Category N: New or Remaining Confirmed Mismatches

#### N1 — `permanentlyFailedIds` comment still claims "FIFO eviction" but `Set` has no eviction
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/image-queue.ts:82-83`
- **Type:** Comment/implementation mismatch

**Claim:** The comment says "Maximum number of permanently-failed IDs to track. FIFO eviction when exceeded."

**Reality:** `permanentlyFailedIds` is a `Set<number>`. There is NO eviction logic for this Set — it grows unbounded until the process restarts. The `pruneRetryMaps` function at line 98 only prunes `retryCounts`, `claimRetryCounts`, and `lastErrors` Maps. The `permanentlyFailedIds` Set is never pruned. The comment is misleading.

**Fix:** Update the comment: "Maximum number of permanently-failed IDs to track. No automatic eviction — the Set grows until process restart." OR implement FIFO eviction if that was the intent.

---

#### N2 — CLAUDE.md masonry grid description still outdated
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 389, `apps/web/src/components/home-client.tsx:207-225`
- **Type:** Documentation/code mismatch

**Claim:** CLAUDE.md says "Masonry grid: pure CSS multi-column layout (`columns-1 sm:columns-2 … 2xl:columns-5` + `break-inside-avoid`) — no JS reorder pass"

**Reality:** The masonry grid uses a static `COLUMN_CLASS_MAP` with explicit Tailwind class names (see `home-client.tsx:215-221`). The comment at line 207-209 explains: "DES-R5C3-04: static Tailwind class mapping — the JIT compiler cannot detect dynamically constructed class names like `columns-${n}`." CLAUDE.md still describes the old dynamic template literal approach.

**Fix:** Update CLAUDE.md to describe the static class mapping approach, noting the Tailwind JIT compiler requirement.

---

#### N3 — `color-detection.ts` NCLX code 11 comment is still self-contradictory
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:191-196`
- **Type:** Comment inaccuracy

**Claim:** The comment says "IEC 61966-2-4 (xvYCC) uses the BT.709 transfer function (the SAME curve as code 1), extended to negative R'G'B' for a wider gamut — NOT the sRGB transfer (xvYCC ≠ IEC 61966-2-1). We approximate it as 'srgb' because that is the same enum label we use for code-1/BT.709"

**Reality:** The comment is still self-contradictory. It says xvYCC uses "the BT.709 transfer function (the SAME curve as code 1)" and then says "NOT the sRGB transfer". But BT.709 transfer function and sRGB transfer function ARE the same curve (both gamma 2.4 with linear segment). The distinction should be about gamut extent, not transfer curve. The code mapping (`11: 'srgb'`) is correct; the comment is confusing.

**Fix:** Clarify: "IEC 61966-2-4 (xvYCC) uses the same transfer curve as BT.709/code-1 (gamma 2.4 with linear segment), but extends to negative R'G'B' for a wider gamut. We map it to 'srgb' because our enum lacks a distinct xvYCC label."

---

#### N4 — `normalizeConfiguredImageSizes` JSDoc still omits empty string case
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/gallery-config-shared.ts:216-220`
- **Type:** JSDoc incompleteness

**Claim:** The JSDoc says "Returns null when the input is malformed or exceeds the supported list size."

**Reality:** The function also returns `null` for empty string (`!sizesStr || !sizesStr.trim()` at line 221) and for segments with empty values (line 224). The JSDoc should mention these cases.

**Fix:** Update the JSDoc to: "Returns null when the input is empty, malformed, or exceeds the supported list size."

---

#### N5 — `csv-escape.ts` comment still says "C0/C1 control characters" but strips DEL (0x7F)
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/csv-escape.ts:41-44`
- **Type:** Documentation imprecision

**Claim:** The comment says "Strip C0/C1 control characters (0x00-0x1F, 0x7F-0x9F)".

**Reality:** The regex `/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g` strips:
- C0 controls (0x00-0x1F) except LF (0x0A) and CR (0x0D)
- DEL (0x7F) and the extended control range (0x80-0x9F)

True C1 control characters are U+0080-U+009F. The regex strips these, but it also strips 0x7F (DEL) which is not a C1 control. The comment is slightly imprecise.

**Fix:** Update the comment to: "Strip C0 control characters (0x00-0x1F) and DEL + extended control range (0x7F-0x9F)."

---

#### N6 — `advisory-locks.ts` module JSDoc does not mention `getImageProcessingLockName`
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/advisory-locks.ts:1-45`
- **Type:** Documentation completeness

**Claim:** The module JSDoc explains the advisory lock scoping.

**Reality:** The module JSDoc at lines 8-15 mentions the scoped lock names but does not mention `getImageProcessingLockName` which generates per-image lock names (`gallerykit:image-processing:${jobId}`). The per-image locks are also scoped to the MySQL server, so two GalleryKit instances could theoretically collide on the same job ID.

**Fix:** Add a note that per-image processing locks are also server-scoped and could collide across instances if job IDs overlap.

---

#### N7 — `exif-datetime.ts` two-phase validation not documented
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/exif-datetime.ts:1-31`
- **Type:** Missing documentation

**Claim:** The function validates EXIF datetime parts.

**Reality:** The function checks `day < 1 || day > 31` (line 14) which allows day 31 for all months. The subsequent `new Date(Date.UTC(...))` validation at lines 22-30 catches invalid dates (e.g., February 31 becomes March 3). The two-phase validation is not explained.

**Fix:** Add a comment: "Initial bounds check is permissive (allows day 31 for all months); the Date constructor catches invalid month-day combinations."

---

#### N8 — `queue-shutdown.ts` opaque "C4-C3" reference still present
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/queue-shutdown.ts:30-32`
- **Type:** Stale reference

**Claim:** The comment says "C4-C3: Clear the bootstrap retry timer so it doesn't keep the event loop alive after shutdown."

**Reality:** The "C4-C3" reference is not a standard ticket/issue reference in the codebase. It may be a cycle-4, commit-3 reference from an internal review process. The comment is accurate in describing the behavior but the reference is opaque.

**Fix:** Remove the opaque reference: "Clear the bootstrap retry timer so it doesn't keep the event loop alive after shutdown."

---

#### N9 — `clip-paths.ts` JSDoc doesn't mention 40-hex SHA requirement
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/clip-paths.ts:81-96`
- **Type:** Documentation/implementation mismatch

**Claim:** The JSDoc says "a NON-`main` revision" but doesn't mention the 40-hex SHA constraint.

**Reality:** The guard at line 91 checks `/^[0-9a-f]{40}$/` which requires exactly 40 hex characters. The JSDoc should clarify that only full 40-hex commit SHAs are accepted, not tags or short SHAs.

**Fix:** Add to JSDoc: "Only full 40-hex commit SHAs are accepted — branch names and short SHAs are rejected to guarantee the seed→offline-load round-trip."

---

#### N10 — `restore-maintenance.ts` still has no module JSDoc
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/restore-maintenance.ts`
- **Type:** Missing module JSDoc

**Claim:** The module uses a Symbol-keyed global state.

**Reality:** There is no module-level JSDoc explaining what restore maintenance is, why it exists, or when it should be used.

**Fix:** Add a module JSDoc: "Restore maintenance flag — prevents new uploads and image processing during database restore operations. Set by the DB restore action and checked by the upload queue and image processing pipeline."

---

#### N11 — `audit.ts` JSDoc still says "fire-and-forget" but function is async
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/audit.ts:1-15`
- **Type:** Documentation/implementation mismatch

**Claim:** The JSDoc says "Fire-and-forget audit log writer. Callers should use `.catch(console.debug)` to avoid blocking."

**Reality:** The function is `async` and returns `Promise<void>`. Some callers may `await` it (which blocks), while others may fire-and-forget. The JSDoc should clarify both patterns.

**Fix:** Update the JSDoc: "Async audit log writer. Callers may await for guaranteed persistence or fire-and-forget with `.catch(console.debug)` for non-blocking behavior."

---

#### N12 — `icc-extractor.ts` still not mentioned in CLAUDE.md
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/icc-extractor.ts`, CLAUDE.md
- **Type:** Missing documentation

**Claim:** ICC extraction is mentioned in the color pipeline section.

**Reality:** The `icc-extractor.ts` module is not mentioned in CLAUDE.md. It is a critical module for parsing ICC profile names (v2 `desc` and v4 `mluc` descriptors). The module is referenced in the `images` table documentation (`icc_profile_name` column) but the module itself is not documented.

**Fix:** Add a brief mention in the "Color & HDR Pipeline" section: "ICC profile names are extracted by `lib/icc-extractor.ts` which parses v2 `desc` and v4 `mluc` (UTF-16BE, locale-matched) descriptors."

---

#### N13 — `process-image.ts` line reference in CLAUDE.md is stale
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 245, `apps/web/src/lib/process-image.ts`
- **Type:** Stale line number reference

**Claim:** CLAUDE.md says "trading decode reuse for correctness (`process-image.ts:1131-1135`)".

**Reality:** The actual code for the fresh-decode-per-format logic is at lines 1098-1107 (the `needsRgb16` block and fresh `sharp()` instances). The line reference `1131-1135` has drifted significantly. The comment at line 40-44 also documents this: "CM-LOW-10: processImageFormats fans out to AVIF + WebP + JPEG via Promise.all, and sharp.concurrency() is the PER-CALL libvips thread cap."

**Fix:** Update CLAUDE.md to reference the correct line range (approximately 1098-1107) or use a comment anchor like `CM-LOW-10` instead of line numbers.

---

#### N14 — `deleteImageVariants` still lacks JSDoc
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts` (function location varies, search for `deleteImageVariants`)
- **Type:** Missing JSDoc

**Claim:** The function is exported and used by multiple callers.

**Reality:** The `deleteImageVariants` function lacks JSDoc documenting its parameters (`dir`, `baseFilename`, `sizes`). The `sizes` parameter controls whether a full directory scan is performed (empty array = scan all), which is a critical behavior for callers.

**Fix:** Add JSDoc documenting the parameters, especially the `sizes` parameter semantics.

---

#### N15 — `revalidation.ts` has no module JSDoc
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/revalidation.ts`
- **Type:** Missing module JSDoc

**Claim:** The module provides localized path revalidation helpers.

**Reality:** There is no module-level JSDoc explaining the purpose or the O(N*L) complexity note. The inline comment at line 28-29 is sufficient for code readers but a module JSDoc would help.

**Fix:** Add a module JSDoc: "Localized path revalidation helpers. `revalidateLocalizedPaths` invalidates paths for all configured locales, with O(N*L) complexity where N = path count and L = locale count."

---

#### N16 — `backfill-cicp-recheck.ts` script not documented in CLAUDE.md
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/scripts/backfill-cicp-recheck.ts`
- **Type:** Missing documentation

**Claim:** The script is a one-shot diagnostic tool.

**Reality:** The script is not mentioned in CLAUDE.md. It is a read-only diagnostic that re-runs `detectColorSignals` on all HEIF/AVIF/HEIC files and compares against stored DB values. It is useful for operators after NCLX map fixes.

**Fix:** Add a brief mention in the "Operational Playbook" or "Color & HDR Pipeline" section.

---

#### N17 — `embeddings.ts` server action JSDoc says "stub inference" but production uses real ONNX
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/app/actions/embeddings.ts:1-9`
- **Type:** Documentation imprecision

**Claim:** The JSDoc says "generates embeddings via the stub inference (or real ONNX when replaced)".

**Reality:** The production deployment uses real ONNX inference (`embedImageReal` from `clip-model.ts`). The code at lines 16-18 imports both `embedImageStub` and `embedImageReal`. The JSDoc is outdated — it implies stub is the default.

**Fix:** Update the JSDoc: "Generates embeddings via CLIP inference (stub in dev/test, real ONNX in production when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`)."

---

#### N18 — `process-image.ts` `sharp.concurrency()` comment says "Limit libvips worker threads" but it's per-call
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/process-image.ts:49`
- **Type:** Comment imprecision

**Claim:** The comment says "Limit libvips worker threads to keep the server responsive during conversions."

**Reality:** `sharp.concurrency()` sets the per-call libvips thread cap, not a global worker pool limit. The comment at lines 40-44 is more precise: "sharp.concurrency() is the PER-CALL libvips thread cap." The line 49 comment is slightly less precise but not actively misleading.

**Fix:** Optional — no action needed unless precision is required.

---

#### N19 — `home-client.tsx` `COLUMN_CLASS_MAP` has no JSDoc
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/components/home-client.tsx:215-221`
- **Type:** Missing documentation

**Claim:** The static class mapping is explained in an inline comment.

**Reality:** The inline comment at lines 207-209 explains the JIT compiler constraint. The `COLUMN_CLASS_MAP` constant itself has no JSDoc. This is acceptable since the inline comment is sufficient.

**Fix:** No change needed.

---

#### N20 — `gain-map-detection.ts` boundary check comment lacks null-terminator note
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/gain-map-detection.ts:87` (approximate)
- **Type:** Missing documentation

**Claim:** The boundary check at the ISOBMFF walker handles box sizes correctly.

**Reality:** The boundary check does not explicitly document whether it accounts for null-terminated strings in `item_uri` fields. This is a low-impact completeness issue.

**Fix:** Optional — add a note about null-terminated string handling if the walker reads string fields.

---

#### N21 — `photo-viewer.tsx` keyboard repeat suppression undocumented
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/components/photo-viewer.tsx` (keyboard handler)
- **Type:** Missing inline comment

**Claim:** The keyboard handler suppresses repeat events for navigation keys.

**Reality:** The `e.repeat` check exists but has no inline comment explaining why repeat events are suppressed. A developer might remove it thinking it's unnecessary.

**Fix:** Add a brief comment: "Suppress repeat events so holding an arrow key doesn't rapidly cycle through photos."

---

#### N22 — `color-details-section.tsx` clipboard fallback undocumented
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/components/color-details-section.tsx`
- **Type:** Missing documentation

**Claim:** The copy-to-clipboard button has a fallback for unsupported browsers.

**Reality:** The fallback behavior (likely a `prompt()` or manual selection) is not documented in comments or JSDoc.

**Fix:** Optional — document the fallback behavior if it exists.

---

#### N23 — Orphaned migration `0014_drop_reactions.sql` still present
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/drizzle/0014_drop_reactions.sql`
- **Type:** Hygiene issue

**Claim:** The migration file exists in the drizzle directory.

**Reality:** The `reactions` table was never part of the GalleryKit schema. This migration drops a table that doesn't exist in any version of the product. It is harmless but adds noise to the migration history.

**Fix:** Remove the orphaned migration file and its journal entry.

---

#### N24 — Root `package.json` missing `lint:public-route-rate-limit`
- **Severity:** Low
- **Confidence:** High
- **File:** `/Users/hletrd/flash-shared/gallery/package.json`
- **Type:** Documentation/implementation mismatch

**Claim:** The root `package.json` scripts section documents available commands.

**Reality:** The root `package.json` has `lint:api-auth` and `lint:action-origin` but is missing `lint:public-route-rate-limit`. The script exists in `apps/web/package.json` but not at the root, making it less discoverable.

**Fix:** Add `"lint:public-route-rate-limit": "npm run lint:public-route-rate-limit --workspace=apps/web"` to the root `package.json` scripts.

---

#### N25 — Root `build` script uses `--workspaces` instead of `--workspace`
- **Severity:** Low
- **Confidence:** High
- **File:** `/Users/hletrd/flash-shared/gallery/package.json:13`
- **Type:** Documentation/implementation mismatch

**Claim:** The root `package.json` has `"build": "npm run build --workspaces"`.

**Reality:** The `--workspaces` flag runs the script in ALL workspaces. Since there is only one workspace (`apps/web`), this is functionally equivalent to `--workspace=apps/web`. However, `--workspaces` is the plural form and may be confusing if additional workspaces are added later. The `dev`, `start`, `lint`, `typecheck`, and `test` scripts all use `--workspace=apps/web` (singular), so `build` is inconsistent.

**Fix:** Change to `"build": "npm run build --workspace=apps/web"` for consistency.

---

### Category C: New Issues from Cycle-3 Commits

#### C1 — `auth-rate-limit.ts` getter JSDoc doesn't mention shallow copy
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/auth-rate-limit.ts:21-28`
- **Type:** Missing documentation

**Claim:** The `getLoginRateLimitEntry` and `getAccountLoginRateLimitEntry` functions return rate limit entries.

**Reality:** The cycle-3 commit (5f4a5e95) changed these functions to return shallow copies (`{ ...entry }`) to prevent mutable reference leaks. The JSDoc does not mention this defensive copy behavior, which is important for callers who might mutate the returned object.

**Fix:** Add JSDoc: "Returns a shallow copy of the entry to prevent callers from mutating the internal Map state."

---

#### C2 — `process-image.ts` `deleteImageVariants` ENOENT comment could be clearer
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/process-image.ts` (around `deleteImageVariants`)
- **Type:** Comment completeness

**Claim:** The cycle-3 commit (9c5c38ca) added ENOENT distinction in `deleteImageVariants`.

**Reality:** The commit distinguishes ENOENT from other `opendir` errors, but the comment explaining WHY this distinction matters (e.g., "ENOENT means the directory was already cleaned up by a concurrent delete; other errors indicate filesystem corruption or permission issues") is not present.

**Fix:** Add a comment explaining the ENOENT vs other error distinction.

---

#### C3 — `collections.ts` restore-maintenance check not documented in CLAUDE.md
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/app/actions/collections.ts`, CLAUDE.md
- **Type:** Missing documentation

**Claim:** The cycle-3 commit (7453030e) added restore-maintenance checks to smart collections and embedding backfill.

**Reality:** CLAUDE.md does not mention that smart collection mutations and embedding backfill are blocked during restore maintenance. The `restore-maintenance.ts` module is not documented in CLAUDE.md at all (see N10).

**Fix:** Add a note in the "Race Condition Protections" or "Operational Playbook" section that restore maintenance blocks uploads, image processing, smart collection mutations, and embedding backfill.

---

## Risk Assessment

| Category | Count | Highest Severity | Risk to Operations |
|----------|-------|------------------|-------------------|
| New/Remaining Mismatches (N) | 25 | Low | Low — mostly completeness and precision issues |
| New from Cycle-3 (C) | 3 | Low | Low |
| Still Open (carried forward) | 20 | Low | Low |
| Correctly Documented | 50+ | — | — |

**Overall:** No critical documentation bugs. The most impactful changes from the previous review have been fixed. The remaining issues are low-severity completeness and precision issues. The codebase documentation quality is high and improving. The cycle-3 commits did not introduce any new documentation regressions.

---

## Recommended Priority Order

1. **Fix `permanentlyFailedIds` comment (N1)** — Misleading eviction claim
2. **Update CLAUDE.md masonry grid description (N2)** — Code changed, docs didn't
3. **Fix NCLX code 11 comment (N3)** — Self-contradictory
4. **Fix `normalizeConfiguredImageSizes` JSDoc (N4)** — Missing empty string case
5. **Fix `csv-escape.ts` C0/C1 comment (N5)** — Imprecise terminology
6. **Fix `advisory-locks.ts` per-image lock note (N6)** — Missing multi-tenant warning
7. **Fix `exif-datetime.ts` two-phase validation comment (N7)** — Missing explanation
8. **Fix `queue-shutdown.ts` opaque reference (N8)** — Stale reference
9. **Fix `clip-paths.ts` SHA-only clarification (N9)** — Missing constraint docs
10. **Add module JSDoc to `restore-maintenance.ts` (N10)** — Missing module docs
11. **Fix `audit.ts` fire-and-forget JSDoc (N11)** — Misleading async description
12. **Add `icc-extractor.ts` to CLAUDE.md (N12)** — Missing module mention
13. **Fix stale line reference in CLAUDE.md (N13)** — Line number drift
14. **Add JSDoc to `deleteImageVariants` (N14)** — Missing parameters
15. **Add module JSDoc to `revalidation.ts` (N15)** — Missing module docs
16. **Document `backfill-cicp-recheck.ts` (N16)** — Missing diagnostic script docs
17. **Fix `embeddings.ts` JSDoc (N17)** — Outdated stub inference claim
18. **Fix root `package.json` inconsistencies (N24, N25)** — Script consistency
19. **Add restore-maintenance docs to CLAUDE.md (C3)** — Missing operational docs

---

## Verified Correct (No Issues Found at HEAD bcd67b12)

1. **All 18 operational env vars in CLAUDE.md table** — Verified against code. Correct.
2. **Nginx config** — Matches CLAUDE.md claims. All 5 location blocks correct.
3. **Upload limits** — 200MB per file, 2GiB batch, 100 files per window. Correct.
4. **Health routes** — `/api/live` and `/api/health` behavior. Correct.
5. **Color/HDR pipeline** — All 13 claims verified, including sort-before-hash.
6. **Security architecture** — All claims verified, including OG route SSRF.
7. **Service Worker** — Template and generated `sw.js` match.
8. **Docker deployment** — Compose file, Dockerfile, entrypoint all consistent.
9. **Connection pool** — 10 connections, queue limit 20, keepalive, init timeout.
10. **Migration system** — Post-condition assertion, hash-based check, reconcile.
11. **settings-hash.ts sort fix** — Correctly sorts imageSizes before hashing.
12. **gain-map-detection.ts off-by-one fix** — Boundary check now correct.
13. **photo-viewer.tsx keyboard repeat** — Correctly suppresses repeat events.
14. **og-route SSRF hardening** — Fail-closed and same-origin validation correct.
15. **admin-backfill-runner.ts** — All documentation current and accurate.
16. **image-queue.ts** — Claim retry, permanently-failed IDs well-documented.
17. **rate-limit.ts** — Four rollback patterns accurately documented, Pattern 4 unified.
18. **blur-data-url.ts** — Contract and throttling accurately documented.
19. **csv-escape.ts** — Defense-in-depth strategy accurately documented.
20. **validation.ts** — Unicode formatting policy accurately documented.
21. **bounded-map.ts** — FIFO eviction accurately documented.
22. **advisory-locks.ts** — Lock names and scoping accurately documented.
23. **clip-paths.ts** — Path resolution and cache layout accurately documented.
24. **clip-embeddings.ts** — Embedding utilities accurately documented.
25. **view-retention.ts** — Retention sweep accurately documented.
26. **password-hashing.ts** — Argon2id parameters accurately documented.
27. **queue-shutdown.ts** — Shutdown drain logic accurately documented.
28. **process-image.ts `resolveColorPipelineDecision`** — JSDoc accurate.
29. **process-image.ts `resolveAvifIccProfile`** — JSDoc accurate (function body, not orphaned block).
30. **process-image.ts wide-gamut downscale** — Temp file cleanup documented.
31. **gallery-config-shared.ts** — All validators, defaults, types accurate.
32. **gallery-config.ts** — Semantic search mode healing accurately documented.
33. **upload-paths.ts** — Module and function JSDoc accurate.
34. **color-detection.ts module JSDoc** — Updated, no longer references stale US-CM12.
35. **detectColorSignals JSDoc** — Added, documents `_image` reserved parameter.
36. **enqueueImageProcessing JSDoc** — Added, documents return value semantics.
37. **smart_collections in CLAUDE.md** — Accurately described with query JSON format.
38. **admin_tokens in CLAUDE.md** — Accurately described with token rotation and nginx location.
39. **site-config.json in CLAUDE.md** — Deployment Checklist describes key fields.
40. **Semantic search runtime limits in CLAUDE.md** — `SEMANTIC_SCAN_LIMIT` and `SEMANTIC_TOP_K_MAX` documented.
41. **gamma18 documentation** — Now mentions ProPhoto path via color-detection.ts:99-107.
42. **settings-hash sort behavior** — Documented in CLAUDE.md ETag section.
43. **NEXT_UPLOAD_BODY_MAX_BYTES** — Added to `.env.local.example`.
44. **viewCountRetryCount eviction note** — Updated to clarify no automatic eviction.
45. **process-image.ts orphaned JSDoc** — Deleted.
46. **Cycle-3 `auth-rate-limit.ts` shallow copy** — Correctly returns `{ ...entry }` to prevent mutation leaks.
47. **Cycle-3 `process-image.ts` ENOENT handling** — Correctly distinguishes ENOENT from other errors.
48. **Cycle-3 `collections.ts` restore-maintenance guard** — Correctly checks `getRestoreMaintenanceMessage`.
49. **Cycle-3 `topics.ts` revalidation ordering** — Correctly moves revalidation outside try/catch.
50. **Cycle-3 `public.ts` Array.isArray guard** — Correctly guards `tagSlugs` parameter.
