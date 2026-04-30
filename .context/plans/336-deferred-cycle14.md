# Plan 336-Deferred — Deferred Items (Cycle 14)

**Created:** 2026-04-30 (Cycle 14)
**Status:** Deferred

## New Deferred Findings (Cycle 14)

### C14-MED-03: `createGroupShareLink` BigInt coercion risk on `insertId`
- **File**: `apps/web/src/app/actions/sharing.ts:243`
- **Original severity/confidence**: MEDIUM / Medium
- **Reason for deferral**: Previously deferred as C30-04 / C36-02 / C8-01.
  The `insertId` BigInt precision loss requires a shared-group count exceeding
  `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991). The app enforces a 100-image
  cap per group and shared groups are admin-created at low volume. The risk is
  theoretical at personal-gallery scale. The `Number.isFinite(groupId)` guard
  would catch `Infinity` but not silent precision loss.
- **Exit criterion**: If shared group count ever approaches 2^53, or if the
  insertId pattern is reused for higher-volume tables, re-open and use BigInt
  comparison.

### C14-LOW-01: `original_file_size` BigInt precision risk
- **File**: `apps/web/src/app/actions/images.ts:328`
- **Original severity/confidence**: LOW / Low
- **Reason for deferral**: Previously deferred as C9-F01. The per-file upload
  cap is 200 MB, well within `Number.MAX_SAFE_INTEGER` (which corresponds to
  ~9 PB). The schema's `mode: 'number'` is intentionally safe under current
  limits. Adding a code comment is the minimal fix but not urgent.
- **Exit criterion**: If the per-file upload cap is raised above 9 PB, or if
  the column is used for aggregate totals, re-open.

### C14-LOW-02: `lightbox.tsx` showControls callback identity instability
- **File**: `apps/web/src/components/lightbox.tsx:95-119`
- **Original severity/confidence**: LOW / Low
- **Reason for deferral**: The callback's `controlsVisible` dependency causes it
  to be recreated on each visibility toggle, re-subscribing event listeners.
  This is a minor performance concern — the re-subscription is cheap and the
  behavior is correct. Using a ref for `controlsVisible` alongside state would
  stabilize the callback but adds complexity for marginal gain.
- **Exit criterion**: If event listener re-subscription causes measurable
  jank on low-end devices, or if the lightbox is refactored.

### C14-LOW-03: `searchImages` alias branch over-fetch
- **File**: `apps/web/src/lib/data.ts:1137-1138`
- **Original severity/confidence**: LOW / Low (informational)
- **Reason for deferral**: Documented tradeoff — parallel tag + alias queries
  may over-fetch when tag results fill the gap. At personal-gallery scale this
  is acceptable. Serializing would add latency (3 sequential rounds vs 2).
- **Exit criterion**: If gallery scales beyond personal use and search
  performance becomes a concern, re-evaluate.

## Carry-Forward from Previous Cycles

All previously deferred items remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps [LOW]
- C32-04 / C30-08: Health endpoint DB disclosure [LOW]
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap [LOW]
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit [LOW]
- C30-04 / C36-02 / C8-01 / C14-MED-03: `createGroupShareLink` insertId validation / BigInt coercion [MEDIUM]
- C9-F01 / C14-LOW-01: original_file_size bigint mode: 'number' precision [LOW]
- C9-F03: searchImagesAction rate limit check/increment window [LOW]
- C30-06: Tag slug regex inconsistency [LOW]
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component) [LOW]
- C6-F03: No E2E test coverage for upload pipeline [LOW]
- C7-F03: No test coverage for view count buffering system [LOW]
- C7-F04: No test for search rate limit rollback logic [LOW]
- C13-03: CSV export column headers hardcoded in English [LOW]
- A17-MED-02 / C14-LOW-04: CSP `style-src 'unsafe-inline'` in production [MEDIUM]
- A17-MED-01 / C14-LOW-05: `data.ts` god module (1258 lines) [MEDIUM]
- A17-MED-03 / C14-LOW-06: `getImage` parallel DB queries — pool exhaustion risk [MEDIUM]
- A17-LOW-04 / C14-LOW-07: `permanentlyFailedIds` process-local — lost on restart [LOW]
- A17-LOW-08: Lightbox auto-hide UX [LOW]
- A17-LOW-09: Photo viewer sidebar layout shift [LOW]
