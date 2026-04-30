# Plan 178 — Cycle 3 Ultradeep Hardening

**Created:** 2026-04-22
**Status:** DONE
**Purpose:** Implement the highest-signal cycle-3 ultradeep findings that are code-fixable in a bounded pass without introducing new dependencies.

## Scheduled fixes

### C178-01: Reuse the runtime MySQL TLS policy in migration/startup scripts
**Severity:** HIGH | **Confidence:** High
**Sources:** `C3-01` in `.context/reviews/_aggregate.md`, `.context/reviews/security-reviewer.md`
**Files:** `apps/web/scripts/migrate.js`, `apps/web/scripts/migrate-capture-date.js`, shared helper if needed

Implementation:
1. Extract/reuse the same non-localhost TLS policy already used by `apps/web/src/db/index.ts`.
2. Apply it to both migration scripts.
3. Preserve the existing `DB_SSL=false` escape hatch semantics.

### C178-02: Make `image_sizes` a bounded, non-breaking setting
**Severity:** HIGH | **Confidence:** High
**Sources:** `C3-04` in `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/debugger.md`, `.context/reviews/critic.md`
**Files:** `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, tests if needed

Implementation:
1. Canonicalize `image_sizes` server-side (trim, dedupe, sort ascending).
2. Add a hard cap on the number of sizes accepted.
3. Refuse `image_sizes` changes once processed images already exist, so old derivatives are not stranded.
4. Surface the constraint clearly in the admin settings UI and error messaging.

### C178-03: Restore topic mutation correctness and operator feedback
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `C3-05`, `C3-06`, `C3-14` in `.context/reviews/_aggregate.md`, `.context/reviews/critic.md`, `.context/reviews/designer.md`
**Files:** `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`

Implementation:
1. Reapply the 100-character topic-label validation to `updateTopic()`.
2. Return a structured warning when topic image processing fails instead of silently reporting full success.
3. Surface that warning in `TopicManager`.
4. Add an accessible name to alias delete buttons.

### C178-04: Fix public cache invalidation for topic/tag mutations
**Severity:** MEDIUM | **Confidence:** High
**Sources:** `C3-07` in `.context/reviews/_aggregate.md`, `.context/reviews/debugger.md`
**Files:** `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/lib/revalidation.ts` if needed

Implementation:
1. Broaden invalidation after topic/tag rename/delete so cached photo pages do not stay stale for ISR duration.
2. Keep the change simple and safe even if it means using a coarser invalidation scope.

### C178-05: Remove fragile framework-coupling from auth/admin-route checks
**Severity:** HIGH | **Confidence:** High
**Sources:** `C3-11`, `C3-16` in `.context/reviews/_aggregate.md`, `.context/reviews/dependency-expert.md`, `.context/reviews/critic.md`
**Files:** `apps/web/src/app/actions/auth.ts`, `apps/web/scripts/check-api-auth.ts`

Implementation:
1. Replace the private `next/dist/.../redirect-error` import with the public control-flow pattern.
2. Upgrade the admin API auth checker from string search to a real AST-based export/wrapper check.

### C178-06: Fix the confirmed UI/a11y defects from the designer review
**Severity:** HIGH | **Confidence:** High
**Sources:** `C3-12`, `C3-13`, `C3-15` in `.context/reviews/_aggregate.md`, `.context/reviews/designer.md`
**Files:** `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/app/[locale]/loading.tsx`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`

Implementation:
1. Remove the nested interactive download control pattern.
2. Make the mobile info sheet semantics match its actual modal behavior.
3. Localize loading announcements.

### C178-07: Clear low-cost drift the review reconfirmed
**Severity:** LOW | **Confidence:** High
**Sources:** `C3-17`, `C3-22` in `.context/reviews/_aggregate.md`, `.context/reviews/verifier.md`, `.context/reviews/document-specialist.md`
**Files:** `apps/web/src/lib/data.ts`, `README.md`, `CLAUDE.md` if needed

Implementation:
1. Correct the misleading `getImage()` legacy-null comment or make the behavior match it.
2. Document `DEPLOY_REMOTE_SCRIPT` alongside the existing deploy helper env vars.

## Progress
- [x] C178-01: Migration/startup TLS parity
- [x] C178-02: Safe `image_sizes`
- [x] C178-03: Topic mutation correctness/feedback
- [x] C178-04: Topic/tag public revalidation
- [x] C178-05: Auth/admin-route framework hardening
- [x] C178-06: UI/a11y fixes
- [x] C178-07: Low-cost docs/comment drift cleanup
