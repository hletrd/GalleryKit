# Verifier Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: verifier
## Scope: Evidence-based correctness check against stated behavior

---

### C6R2-V01: `storage_backend` setting has no effect on actual storage behavior (HIGH)

**Claim:** The admin settings page allows switching storage backend between local, MinIO, and S3.
**Evidence:** `actions/settings.ts:73-78` calls `switchStorageBackend()` which updates the singleton. However, no code reads from the storage singleton. All file operations use direct `fs` calls via `UPLOAD_DIR_*` constants.
**Verdict:** FALSE — the setting is stored and the singleton switches, but actual storage behavior does not change.

This is a correctness issue, not just a missing feature. The admin UI creates the expectation that switching backends works, but it doesn't.

**Confidence:** HIGH

---

### C6R2-V02: Gallery config settings have no effect on processing pipeline (HIGH)

**Claim:** The admin settings page allows configuring image quality (WebP/AVIF/JPEG), image sizes, queue concurrency, and other processing parameters.
**Evidence:** `gallery-config.ts` reads these settings from the DB and exposes them via `getGalleryConfig()`. However:
- `process-image.ts:368-373` hard-codes quality values (90, 85, 90)
- `process-image.ts:167` hard-codes `OUTPUT_SIZES = [640, 1536, 2048, 4096]`
- `image-queue.ts:58` reads `QUEUE_CONCURRENCY` from env, not from gallery config
- `process-image.ts:56` reads `MAX_FILE_SIZE` from env, not from gallery config

**Verdict:** FALSE — the settings are stored but have no effect on the processing pipeline.

**Confidence:** HIGH

---

### C6R2-V03: `selectFields` compile-time guard works correctly (CONFIRMED)

**Claim:** The compile-time guard prevents adding privacy-sensitive fields to `selectFields`.
**Evidence:** The type assertion at `data.ts:131-139` creates a conditional type that resolves to `never` when a sensitive key is present, causing a type error. Testing: adding `latitude: images.latitude` to `selectFields` would produce a type error because `keyof typeof selectFields` would include `'latitude'`, which extends `_PrivacySensitiveKeys`, causing the conditional to resolve to the error tuple instead of `true`.

**Verdict:** CONFIRMED — the compile-time guard works as intended.

**Confidence:** HIGH

---

### C6R2-V04: `home-client.tsx` eslint-disable issue resolved (CONFIRMED)

**Claim:** C5-F02/C6-F02 stated that `home-client.tsx` had a file-level `eslint-disable @next/next/no-img-element`.
**Evidence:** Current code at `home-client.tsx:1` has no file-level disable. Line 260 has `eslint-disable-next-line @next/next/no-img-element` which is the correct per-element approach.

**Verdict:** RESOLVED — the file-level disable has been removed since the previous review.

**Confidence:** HIGH

---

### Previously Verified Findings

- C5-F01 (GPS privacy comments): CONFIRMED — PRIVACY comments and compile-time guard present
- C5-F03 (processImageFormats verification): CONFIRMED — all 3 formats verified
- C6-03 (upload tracker TOCTOU): CONFIRMED — pre-increment pattern present
- C6-07 (session transaction): CONFIRMED — db.transaction wrapping present
- C6-09 (CSV streaming): CONFIRMED — incremental building with GC release present
