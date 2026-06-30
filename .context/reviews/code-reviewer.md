# Cycle 34 Code Reviewer Review

Reviewer: code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `e1f124a265998ea51297d6716df6c03a2056a96c`
Date: 2026-06-30 KST
Scope: read-only review lane. No source, test, plan, git, or commit changes were made.

## Inventory

Required context read:

- `AGENTS.md`
- Relevant `CLAUDE.md` sections: project structure, security architecture, privacy, runtime topology, permanently deferred items, quality gates, lint gates, touch-target policy
- Current Cycle 33 plan and deferred ledger:
  - `.context/plans/cycle-33-2026-06-30-plan.md`
  - `.context/plans/cycle-33-2026-06-30-deferred.md`
- Current and archived review baselines:
  - `.context/reviews/_aggregate.md`
  - `.context/reviews/archive/_aggregate-cycle33.md`
  - `.context/reviews/archive/cycle33-comprehensive-review.md`

Repository state:

- `git rev-parse HEAD`: `e1f124a265998ea51297d6716df6c03a2056a96c`
- `git status --short`: clean
- Current HEAD is `fix(cycle-33): 🐛 close reviewed production gaps`

Files and subsystems inspected:

- Cycle 33 touched implementation files:
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/api/admin/lr/upload/route.ts`
  - `apps/web/src/lib/caption-generator.ts`
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-public-route-rate-limit.ts`
  - `apps/web/src/app/feed.xml/route.ts`
  - `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
  - `apps/web/src/app/[locale]/admin/layout.tsx`
  - `apps/web/src/app/[locale]/admin/page.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
  - `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/db/schema.ts`
- Regression tests/source contracts inspected:
  - `apps/web/src/__tests__/bulk-update-images.test.ts`
  - `apps/web/src/__tests__/caption-generator.test.ts`
  - `apps/web/src/__tests__/check-action-origin.test.ts`
  - `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
  - `apps/web/src/__tests__/feed-sized-derivative.test.ts`
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`
  - `apps/web/src/__tests__/cycle-21-source-contracts.test.ts`
  - `apps/web/src/__tests__/cycle-22-source-contracts.test.ts`

Cycle 33 deferred findings were treated as baseline and not re-raised. This review only reports new evidence from the current HEAD.

## Findings

### C34-CODE-01 - Lightroom multipart parse slot leaks on quota early returns

Severity: High
Confidence: High

Region:

- `apps/web/src/app/api/admin/lr/upload/route.ts:60-73`
- `apps/web/src/app/api/admin/lr/upload/route.ts:130-185`
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:267-278`

Issue:

The new LR/PAT upload pre-parse guard acquires the single multipart parse slot at `route.ts:130`, but the slot is only released in the `finally` around `request.formData()` at `route.ts:177-185`. Two quota branches return before reaching that `finally`:

- `tracker.count + 1 > UPLOAD_MAX_FILES_PER_WINDOW` at `route.ts:147-151`
- `tracker.bytes + declaredUploadBytes > MAX_TOTAL_UPLOAD_BYTES` at `route.ts:153-157`

Because `tryAcquireLrMultipartParseSlot()` increments the module-level `lrMultipartParseInFlight` counter, either early return leaves the counter at 1 for the lifetime of the process. Every later LR upload then fails at `route.ts:130-135` with "Another Lightroom upload is being parsed; retry shortly", even though no parse is active.

Concrete failure scenario:

1. An authenticated Lightroom/PAT client reaches the per-window file or byte quota.
2. The next upload attempt acquires `releaseMultipartParseSlot`, then returns 429 from the quota check before `request.formData()`.
3. `lrMultipartParseInFlight` remains permanently incremented.
4. All subsequent Lightroom uploads in that web process return 429 from the parse-slot guard until process restart.

This is especially actionable because Cycle 33's own plan required "Ensure every early return releases the pre-parse slot", and the source-contract test only asserts that some later `finally` calls `releaseMultipartParseSlot()`; it does not cover returns between acquisition and parsing.

Suggested fix:

Move `tryAcquireLrMultipartParseSlot()` to immediately after the tracker quota checks and immediately before `request.formData()`, or wrap the whole post-acquire block in a `try/finally` that dominates every return. The simpler fix is to acquire the slot only once all pre-parse quota checks have passed. Add a focused regression test or source-contract assertion that no `return NextResponse` exists between slot acquisition and the release-dominated `request.formData()` block, or preferably a mocked route test that hits the quota-exceeded branch and proves the next request can still acquire the slot.

## Final sweep

No other new actionable findings were confirmed in the inspected Cycle 33 changes. In particular:

- Bulk alt-suggestion copying now sanitizes and length-checks copied suggestions.
- Caption stub truncation is now code-point safe.
- Bulk image ID limits are applied after ID de-duplication.
- Auth action and public route scanner discovery changes were inspected; no new fail-open path was confirmed in the current implementation.
- Feed ETag route behavior and admin login/layout outage handling were inspected without a new actionable finding.
- Settings invalid-field focus and token clipboard fallback changes were inspected without a new actionable finding.

No tests were run in this read-only review lane; validation evidence is static inspection of the cited files at HEAD `e1f124a2`.
