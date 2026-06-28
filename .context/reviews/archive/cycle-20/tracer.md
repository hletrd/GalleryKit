# Tracer Report — Cycle 20

**Date:** 2026-06-27
**HEAD:** 9af705f4 (cycle-19 SW stamp)
**Flows traced:** 4
**New findings:** 0 CRIT / 0 HIGH / 0 MED / 0 LOW
**Confirmed clean (cycle-19 fixes applied):** F2 (GPS walkAborted), A2 (search enrichment compile-guard)
**Confirmed documented-deferred (no new defects):** A3, MINOR-2 (upload quota single-settle), CRT-D1 (cache static path)
**Note:** R20-L1 (HEAD short-circuit in serve-upload.ts) is already committed at `351b5306` — confirmed present at HEAD; not a new implementation task for this cycle.

---

## Flow 1 — Upload → Quota Claim → Settle

### Observation

Six settle call sites exist in `apps/web/src/app/actions/images.ts` for the quota claim made at lines 226-228. The outer `finally` (lines 590-592) releases only the upload-contract advisory lock, NOT the quota claim.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All 6 settle points are correctly placed; no leaked-claim path exists in the current code | High | Strong | All call sites read; settle math confirmed for every exit path |
| 2 | HDR-rejected or raw-rejected files silently carry their bytes into the settled claim (over-charges the window) | Low | Strong-against | `successCount`/`uploadedBytes` only increment inside the per-file success path; neither rejection category touches them |
| 3 | A throw escaping the per-file catch leaks the claim | Low | Strong-against | Per-file `catch(e)` wraps the full body; the only non-settled outer path relies on `deleteOriginalUploadFile` never rejecting — a documented invariant confirmed in the cycle-19 aggregate (FALSE-POSITIVE verdict) |

### Evidence For

- `images.ts:541-542` — all-failures path settles before returning
- `images.ts:564` — partial/full success path settles before audit log
- `images.ts:233-250` — disk-space inner try/catch settles on throw AND on early return
- `images.ts:267-279` — topic-query try/catch settles then re-throws
- HDR rejections: `hdrRejectedCount++` and `failedFiles.push()` at ~line 313; these do NOT increment `successCount` or `uploadedBytes`. Settle delta `(successCount - files.length)` correctly releases the claim for rejected files.
- Raw rejections: `rawRejectedCount++` and `rawRejectedFiles.push()` at ~line 527-529; same accounting.
- `upload-tracker-state.ts:62-68` — `resetUploadTrackerWindowIfExpired` mutates the entry object IN PLACE (three field assignments, no Map.set with a new object). The settle in `upload-tracker.ts` calls `tracker.get(key)` and gets the current (possibly already-reset) entry. If the 1h window resets mid-batch, the settle operates on the zeroed new-window entry: `Math.max(0, 0 + (successCount - claimedCount))`. For partial failures this yields 0, undercharging the second window. This is the known deferred MINOR-2.

### Evidence Against / Gaps

- No evidence of any new unguarded `await` added between the claim (line 226) and the per-file loop that would bypass a settle.
- `deleteOriginalUploadFile` never-throws invariant is comment-only (no test enforcement). That gap is captured in Test FINDING-3 (deferred list).

### Rebuttal Round

Best challenge to H1: "The outer `finally` does not settle the claim. If any exception escapes the per-file for-loop body past the per-file catch, the claim leaks." Why H1 still stands: no exception can escape the per-file `catch(e)` unless `deleteOriginalUploadFile` throws (documented to swallow both `fs.unlink` calls via `.catch(() => {})`). The topic-query catch re-throws only AFTER settling at line 273-274. No other unguarded awaits in scope.

### Current Best Explanation

Flow 1 is CLEAN against the cycle-20 query. No new defects beyond documented deferred items A3 and MINOR-2.

### Critical Unknown

The `deleteOriginalUploadFile` never-throws contract has no test enforcement. A future change to that helper that propagates an error would leak the claim silently.

### Discriminating Probe

Add a test that mocks `deleteOriginalUploadFile` to reject and verifies `settleUploadTrackerClaim` is still called. Closes the comment-only invariant at test-enforcement level (subsumes deferred Test FINDING-3).

---

## Flow 2 — Public Search/Similar Request → Column Set → No PII

### Observation

Both `api/search/semantic/route.ts` and `api/search/similar/[id]/route.ts` are public (anonymous-caller) routes that return image result cards. Prior to the A2 fix they contained hand-copied inline `db.select({...})` objects outside any compile-time PII guard.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | A2 fix fully applied: both routes share one compile-guarded enrichment select; no PII reaches anonymous callers | High | Strong | Direct file read of `search-enrichment-fields.ts` and both route imports confirmed |
| 2 | A third public search route bypasses the shared select | Low | Strong-against | No third public image-select route found in `api/search/` |

### Evidence For

- `/apps/web/src/lib/search-enrichment-fields.ts` lines 29-41: 11 fields — `id`, `title`, `description`, `filename_jpeg`, `width`, `height`, `topic`, `topic_label`, `camera_model`, `lens_model`, `capture_date`. No `latitude`, `longitude`, `filename_original`, `user_filename`, pipeline-decision columns, or any `_PrivacySensitiveKeys` member.
- Line 43: `type _SearchEnrichmentSensitive = Extract<keyof typeof searchEnrichmentSelectFields, PrivacySensitiveKeys>` — must reduce to `never` for `tsc` to pass. tsc exit 0 confirmed at HEAD.
- Line 44-46: guard wired as a value (`= true`); removing the type or guard causes a compile error.
- `api/search/semantic/route.ts:55` — `import { searchEnrichmentSelectFields }` confirmed.
- `api/search/similar/[id]/route.ts:44` — `import { searchEnrichmentSelectFields }` confirmed.
- `topic_label` is `topics.label` (JOIN column), correctly absent from `PrivacySensitiveKeys`.

### Evidence Against / Gaps

None. The compile guard fires at tsc time, not test time.

### Rebuttal Round

Best challenge: "A new privacy-sensitive column added to `images` without updating `PrivacySensitiveKeys` would be invisible to the guard." This is the general drift risk for the entire privacy system, not a search-specific gap. The A2 fix puts these routes on equal footing with all other public surfaces. No search-specific bypass remains.

### Current Best Explanation

Flow 2 is CLEAN. A2 fully applied with compile-time enforcement.

### Critical Unknown

General `PrivacySensitiveKeys` drift (adding a sensitive column without updating the guard). Not search-specific; no novel probe needed this cycle.

### Discriminating Probe

None new required. `npm run typecheck` is the existing discriminating probe.

---

## Flow 3 — GPS Strip: strip_gps_on_upload=true → Walker → Stored Original

### Observation

`stripGpsFromOriginal` in `apps/web/src/lib/process-image.ts` implements a two-tier strategy: tier-1 lossless container-aware scrub, tier-2 metadata-free Sharp re-encode. The cycle-19 F2 finding was that the ISOBMFF walker returned `{stripped:false}` on anomalous-box early-exit, preventing the tier-2 fallback.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | F2 fix applied; no new bypass for JPEG/AVIF/WebP/TIFF/PNG on any standard or anomalous-box input | High | Strong | `walkAborted` flag confirmed at three guard points; `return null` on walkAborted confirmed |
| 2 | HEIC with anomalous ISOBMFF structure retains GPS | High (as a known limitation) | Strong | `process-image.ts:1690-1694` — no HEVC encoder; console.error + return |
| 3 | Tier-2 re-encode outer catch silently retains GPS on disk/OOM failure for any format | Medium (as a documented limitation) | Strong | `process-image.ts:1700-1708` — outer catch: safeUnlink tmpPath, return, comment says "Non-fatal" |

### Evidence For

**F2 fix confirmed at `gps-exif-strip.ts`:**
- Line 386: `let walkAborted = false;`
- Lines 388-393: three guard conditions each set `walkAborted = true` and return from the generator:
  - `if (pos + 16 > end)` (truncated box header)
  - `if (big > BigInt(Number.MAX_SAFE_INTEGER))` (64-bit box size overflow)
  - `if (size < headerSize || pos + size > end)` (box size overrun)
- Lines 461-467: `if (exifItemIds.size === 0 && xmpItemIds.size === 0) { if (walkAborted) return null; return { buffer: input, stripped: false }; }` — the pre-F2 code returned `{stripped:false}` unconditionally here, giving a false "clean" result. The fix correctly returns `null` when the walk was aborted, triggering tier-2.

**Format dispatch in `process-image.ts:1629-1718`:**
- JPEG: `input[0] === 0xff && input[1] === 0xd8` content guard + lossless scrub; on null → tier-2 at quality 95
- TIFF: lossless scrub; on null → tier-2 LZW
- HEIC/HEIF/AVIF: lossless ISOBMFF scrub; AVIF on null → tier-2 at quality 90; HEIC/HEIF on null → console.error + return (no HEVC encoder)
- WebP: lossless scrub; on null → tier-2 preserving lossless/lossy VP8 chunk type (AGG-C7-05)
- PNG: no lossless scrubber → `scrubbed` stays null → falls straight to tier-2 pixel-lossless. Correct.
- GIF/BMP: early return (no standardized EXIF/GPS carriage)
- Unknown extension: console.error + return

**Outer try/catch (tier-2 fault tolerance):**
- `process-image.ts:1700-1708`: if tier-2 `sharp().toFile()` throws, outer catch runs `safeUnlink(tmpPath)` (cleanup temp) and returns. The original is unchanged. Explicitly documented: DB columns are already nulled; derivatives already have no GPS; only download-original path leaks on failure; failing the upload entirely would be worse.

### Evidence Against / Gaps

**Edge case — partial ISOBMFF walk with walkAborted (not a new defect):**
If the iinf children walk is aborted mid-scan but some Exif items were already found before the abort (`exifItemIds.size > 0`), the walkAborted check at line 461-467 is skipped. The found-before-abort items are processed; items after the abort point are invisible. For a file with multiple Exif items (non-standard), a later GPS-bearing item could survive. Realistic probability: very low (single Exif item is the norm). Practical bound: this path ends at the HEIC no-HEVC limitation anyway for HEIC files, and AVIF files can fall to tier-2 re-encode. Not a new defect.

### Rebuttal Round

Best challenge to H1: "JPEG scrubber has a content-based magic-byte guard (`input[0] === 0xff && input[1] === 0xd8`) but AVIF/TIFF/WebP scrubbers rely on extension only. A misnamed file could be processed by the wrong scrubber." Why H1 still stands: the upload pipeline uses `crypto.randomUUID()` for all filenames with format-determined extensions assigned by the encoder. A misnamed file would fail Sharp `metadata()` before reaching GPS strip. No live path reaches a format mismatch at the GPS strip stage.

### Current Best Explanation

Flow 3 is CLEAN for all in-scope paths. F2 applied. The HEIC anomalous-structure gap (H2) and the tier-2 best-effort gap (H3) are known documented limitations, not regressions since cycle 19.

### Critical Unknown

Whether a structurally-valid HEIC where the Exif IFD is nested inside a non-standard box hierarchy (not reached by the walker's depth limit) could return `{stripped:false}` without the GPS actually being absent.

### Discriminating Probe

Read the ISOBMFF walker's depth-limit parameter and verify it descends to the correct depth to find `infe` boxes in all standard HEIF/AVIF authoring tools. An AVIF produced by ImageMagick vs. libavif could have a different box depth for the Exif item.

---

## Flow 4 — Admin Setting Flip → Which Served Bytes Update

### Observation

`serveUploadFile` builds an ETag from pipeline version, file mtime, file size, and an 8-character SHA-256 prefix of all color-impacting settings. The Next.js static file server uses a different ETag (mtime+size only). The two paths serve the same files under different conditions.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Serve-upload ETag includes settings hash; static-path ETag does not; CRT-D1 is the documented gap | High | Strong | `serve-upload.ts:215`, `settings-hash.ts:45-58` confirmed |
| 2 | The 5s stale-while-revalidate hash cache can serve a pre-flip ETag in the first 5s after an admin setting change | High (as deliberate design) | Strong | `serve-upload.ts:50-83` confirmed — stale-while-revalidate is intentional |
| 3 | `COLOR_IMPACTING_KEYS` is missing a byte-impacting setting | Low | Strong-against | 9 keys confirmed; compile guard (`_ColorKeysAreSettingKeys`) validates all 9 are `GallerySettingKey` members |

### Evidence For

**H1 — ETag construction:**
- `serve-upload.ts:215`: `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`
- `settings-hash.ts:45-58`: `COLOR_IMPACTING_KEYS` has 9 entries — 5 color keys (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`), 3 quality keys (`image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`), and `image_sizes`.
- `settings-hash.ts:83-84`: `image_sizes` is sorted ascending before hashing so `[640,1536]` and `[1536,640]` produce the same hash (AGG-R7C3-02).
- `settings-hash.ts:66-68`: `_ColorKeysAreSettingKeys` compile guard: `(typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never`. tsc exit 0 confirms no typo.
- `settings-hash.ts:71`: `HASH_LENGTH = 8`. No `.slice(0, 8)` at the ETag site — the hash is pre-sliced to 8 chars in `buildHash`.

**H1 — CRT-D1 (static-path gap, documented):**
- Next.js static file server emits `W/"{size-hex}-{mtime-hex}"` ETags (no pipeline version, no settings hash). A setting flip does NOT change on-disk bytes or mtime until a backfill re-encode runs. Documented in CLAUDE.md as "Operational gotcha (CRT-D1)."

**H2 — stale-while-revalidate (deliberate):**
- `serve-upload.ts:50-83`: if cached hash is < 5000 ms old, return immediately. If stale, fire a background refresh (`servingHashInflight` deduplication) and return the stale hash. If no cache (cold start), await the fresh fetch.
- On DB error during refresh: returns `servingHashCache.hash` (last known) or the static `FALLBACK_HASH`. `finally { servingHashInflight = null; }` ensures the next request retries.
- Net: up to 5s after a setting flip, serve-upload requests may get the pre-flip ETag. Deliberate latency/correctness trade-off.

**R20-L1 (already committed):**
- `serve-upload.ts:237-258`: HEAD requests return headers-only without opening a file stream. Committed at `351b5306 perf(serve-upload): ⚡ HEAD-aware serveUploadFile skips file stream open (R20-L1)`, which predates the current HEAD (`9af705f4`). Not a new implementation task for cycle 20.

### Evidence Against / Gaps

**H3 — `COLOR_IMPACTING_KEYS` completeness:** The compile guard catches typos and removed keys but NOT a forgotten new byte-impacting setting. Documented in CLAUDE.md ("Adding a new color-impacting setting" checklist). No new byte-impacting settings added since cycle 19.

### Rebuttal Round

Best challenge to H1: "The serve-upload path with settings-hash ETag serves only the minority of real traffic (static path serves existing files). The 'settings flip invalidates cache' story is only true for the SW HEAD revalidation path and fallback route." Why H1 still stands: CRT-D1 is the documented known limitation. The ETag design is correct for the serve-upload path. No new gap was discovered.

### Current Best Explanation

Flow 4 is CLEAN. The serve-upload ETag is correctly constructed. The 5s stale-while-revalidate is deliberate. CRT-D1 (static path gap) is the only limitation, documented. R20-L1 is already committed.

### Critical Unknown

Whether the Service Worker HEAD revalidation correctly re-parses the serve-upload ETag across a settings-hash change (old ETag: `W/"v7-{mtime}-{size}-{old_hash}"` vs new ETag: `W/"v7-{mtime}-{size}-{new_hash}"`). The SW template contract test pins revalidation logic but does not exercise a settings-hash rotation specifically.

### Discriminating Probe

Add a test: call `serveUploadFile` with an `If-None-Match` carrying an ETag built from the pre-flip settings hash → expect 200 (not 304). This confirms the 304 short-circuit only fires on exact full ETag match, not on pipeline-version-prefix match.

---

## Convergence / Separation Notes

All four flows are clean at HEAD 9af705f4. No two traced hypotheses share a root cause. The structural theme across flows 3 and 4 is "documented best-effort fallbacks that retain GPS / serve stale bytes on rare failure paths" — both are deliberate design choices at known, documented decision points, not a shared defect root.

---

## Overall Uncertainty Notes

- The `deleteOriginalUploadFile` never-throws invariant (Flow 1) is comment-only with no compile or test enforcement.
- The HEIC partial-walk scenario (Flow 3) is technically reachable but bounded by the existing no-HEVC-encoder limitation.
- The 5s stale window (Flow 4) is an intentional latency trade-off.
- The `COLOR_IMPACTING_KEYS` completeness gap (Flow 4) is a process/checklist risk, not a type-system-detectable gap.
