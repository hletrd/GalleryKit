# Cycle 32 Critic Review

Reviewer: critic
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `3d174c96`
Date: 2026-06-30 KST
Scope: skeptical multi-perspective source critique only. No product code or other review files were edited.

## Findings

### C32-CRIT-01 - Bulk-edit tags can be silently ignored while the action reports success

Severity: Medium
Confidence: High

Exact citations:

- `apps/web/src/components/bulk-edit-dialog.tsx:112-153`
- `apps/web/src/components/tag-input.tsx:87-95`
- `apps/web/src/app/actions/images.ts:995-1003`
- `apps/web/src/app/actions/images.ts:1132-1155`
- `apps/web/src/app/actions/images.ts:1169-1184`
- `apps/web/src/app/actions/images.ts:154-160`
- `apps/web/src/__tests__/bulk-update-images.test.ts:202-278`
- `apps/web/src/__tests__/bulk-update-images.test.ts:532-599`

Failure scenario:

An admin selects 40 images, opens bulk edit, and adds or removes a tag whose submitted value is malformed, control-character-tainted, slug-invalid after normalization, or otherwise rejected by the server-side tag rules. The dialog only validates title, description, and topic before submitting; the tag input prevents obvious invalid manual entry, but the server action is still the trust boundary. In `bulkUpdateImages`, the action validates that tag arrays are arrays of strings and length-bounded, then each invalid add/remove tag is skipped with `continue`. The action still revalidates data and returns `{ success: true, count: existingIds.length }`, and the audit event records the requested tag names even when no tag mutation happened.

Why this matters:

This is an admin data-correction workflow, so "success" is used as evidence that the batch operation applied. Silent skips make the UI and audit trail misleading: a real operator can close the dialog believing a tag was added or removed across the selection when the server did nothing for that tag. Upload already aborts on any invalid tag candidate, so the product has a stricter precedent for tag correctness at `apps/web/src/app/actions/images.ts:154-160`.

Concrete fix:

Validate and normalize all `addTagNames` and `removeTagNames` before opening the transaction. If any candidate is rejected by `requireCleanInput`, `isValidTagName`, slug validation, or an equivalent remove-tag lookup policy, return a localized error instead of partial/silent success. Add tests next to the existing bulk-update validation and tag-mutation tests for invalid add/remove names and for "valid plus invalid" mixed batches.

### C32-CRIT-02 - Gallery scroll restoration uses only pathname, so tag-filtered lists collide

Severity: Low
Confidence: High

Exact citations:

- `apps/web/src/components/home-client.tsx:124-140`
- `apps/web/src/components/home-client.tsx:145-170`
- `apps/web/src/components/home-client.tsx:323-328`
- `apps/web/src/components/tag-filter.tsx:23-45`

Failure scenario:

A visitor opens `/en?tags=travel`, scrolls deep into that filtered result set, clicks a photo, then returns to `/en` or another tag combination under the same pathname. `HomeClient` saves scroll under `gallery-scroll:${pathname}` and restores/removes that same key on mount, while `TagFilter` changes the active tag set through the `tags` query parameter on the same pathname. The saved Y position from one gallery variant can therefore be applied to a different variant with a different result count/order.

Why this matters:

The home gallery is the primary browsing surface. Restoring a filtered list's deep scroll into the unfiltered or differently-filtered list can land the visitor mid-stream, below the expected top context, or near blank space if the new result set is shorter. It is not data loss, but it is product correctness friction in the core public UX.

Concrete fix:

Include the canonical gallery variant in the scroll key: at minimum the active search params, and preferably the already-available route state (`currentTags`, `topicSlug`, `smartCollectionSlug`) serialized in a stable order. Add a client test or focused component test that saves scroll from one tag query and verifies a different tag query does not restore it.

## Review Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the repo surface relevant to product correctness, architecture, operations, UX, tests, documentation, and maintainability. Inspected areas included public and admin routes, server actions, auth/session/rate-limit utilities, upload/delete/bulk-edit flows, search and feed changes, deploy scripts, Docker/nginx/runtime shutdown behavior, migration guidance, and existing review/test coverage.

I also checked the prior critic findings against current HEAD and did not re-file them:

- Search mode invalidation is now centralized through `clearSearchState()` and called by the semantic toggle at `apps/web/src/components/search.tsx:151-158` and `apps/web/src/components/search.tsx:503-506`.
- The public-route rate-limit scanner now detects ambiguous file-level exemptions across multiple protected surfaces at `apps/web/scripts/check-public-route-rate-limit.ts:552-568`, with regression coverage at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:273-306`.
- Root and topic feed routes now perform cheap freshness checks before full feed composition at `apps/web/src/app/feed.xml/route.ts:29-56` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:50-78`.

## Positive Evidence

- Auth/session handling uses signed session tokens, hashed stored tokens, production secret checks, same-origin mutation guards, and account/IP rate limits in the inspected paths.
- Deploy sequencing builds, starts, health-checks, then prunes stopped artifacts; the auto-prune path does not run before the replacement container is healthy.
- Runtime instrumentation installs graceful shutdown hooks for image processing and buffered shared-group view counts.
- Existing source-contract tests cover many previously fragile areas, including bulk-update auth/tri-state shape, public route guard behavior, privacy-sensitive data omission, and touch targets.

## Validation Notes

This was a static review lane. I did not run the full lint/typecheck/build/test suite because the task was to produce a critique artifact, not modify behavior. Validation evidence came from direct source inspection, exact line references, current HEAD/status checks, and a final sweep over the candidate issue areas.

## Final Sweep

I rechecked the fixed cycle-31 areas, the current admin bulk-edit path, public gallery filter navigation, tag input/server-action boundaries, feed freshness, auth/rate-limit shape, upload invariants, deploy hygiene, and available bulk-update tests. I did not find additional confirmed actionable issues that cleared the "not taste, concrete scenario, exact citation" bar. Residual risk: no browser automation, production logs, or live deploy checks were run in this review lane.
