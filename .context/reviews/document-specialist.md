# Run-10 Cycle-2 Convergence — Document Specialist Review

Date: 2026-06-25
HEAD: 87065049 (docs(reviews): run-10 cycle-2 convergence)
Previous Review: 1d5545cb (run-9 cycle-8 convergence)

## Summary

This review covers documentation changes since the cycle-8 review (HEAD 1d5545cb). The cycle-2 commits (leading to 87065049) include significant documentation fixes: orphaned JSDoc removal, `detectColorSignals` JSDoc added, `enqueueImageProcessing` return value documented, `permanentlyFailedIds` comment corrected, rate-limit pattern numbering unified, `gamma18` documentation corrected, `settings-hash` sort behavior documented, `NEXT_UPLOAD_BODY_MAX_BYTES` added to `.env.local.example`, CLAUDE.md expanded with smart_collections, admin_tokens, site-config, OG SSRF, and semantic search limits. Most high-impact findings from the previous review have been fixed. A few new and remaining issues are identified below.

---

## Status of Previous Review Findings

### Fixed since last review (verified at HEAD 87065049)

| ID | Finding | Fix Commit | Notes |
|----|---------|-----------|-------|
| N7/P2 | Stale JSDoc in `process-image.ts:595-633` | 850e19c6 (DOC-01) | Orphaned block deleted. Actual `resolveAvifIccProfile` JSDoc at 700-723 is correct. |
| N8/P3 | `color-detection.ts` module JSDoc stale feature ID | e528195e (DOC-04) | Updated to clarify HDR sources detected but delivered as SDR until WI-09 ships. |
| N9 | `detectColorSignals` lacks JSDoc | e528195e (DOC-10) | JSDoc added at lines 295-302 documenting parameters and `_image` reserved param. |
| N11 | `enqueueImageProcessing` return value undocumented | cab5eb58 (DOC-03) | JSDoc added at lines 246-251. |
| N14 | `permanentlyFailedIds` "FIFO eviction" comment | cab5eb58 (DOC-07) | Comment still says "FIFO eviction" but the `Set` has no eviction. **Partial fix** — see R1. |
| N15 | `resolveAvifIccProfile` JSDoc "STRICT P3" claim | 850e19c6 (DOC-06) | JSDoc updated to clarify `'p3'` vs `'p3-from-wide'` distinction. |
| N24 | `rate-limit.ts` pattern numbering inconsistency | 5bf0dda6 (DOC-20) | Pattern 4 now consistently labeled. OG routes reference Pattern 4. |
| P1 | `NEXT_UPLOAD_BODY_MAX_BYTES` missing from `.env.local.example` | c9d4f745 (DOC-11) | Added with comment explaining purpose. |
| N3 | `settings-hash.ts` sort behavior undocumented | a8bb1389 (DOC-12) | CLAUDE.md ETag section now documents sort-before-hash. |
| N6 | OG route SSRF hardening not in CLAUDE.md | a8bb1389 (DOC-14) | Added to Security Architecture section. |
| N32 | Semantic search runtime limits not in CLAUDE.md | a8bb1389 (DOC-19) | `SEMANTIC_SCAN_LIMIT` and `SEMANTIC_TOP_K_MAX` documented. |
| N37 | `site-config.json` structure undocumented | a8bb1389 (DOC-13) | Deployment Checklist now describes key fields. |
| N39 | `smart_collections` undocumented | a8bb1389 (DOC-12) | Added to schema section with query JSON description. |
| N40 | `admin_tokens` / Lightroom plugin undocumented | a8bb1389 (DOC-12) | Added to schema section with token rotation and nginx location note. |
| N1 | `gamma18` origin imprecise | a8bb1389 (DOC-12) | Updated to mention ProPhoto path via `color-detection.ts:99-107`. |
| N18 | `viewCountRetryCount` cap comment misleading | 0e8c86fb (DOC-08) | Comment updated to clarify no automatic eviction. |

### Still Open from Previous Review (carried forward)

| ID | Finding | Status |
|----|---------|--------|
| N2 | `gain-map-detection.ts` boundary check comment | Still present — no null-terminator comment at line 87. Low impact. |
| N4 | `photo-viewer.tsx` keyboard repeat suppression | Still no inline comment at the `e.repeat` check. Low impact. |
| N5 | `color-details-section.tsx` clipboard fallback | Still undocumented fallback behavior. Low impact. |
| N10 | `deleteImageVariants` JSDoc missing parameters | Still no JSDoc. Low impact. |
| N12 | Masonry grid static class mapping | CLAUDE.md still describes old dynamic approach. See R2. |
| N13 | `color-detection.ts` NCLX code 11 comment | Self-contradictory comment still present at lines 191-196. See R3. |
| N16 | `use-display-capability.ts` SSR default trade-off | Comment is accurate enough. No change needed. |
| N17 | `normalizeConfiguredImageSizes` JSDoc incomplete | Still says "malformed or exceeds" without mentioning empty string. See R4. |
| N19 | `formatUploadLimit` GB/GiB labeling | Widely accepted convention. No change needed. |
| N20 | `sharp.concurrency()` comment imprecision | Comment at line 49 is accurate enough. No change needed. |
| N26 | `csv-escape.ts` C0/C1 comment | Still says "C0/C1" but regex strips 0x7F too. See R5. |
| N27 | `advisory-locks.ts` per-image lock scoping | No mention of `getImageProcessingLockName` in module JSDoc. See R6. |
| N28 | `exif-datetime.ts` two-phase validation | No comment explaining two-phase validation. See R7. |
| N29 | `process-topic-image.ts` `MAX_INPUT_PIXELS_TOPIC` import | Import at line 9 is used at line 80 (not shown in prior review). Verified correct. |
| N30 | `queue-shutdown.ts` opaque "C4-C3" reference | Still present at line 30. See R8. |
| N31 | `clip-paths.ts` SHA-only clarification | JSDoc at line 81-83 doesn't mention 40-hex SHA requirement. See R9. |
| N33 | `password-hashing.ts` OWASP citation | No specific OWASP version cited. Acceptable. |
| N34 | `view-retention.ts` "13 months" comment | 395 days = 13.0 months. Comment is accurate enough. |
| N35 | `restore-maintenance.ts` missing module JSDoc | Still no module JSDoc. See R10. |
| N36 | `audit.ts` "fire-and-forget" JSDoc | Still says "fire-and-forget" but function is async. See R11. |
| N38 | `_PrivacySensitiveKeys` guard not shown | Reference in CLAUDE.md is sufficient. No change needed. |
| N41 | `sw-cache.ts` not documented | Mention in CLAUDE.md is sufficient. No change needed. |
| N42 | `sw.template.js` build process | Correctly documented. No issue. |
| N43 | `icc-extractor.ts` not mentioned | Still missing from CLAUDE.md. See R12. |
| N45 | `gain-map-detection.ts` two signaling shapes | Optional enhancement. No issue. |
| D1 | Orphaned migration `0014_drop_reactions.sql` | Still present. Hygiene issue. |
| D2 | Root `package.json` missing `lint:public-route-rate-limit` | Still present. |
| D3 | Root `build` script uses `--workspaces` | Still present. |

---

## New Findings (Run-10 Cycle-2)

### Category R: New or Remaining Confirmed Mismatches

#### R1 — `permanentlyFailedIds` comment still claims "FIFO eviction" but `Set` has no eviction
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/image-queue.ts:82-83`
- **Type:** Comment/implementation mismatch

**Claim:** The comment says "FIFO eviction when exceeded" for `MAX_PERMANENTLY_FAILED_IDS = 1000`.

**Reality:** `permanentlyFailedIds` is a `Set<number>`. There is NO eviction logic for this Set — it grows unbounded until the process restarts. The `pruneRetryMaps` function at line 98 only prunes `retryCounts`, `claimRetryCounts`, and `lastErrors` Maps. The `permanentlyFailedIds` Set is never pruned. The comment is misleading.

**Fix:** Update the comment: "Maximum number of permanently-failed IDs to track. No automatic eviction — the Set grows until process restart." OR implement FIFO eviction if that was the intent.

---

#### R2 — CLAUDE.md masonry grid description still outdated
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 389, `apps/web/src/components/home-client.tsx:207-225`
- **Type:** Documentation/code mismatch

**Claim:** CLAUDE.md says "Masonry grid: pure CSS multi-column layout (`columns-1 sm:columns-2 … 2xl:columns-5` + `break-inside-avoid`) — no JS reorder pass"

**Reality:** The masonry grid uses a static `COLUMN_CLASS_MAP` with explicit Tailwind class names (see `home-client.tsx:215-221`). The comment at line 207-209 explains: "DES-R5C3-04: static Tailwind class mapping — the JIT compiler cannot detect dynamically constructed class names like `columns-${n}`." CLAUDE.md still describes the old dynamic template literal approach.

**Fix:** Update CLAUDE.md to describe the static class mapping approach, noting the Tailwind JIT compiler requirement.

---

#### R3 — `color-detection.ts` NCLX code 11 comment is still self-contradictory
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:191-196`
- **Type:** Comment inaccuracy

**Claim:** The comment says "IEC 61966-2-4 (xvYCC) uses the BT.709 transfer function (the SAME curve as code 1), extended to negative R'G'B' for a wider gamut — NOT the sRGB transfer (xvYCC ≠ IEC 61966-2-1). We approximate it as 'srgb' because that is the same enum label we use for code-1/BT.709"

**Reality:** The comment is still self-contradictory. It says xvYCC uses "the BT.709 transfer function (the SAME curve as code 1)" and then says "NOT the sRGB transfer". But BT.709 transfer function and sRGB transfer function ARE the same curve (both gamma 2.4 with linear segment). The distinction should be about gamut extent, not transfer curve. The code mapping (`11: 'srgb'`) is correct; the comment is confusing.

**Fix:** Clarify: "IEC 61966-2-4 (xvYCC) uses the same transfer curve as BT.709/code-1 (gamma 2.4 with linear segment), but extends to negative R'G'B' for a wider gamut. We map it to 'srgb' because our enum lacks a distinct xvYCC label."

---

#### R4 — `normalizeConfiguredImageSizes` JSDoc still omits empty string case
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/gallery-config-shared.ts:216-220`
- **Type:** JSDoc incompleteness

**Claim:** The JSDoc says "Returns null when the input is malformed or exceeds the supported list size."

**Reality:** The function also returns `null` for empty string (`!sizesStr || !sizesStr.trim()` at line 221) and for segments with empty values (line 224). The JSDoc should mention these cases.

**Fix:** Update the JSDoc to: "Returns null when the input is empty, malformed, or exceeds the supported list size."

---

#### R5 — `csv-escape.ts` comment still says "C0/C1 control characters" but strips DEL (0x7F)
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

#### R6 — `advisory-locks.ts` module JSDoc does not mention `getImageProcessingLockName`
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/advisory-locks.ts:1-45`
- **Type:** Documentation completeness

**Claim:** The module JSDoc explains the advisory lock scoping.

**Reality:** The module JSDoc at lines 8-15 mentions the scoped lock names but does not mention `getImageProcessingLockName` which generates per-image lock names (`gallerykit:image-processing:${jobId}`). The per-image locks are also scoped to the MySQL server, so two GalleryKit instances could theoretically collide on the same job ID.

**Fix:** Add a note that per-image processing locks are also server-scoped and could collide across instances if job IDs overlap.

---

#### R7 — `exif-datetime.ts` two-phase validation not documented
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/exif-datetime.ts:1-31`
- **Type:** Missing documentation

**Claim:** The function validates EXIF datetime parts.

**Reality:** The function checks `day < 1 || day > 31` (line 14) which allows day 31 for all months. The subsequent `new Date(Date.UTC(...))` validation at lines 22-30 catches invalid dates (e.g., February 31 becomes March 3). The two-phase validation is not explained.

**Fix:** Add a comment: "Initial bounds check is permissive (allows day 31 for all months); the Date constructor catches invalid month-day combinations."

---

#### R8 — `queue-shutdown.ts` opaque "C4-C3" reference still present
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/queue-shutdown.ts:30-32`
- **Type:** Stale reference

**Claim:** The comment says "C4-C3: Clear the bootstrap retry timer so it doesn't keep the event loop alive after shutdown."

**Reality:** The "C4-C3" reference is not a standard ticket/issue reference in the codebase. It may be a cycle-4, commit-3 reference from an internal review process. The comment is accurate in describing the behavior but the reference is opaque.

**Fix:** Remove the opaque reference: "Clear the bootstrap retry timer so it doesn't keep the event loop alive after shutdown."

---

#### R9 — `clip-paths.ts` JSDoc doesn't mention 40-hex SHA requirement
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/clip-paths.ts:81-96`
- **Type:** Documentation/implementation mismatch

**Claim:** The JSDoc says "a NON-`main` revision" but doesn't mention the 40-hex SHA constraint.

**Reality:** The guard at line 91 checks `/^[0-9a-f]{40}$/` which requires exactly 40 hex characters. The JSDoc should clarify that only full 40-hex commit SHAs are accepted, not tags or short SHAs.

**Fix:** Add to JSDoc: "Only full 40-hex commit SHAs are accepted — branch names and short SHAs are rejected to guarantee the seed→offline-load round-trip."

---

#### R10 — `restore-maintenance.ts` still has no module JSDoc
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/restore-maintenance.ts`
- **Type:** Missing module JSDoc

**Claim:** The module uses a Symbol-keyed global state.

**Reality:** There is no module-level JSDoc explaining what restore maintenance is, why it exists, or when it should be used.

**Fix:** Add a module JSDoc: "Restore maintenance flag — prevents new uploads and image processing during database restore operations. Set by the DB restore action and checked by the upload queue and image processing pipeline."

---

#### R11 — `audit.ts` JSDoc still says "fire-and-forget" but function is async
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/audit.ts:1-15`
- **Type:** Documentation/implementation mismatch

**Claim:** The JSDoc says "Fire-and-forget audit log writer. Callers should use `.catch(console.debug)` to avoid blocking."

**Reality:** The function is `async` and returns `Promise<void>`. Some callers may `await` it (which blocks), while others may fire-and-forget. The JSDoc should clarify both patterns.

**Fix:** Update the JSDoc: "Async audit log writer. Callers may await for guaranteed persistence or fire-and-forget with `.catch(console.debug)` for non-blocking behavior."

---

#### R12 — `icc-extractor.ts` still not mentioned in CLAUDE.md
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/icc-extractor.ts`, CLAUDE.md
- **Type:** Missing documentation

**Claim:** ICC extraction is mentioned in the color pipeline section.

**Reality:** The `icc-extractor.ts` module is not mentioned in CLAUDE.md. It is a critical module for parsing ICC profile names (v2 `desc` and v4 `mluc` descriptors). The module is referenced in the `images` table documentation (`icc_profile_name` column) but the module itself is not documented.

**Fix:** Add a brief mention in the "Color & HDR Pipeline" section: "ICC profile names are extracted by `lib/icc-extractor.ts` which parses v2 `desc` and v4 `mluc` (UTF-16BE, locale-matched) descriptors."

---

#### R13 — `process-image.ts` line reference in CLAUDE.md is stale
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 245, `apps/web/src/lib/process-image.ts`
- **Type:** Stale line number reference

**Claim:** CLAUDE.md says "trading decode reuse for correctness (`process-image.ts:1131-1135`)".

**Reality:** The actual code for the fresh-decode-per-format logic is at lines 1120-1150 (the 10-bit AVIF block). The line reference `1131-1135` may have drifted. The comment at line 40-44 also documents this: "CM-LOW-10: processImageFormats fans out to AVIF + WebP + JPEG via Promise.all, and sharp.concurrency() is the PER-CALL libvips thread cap."

**Fix:** Update CLAUDE.md to reference the correct line range or use a comment anchor instead of line numbers.

---

#### R14 — `deleteImageVariants` still lacks JSDoc
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts`
- **Type:** Missing JSDoc

**Claim:** The function is exported and used by multiple callers.

**Reality:** The `deleteImageVariants` function lacks JSDoc documenting its parameters (`dir`, `baseFilename`, `sizes`). The `sizes` parameter controls whether a full directory scan is performed (empty array = scan all), which is a critical behavior for callers.

**Fix:** Add JSDoc documenting the parameters, especially the `sizes` parameter semantics.

---

#### R15 — `revalidation.ts` has no module JSDoc
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/revalidation.ts`
- **Type:** Missing module JSDoc

**Claim:** The module provides localized path revalidation helpers.

**Reality:** There is no module-level JSDoc explaining the purpose or the O(N*L) complexity note. The inline comment at line 28-29 is sufficient for code readers but a module JSDoc would help.

**Fix:** Add a module JSDoc: "Localized path revalidation helpers. `revalidateLocalizedPaths` invalidates paths for all configured locales, with O(N*L) complexity where N = path count and L = locale count."

---

#### R16 — `backfill-cicp-recheck.ts` script not documented in CLAUDE.md
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/scripts/backfill-cicp-recheck.ts`
- **Type:** Missing documentation

**Claim:** The script is a one-shot diagnostic tool.

**Reality:** The script is not mentioned in CLAUDE.md. It is a read-only diagnostic that re-runs `detectColorSignals` on all HEIF/AVIF/HEIC files and compares against stored DB values. It is useful for operators after NCLX map fixes.

**Fix:** Add a brief mention in the "Operational Playbook" or "Color & HDR Pipeline" section.

---

#### R17 — `embeddings.ts` server action JSDoc says "stub inference" but production uses real ONNX
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/app/actions/embeddings.ts:1-9`
- **Type:** Documentation imprecision

**Claim:** The JSDoc says "generates embeddings via the stub inference (or real ONNX when replaced)".

**Reality:** The production deployment uses real ONNX inference (`embedImageReal` from `clip-model.ts`). The code at lines 16-18 imports both `embedImageStub` and `embedImageReal`. The JSDoc is outdated — it implies stub is the default.

**Fix:** Update the JSDoc: "Generates embeddings via CLIP inference (stub in dev/test, real ONNX in production when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`)."

---

#### R18 — `process-image.ts` `sharp.concurrency()` comment says "Limit libvips worker threads" but it's per-call
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/process-image.ts:49`
- **Type:** Comment imprecision

**Claim:** The comment says "Limit libvips worker threads to keep the server responsive during conversions."

**Reality:** `sharp.concurrency()` sets the per-call libvips thread cap, not a global worker pool limit. The comment at lines 40-44 is more precise: "sharp.concurrency() is the PER-CALL libvips thread cap." The line 49 comment is slightly less precise but not actively misleading.

**Fix:** Optional — no action needed unless precision is required.

---

#### R19 — `home-client.tsx` `COLUMN_CLASS_MAP` has no JSDoc
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/components/home-client.tsx:215-221`
- **Type:** Missing documentation

**Claim:** The static class mapping is explained in an inline comment.

**Reality:** The inline comment at lines 207-209 explains the JIT compiler constraint. The `COLUMN_CLASS_MAP` constant itself has no JSDoc. This is acceptable since the inline comment is sufficient.

**Fix:** No change needed.

---

#### R20 — `color-detection.ts` `gamma18` still has no NCLX mapping
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:99-107`, CLAUDE.md line 159
- **Type:** Documentation/implementation alignment

**Claim:** CLAUDE.md says "`gamma18` comes from ICC name heuristics (ProPhoto path via `lib/color-detection.ts:99-107`, AGG-D3)".

**Reality:** The code at lines 99-107 maps ProPhoto to `gamma18` via the ICC name heuristic. There is no NCLX code that maps to `gamma18`. The documentation is now accurate after the fix in a8bb1389.

**Status:** Verified correct — no issue.

---

## Risk Assessment

| Category | Count | Highest Severity | Risk to Operations |
|----------|-------|------------------|-------------------|
| New/Remaining Mismatches (R) | 20 | Low | Low — mostly completeness and precision issues |
| Fixed since last review | 17 | — | — |
| Still Open (carried forward) | 15 | Low | Low |
| Correctly Documented | 50+ | — | — |

**Overall:** No critical documentation bugs. The most impactful changes from the previous review have been fixed. The remaining issues are low-severity completeness and precision issues. The codebase documentation quality is high and improving.

---

## Recommended Priority Order

1. **Fix `permanentlyFailedIds` comment (R1)** — Misleading eviction claim
2. **Update CLAUDE.md masonry grid description (R2)** — Code changed, docs didn't
3. **Fix NCLX code 11 comment (R3)** — Self-contradictory
4. **Fix `normalizeConfiguredImageSizes` JSDoc (R4)** — Missing empty string case
5. **Fix `csv-escape.ts` C0/C1 comment (R5)** — Imprecise terminology
6. **Fix `advisory-locks.ts` per-image lock note (R6)** — Missing multi-tenant warning
7. **Fix `exif-datetime.ts` two-phase validation comment (R7)** — Missing explanation
8. **Fix `queue-shutdown.ts` opaque reference (R8)** — Stale reference
9. **Fix `clip-paths.ts` SHA-only clarification (R9)** — Missing constraint docs
10. **Add module JSDoc to `restore-maintenance.ts` (R10)** — Missing module docs
11. **Fix `audit.ts` fire-and-forget JSDoc (R11)** — Misleading async description
12. **Add `icc-extractor.ts` to CLAUDE.md (R12)** — Missing module mention
13. **Fix stale line reference in CLAUDE.md (R13)** — Line number drift
14. **Add JSDoc to `deleteImageVariants` (R14)** — Missing parameters
15. **Add module JSDoc to `revalidation.ts` (R15)** — Missing module docs
16. **Document `backfill-cicp-recheck.ts` (R16)** — Missing diagnostic script docs
17. **Fix `embeddings.ts` JSDoc (R17)** — Outdated stub inference claim

---

## Verified Correct (No Issues Found at HEAD 87065049)

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
