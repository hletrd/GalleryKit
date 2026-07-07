# Verifier Review - Run-10 Cycle 5 Prompt 1

Reviewer: verifier lane. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `591b44bd`.
Mode: read-only verification except this artifact. I did not run build/test/e2e because the lane was constrained to review-artifact writes only; validation here is static evidence plus `git diff --check HEAD~10..HEAD` (clean).

## Inventory

I built the inventory before checking claims by combining:
- `git diff --name-only HEAD~10..HEAD`
- current cycle-4 plan/deferred ledgers
- `rg` over callers/tests for `bootstrapMissingActiveEmbeddings`, `embeddingScanCursorId`, `syncPhotoQueryBasePath`, `PhotoNavigation`, `photoId`, `SHARE_MAX_REQUESTS`, and `SEMANTIC_SCAN_LIMIT`

Files examined from the verifier angle:
- `AGENTS.md` instructions supplied in the prompt
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-4-2026-07-07-plan.md`
- `.context/plans/cycle-4-2026-07-07-deferred.md`
- `.context/plans/deferred-carry-forward.md`
- `apps/web/README.md`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/__tests__/image-queue-embedding-bootstrap-cap.test.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/e2e/swipe-visual-reset.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/hydration-photo-page.spec.ts`
- source/test references located by `rg` for image-queue side effects, queue shutdown, semantic scan limits, and shared-group navigation

## Confirmed Issues

### VER-C5-01 - The missing-embedding bootstrap does not prove the stated scan-cap behavior for arbitrary valid limits

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/lib/image-queue.ts:569-595`; tests at `apps/web/src/__tests__/image-queue-embedding-bootstrap-cap.test.ts:161-179,244-307`
- Stated behavior being checked: the bootstrap retry is bounded by `SEMANTIC_SCAN_LIMIT` and "stops once SEMANTIC_SCAN_LIMIT rows have been scanned" (test comment at `image-queue-embedding-bootstrap-cap.test.ts:4-14` and code comment at `image-queue.ts:570-575`).

Evidence: `BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE` is 50 (`image-queue.ts:112`). The loop checks `scanned >= SEMANTIC_SCAN_LIMIT` before the query, but the query then always fetches up to 50 rows (`image-queue.ts:573-593`) and only afterwards increments `scanned` (`image-queue.ts:595`). The tests set `scanLimit: 100`, exactly two 50-row batches, so they do not exercise a non-multiple cap. `SEMANTIC_SCAN_LIMIT` is parsed from env as any positive integer up to 25,000 (`clip-embeddings.ts:37-44`), so non-multiple values are valid.

Concrete failure scenario: with `SEMANTIC_SCAN_LIMIT=75` and many missing embeddings, the bootstrap scans two 50-row batches and logs the cap at 100. With `SEMANTIC_SCAN_LIMIT=1`, it scans 50 rows. That violates the cap as an operator budget. The semantic/similar route cap may still be correct; this finding is limited to `bootstrapMissingActiveEmbeddings`.

Suggested fix: limit each query by remaining budget:

```ts
const remainingScanBudget = SEMANTIC_SCAN_LIMIT - scanned;
if (remainingScanBudget <= 0) {
  state.embeddingScanCursorId = cursorId;
  console.warn(...);
  break;
}
const rows = await db.select(...).limit(Math.min(BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE, remainingScanBudget));
```

Add a regression test using `scanLimit: 75` to prove the second query is limited to 25 rows and the cursor resumes after id 75, not 100.

## Likely Issues

None confirmed beyond VER-C5-01. I specifically re-checked the current patches against their claimed behavior:

- Hydration fix: `photo-viewer.tsx:111-125` renders deterministic `false` first, then restores persisted/desktop pin state post-mount. The e2e spec now navigates to `/` before locating a photo (`hydration-photo-page.spec.ts:29-34`), so the test setup is coherent.
- Shared-group shallow stepping: `photo-viewer.tsx:337-352` updates only browser history when `syncPhotoQueryBasePath` is present, while `g/[key]/page.tsx:199-209` disables prefetch on shared-grid photo links. This matches the plan's limiter-burn fix shape.
- Swipe visual reset: `photo-navigation.tsx:119-132,204-221` resets visuals on successful swipe and skips one hard reset to preserve the settle animation. `swipe-visual-reset.spec.ts:59-131` covers sub-threshold snap-back, threshold in-place navigation, chevron navigation, and repeated shallow stepping.
- Model-version flip: `image-queue.ts:542-558` resets cursor when the active embedding model version changes; `image-queue-embedding-bootstrap-cap.test.ts:275-307` covers stub-to-production flip with the env gate enabled.

## Manual-Validation Risks

### RISK-VER-C5-01 - Cycle-4 deploy and e2e release evidence is not proven by committed artifacts

- Severity: Medium evidence gap
- Confidence: High that evidence is missing from artifacts; unknown runtime state
- File/region: `.context/plans/cycle-4-2026-07-07-plan.md:213-239`

The plan records all non-e2e gates green, but says Playwright e2e remained infrastructure-blocked in this lane and that deploy was pending for the docs-artifact head. `AGENTS.md`/`CLAUDE.md` require per-iteration deploys after pushed commits. I did not run deploy or e2e in this read-only lane. The next planning step should preserve this as a manual-validation item unless another artifact proves the final head was deployed and smoke-checked.

### RISK-VER-C5-02 - C4-17 "SCHEDULED-NEXT" needs explicit Prompt 2 disposition

- Severity: Low-Medium process risk
- Confidence: High
- File/region: `.context/plans/cycle-4-2026-07-07-deferred.md:62-74`; `.context/plans/deferred-carry-forward.md:98-100`

The deferred register explicitly says the maintenance-scheduler extraction should be picked up in cycle 5. Prompt 1 should not implement it, but Prompt 2 should either schedule it or record a concrete re-justification. Silent carry-forward would contradict the register's own "SCHEDULED-NEXT" disposition.

## Final Sweep

Evidence collected:
- `git diff --check HEAD~10..HEAD` reported no whitespace errors.
- Static arithmetic check of the bootstrap cap showed valid limits `1`, `49`, `51`, `75`, `99`, and `101` overshoot to the next 50-row multiple.
- `rg` confirmed `SEMANTIC_SCAN_LIMIT` is env-tunable and used by routes/backfill/bootstrap; the confirmed issue applies only to the bootstrap loop's fixed query batch.
- Shared-group and swipe-navigation claims were checked across component, route, and e2e files rather than from comments alone.
- Plan/deferred files were checked for no-silent-drop shape and carry-forward linkage.

File groups examined: cycle-4 plan/deferred ledgers, current plan index/carry-forward register, image-queue/CLIP embedding bootstrap source and tests, photo viewer/navigation components, shared-group page, shared-group/swipe/hydration e2e specs, README/CLAUDE operational claims relevant to deploy, CLIP, and per-cycle policy.
