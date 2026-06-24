# Cycle 2 Deep Review — Code Reviewer

Date: 2026-06-24
HEAD: 95de4d11

## Summary

Cycle 1 fixed 13 of 43 findings. This review focuses on the remaining open issues and any new issues introduced by cycle 1 fixes. All gates pass (eslint, tsc, vitest, api-auth, action-origin, public-route-rate-limit). 225 test files, 2064 tests pass.

## New Findings (Cycle 2)

### CR2-01 — `semantic-search-route.test.ts` has stale assertion after AGG-12 fix

- Severity: Medium
- Confidence: High
- Type: Test drift

Evidence: Commit 4264d1d4 (AGG-12) removed `rollbackSemanticAttempt` after expensive embedding failures. The test at `apps/web/src/__tests__/semantic-search-route.test.ts` was updated in f8137c74 but the test name/comments may still reference the old rollback behavior.

Failure scenario: Future maintainers reading the test expect rollback behavior that no longer exists.

Suggested fix: Update test comments to reflect the new no-rollback-after-expensive-work contract.

### CR2-02 — `check-action-origin.test.ts` fixture coverage gap for nested async IIFE

- Severity: Low
- Confidence: Medium
- Type: Test gap

Evidence: The hardened scanner (AGG-01/02/03 fix in 4d03d50f) added detection for mutation-before-return and star re-exports. However, the fixture tests don't cover a nested async IIFE pattern where `requireSameOriginAdmin()` is called inside an IIFE that then mutates.

Failure scenario: A future action uses an IIFE pattern that evades the scanner.

Suggested fix: Add a negative fixture for nested async IIFE with mutation-before-return.

## Verified Fixed (from Cycle 1)

- AGG-01: Scanner hardened (mutation-before-return, star re-exports) — confirmed by reading check-action-origin.ts
- AGG-02: Star re-exports now rejected — confirmed
- AGG-03: Pre-increment call required before mutation — confirmed
- AGG-08: retryFailedImage guards against restore maintenance — confirmed in images.ts
- AGG-12: No rollback after expensive semantic search work — confirmed in semantic/route.ts
- AGG-39: retryFailedImage error localized — confirmed in images.ts and messages

## Remaining Open (from Cycle 1, verified still present)

- AGG-05: Admin photo detail uses public projection with admin UI — still present in data.ts
- AGG-06: DB restore accepts incomplete dumps — still present in db-actions.ts
- AGG-07: Late caption/embedding hooks can write after restore — still present in image-queue.ts
- AGG-09: Permanent failure state not durable across restarts — still present in image-queue.ts
- AGG-10: Sidecar backfill unsafe concurrency — still present in backfill-color-pipeline.ts
- AGG-11: Semantic search no global CPU guard — still present in semantic/route.ts
- AGG-14: Stub and production semantic embeddings can overwrite — still present in clip-embeddings.ts
- AGG-15: Backfill command no-op before activation — still present in backfill-clip-embeddings.ts
- AGG-16: Missing env vars in example — still present in .env.local.example
- AGG-18: Auto alt-text stub presented as AI — still present in caption-generator.ts
- AGG-19: Similar photos stale results — still present in similar-photos.tsx
- AGG-20: Partial numeric ids — FIXED in similar/[id]/route.ts (regex validation added)
- AGG-26: CSP allows inline styles — still present in content-security-policy.ts
- AGG-27: Search LIKE escaping relies on SQL mode — still present in data.ts
- AGG-29: Token management absent from admin nav — still present in admin-nav.tsx
- AGG-30: Legacy symlink cleanup — still present in upload-paths.ts
- AGG-31: Storage abstraction risk — still present in storage/local.ts
- AGG-32: Search modal clipped — still present in search.tsx
- AGG-35: Touch-target audit stale budgets — still present in touch-target-audit.test.ts
- AGG-36: Admin tables lack overflow — still present in topic-manager.tsx, tag-manager.tsx
- AGG-37: Custom modal focus trap without inert — still present in lightbox.tsx, info-bottom-sheet.tsx
- AGG-38: Light theme hydration mismatch — still present in nav-client.tsx
- AGG-40: HDR claims misread — still present in README.md
- AGG-41: High-performance claim unproven — still present in README.md
- AGG-42: Demo config leaks — still present in site-config.json, nginx/default.conf
- AGG-43: GitHub trust signal — still present in footer.tsx
