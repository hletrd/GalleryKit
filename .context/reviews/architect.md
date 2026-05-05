# Architecture Review — Cycle 14 (2026-05-06)

**Reviewer angle**: Architectural/design risks, coupling, layering
**Scope**: Module boundaries, data flow, deployment topology, i18n, build pipeline
**Gates**: All green

---

## Executive Summary

Architecture remains clean and well-layered. No new architectural risks in cycle 14.

## Findings

No new findings in cycle 14.

## Verified Architecture

1. **Module layering**: `data.ts` (queries) / `process-image.ts` (image pipeline) / `auth-rate-limit.ts` (security) are cleanly separated with no circular dependencies.

2. **Single-instance topology**: Correctly documented. Process-local states (restore flags, upload quota, image queue, view count buffer) are acknowledged as not horizontally scalable without shared storage.

3. **i18n**: Locale-prefix routes (`/[locale]/...`), server-side translations via `next-intl`, organized key structure in `messages/`.

4. **Build pipeline**: Service worker generation via `scripts/build-sw.ts`, standalone output for Docker, multi-stage Dockerfile.

5. **Storage abstraction**: `@/lib/storage` exists as internal abstraction but local filesystem is the only wired backend. Not exposed as a user-facing toggle — correctly documented.

## Conclusion

No architectural concerns in cycle 14.
