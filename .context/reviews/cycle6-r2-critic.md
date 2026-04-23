# Critic Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: critic
## Scope: Multi-perspective critique of the whole change surface

---

### C6R2-C01: The StorageBackend abstraction was shipped half-done (HIGH)

The storage abstraction was committed as a complete feature (commit `0000000a`), but it's architecturally incomplete. The admin UI implies S3/MinIO are usable backends, the `switchStorageBackend` function runs on save, and the settings page shows an amber warning about env vars — all creating the impression that remote storage is functional. But nothing actually routes through the abstraction.

This is worse than not having the abstraction at all, because:
1. It creates false confidence (admin thinks they're using S3)
2. It adds ~580 lines of dead code that must be maintained
3. It introduces a settings toggle that appears to work but doesn't
4. Future developers may assume the integration is done

**Recommendation:** Either complete the integration in the same commit series, or hide the S3/MinIO options behind a feature flag/env var until integration is complete.

**Confidence:** HIGH

---

### C6R2-C02: Gallery settings page is a no-op for image processing parameters (HIGH)

Related to C6R2-V02 but from a UX perspective: the settings page lets you change WebP/AVIF/JPEG quality, image sizes, queue concurrency, max file size, and max files per batch. None of these have any effect on the actual processing pipeline. This is a usability problem — the admin configures values that are silently ignored.

**Recommendation:** Either integrate the settings into the pipeline, or mark the non-functional settings as "Coming Soon" / disabled in the UI.

**Confidence:** HIGH

---

### C6R2-C03: `selectFields` privacy approach needs stronger enforcement (MEDIUM)

The compile-time guard added since the last cycle is a good step, but it still has a gap: per-query spreads can add sensitive fields without the guard catching it. A `publicSelectFields` constant (or a branded type that prevents spreading sensitive fields into public queries) would be more robust.

**Confidence:** MEDIUM

---

### C6R2-C04: Duplicate UPLOAD_ROOT logic is a maintenance hazard (MEDIUM)

Three files independently derive `UPLOAD_ROOT` with the same logic. If the logic changes (e.g., a new deployment directory structure), all three must be updated in sync. This is fragile.

**Confidence:** HIGH

---

### C6R2-C05: Settings page lacks unsaved-changes protection (LOW)

The settings page has no mechanism to warn the user about unsaved changes. Navigating away after modifying settings silently discards changes. This is a minor UX issue.

**Confidence:** MEDIUM
