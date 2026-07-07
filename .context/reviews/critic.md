# Critic Review - Run-10 Cycle 5 Prompt 1

Reviewer: critic lane. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `591b44bd`.
Mode: read-only static review except this artifact. Source files were not modified.

## Inventory

Review-relevant change surface was built from `git diff --name-only HEAD~10..HEAD`, current plans, and cross-file callers/tests. Generated/build outputs, `node_modules`, `.next`, and runtime uploads were excluded.

Primary changed files examined:
- `.context/plans/README.md`
- `.context/plans/cycle-3-2026-07-07-plan.md`
- `.context/plans/cycle-4-2026-07-07-plan.md`
- `.context/plans/cycle-4-2026-07-07-deferred.md`
- `.context/plans/deferred-carry-forward.md`
- `.gitignore`
- `CLAUDE.md`
- `apps/web/README.md`
- `apps/web/e2e/hydration-photo-page.spec.ts`
- `apps/web/src/__tests__/image-queue-embedding-bootstrap-cap.test.ts`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/lib/image-queue.ts`

Cross-file interaction files examined:
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/e2e/swipe-visual-reset.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/instrumentation.ts`
- relevant `image-queue` tests and source-contract pins located with `rg`

## Confirmed Issues

### CRIT-C5-01 - Embedding bootstrap can exceed the configured scan cap for non-multiple limits

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/lib/image-queue.ts:569-595`; test gap at `apps/web/src/__tests__/image-queue-embedding-bootstrap-cap.test.ts:161-179`
- Classification: product invariant drift / off-by-budget

`bootstrapMissingActiveEmbeddings` checks `if (scanned >= SEMANTIC_SCAN_LIMIT)` before issuing the next query, but the query always uses `.limit(BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE)` where the batch size is 50. After the fetch, `scanned += rows.length`. This respects the cap only when `SEMANTIC_SCAN_LIMIT` is a multiple of 50. `SEMANTIC_SCAN_LIMIT` is env-tunable with arbitrary positive integer values in `apps/web/src/lib/clip-embeddings.ts:37-44`, so values such as `51`, `75`, or `101` are valid. A static arithmetic check shows the current loop scans 100 rows for limit 75 and 150 rows for limit 101.

Concrete failure scenario: an operator lowers `SEMANTIC_SCAN_LIMIT=75` to reduce startup/background DB and CLIP pressure. The missing-embedding bootstrap still scans two full 50-row batches before noticing the cap, exceeding the requested work budget by 25 rows. With `SEMANTIC_SCAN_LIMIT=1`, it scans 50 rows. The log also reports the exceeded number, e.g. `embedding bootstrap reached scan cap (100)`, which obscures that the configured cap was 75.

Suggested fix: calculate the remaining budget before the query and use it in the query limit:

```ts
const remaining = SEMANTIC_SCAN_LIMIT - scanned;
if (remaining <= 0) { ... }
const batchLimit = Math.min(BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE, remaining);
...
.limit(batchLimit);
```

Add a regression case with `scanLimit: 75` and three 50-row batches; assert the mocked limit receives `50` then `25`, or at least that only 75 rows are consumed and the cursor lands on id 75.

## Likely Issues

None filed. The shared-group shallow URL sync (`photo-viewer.tsx:337-352` plus `g/[key]/page.tsx:199-209`) and swipe-settle reset (`photo-navigation.tsx:119-132,204-221`) are coherent with the surrounding e2e coverage. I did not find a source-level contradiction in those paths.

## Manual-Validation Risks

### RISK-C5-01 - Cycle-4 release evidence remains incomplete in the plan artifact

- Severity: Medium evidence risk
- Confidence: High that the artifact is incomplete; Low on whether deployment actually failed or simply was not recorded
- File/region: `.context/plans/cycle-4-2026-07-07-plan.md:213-239`; project policy in `AGENTS.md`/`CLAUDE.md` per-iteration deploy rules

The cycle-4 plan marks post-deploy checks unchecked and says `DEPLOY: pending for the current docs-artifact head`. It also records that local Playwright e2e remained infrastructure-blocked and production-target e2e was fixture-dependent, not release evidence. The project policy requires deploy after each pushed iteration, but this artifact does not prove the final cycle-4 head was deployed or smoke-checked. This is an evidence gap, not a confirmed product defect.

Suggested fix: Prompt 2 should either schedule a small docs/evidence reconciliation task or carry an explicit manual-validation item: confirm current deployed SHA, `/api/live`, `/en`, and fresh-slug 404 against the deploy target, then update the plan ledger.

### RISK-C5-02 - Scheduled-next maintenance-scheduler extraction is still only a carry-forward row

- Severity: Low-Medium architecture risk
- Confidence: High
- File/region: `.context/plans/cycle-4-2026-07-07-deferred.md:62-74`; `.context/plans/deferred-carry-forward.md:98-100`

The cycle-4 deferred register marks C4-17 as `SCHEDULED-NEXT`: retention sweeps are still parasitic on `image-queue.ts` bootstrap and should be extracted into an `instrumentation.ts`-owned maintenance scheduler. Prompt 1 should not implement it, but Prompt 2 should preserve this row as a planned cycle-5 work package or explicitly re-justify why the scheduled-next handoff is not being honored.

## Final Sweep

Commonly missed issue classes checked:
- Off-by-budget / cap enforcement: found CRIT-C5-01.
- Model-version flip / cursor reset: code resets `embeddingScanCursorId` and tracks `embeddingScanModelVersion`; test covers stub-to-production flip.
- Process-local state honesty: cycle-4 register records durable cursor/per-row failure marking as deferred C4-09d.
- Shared-group limiter burn: code uses `window.history.replaceState` for in-place sync and `prefetch={false}` on shared-grid tile links; e2e covers repeated stepping without viewer replacement.
- Swipe stale visual reset: success branches set animated reset plus one-shot skip; layout effect reasserts hard reset on later id changes; e2e covers swipe and chevron.
- Documentation/plans contradictions: no false "closed" source claim found, but cycle-4 deploy/e2e evidence remains a manual-validation gap.

No additional confirmed issues were found in the examined file groups.
