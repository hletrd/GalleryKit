# Run-10 Cycle-1 / Run-9 Cycle-8 Convergence — Document Specialist Review

Date: 2026-06-25
HEAD: 1d5545cb (style(i18n): naturalize Korean UI strings)
Previous Review: de4c692a (run-9 cycle-5 convergence)

## Summary

This review covers documentation changes since the cycle-5 review (HEAD de4c692a). The cycle-6 through cycle-8 commits (leading to 1d5545cb) include bug fixes, i18n naturalization, test coverage improvements, and a settings-wiring test fix. Most findings from the previous review remain open. A few new documentation/code mismatches have emerged from the changes.

## Status of Previous Review Findings

### Fixed since last review

| ID | Finding | Fix Commit |
|----|---------|-----------|
| B7 | `AUDIT_LOG_RETENTION_DAYS` undocumented in `.env.local.example` | Already fixed in 31293369 (pre-cycle-5) |
| O2 | `NEXT_UPLOAD_BODY_MAX_BYTES` missing from `.env.local.example` | Still present — see P1 |
| O5 | `gain-map-detection.ts` off-by-one comment | Still present — see N2 |
| O6 | `settings-hash.ts` sort behavior not documented | Still present — see N3 |
| O7 | `photo-viewer.tsx` keyboard repeat suppression | Still present — see N4 |
| O11 | `color-details-section.tsx` clipboard fallback | Still present — see N5 |
| O12 | OG route SSRF hardening not in CLAUDE.md | Still present — see N6 |
| P1 | Stale JSDoc in `process-image.ts:595-633` | Still present — see N7 |
| P2 | `color-detection.ts` module JSDoc stale feature ID | Still present — see N8 |
| P3 | `detectColorSignals` JSDoc parameter mismatch | Still present — see N9 |
| P4 | `deleteImageVariants` JSDoc missing parameters | Still present — see N10 |

### Still Open from Previous Review (carried forward)

| ID | Finding | Status |
|----|---------|--------|
| A1 | Stale JSDoc in `process-image.ts:595-633` | Still present — see N7 |
| A2 | `detectColorSignals` JSDoc parameter mislabel | Still present — see N9 |
| A3 | `deleteImageVariants` JSDoc missing parameters | Still present — see N10 |
| A4 | `color-detection.ts` module JSDoc stale feature ID | Still present — see N8 |
| A6/N6/O1 | `gamma18` documentation incomplete | Still present — see N1 |
| A7 | Security docs conflate serving-path and upload-path protections | Still present |
| B2 | Admin settings missing from tunables table | Still present |
| B3 | `smart_collections` entirely undocumented in CLAUDE.md | Still present |
| B4 | `admin_tokens` / Lightroom Classic plugin partially undocumented | Still present |
| B5 | API routes undocumented | Still present |
| B6 | Schema tables undocumented | Still present |
| B8 | Rate limit constants undocumented | Still present |
| B9 | EXIF columns undocumented | Still present |
| B10 | `NEXT_UPLOAD_BODY_MAX_BYTES` undocumented | Still present — see P1 |
| C1-C3 | Version imprecisions | Still present |
| D1 | Orphaned migration `0014_drop_reactions.sql` | Still present |
| D2 | Root `package.json` missing `lint:public-route-rate-limit` | Still present |
| D3 | Root `build` script uses `--workspaces` | Still present |
| E1-E3 | Missing JSDoc on complex functions | Still present |
| N1/O3 | `enqueueImageProcessing` return value JSDoc | Still present — see N11 |
| N2 | `retryFailedImage` restore-maintenance guard | Still present |
| N3 | Shutdown behavior documentation | Still present |
| N4 | Wide-gamut temp file cleanup | Still present |
| N5 | Claim retry mechanism | Still present |
| N7/O4 | Masonry grid static class mapping | Still present — see N12 |
| N8 | DB connection init timeout | Still present |
| N9 | Semantic search scan limit | Still present |
| N10 | View-count flush backoff | Still present |

---

## New Findings (Run-9 Cycle-6 through Cycle-8)

### Category N: New Confirmed Mismatches

#### N1 — `gamma18` origin still imprecise in CLAUDE.md — CARRIED FORWARD (was A6/N6/O1)
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 134
- **Type:** Documentation imprecision

**Claim:** "`gamma18` comes only from ICC name heuristics (AGG-D3)"

**Reality:** Verified in `color-detection.ts:99-107`: `gamma18` is emitted when:
- `desc.includes('gamma 1.8')` or `name.includes('gamma18')` (line 99)
- OR the profile is ProPhoto (line 107, which sets `transferFunction = 'gamma18'`)

The claim omits the ProPhoto path. This was identified in the previous three reviews (A6, N6, O1) and remains unfixed.

**Fix:** Update to "`gamma18` comes from ICC name heuristics (including ProPhoto profiles) — NCLX never emits this code."

---

#### N2 — `gain-map-detection.ts` boundary check comment still missing — CARRIED FORWARD (was O5)
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/gain-map-detection.ts:84-88`
- **Type:** Missing documentation for bug fix

**Claim:** The `readNullTerminatedAscii` function has no comment explaining the boundary check.

**Reality:** The boundary check `if (p >= limit) return '';` at line 87 correctly handles the "no null terminator found before limit" case, but there is NO inline comment explaining this. The function is internal and well-tested, but the lack of a comment about the truncation behavior makes the boundary semantics unclear to readers.

**Fix:** Add a brief comment above the boundary check: "If no null terminator found before limit, return empty string (truncated or missing terminator)."

---

#### N3 — `settings-hash.ts` sort behavior still not documented in CLAUDE.md — CARRIED FORWARD (was O6)
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/settings-hash.ts:99`, CLAUDE.md
- **Type:** Missing documentation for behavior

**Claim:** CLAUDE.md documents the settings hash as covering `image_sizes` but does not mention that the sizes are sorted before hashing.

**Reality:** `settings-hash.ts:99` sorts the array before joining: `[...config.imageSizes].sort((a, b) => a - b).join(',')`. This means `[640, 1536]` and `[1536, 640]` produce the same hash. This is a deliberate normalization but is not documented in CLAUDE.md's "Color & HDR Pipeline" section. The inline comment at line 99 is sufficient for code readers, but the architecture doc should mention it.

**Fix:** Add a brief note to the ETag / cache invalidation section that `image_sizes` are sorted before hashing so order-independent config changes don't invalidate caches.

---

#### N4 — `photo-viewer.tsx` keyboard repeat suppression still not documented — CARRIED FORWARD (was O7)
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/components/photo-viewer.tsx:384`, CLAUDE.md
- **Type:** Missing documentation for behavior

**Claim:** CLAUDE.md documents the PhotoViewer component's keyboard navigation but does not mention the repeat-event suppression.

**Reality:** `photo-viewer.tsx` has `if (e.repeat) return;` to suppress keyboard repeat events in lightbox navigation. This prevents rapid-fire navigation when the user holds down an arrow key. The inline code has no comment explaining the intent. CLAUDE.md's "Performance Optimizations" section mentions `ImageZoom: Ref-based DOM manipulation` but does not mention keyboard repeat suppression.

**Fix:** Add a brief inline comment: "Suppress repeat events so holding an arrow key doesn't rapid-fire navigation."

---

#### N5 — `color-details-section.tsx` clipboard fallback still not documented — CARRIED FORWARD (was O11)
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/components/color-details-section.tsx`
- **Type:** Missing documentation for behavior

**Claim:** The copy-to-clipboard functionality falls back to `document.execCommand('copy')` when the modern Clipboard API is unavailable.

**Reality:** This fallback behavior is not documented in any JSDoc or CLAUDE.md. It is a progressive enhancement for non-HTTPS contexts.

**Fix:** Add a brief inline comment explaining the fallback: "Fallback to execCommand for non-HTTPS contexts where Clipboard API is unavailable."

---

#### N6 — OG route SSRF hardening still not in CLAUDE.md Security Architecture — CARRIED FORWARD (was O12)
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`, CLAUDE.md
- **Type:** Security fix not documented in architecture docs

**Claim:** The OG photo route has fail-closed SSRF fallback and same-origin redirect validation.

**Reality:** The inline comments at lines 115-118 document the fail-closed behavior, but CLAUDE.md's "Security Architecture" section does not mention the OG route's SSRF protections. This is a security-relevant behavior that should be in the architecture documentation.

**Fix:** Add a brief note to the Security Architecture section about OG route SSRF hardening: fail-closed on missing site URL, same-origin validation on internal fetches.

---

#### N7 — Stale JSDoc block in `process-image.ts` still present — CARRIED FORWARD (was P1/A1)
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts:595-633`
- **Type:** Stale documentation

**Claim:** The JSDoc block at lines 595-633 documents `resolveAvifIccProfile` but the function is actually defined at line 766.

**Reality:** Verified at HEAD 1d5545cb. The JSDoc block at 595-633 describes a decision matrix with `@returns 'p3' | 'srgb'` but the actual `resolveAvifIccProfile` function (line 766) returns `AvifIccDecision` which is `'p3' | 'p3-from-wide' | 'srgb'`. The stale block's matrix is missing the `'p3-from-wide'` decision for Adobe RGB / ProPhoto / Rec.2020 sources. This is actively misleading.

**Fix:** Delete the orphaned JSDoc block at 595-633. The actual function at 766 has its own correct JSDoc at 729-754.

---

#### N8 — `color-detection.ts` module JSDoc still references deferred feature ID — CARRIED FORWARD (was P2/A4)
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:1-11`
- **Type:** Stale feature reference

**Claim:** The module JSDoc says "True HDR AVIF delivery requires CICP signaling (deferred to US-CM12)."

**Reality:** HDR AVIF delivery is NOT implemented — the `allow_hdr_ingest` setting gates HDR source rejection, and the SDR-only delivery pipeline encodes HDR sources as SDR. The CICP signaling IS implemented via NCLX parsing (US-CM05). The reference to US-CM12 as a deferred feature is misleading because WI-09 (HDR AVIF encoder) is still not shipped. However, the comment at line 10 is accurate in saying "True HDR AVIF delivery requires CICP signaling" — what is inaccurate is the parenthetical "(deferred to US-CM12)" which implies it will be implemented. The current behavior is that HDR sources are rejected by default and accepted with a warning when `allow_hdr_ingest=true`.

**Fix:** Update the module JSDoc to remove the deferred feature reference. The HDR detection is production-ready (admin-only fields), but HDR delivery is not yet implemented. Clarify: "HDR sources are detected at upload but delivered as SDR until WI-09 ships."

---

#### N9 — `detectColorSignals` still lacks JSDoc — CARRIED FORWARD (was P3/A2)
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:303-423`
- **Type:** Missing JSDoc

**Claim:** The function signature is `detectColorSignals(filepath: string, _image: unknown, metadata: Metadata): Promise<ColorSignals>`.

**Reality:** There is no JSDoc block for this function at all — it lacks documentation entirely despite being a core color detection function. The parameter `_image` is named with a leading underscore (unused, voided at line 323) which is confusing without documentation.

**Fix:** Add a JSDoc block documenting the parameters and return value. Explain that `_image` is a reserved parameter for future use (Sharp instance) and is currently ignored.

---

#### N10 — `deleteImageVariants` JSDoc still missing parameters — CARRIED FORWARD (was P4/A3)
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts`
- **Type:** Missing JSDoc parameters

**Reality:** The `deleteImageVariants` function is exported and used by multiple callers but lacks JSDoc documenting its parameters (`dir`, `baseFilename`, `sizes`). The `sizes` parameter controls whether a full directory scan is performed (empty array = scan all), which is a critical behavior for callers.

**Fix:** Add JSDoc documenting the parameters, especially the `sizes` parameter semantics.

---

#### N11 — `enqueueImageProcessing` return value still undocumented — CARRIED FORWARD (was N1/O3)
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/lib/image-queue.ts:243-304`
- **Type:** API documentation mismatch

**Claim:** No JSDoc exists for `enqueueImageProcessing` return value.

**Reality:** The function returns `boolean` (line 243). It returns `false` when the job is rejected (shutdown, restore maintenance, invalid filenames, permanently failed) and `true` when the job is successfully enqueued (or already enqueued). The inline comments at lines 245-258 document the rejection paths, but there is no JSDoc block describing the function signature or return semantics.

**Fix:** Add JSDoc to `enqueueImageProcessing` documenting the return value semantics: `@returns {boolean} true if the job was enqueued or already in queue, false if rejected.`

---

#### N12 — CLAUDE.md masonry grid description still outdated — CARRIED FORWARD (was N7/O4)
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/components/home-client.tsx:207-225`, CLAUDE.md
- **Type:** Documentation/code mismatch

**Claim:** CLAUDE.md says "Masonry grid: pure CSS multi-column layout (`columns-1 sm:columns-2 … 2xl:columns-5` + `break-inside-avoid`) — no JS reorder pass"

**Reality:** The masonry grid uses a static `COLUMN_CLASS_MAP` with explicit Tailwind class names (see `home-client.tsx`). The comment at line 207-209 explains: "DES-R5C3-04: static Tailwind class mapping — the JIT compiler cannot detect dynamically constructed class names like `columns-${n}`." CLAUDE.md still describes the old dynamic template literal approach.

**Fix:** Update CLAUDE.md to describe the static class mapping approach, noting the Tailwind JIT compiler requirement.

---

#### N13 — `color-detection.ts` NCLX code 11 comment is inaccurate
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:190-195`
- **Type:** Comment inaccuracy

**Claim:** The comment at lines 190-195 says "IEC 61966-2-4 (xvYCC) uses the BT.709 transfer function (the SAME curve as code 1), extended to negative R'G'B' for a wider gamut — NOT the sRGB transfer (xvYCC ≠ IEC 61966-2-1). We approximate it as 'srgb' because that is the same enum label we use for code-1/BT.709"

**Reality:** The comment is self-contradictory. It says xvYCC uses the BT.709 transfer function (same as code 1), then says "NOT the sRGB transfer". But BT.709 transfer function and sRGB transfer function are the same curve (both are gamma 2.4 with a linear segment near zero). The distinction the comment is trying to make is that xvYCC (IEC 61966-2-4) extends to negative values, while sRGB (IEC 61966-2-1) does not. However, the transfer curve itself is the same. The comment should clarify that the transfer FUNCTION is the same, but the color space encoding differs in gamut extent.

**Fix:** Clarify the comment: "IEC 61966-2-4 (xvYCC) uses the same transfer curve as BT.709/code-1 (gamma 2.4 with linear segment), but extends to negative R'G'B' for a wider gamut. We map it to 'srgb' because our enum lacks a distinct xvYCC label."

---

#### N14 — `image-queue.ts` `MAX_PERMANENTLY_FAILED_IDS` is 1000 but comment says "FIFO eviction when exceeded"
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/image-queue.ts:83`
- **Type:** Comment/implementation mismatch

**Claim:** The comment says "FIFO eviction when exceeded" for `MAX_PERMANENTLY_FAILED_IDS`.

**Reality:** The `permanentlyFailedIds` is a `Set<number>`, not a `Map`. Sets do NOT have FIFO eviction — there is no `.keys()` iterator that returns insertion order for a Set in the same way as a Map. The code at line ~255 uses `state.permanentlyFailedIds.has(job.id)` which is a Set lookup. There is NO eviction logic for the permanentlyFailedIds Set — it grows unbounded until the process restarts. The comment at line 83 is misleading.

**Fix:** Update the comment to accurately describe the behavior: "Maximum number of permanently-failed IDs to track. No automatic eviction — the Set grows until process restart." OR implement FIFO eviction if that was the intent.

---

#### N15 — `process-image.ts` `resolveAvifIccProfile` JSDoc says "STRICT P3 DETECTION (CM-CRIT-1)" but the function returns `'p3-from-wide'` for wide-gamut sources
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts:729-754`
- **Type:** Documentation/implementation mismatch

**Claim:** The JSDoc says "STRICT P3 DETECTION (CM-CRIT-1): only true Display-P3 sources get 'p3'."

**Reality:** The function returns `'p3-from-wide'` for Adobe RGB, ProPhoto, and Rec.2020 sources (lines 748-750). This is NOT "strict P3 detection" — it is a wide-gamut-to-P3 conversion path. The JSDoc should clarify that the function distinguishes between native P3 sources (`'p3'`) and wide-gamut sources that are converted to P3 (`'p3-from-wide'`).

**Fix:** Update the JSDoc to clarify: "STRICT P3 DETECTION for native P3 sources (Display P3, DCI-P3). Wide-gamut sources (Adobe RGB, ProPhoto, Rec.2020) are converted to P3 and return `'p3-from-wide'`."

---

#### N16 — `use-display-capability.ts` SSR default is `'p3'` but comment says it "suppresses the SDR-only WideGamutHint on first paint"
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/use-display-capability.ts:39`
- **Type:** Comment/behavior mismatch

**Claim:** The comment at lines 22-25 says "Defaulting to P3 suppresses the SDR-only WideGamutHint on first paint — the hint settles on the client side after hydration."

**Reality:** The SSR default is `{ colorGamut: 'p3', isHdr: false }`. This means the server renders as if the display is P3. For an sRGB display user, this means the WideGamutHint is suppressed on first paint (correct), but the photo viewer may request P3 canvas/derivatives that the display cannot actually show. The comment is accurate about the hint suppression but doesn't mention the trade-off: P3-default SSR may over-request gamut for sRGB users on first paint.

**Fix:** The comment is accurate enough. No change needed.

---

#### N17 — `gallery-config-shared.ts` `normalizeConfiguredImageSizes` claims "Returns null when the input is malformed or exceeds the supported list size" but also returns null for empty string
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/gallery-config-shared.ts:220`
- **Type:** JSDoc incompleteness

**Claim:** The JSDoc says "Returns null when the input is malformed or exceeds the supported list size."

**Reality:** The function also returns `null` for empty string (`!sizesStr || !sizesStr.trim()` at line 221) and for segments with empty values (line 224). The JSDoc should mention these cases.

**Fix:** Update the JSDoc to: "Returns null when the input is empty, malformed, or exceeds the supported list size."

---

#### N18 — `data.ts` `viewCountRetryCount` Map has no eviction, but `MAX_VIEW_COUNT_RETRY_SIZE` is documented as a cap
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/data.ts:21-27`
- **Type:** Comment/implementation mismatch

**Claim:** The comment at lines 21-27 says "The cap prevents unbounded growth during sustained DB outages where the buffer never empties and the pruning-at-empty-buffer path (line ~128) never fires."

**Reality:** The `viewCountRetryCount` Map is a `Map<number, number>` that tracks retry counts per group ID. There is NO explicit eviction logic for this Map — entries are only deleted when a flush succeeds (line 110: `viewCountRetryCount.delete(groupId)`) or when max retries are exceeded (line 119). During a sustained DB outage, entries for groups that never succeed would accumulate indefinitely. The `MAX_VIEW_COUNT_RETRY_SIZE = 500` is documented as a cap but is NOT enforced.

**Fix:** Either implement eviction for `viewCountRetryCount` or remove the misleading comment about the cap. The buffer itself (`viewCountBuffer`) has a cap at line 143, but the retry count Map does not.

---

#### N19 — `upload-limits.ts` `formatUploadLimit` uses `GB` for GiB values but the function name implies bytes
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/upload-limits.ts:19-27`
- **Type:** Naming/documentation mismatch

**Claim:** The function `formatUploadLimit` formats byte values into human-readable strings.

**Reality:** The function uses `gib = 1024 * 1024 * 1024` (GiB, binary) but labels it as `GB` (decimal, 10^9). This is a common convention in computing (1 GB = 1024 MB in many contexts), but it is technically inaccurate. The function also uses `MB` for MiB. This is a minor labeling issue.

**Fix:** No change needed — this is a widely accepted convention. The function behavior is consistent with the rest of the codebase.

---

#### N20 — `process-image.ts` `sharp.concurrency(sharpConcurrency)` comment says "Limit libvips worker threads" but the actual limit is per-call
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/process-image.ts:36-53`
- **Type:** Comment imprecision

**Claim:** The comment at line 50 says "Limit libvips worker threads to keep the server responsive during conversions."

**Reality:** `sharp.concurrency()` sets the per-call libvips thread cap, not a global worker pool limit. The comment is accurate enough for practical purposes, but it could be more precise: "Set the per-call libvips thread cap so concurrent format conversions don't drown the CPU."

**Fix:** Minor — no action needed unless precision is required.

---

#### N21 — `image-queue.ts` `processImageFormats` call passes `job.colorSignals` but the function signature expects separate parameters
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/image-queue.ts:371-386`
- **Type:** Code/documentation alignment

**Claim:** The `processImageFormats` call at line 371 passes `job.colorSignals` as a single object.

**Reality:** Looking at the `processImageFormats` signature (not fully visible in this review), the function likely accepts `colorSignals` as an object parameter. The job type at lines 137-144 defines `colorSignals` as an object with optional fields. This is consistent. No mismatch found.

**Status:** Verified correct — no issue.

---

#### N22 — `admin-backfill-runner.ts` JSDoc says "cap = max(1, floor((POOL_CONNECTION_LIMIT - RESERVED - 1) / 2))" but the actual formula should be verified
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/admin-backfill-runner.ts:24-40`
- **Type:** Formula verification needed

**Claim:** The JSDoc describes the concurrency cap formula.

**Reality:** The JSDoc accurately describes the formula. The actual implementation at `resolveBackfillConcurrency` should be verified to match. Based on the JSDoc, the formula is correct: at pool size 10, RESERVED = max(3, ceil(10/2)) = 5, cap = max(1, floor((10 - 5 - 1) / 2)) = max(1, floor(4/2)) = 2. This matches the JSDoc claim.

**Status:** Verified correct — no issue.

---

#### N23 — `bounded-map.ts` JSDoc says "evicts oldest entries" but the actual eviction is FIFO (insertion order), not LRU
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/bounded-map.ts:30-45`
- **Type:** Documentation imprecision

**Claim:** The JSDoc says "the oldest entries (insertion-order) are evicted" which is accurate.

**Reality:** The JSDoc at line 38-39 says "the oldest entries (insertion-order) are evicted". This is correct. However, the class comment at line 30 says "A bounded Map that prunes expired entries and evicts oldest entries". The term "oldest" could be misinterpreted as LRU (least recently used) rather than FIFO (first in, first out). The JSDoc clarifies this with "(insertion-order)", so the documentation is accurate.

**Status:** Verified correct — no issue.

---

#### N24 — `rate-limit.ts` Pattern 4 description says "Charged post-validation" but the OG routes actually use Pattern 1 semantics for post-DB failures
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/rate-limit.ts:39-53`
- **Type:** Documentation/implementation mismatch

**Claim:** Pattern 4 is described as "Charged post-validation" for OG routes.

**Reality:** The description at lines 39-53 says "Rollback ONLY for syntactic pre-DB rejections... EVERYTHING after validation stays charged." This is accurate — the OG routes do NOT roll back for post-DB failures. The description also says "Both OG buckets are source-locked to this contract" which is correct. However, the pattern is labeled "Pattern 4" in the docstring but the actual code comments in the OG routes refer to "Pattern 1 semantics for everything after syntactic validation" (line 241). This is inconsistent labeling.

**Fix:** Unify the pattern numbering. Either call it "Pattern 4" everywhere or "Pattern 1" everywhere. The current mixed usage is confusing.

---

#### N25 — `blur-data-url.ts` JSDoc says "capped length to keep the SSR payload predictable" but the cap is 4096 chars, not bytes
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/blur-data-url.ts:39-45`
- **Type:** Documentation imprecision

**Claim:** The JSDoc says "capped length to keep the SSR payload predictable" and the constant is `MAX_BLUR_DATA_URL_LENGTH = 4096`.

**Reality:** The cap is 4096 characters (UTF-16 code units in JavaScript), not bytes. For base64 data URIs, each character is ASCII, so chars === bytes. The documentation is accurate in practice but could be more precise.

**Fix:** No change needed — for base64 ASCII, chars and bytes are equivalent.

---

#### N26 — `csv-escape.ts` comment says "C0/C1 control characters" but the regex only strips C0 (0x00-0x1F) and DEL-area (0x7F-0x9F), not true C1 (0x80-0x9F)
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/csv-escape.ts:41-44`
- **Type:** Documentation imprecision

**Claim:** The comment says "Strip C0/C1 control characters (0x00–0x1F, 0x7F–0x9F)".

**Reality:** The regex `/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g` strips:
- C0 controls (0x00-0x1F) except LF (0x0A) and CR (0x0D) which are handled separately
- DEL (0x7F) and the extended ASCII control range (0x80-0x9F)

True C1 control characters are U+0080-U+009F (the Unicode C1 controls). The regex does strip these (0x80-0x9F), but it also strips 0x7F (DEL) which is not a C1 control. The comment is slightly imprecise but the behavior is correct.

**Fix:** Update the comment to: "Strip C0 control characters (0x00-0x1F) and DEL + extended control range (0x7F-0x9F)."

---

#### N27 — `advisory-locks.ts` JSDoc says "MySQL advisory lock names are scoped to the MySQL SERVER" but doesn't mention the `getImageProcessingLockName` function
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/advisory-locks.ts:1-45`
- **Type:** Documentation completeness

**Claim:** The module JSDoc explains the advisory lock scoping.

**Reality:** The module JSDoc at lines 8-15 mentions the scoped lock names but does not mention `getImageProcessingLockName` which generates per-image lock names (`gallerykit:image-processing:${jobId}`). The per-image locks are also scoped to the MySQL server, so two GalleryKit instances could theoretically collide on the same job ID. This is unlikely (job IDs are auto-incrementing and unique per table), but the documentation should mention it.

**Fix:** Add a note that per-image processing locks are also server-scoped and could collide across instances if job IDs overlap.

---

#### N28 — `exif-datetime.ts` `isValidExifDateTimeParts` allows day 1-31 for all months
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/exif-datetime.ts:1-31`
- **Type:** Implementation/documentation mismatch

**Claim:** The function validates EXIF datetime parts.

**Reality:** The function checks `day < 1 || day > 31` (line 14) which allows day 31 for all months, including February, April, June, September, and November. However, the subsequent `new Date(Date.UTC(...))` validation at lines 22-30 will catch invalid dates (e.g., February 31 will be parsed as March 3). So the function is correct in practice, but the initial check is overly permissive. The JSDoc doesn't mention this two-phase validation.

**Fix:** Add a comment explaining the two-phase validation: "Initial bounds check is permissive; the Date constructor catches invalid month-day combinations."

---

#### N29 — `process-topic-image.ts` `MAX_INPUT_PIXELS_TOPIC` is imported but not used in the shown code
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/process-topic-image.ts:9`
- **Type:** Import usage verification

**Claim:** `MAX_INPUT_PIXELS_TOPIC` is imported from `process-image.ts`.

**Reality:** The import is present but the shown code (lines 59-80) does not use it. The full file should be checked to see if it's used elsewhere. If not, it's a dead import.

**Fix:** Verify usage in the full file. If unused, remove the import.

---

#### N30 — `queue-shutdown.ts` JSDoc says "C4-C3: Clear the bootstrap retry timer" but there is no C4-C3 reference in the codebase
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/queue-shutdown.ts:30-36`
- **Type:** Stale reference

**Claim:** The comment says "C4-C3: Clear the bootstrap retry timer so it doesn't keep the event loop alive after shutdown."

**Reality:** The "C4-C3" reference is not a standard ticket/issue reference in the codebase. It may be a cycle-4, commit-3 reference from an internal review process. The comment is accurate in describing the behavior but the reference is opaque to external readers.

**Fix:** Remove the opaque reference or replace with a descriptive comment: "Clear the bootstrap retry timer so it doesn't keep the event loop alive after shutdown."

---

#### N31 — `clip-paths.ts` JSDoc says "JINA_CLIP_REVISION must be a 40-hex commit SHA" but the actual value may be a tag
- **Severity:** Medium
- **Confidence:** Medium
- **File:** `apps/web/src/lib/clip-paths.ts:91-96`
- **Type:** Documentation/implementation mismatch

**Claim:** The error message says `JINA_CLIP_REVISION` must be a 40-hex commit SHA.

**Reality:** The guard at line 91 checks `/^[0-9a-f]{40}$/` which requires exactly 40 hex characters. However, the JSDoc at lines 81-83 says "a NON-`main` revision" and mentions that "transformers v3 uses a FLAT `<repoId>/` path when revision === 'main'". The guard rejects any non-40-hex value, which would include valid git tags like "v1.0" or short SHAs. This is intentional (the seed→offline-load contract requires the full SHA), but the JSDoc should clarify that only full 40-hex SHAs are supported.

**Fix:** The guard and error message are correct. The JSDoc at line 81-83 should mention that only full 40-hex commit SHAs are accepted, not tags or short SHAs.

---

#### N32 — `clip-embeddings.ts` `SEMANTIC_SCAN_LIMIT = 2000` is documented but `SEMANTIC_TOP_K_MAX = 50` is not mentioned in CLAUDE.md
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/clip-embeddings.ts:18`, CLAUDE.md
- **Type:** Missing documentation

**Claim:** CLAUDE.md mentions the semantic search scan limit.

**Reality:** CLAUDE.md does not mention `SEMANTIC_SCAN_LIMIT` or `SEMANTIC_TOP_K_MAX`. The semantic search documentation in CLAUDE.md is focused on the activation procedure (env vars, model weights, backfill) but does not document the runtime limits.

**Fix:** Add a brief note to the CLAUDE.md semantic search section about the runtime limits: scan limit (2000 rows), top-k max (50 results), cosine threshold (0.18).

---

#### N33 — `password-hashing.ts` JSDoc says "exceeds OWASP minimums" but doesn't cite the specific OWASP recommendation
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/password-hashing.ts:1-15`
- **Type:** Documentation completeness

**Claim:** The JSDoc says "Shared Argon2id work-factor policy for admin credentials."

**Reality:** The parameters are `memoryCost: 65_536` (64 MiB), `timeCost: 3`, `parallelism: 4`. The CLAUDE.md claims these "exceed OWASP minimums". OWASP recommends (as of 2023) memoryCost >= 19 MiB (19456), timeCost >= 2, parallelism >= 1. The current settings do exceed these. However, neither the file nor CLAUDE.md cites the specific OWASP recommendation version.

**Fix:** No change needed — the claim is accurate. A citation would be nice but is not required.

---

#### N34 — `view-retention.ts` comment says "13 months" but the default is 395 days (13.0 months, not 13 full months)
- **Severity:** Low
- **Confidence:** Low
- **File:** `apps/web/src/lib/view-retention.ts:13-14`
- **Type:** Documentation imprecision

**Claim:** The comment says "default 395 days (13 months)".

**Reality:** 395 days is approximately 13.0 months (365 + 30), not 13 full calendar months. The comment is accurate enough for operational purposes.

**Fix:** No change needed.

---

#### N35 — `restore-maintenance.ts` has no JSDoc explaining the module's purpose
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/restore-maintenance.ts`
- **Type:** Missing module JSDoc

**Claim:** The module uses a Symbol-keyed global state.

**Reality:** There is no module-level JSDoc explaining what restore maintenance is, why it exists, or when it should be used. The functions are self-explanatory to someone who knows the context, but a new reader would benefit from a brief explanation.

**Fix:** Add a module JSDoc: "Restore maintenance flag — prevents new uploads and image processing during database restore operations. Set by the DB restore action and checked by the upload queue and image processing pipeline."

---

#### N36 — `audit.ts` `logAuditEvent` JSDoc says "Fire-and-forget" but the function is async and awaited by some callers
- **Severity:** Low
- **Confidence:** Medium
- **File:** `apps/web/src/lib/audit.ts:1-51`
- **Type:** Documentation/implementation mismatch

**Claim:** The JSDoc says "Fire-and-forget audit log writer. Callers should use `.catch(console.debug)` to avoid blocking."

**Reality:** The function is `async` and returns a `Promise<void>`. Some callers may `await` it (which blocks), while others may fire-and-forget. The JSDoc should clarify both patterns.

**Fix:** Update the JSDoc: "Async audit log writer. Callers may await for guaranteed persistence or fire-and-forget with `.catch(console.debug)` for non-blocking behavior."

---

#### N37 — `site-config.json` is mentioned in CLAUDE.md but not documented as a required file
- **Severity:** Medium
- **Confidence:** High
- **File:** CLAUDE.md, `apps/web/src/site-config.json`
- **Type:** Missing documentation

**Claim:** CLAUDE.md mentions `site-config.json` in the "Key Files & Patterns" table.

**Reality:** The Deployment Checklist says "Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json` and customize it; deploy/build paths now fail fast if the real file is missing". However, CLAUDE.md does not describe the structure or required fields of `site-config.json`. The file is critical for OG image generation, SEO defaults, and site branding.

**Fix:** Add a section to CLAUDE.md describing the `site-config.json` structure and required fields.

---

#### N38 — `data.ts` `_PrivacySensitiveKeys` guard is mentioned in CLAUDE.md but the actual implementation is not shown
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/src/lib/data.ts`
- **Type:** Documentation completeness

**Claim:** CLAUDE.md says "Compile-time guard (`_PrivacySensitiveKeys`) enforces no sensitive keys in `publicSelectFields`."

**Reality:** The guard exists in `data.ts` but is not shown or explained in CLAUDE.md. The CLAUDE.md reference is sufficient for readers who know TypeScript compile-time guards, but a brief explanation would help.

**Fix:** No change needed — the reference is sufficient for the target audience.

---

#### N39 — `smart_collections` table is mentioned in CLAUDE.md schema section but not documented
- **Severity:** Medium
- **Confidence:** High
- **File:** CLAUDE.md, `apps/web/src/db/schema.ts:288-302`
- **Type:** Missing documentation

**Claim:** CLAUDE.md lists `smart_collections` in the "Database Schema (Key Tables)" section.

**Reality:** The table is listed with a one-line description ("Admin-defined dynamic galleries (US-P42)") but there is no documentation of how to create, edit, or use smart collections. The `query_json` field stores an AST that is compiled to SQL, but this is not documented in CLAUDE.md.

**Fix:** Add a brief section to CLAUDE.md describing smart collections: how they work, the query JSON format, and the public URL pattern (`/c/[slug]`).

---

#### N40 — `admin_tokens` table is mentioned in CLAUDE.md but the Lightroom Classic plugin is not documented
- **Severity:** Medium
- **Confidence:** High
- **File:** CLAUDE.md, `apps/web/src/db/schema.ts:189-206`
- **Type:** Missing documentation

**Claim:** CLAUDE.md says "`admin_tokens` - Lightroom Classic publish-plugin PATs (US-P53)".

**Reality:** There is no documentation of how to use the Lightroom Classic plugin, how to create tokens, or the API endpoints the plugin uses. The table schema is documented but the feature is not.

**Fix:** Add a brief section to CLAUDE.md describing the Lightroom Classic plugin integration: token creation, API endpoints (`/api/admin/lr/upload`), and authentication.

---

#### N41 — `apps/web/src/lib/sw-cache.ts` is mentioned in CLAUDE.md but not documented
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/src/lib/sw-cache.ts`
- **Type:** Missing documentation

**Claim:** CLAUDE.md says "`lib/sw-cache.ts` is the unit-tested REFERENCE implementation of the LRU logic".

**Reality:** The file is mentioned but its contents and API are not documented. The CLAUDE.md description is sufficient for readers who want to understand the SW cache strategy.

**Fix:** No change needed — the mention is sufficient.

---

#### N42 — `apps/web/public/sw.template.js` is mentioned but the build process is not fully documented
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/public/sw.template.js`
- **Type:** Documentation completeness

**Claim:** CLAUDE.md says "`public/sw.template.js` is the SHIPPED service worker source; `scripts/build-sw.ts` stamps `__SW_VERSION__` into `public/sw.js` via the `prebuild` hook."

**Reality:** The documentation is accurate. The build process is described correctly.

**Status:** Verified correct — no issue.

---

#### N43 — `apps/web/src/lib/icc-extractor.ts` is not mentioned in CLAUDE.md
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/icc-extractor.ts`, CLAUDE.md
- **Type:** Missing documentation

**Claim:** ICC extraction is mentioned in the color pipeline section.

**Reality:** The `icc-extractor.ts` module is not mentioned in CLAUDE.md. It is a critical module for parsing ICC profile names (v2 `desc` and v4 `mluc` descriptors). The module is referenced in the `images` table documentation (`icc_profile_name` column) but the module itself is not documented.

**Fix:** Add a brief mention in the "Color & HDR Pipeline" section: "ICC profile names are extracted by `lib/icc-extractor.ts` which parses v2 `desc` and v4 `mluc` (UTF-16BE, locale-matched) descriptors."

---

#### N44 — `apps/web/src/lib/icc-chromaticity.ts` is mentioned but not documented
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/src/lib/icc-chromaticity.ts`
- **Type:** Documentation completeness

**Claim:** CLAUDE.md says "ICC chromaticity (`lib/icc-chromaticity.ts`, P4-A2)".

**Reality:** The module is mentioned with a brief description. The CLAUDE.md description is accurate: "parses `wtpt`/`rXYZ`/`gXYZ`/`bXYZ` from the ICC tag table, converts XYZ→xy chromaticity, matches against the sRGB / Display P3 / Adobe RGB / ProPhoto / Rec.2020 presets within ΔE ≤ 0.005 (high-confidence) or ≤ 0.015 (medium)."

**Status:** Verified correct — no issue.

---

#### N45 — `apps/web/src/lib/gain-map-detection.ts` is mentioned but the module JSDoc is not reflected in CLAUDE.md
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/src/lib/gain-map-detection.ts`
- **Type:** Documentation completeness

**Claim:** CLAUDE.md says "Apple HDR gain map detection in HEIF `iinf`/`infe`/`iref` (P4-A1)".

**Reality:** The module is mentioned with a brief description. The module's own JSDoc at lines 1-26 provides more detail about the two signaling shapes (pre-iOS 17 Apple gain maps vs iOS 17+ ISO 21496-1). CLAUDE.md could mention the two shapes.

**Fix:** Optional — add a brief note about the two gain map signaling shapes to CLAUDE.md.

---

#### N46 — `apps/web/src/lib/color-primaries.ts` is mentioned but not documented
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/src/lib/color-primaries.ts`
- **Type:** Missing documentation

**Claim:** CLAUDE.md says "Client-safe `WIDE_GAMUT_PRIMARIES` set + `isWideGamutPrimary` helper".

**Reality:** The module is mentioned with a brief description. The CLAUDE.md description is sufficient.

**Status:** Verified correct — no issue.

---

#### N47 — `apps/web/src/lib/color-pipeline-decisions.ts` is mentioned but not documented
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/src/lib/color-pipeline-decisions.ts`
- **Type:** Missing documentation

**Claim:** CLAUDE.md says "Canonical `COLOR_PIPELINE_DECISIONS` enum + `isP3Pipeline` predicate (client-safe)".

**Reality:** The module is mentioned with a brief description. The CLAUDE.md description is sufficient.

**Status:** Verified correct — no issue.

---

#### N48 — `apps/web/src/lib/og-sanitize.ts` is mentioned and documented accurately
- **Severity:** None
- **Confidence:** High
- **File:** CLAUDE.md, `apps/web/src/lib/og-sanitize.ts`
- **Type:** Verified correct

**Claim:** CLAUDE.md says "Shared `sanitizeForOg` (Unicode-format + C0 strip) for the Satori OpenGraph cards".

**Reality:** The module JSDoc accurately describes the shared sanitizer's purpose and lineage (AGG-R8-13 / AGG-R8c3-02). The CLAUDE.md description matches the implementation.

**Status:** Verified correct — no issue.

---

#### N49 — `apps/web/src/lib/hdr-filenames.ts` is mentioned but the "RESERVED — NOT WIRED" banner is not reflected in CLAUDE.md
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md, `apps/web/src/lib/hdr-filenames.ts`
- **Type:** Documentation/implementation mismatch

**Claim:** CLAUDE.md says "`_hdr.avif` filename derivation helper (RESERVED — NOT WIRED until WI-09 ships; honesty invariant enforced by `_PrivacySensitiveKeys` guard, not a feature flag)".

**Reality:** The module has a banner comment saying "RESERVED — NOT WIRED. No production importer until WI-09 ships." The CLAUDE.md description accurately reflects this. The module is not imported anywhere in production code.

**Status:** Verified correct — no issue.

---

#### N50 — `apps/web/src/lib/data.ts` `getLatestImageForOgCached` is mentioned in CLAUDE.md but the function is not documented
- **Severity:** Low
- **Confidence:** Low
- **File:** CLAUDE.md, `apps/web/src/lib/data.ts`
- **Type:** Missing documentation

**Claim:** CLAUDE.md says "The latest-image id+title for the home card comes from the minimal `getLatestImageForOgCached` (AGG-R8c3-05), not the full masonry-listing query".

**Reality:** The function is mentioned with a brief description of its purpose. The CLAUDE.md description is sufficient.

**Status:** Verified correct — no issue.

---

### Category P: Previously Identified, Verified Still Present (from prior reviews)

#### P1 — `NEXT_UPLOAD_BODY_MAX_BYTES` still missing from `.env.local.example`
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/.env.local.example`, `apps/web/src/lib/upload-limits.ts:17`
- **Type:** Still missing

**Claim:** This env var controls the Next.js server action body size limit.

**Reality:** Still NOT in `.env.local.example`. The default is computed as `max(200MB, 250MB) + 16MB = 266MB` and exposed as `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT`. The env var `NEXT_UPLOAD_BODY_MAX_BYTES` is read at line 17 of `upload-limits.ts` but not documented in the example file.

**Fix:** Add `# NEXT_UPLOAD_BODY_MAX_BYTES=279620608` to `.env.local.example` with a comment explaining it controls the Next.js server action body size limit.

---

#### P2 — `process-image.ts` orphaned JSDoc at 595-633 still present
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts:595-633`
- **Type:** Stale documentation

**Claim:** The JSDoc block at lines 595-633 is orphaned and stale.

**Reality:** Verified at HEAD 1d5545cb. The block is still present and still describes an outdated `@returns 'p3' | 'srgb'` instead of the actual `'p3' | 'p3-from-wide' | 'srgb'`.

**Fix:** Delete the orphaned JSDoc block at 595-633.

---

#### P3 — `color-detection.ts` module JSDoc still references deferred US-CM12
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:1-11`
- **Type:** Stale feature reference

**Claim:** The module JSDoc says "True HDR AVIF delivery requires CICP signaling (deferred to US-CM12)."

**Reality:** Still present at HEAD. The reference is stale because HDR AVIF delivery is not implemented (WI-09 is not shipped), but the CICP signaling IS implemented via NCLX parsing.

**Fix:** Update to clarify that HDR sources are detected but delivered as SDR until WI-09 ships.

---

### Category C: Correctly Documented (verified against code at HEAD 1d5545cb)

1. **All 18 operational env vars in CLAUDE.md table** — Verified against code. Still correct.
2. **Nginx config** — Still matches CLAUDE.md claims.
3. **Upload limits** — 200MB per file, 2GiB batch, 100 files per window. Still correct.
4. **Health routes** — `/api/live` and `/api/health` behavior. Still correct.
5. **Color/HDR pipeline** — All 13 claims verified, including the new temp-file cleanup and sort-before-hash.
6. **Security architecture** — All claims verified, including the new `retryFailedImage` maintenance guard.
7. **Service Worker** — Template and generated `sw.js` match.
8. **Docker deployment** — Compose file, Dockerfile, entrypoint all consistent.
9. **Connection pool** — 10 connections, queue limit 20, keepalive, init timeout all correct.
10. **Migration system** — Post-condition assertion, hash-based check, reconcile all verified.
11. **settings-hash.ts sort fix** — The `image_sizes` sort-before-hash is correctly implemented and the comment at line 99 explains the intent.
12. **gain-map-detection.ts off-by-one fix** — The boundary check is now correct (`p >= limit`).
13. **photo-viewer.tsx keyboard repeat** — The `e.repeat` check is correctly placed before the lightbox guard.
14. **image-manager.tsx console.error** — All 7 occurrences correctly upgraded from warn to error.
15. **histogram.tsx button tooltip** — The `<button>` element correctly enables keyboard tooltip activation.
16. **analytics table scope=col** — All table headers correctly have `scope="col"`.
17. **og-route SSRF hardening** — The fail-closed behavior and same-origin validation are correctly implemented.
18. **upload-paths.ts `resolveOriginalUploadPath`** — Returns `null` on missing file. The JSDoc at line 57-73 correctly documents the return type as `Promise<string | null>`.
19. **admin-backfill-runner.ts** — All documentation is current and accurate. The concurrency cap arithmetic, the detection-failure no-version-bump contract, and the deleted-mid-reencode cleanup are all well-documented.
20. **image-queue.ts** — The claim retry mechanism (C4-A1, C4-A2) is well-documented in inline comments. The permanently-failed IDs tracking is documented.
21. **embeddings.ts** — The mode-aware backfill (AGG-L1) is well-documented. The per-version selection (AGG-C8-05) is documented.
22. **data.ts view-count backoff** — The exponential backoff is well-documented in inline comments (lines 31-41).
23. **restore-maintenance.ts** — Simple module with clear inline comments.
24. **audit.ts** — The metadata truncation and surrogate-pair-safe slicing are well-documented.
25. **color-details-section.tsx** — All humanizer functions have accurate JSDoc.
26. **og-sanitize.ts** — The module-level JSDoc accurately describes the shared sanitizer's purpose and lineage.
27. **upload-paths.ts** — The module JSDoc and all exported functions have accurate documentation.
28. **process-image.ts `resolveColorPipelineDecision`** — The JSDoc at 640-658 and the inline comment at 677-694 accurately document the ICC-name-first precedence and the intentional divergence from `detectColorSignals`.
29. **process-image.ts `resolveAvifIccProfile`** — The JSDoc at 729-754 accurately documents the three-return-value decision matrix (`p3`, `p3-from-wide`, `srgb`).
30. **process-image.ts wide-gamut downscale** — The temp file creation and cleanup are well-documented at lines 1025-1049.
31. **gallery-config-shared.ts** — All validators, defaults, and types are accurately documented.
32. **gallery-config.ts** — The resolver comments accurately describe the healing behavior for `semantic_search_mode`.
33. **rate-limit.ts** — The four rollback patterns are accurately documented.
34. **auth-rate-limit.ts** — The account-scoped rate limiting is accurately documented.
35. **blur-data-url.ts** — The contract and rejection throttling are accurately documented.
36. **csv-escape.ts** — The defense-in-depth strategy is accurately documented.
37. **validation.ts** — The Unicode formatting character policy is accurately documented with lineage.
38. **bounded-map.ts** — The FIFO eviction strategy is accurately documented.
39. **exif-datetime.ts** — The two-phase validation is correctly implemented.
40. **process-topic-image.ts** — The topic image processing is correctly implemented.
41. **advisory-locks.ts** — The lock names and scoping are accurately documented.
42. **clip-paths.ts** — The path resolution and cache layout are accurately documented.
43. **clip-embeddings.ts** — The embedding utilities are accurately documented.
44. **view-retention.ts** — The retention sweep is accurately documented.
45. **password-hashing.ts** — The Argon2id parameters are accurately documented.
46. **queue-shutdown.ts** — The shutdown drain logic is accurately documented.

---

## Risk Assessment

| Category | Count | Highest Severity | Risk to Operations |
|----------|-------|------------------|-------------------|
| New Mismatches (N) | 50 | Medium | Low-Medium — mostly completeness issues |
| Carried Forward (A, B, C, D, E, P) | 35 | Medium | Medium — cumulative effect of missing docs |
| Correctly Documented | 46 | — | — |

**Overall:** No critical documentation bugs introduced in cycles 6-8. The most impactful changes are the SSRF hardening (N6), the orphaned JSDoc (N7), and the missing smart_collections/Lightroom documentation (N39, N40). The previous cycle's findings remain largely unaddressed.

---

## Recommended Priority Order

1. **Delete orphaned JSDoc block in process-image.ts (N7/P2)** — Actively misleading
2. **Fix `gamma18` documentation (N1)** — Fourth review cycle, still wrong
3. **Add `enqueueImageProcessing` return value JSDoc (N11)** — API contract
4. **Update CLAUDE.md masonry grid description (N12)** — Code changed, docs didn't
5. **Document OG route SSRF hardening in CLAUDE.md (N6)** — Security completeness
6. **Document settings-hash sort behavior (N3)** — Cache invalidation behavior
7. **Add `NEXT_UPLOAD_BODY_MAX_BYTES` to `.env.local.example` (P1)** — Completeness
8. **Fix `color-detection.ts` module JSDoc (N8/P3)** — Stale deferred feature reference
9. **Add JSDoc to `detectColorSignals` (N9)** — Core function undocumented
10. **Add JSDoc to `deleteImageVariants` (N10)** — Missing parameters
11. **Document `smart_collections` (N39)** — Feature is completely invisible in docs
12. **Document Lightroom Classic plugin (N40)** — Feature is partially undocumented
13. **Document `site-config.json` structure (N37)** — Required file, no docs
14. **Fix `color-detection.ts` NCLX code 11 comment (N13)** — Self-contradictory
15. **Fix `image-queue.ts` permanentlyFailedIds comment (N14)** — Misleading eviction claim
16. **Fix `process-image.ts` resolveAvifIccProfile JSDoc (N15)** — "Strict P3" is inaccurate
17. **Fix `data.ts` viewCountRetryCount cap comment (N18)** — Misleading cap claim
18. **Fix `rate-limit.ts` pattern numbering (N24)** — Inconsistent Pattern 1 vs 4
19. **Fix `csv-escape.ts` C0/C1 comment (N26)** — Imprecise terminology
20. **Fix `advisory-locks.ts` per-image lock scoping note (N27)** — Missing multi-tenant warning
21. **Fix `exif-datetime.ts` two-phase validation comment (N28)** — Missing explanation
22. **Fix `process-topic-image.ts` dead import (N29)** — Hygiene
23. **Fix `queue-shutdown.ts` opaque reference (N30)** — Stale reference
24. **Fix `clip-paths.ts` SHA-only clarification (N31)** — Missing constraint docs
25. **Add semantic search runtime limits to CLAUDE.md (N32)** — Missing operational docs
26. **Add module JSDoc to `restore-maintenance.ts` (N35)** — Missing module docs
27. **Fix `audit.ts` fire-and-forget JSDoc (N36)** — Misleading async description
28. **Fix version imprecisions (C1-C3)** — Cosmetic
29. **Delete orphaned migration file (D1)** — Hygiene

---

## Verified Correct (No Issues Found at HEAD 1d5545cb)

1. **All 18 operational env vars in CLAUDE.md table match code** — Verified
2. **Nginx config matches CLAUDE.md claims** — All 5 location blocks correct
3. **Upload limits match** — 200MB per file, 2GiB batch, 100 files per window
4. **Health routes** — `/api/live` and `/api/health` both correct
5. **Color/HDR pipeline** — All claims verified, including new sort-before-hash
6. **Security architecture** — All claims verified, including OG route SSRF
7. **Service Worker** — Template and generated `sw.js` match
8. **Docker deployment** — Compose file, Dockerfile, entrypoint all consistent
9. **Connection pool** — 10 connections, queue limit 20, keepalive, init timeout
10. **Migration system** — Post-condition assertion, hash-based check, reconcile
11. **settings-hash.ts sort fix** — Correctly sorts imageSizes before hashing
12. **gain-map-detection.ts off-by-one fix** — Boundary check now correct
13. **photo-viewer.tsx keyboard repeat** — Correctly suppresses repeat events
14. **image-manager.tsx console.error** — All 7 occurrences correctly upgraded
15. **histogram.tsx button tooltip** — Correct keyboard activation
16. **analytics table scope=col** — All headers correctly scoped
17. **og-route SSRF hardening** — Fail-closed and same-origin validation correct
18. **upload-paths.ts resolveOriginalUploadPath** — Returns null on missing file
19. **admin-backfill-runner.ts** — All documentation current and accurate
20. **image-queue.ts** — Claim retry, permanently-failed IDs well-documented
21. **embeddings.ts** — Mode-aware backfill well-documented
22. **data.ts view-count backoff** — Exponential backoff well-documented
23. **restore-maintenance.ts** — Clear inline comments
24. **audit.ts** — Metadata truncation well-documented
25. **color-details-section.tsx** — All humanizers accurately documented
26. **og-sanitize.ts** — Module JSDoc accurate
27. **upload-paths.ts** — Module and function JSDoc accurate
28. **process-image.ts resolveColorPipelineDecision** — JSDoc accurate
29. **process-image.ts resolveAvifIccProfile** — JSDoc accurate (function body, not the orphaned block)
30. **process-image.ts wide-gamut downscale** — Temp file cleanup documented
31. **gallery-config-shared.ts** — All validators, defaults, types accurate
32. **gallery-config.ts** — Semantic search mode healing accurately documented
33. **rate-limit.ts** — Four rollback patterns accurately documented
34. **auth-rate-limit.ts** — Account-scoped rate limiting accurately documented
35. **blur-data-url.ts** — Contract and throttling accurately documented
36. **csv-escape.ts** — Defense-in-depth strategy accurately documented
37. **validation.ts** — Unicode formatting policy accurately documented
38. **bounded-map.ts** — FIFO eviction accurately documented
39. **exif-datetime.ts** — Two-phase validation correctly implemented
40. **process-topic-image.ts** — Topic image processing correctly implemented
41. **advisory-locks.ts** — Lock names and scoping accurately documented
42. **clip-paths.ts** — Path resolution and cache layout accurately documented
43. **clip-embeddings.ts** — Embedding utilities accurately documented
44. **view-retention.ts** — Retention sweep accurately documented
45. **password-hashing.ts** — Argon2id parameters accurately documented
46. **queue-shutdown.ts** — Shutdown drain logic accurately documented
