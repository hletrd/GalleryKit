# Plan 191 — Cycle 10 Ultradeep Fixes

**Source review:** Cycle 10 Aggregate Review (`C10-01` through `C10-06`)
**Status:** DONE
**User-injected TODOs honored this cycle:** `deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`

---

## Findings to Address This Cycle

| ID | Description | Severity | Confidence |
|---|---|---|---|
| C10-01 | `getClientIp()` trusts the left-most forwarded IP even though the shipped nginx config appends the real client IP, making throttles spoofable | HIGH | HIGH |
| C10-02 | `createTopic()` can create a slug that silently hijacks an existing alias route | HIGH | HIGH |
| C10-03 | Topic slug renames are incompatible with the current `ON UPDATE no action` foreign-key contract | HIGH | HIGH |
| C10-04 | Tag slug collisions still map requests onto the wrong existing tag across add/batch/upload flows | HIGH | HIGH |
| C10-05 | Single-image tag mutations can report success even when the target image no longer exists | MEDIUM | HIGH |
| C10-06 | Successful uploads do not invalidate the affected public topic page | MEDIUM | HIGH |

---

## Implementation Plan

### 1. Harden trusted client-IP parsing against the shipped nginx chain (`C10-01`)
**Files:**
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`

**Plan:**
1. Change forwarded-IP parsing to prefer the right-most valid forwarded hop for the documented nginx `proxy_add_x_forwarded_for` contract.
2. Keep the existing `x-real-ip` fallback and `TRUST_PROXY` gate.
3. Lock the behavior with regression tests that prove spoofed left-most hops no longer win.

### 2. Preserve topic route integrity on create + rename (`C10-02`, `C10-03`)
**Files:**
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`

**Plan:**
1. Reject `createTopic()` when the requested slug already exists as a topic or alias route segment.
2. Replace the current rename flow with a schema-compatible transaction that creates the replacement topic row first, migrates children, then removes the old row.
3. Add focused tests for alias-collision rejection and FK-safe rename ordering.

### 3. Make tag mutation flows reject collisions and stale targets instead of mutating the wrong records (`C10-04`, `C10-05`)
**Files:**
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/__tests__/tags-actions.test.ts`

**Plan:**
1. Centralize tag-name/slug resolution so exact-name matches win and slug collisions return an explicit collision result instead of silently selecting another tag.
2. Use that helper in tag add/remove/batch flows and upload-time tag assignment so colliding names are rejected or skipped rather than misapplied.
3. Verify image existence before single-image tag mutations and avoid false success toasts when no tag change actually happened.
4. Add regression coverage for collision handling and missing-image behavior.

### 4. Revalidate the affected public topic page after uploads (`C10-06`)
**Files:**
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/__tests__/images-actions.test.ts`

**Plan:**
1. Extend upload success revalidation to include the affected topic path.
2. Add focused coverage that proves the topic path is invalidated alongside `/` and `/admin/dashboard`.

---

## Verification Goals

- `npm run lint --workspace=apps/web`
- `npm run build`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- Per-cycle deploy command succeeds after green gates:
  - `ssh -i ~/.ssh/atik.pem ubuntu@gallery.atik.kr "cd /home/ubuntu/gallery && bash apps/web/deploy.sh"`


## Completion Notes

- [x] `C10-01` implemented in `apps/web/src/lib/rate-limit.ts` and `rate-limit.test.ts`
- [x] `C10-02` + `C10-03` implemented in `apps/web/src/app/actions/topics.ts` with regression coverage in `topics-actions.test.ts`
- [x] `C10-04` + `C10-05` implemented via `apps/web/src/lib/tag-records.ts`, `tags.ts`, `images.ts`, `image-manager.tsx`, and `tags-actions.test.ts`
- [x] `C10-06` implemented in `apps/web/src/app/actions/images.ts` with regression coverage in `images-actions.test.ts`

## Verification Results

- [x] `npm run lint --workspace=apps/web`
- [x] `npm run build`
- [x] `npm test --workspace=apps/web`
- [x] `npm run test:e2e --workspace=apps/web`
