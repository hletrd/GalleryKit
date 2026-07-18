# Verifier — Cycle 6 Provenance

Review target: `6e4c25c8` (`master == origin/master`).

## Independent verification

- Good GPG signatures: `baec70b5`, `45a9417f`, `6e4c25c8`.
- Green now: ESLint; API auth; action origin/mutation barrier; public route rate limit; typecheck; production audit; focused 16-test responsive/memo set; full Vitest 362 passed/2 skipped and 3,415 passed/4 skipped; `git diff --check`.
- Browser: production 393/768/1024/1536 checks, nav/search interaction, accessibility snapshots, computed styles, currentSrc, and console/errors. No local server was running; exact local full Playwright/build claims remain the prior cycle's recorded evidence, not independently repeated here.

## NEW Cycle 6 findings

### VER-C6-01 — Sparse intrinsic-size acceptance is not met

- Severity / confidence: **Medium / High**
- Status: **Confirmed computed-style mismatch; visible shift manual-validation**
- Regions: `home-client.tsx:231-274`; `masonry-card.tsx:52-77`; Cycle 5 plan `:24-28,56-64`
- Scenario: two photos at 1,536 px produce two 744×496 cards and correct 50vw sizes, but only a 196 px intrinsic stand-in because raw columns remain five.
- Fix: cap/measure effective columns consistently and browser-test the computed hint.

### VER-C6-02 — Changed home integration lacks a browser verifier

- Severity / confidence: **Medium / High**
- Status: **Confirmed test-design gap**
- Regions: `e2e/responsive-masonry.spec.ts:9-85`; `__tests__/responsive-masonry.test.ts:8-42`; `__tests__/masonry-card-memo.test.ts:99-177`
- Scenario: home passes the wrong count/policy while archive/shared and pure helper tests remain green.
- Fix: seed sparse home states and assert actual DOM `sizes`, columns, currentSrc, and intrinsic hint.

### VER-C6-03 — Cycle 5 ledger is stale after signed publication

- Severity / confidence: **Low / High**
- Status: **Confirmed push; exact deployed SHA manual-validation**
- Regions: `.context/plans/cycle-5-2026-07-18-plan.md:5,47-49,70-78`; `.context/plans/README.md:34-40`
- Scenario: recovery follows unchecked terminal tasks despite remote equality and live new behavior.
- Fix: reconcile, archive, and record deploy evidence without overstating exact identity.

## Final sweep

I verified fixes for all four Cycle 5 aggregate items, rechecked prior carry-forward exit criteria, and swept guards, migrations/privacy, runtime concurrency, image/color/PWA behavior, responsive siblings, and release evidence. No further new candidate passed verification.
