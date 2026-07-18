# Cycle 10 Verifier Review

Date: 2026-07-18 KST  
Reviewed HEAD: `1e3646e3`  
Lane: verifier

## Verification scope

Verified every work package and acceptance claim in `.context/plans/cycle-9-2026-07-18-plan.md` against source, tests, generated E2E assets, current git state, and the deployed public DOM. Focused Vitest passed: 3 files / 28 tests (`image-url`, public-grid source contract, detached-config micro-cache). `git diff --check` passed. Current HEAD and `origin/master` match, and the last three commits are GPG-good.

## VER-C10-01 — “4096w derivative” acceptance is suffix-true but pixel-false

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed acceptance failure**
- Regions: Cycle 9 acceptance `.context/plans/cycle-9-2026-07-18-plan.md:60-66,103-109,150-153`; encoder `apps/web/src/lib/process-image.ts:1214-1234`; source builder `apps/web/src/lib/image-url.ts:91-95`; E2E seed `apps/web/scripts/seed-e2e.ts:79-87`; E2E assertion `apps/web/e2e/responsive-masonry.spec.ts:102-138`.

Cycle 9 declares success because the browser selects a filename ending `_4096`. The 1200 px seed makes that assertion non-probative: direct metadata inspection shows `_4096` is 1200×1200, as are every configured candidate above `_1536`, because the encoder deliberately avoids enlargement. The browser receives a false `4096w` descriptor.

Concrete failure: the test remains green if every >1200 suffix is the same 1200 px file, exactly the condition that makes the ultrawide DPR-2 photo soft. The intended acceptance criterion—an adequate high-resolution derivative—is not met.

Fix: generate a real-width/deduplicated source list and verify decoded resource width against `ceil(slotWidth * devicePixelRatio)` up to the source's genuine maximum. An expected shortfall should be asserted as source-limited, not presented as a 4096 px success.

## Verification disposition

- C9-01 config generation/ownership: **verified closed**. `gallery-config.ts:235-281` prevents stale publication and clears only matching owners; the deterministic test covers the critical interleaving.
- C9-02 complete ladder presence: **mechanically present but behaviorally incomplete** because VER-C10-01 invalidates the descriptor/quality premise.
- C9-03 Cycle 8 ledger: **verified closed**.
- Cycle 9 terminal release ledger: **not reconciled**; see `document-specialist.md` DOC-C10-01.

Final sweep found no second config-cache race or regression in one/two-size URL generation.
