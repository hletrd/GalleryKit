# Cycle 85/100 Tracer / Debugger Review

Reviewed HEAD: `1d29b98861098a68a8107746997a5d81d70f03f1`.
Date: 2026-07-01.
Role: tracer-debugger lane.

Scope: Cycle 84 changes and adjacent suspicious flows: failed-image retry labels, permanently failed queue retry/delete state, release ledger/deploy state, public label helpers, and current Cycle 85 peer-review hypotheses. Source and plan files were not edited; this artifact is the only write.

## Inventory

- Cycle 84 delta from `023ae28d41ee757caaa408710bd864d88087a40c` to `HEAD` changed review/plan artifacts, `.gitignore`, and `apps/web/src/__tests__/failed-image-retry.test.ts`; no production runtime source changed in that commit.
- Latest review pointer still names Cycle 84 as current aggregate and lists `C84-01` and `C84-02` as scheduled findings at `.context/reviews/_aggregate.md:3` through `.context/reviews/_aggregate.md:10`.
- Cycle 84 aggregate recorded the same two findings: release-ledger drift at `.context/reviews/cycle-84-2026-07-01/_aggregate.md:21` through `.context/reviews/cycle-84-2026-07-01/_aggregate.md:29`, and failed-image retry source-contract weakness at `.context/reviews/cycle-84-2026-07-01/_aggregate.md:31` through `.context/reviews/cycle-84-2026-07-01/_aggregate.md:39`.
- Current peer hypotheses reviewed: Cycle 85 architect/code-reviewer confirm Cycle 84 release-ledger drift; test-engineer reports retry aria translation-placeholder coverage and permanently-failed cleanup coverage gaps; perf/security report no new runtime/security finding.
- `HEAD`, `origin/master`, and `origin/HEAD` all resolve to `1d29b98861098a68a8107746997a5d81d70f03f1`; `git log -1 --show-signature --format=fuller` reports a good signature from `Jiyong Youn <01@0101010101.com>`.
- Carry-forward deferred items remain governed by `.context/plans/cycle-84-2026-07-01-deferred.md:12` through `.context/plans/cycle-84-2026-07-01-deferred.md:17`; this pass found no exit criterion hit.

## Confirmed Findings

### C85-TRC-01 - Cycle 84 release ledger remains active and deploy-unclosed after its pushed signed HEAD

- Severity: Medium.
- Confidence: High.
- Citations: `AGENTS.md:17`, `CLAUDE.md:469`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-84-2026-07-01-plan.md:8`, `.context/plans/cycle-84-2026-07-01-plan.md:39`, `.context/plans/cycle-84-2026-07-01-plan.md:48`, `.context/plans/cycle-84-2026-07-01-plan.md:49`, `.context/plans/cycle-84-2026-07-01-plan.md:53`, `.context/plans/cycle-84-2026-07-01-plan.md:61`.
- Evidence: project policy requires `npm run deploy` after every pushed `master` commit. Cycle 84's plan makes signed commit, pull-rebase, push, and deploy part of the required sequence, but its progress still leaves commit/push and deploy unchecked. Gate evidence stops at local checks plus `git diff --cached --check`; it does not record terminal signed `1d29b988` / `origin/master` evidence or a deploy result/gap. The commit itself is already pushed and signed, so the ledger is stale rather than the code being unpushed.
- Failure scenario: Cycle 85+ operators cannot distinguish "Cycle 84 was deployed", "Cycle 84 was pushed but not deployed", and "Cycle 84 deploy evidence is intentionally superseded" from committed ledgers. This repeats the release-state ambiguity Cycle 84 closed for Cycle 83.
- Suggested fix: mark Cycle 84 commit/pull-rebase/push complete with signed `1d29b988` / `origin/master` evidence, record `npm run deploy` evidence or an explicit deploy-evidence gap/supersession note, and move Cycle 84 out of active plans.

### C85-TRC-02 - Retry accessible-name contract can pass if locale templates drop `{label}`

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, `apps/web/src/__tests__/failed-image-retry.test.ts:159`, `apps/web/src/__tests__/failed-image-retry.test.ts:161`, `apps/web/src/__tests__/failed-image-retry.test.ts:162`, `apps/web/src/__tests__/failed-image-retry.test.ts:163`, `apps/web/messages/en.json:73`, `apps/web/messages/en.json:74`, `apps/web/messages/ko.json:73`, `apps/web/messages/ko.json:74`, `apps/web/src/__tests__/i18n-key-parity.test.ts:47`, `apps/web/src/__tests__/i18n-key-parity.test.ts:65`.
- Evidence: current runtime code is correct: the row assigns `const label = getFailedImageLabel(img)`, renders `{label}`, and passes `{ label }` into the retry/ retrying aria template. Current English and Korean templates also include `{label}`. The focused retry test, however, inspects only dashboard source and never reads message values. The global i18n parity test checks key-set equality only, so a copy edit that keeps `dashboard.retryImageAria` and `dashboard.retryingImageAria` but removes `{label}` still passes both tests.
- Failure scenario: a locale value changes to "Retry processing" or "Retrying..." without `{label}`. The component still passes `{ label }`, key parity still passes, and the retry button loses the per-image accessible name that Cycle 84 intended to protect.
- Suggested fix: add a targeted placeholder assertion for `dashboard.retryImageAria` and `dashboard.retryingImageAria` in both locale files, or add a small i18n placeholder-parity helper for selected keys without comparing full localized values.

### C85-TRC-03 - Permanently-failed delete cleanup coverage can pass while one delete action loses cleanup

- Severity: Low.
- Confidence: High.
- Citations: `apps/web/src/app/actions/images.ts:697`, `apps/web/src/app/actions/images.ts:699`, `apps/web/src/app/actions/images.ts:809`, `apps/web/src/app/actions/images.ts:812`, `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:85`, `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:91`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:25`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:35`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:41`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:50`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:51`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts:53`.
- Evidence: current source is correct: `deleteImage()` deletes the ID from `queueState.permanentlyFailedIds`, and `deleteImages()` loops over found IDs and does the same. The tests are weaker than their claim. One source-contract test checks only that `permanentlyFailedIds.delete(id)` appears somewhere in `images.ts`; it does not prove both delete actions perform cleanup. The behavior-style cleanup tests directly mutate queue state and comment that they are simulating the actions, so they would still pass if action cleanup were removed.
- Failure scenario: a future refactor keeps single-delete cleanup but drops the batch `deleteImages()` cleanup loop. Existing cleanup tests can still pass, while stale permanently-failed IDs remain excluded from bootstrap after batch deletion and DB restore/reuse scenarios.
- Suggested fix: slice `export async function deleteImage` and `export async function deleteImages` separately in the source contract and require cleanup in both bodies, or add an action-level mocked test that calls each action and asserts only found/deleted IDs are removed from the queue state.

## Refutations / Clean Surfaces

- No runtime failed-image retry label defect is present at HEAD. `getFailedImageLabel()` trims title/user filename and falls back to `ID ${img.id}` at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39` through `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:40`; the failed row derives `label` from that helper at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, renders it at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:109` through `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:110`, and uses it in the retry aria label at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`.
- No retry state-machine defect was confirmed. Failed rows are bounded and require `processed=false` plus `processing_error IS NOT NULL` at `apps/web/src/lib/data.ts:1024` through `apps/web/src/lib/data.ts:1041`. Retry rechecks the same failed predicate at `apps/web/src/app/actions/images.ts:1224` through `apps/web/src/app/actions/images.ts:1247`, clears failure columns only after a fresh settings snapshot at `apps/web/src/app/actions/images.ts:1253` through `apps/web/src/app/actions/images.ts:1266`, deletes in-memory failure bookkeeping before enqueue at `apps/web/src/app/actions/images.ts:1273` through `apps/web/src/app/actions/images.ts:1279`, and restores a visible failed state if enqueue rejects at `apps/web/src/app/actions/images.ts:1312` through `apps/web/src/app/actions/images.ts:1327`.
- No permanently-failed bootstrap loop regression was confirmed. The queue rejects IDs already in `permanentlyFailedIds` at `apps/web/src/lib/image-queue.ts:522` through `apps/web/src/lib/image-queue.ts:527`, adds IDs only after retry exhaustion at `apps/web/src/lib/image-queue.ts:762` through `apps/web/src/lib/image-queue.ts:779`, persists the visible failure at `apps/web/src/lib/image-queue.ts:801` through `apps/web/src/lib/image-queue.ts:807`, and bootstrap excludes only rows with no processing error plus the in-memory permanent set at `apps/web/src/lib/image-queue.ts:900` through `apps/web/src/lib/image-queue.ts:905`.
- Public label helpers remain clean. `getPhotoResultLabel()` trims labels, rejects filename-like titles, uses description, then fallback at `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99`; search uses that helper and renders the label at `apps/web/src/components/search.tsx:71` and `apps/web/src/components/search.tsx:104` through `apps/web/src/components/search.tsx:105`; similar-photo results pass the helper-derived label into thumbnail `title`, `aria-label`, and `alt` at `apps/web/src/components/similar-photos.tsx:183`, `apps/web/src/components/similar-photos.tsx:188`, and `apps/web/src/components/similar-photos.tsx:231` through `apps/web/src/components/similar-photos.tsx:236`.
- The Cycle 84 failed-image source-contract weakness is closed for the original row-local helper flow. The strengthened test slices the failed-image map body and now requires helper assignment, visible `{label}`, and retry aria label in that body at `apps/web/src/__tests__/failed-image-retry.test.ts:154` through `apps/web/src/__tests__/failed-image-retry.test.ts:163`.
- I did not re-raise `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, `C75-08`, or the historical broad e2e/performance/operator items because the current Cycle 84 delta and traced flows did not satisfy the exit criteria listed at `.context/plans/cycle-84-2026-07-01-deferred.md:12` through `.context/plans/cycle-84-2026-07-01-deferred.md:17`.

## Validation

- `npm test --workspace=apps/web -- --run src/__tests__/failed-image-retry.test.ts src/__tests__/photo-title.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/cycle-21-source-contracts.test.ts src/__tests__/image-queue-permanent-failure.test.ts src/__tests__/image-queue-permanent-failure-cleanup.test.ts` passed: 6 files, 62 tests.
- Read-only evidence commands included `git rev-parse HEAD origin/master origin/HEAD`, `git log -1 --show-signature --format=fuller`, `git diff --name-only 023ae28d41ee757caaa408710bd864d88087a40c..HEAD`, and targeted `nl`/`rg` inspections of cited files.
- Not run: full lint, typecheck, build, full Vitest, Playwright e2e, or deploy. This was a focused tracer/debugger review lane.
