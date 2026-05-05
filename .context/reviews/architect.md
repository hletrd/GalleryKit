# Cycle 17 Architect Review — architect

Date: 2026-05-06
Scope: Full repository, post-cycle-16 state
Focus: Architectural/design risks, coupling, layering

## Findings

### MEDIUM SEVERITY

**C17-ARCH-01: ImageProcessingJob is a bag-of-fields with weak producer contracts**
- **File:** `apps/web/src/lib/image-queue.ts` (lines 107-121)
- **Confidence:** High
- **Problem:** `ImageProcessingJob` declares `camera_model?`, `capture_date?`, `iccProfileName?`, `quality?`, and `imageSizes?` as all optional. There is no compile-time or runtime enforcement that producers pass consistent sets of fields. The bootstrap query and `uploadImages` have already diverged twice (cycle 16 fixed bootstrap only; cycle 17 must fix upload). Optional fields for data that is always available at the producer create a footgun.
- **Fix:** Split into `ImageProcessingJobRequired` (always-present fields) and `ImageProcessingJobOptional` (truly conditional fields), or use a builder pattern that validates completeness before enqueuing.

**C17-ARCH-02: iccProfileName is not persisted, creating a bootstrapping gap**
- **File:** `apps/web/src/db/schema.ts`
- **Confidence:** High
- **Problem:** The `images` table has `color_space` (from EXIF) but no `icc_profile_name` (from Sharp ICC parsing). The queue's `processImageFormats` needs `iccProfileName` to decide AVIF colorspace, but bootstrapped jobs can never receive it because it's not in the DB. This forces a design split: fresh uploads COULD pass it, but bootstrapped jobs never can.
- **Fix:** Add `icc_profile_name` to the schema and persist it at upload time. This closes the gap and makes bootstrap behavior match fresh-upload behavior.

### LOW SEVERITY

**C17-ARCH-03: Service Worker metadata store uses a single shared JSON blob**
- **File:** `apps/web/public/sw.js` (lines 54-75)
- **Confidence:** Medium
- **Problem:** The metadata store (`getMeta`/`setMeta`) serializes the entire LRU Map to a single JSON blob stored under `/__meta__` in the Cache API. This creates a serialization bottleneck and the read-modify-write race (C16-HIGH-01). Per-URL metadata keys would eliminate the race and reduce serialization overhead.
- **Fix:** Store each entry as a separate Cache API item with the URL as the key.

**C17-ARCH-04: Module-level singletons rely on single-writer topology**
- **File:** `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts`
- **Confidence:** Low
- **Problem:** The processing queue state (`getProcessingQueueState`), rate-limit Maps, and view-count buffer are all module-level singletons. The CLAUDE.md documents this as intentional for the single-instance topology, but it means horizontal scaling is blocked without significant refactoring.
- **Fix:** Documented and accepted by project rules. No action needed.

## Verdict

The architecture is sound for its intended single-instance deployment model. The main risk is the weak contract around `ImageProcessingJob` fields, which has already caused two cycles of partial fixes. Adding `icc_profile_name` to the schema would be a structural improvement that eliminates a persistent data-flow gap.
