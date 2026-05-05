# Architecture Review — Cycle 13 (2026-05-05)

**Reviewer angle**: Design risks, coupling, layering, scalability, maintainability
**Scope**: Module boundaries, data flow, storage abstractions, i18n, deployment topology
**Gates**: All green

---

## Executive Summary

The architecture is well-layered and appropriate for a single-writer personal gallery. Data access is centralized in `lib/data.ts`, image processing is isolated in `lib/process-image.ts`, and auth is cleanly separated. The codebase correctly acknowledges its single-instance topology limitations.

No new architectural risks identified in this cycle.

## Verified Architecture Decisions

### Single-Instance Topology Acknowledgment
- `CLAUDE.md` explicitly documents: "The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store."
- This is an honest and appropriate architectural boundary for the project's scope.

### Rate-Limit Abstraction
- `BoundedMap` (`lib/bounded-map.ts`) consolidates the previously duplicated prune+evict pattern across rate-limit modules. Two strategies supported: `resetAt`-based and window-based.
- The abstraction correctly delegates expiry policy to consumer-provided predicates while handling hard-cap eviction uniformly.

### Image Processing Pipeline
- Upload -> original save -> DB insert -> async queue -> Sharp processing (AVIF/WebP/JPEG in parallel) -> conditional UPDATE
- Advisory locks (`gallerykit:image-processing:{jobId}`) prevent duplicate processing across workers/restarts
- Single Sharp instance with `clone()` avoids triple buffer decode
- Color pipeline versioning (`IMAGE_PIPELINE_VERSION = 3`) enables cache invalidation on encoder semantic changes

### Privacy Field Guard Pattern
- `adminSelectFields` -> destructuring omission -> `publicSelectFields` with compile-time guards
- This is an effective pattern: adding a sensitive field to admin queries does NOT automatically leak it to public queries
- Three compile-time guards prevent common mistakes: privacy keys, map-only keys, large payload keys

### i18n Architecture
- `next-intl` with locale-prefixed routes (`/[locale]/...`)
- Server actions use `getTranslations('serverActions')` for localized error messages
- Translation keys are well-organized by domain

## Areas of Technical Debt (Already Documented)

The following are known limitations, not new findings:
- **Storage backend**: `lib/storage` module exists as an abstraction but only local filesystem is wired end-to-end
- **Semantic search**: Uses deterministic stub embeddings; real ONNX inference deferred
- **EXIF-based search/filter**: No range queries for ISO, aperture, etc.
- **Bulk operations**: `bulkUpdateImages` uses per-row UPDATE loop

## Conclusion

Architecture is sound for the project's scope. No layering violations, coupling issues, or scalability risks beyond the already-documented single-instance constraint.
