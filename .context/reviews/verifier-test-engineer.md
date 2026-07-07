# Cycle 12 Verifier + Test-Engineer Review

Date: 2026-07-07
Repo: `/Users/hletrd/flash-shared/gallery`
Mode: evidence-based correctness and test-coverage review. I did not implement source changes; only this review file was written.

## Inventory

- Read first: `AGENTS.md`, `CLAUDE.md`, `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- Reviewed docs/history: `.context/plan/plan-c12.md`, `.context/plans/README.md`, `.context/reviews/_aggregate.md`, `.context/reviews/test-engineer.md`, `.context/reviews/verifier.md`.
- Test surface: 347 Vitest files under `apps/web/src/__tests__`; 9 Playwright specs under `apps/web/e2e`.
- Source-contract density: 156 test files call `readFileSync(...)`; 222 test files match source/string-contract patterns. These are useful tripwires but still leave behavior/browser/database oracles thin in several places.
- Lightweight checks run:
  - `rg "\.only\(|describe\.only|it\.only|test\.only" apps/web/src/__tests__ apps/web/e2e ...`: no output, exit 1, so no focused tests found.
  - `npm run lint:api-auth --workspace=apps/web`: pass, 2 admin routes OK.
  - `npm run lint:action-origin --workspace=apps/web`: pass, all mutating server actions guarded or explicitly exempted.
  - `npm run lint:public-route-rate-limit --workspace=apps/web`: pass, public route scanner OK.
  - `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: fail, 2 moderate PostCSS findings via Next nested dependency.
- Not run: full lint/typecheck/build/unit/e2e. This was a review-only lane and the user allowed static review; full e2e/build would be longer and can write generated artifacts.

## Findings

### VTE-C12-01 - Real CLIP production activation is not proven by required gates

- Severity: High
- Confidence: High
- Validation: confirmed
- Evidence: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41` skips unless `CLIP_OFFLINE_LOAD=1` and seeded weights exist; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31` skips unless `CLIP_INTEGRATION=1`; `apps/web/package.json:21-23` defines `test:clip:preflight`, but `.github/workflows/quality.yml:66-80` runs only normal unit/e2e/build gates.
- Failure scenario: a model revision/cache-layout change, ONNX runtime break, or production `CLIP_MODELS_ROOT` mismatch breaks real offline `jina-clip-v2` loading. CI stays green because the real-model suites skip and route tests can mock embeddings.
- Suggested test/fix: add a scheduled or dependency-change CI preflight that seeds/caches the pinned weights and runs `npm run test:clip:preflight --workspace=apps/web`, or require a recent preflight marker before enabling production semantic mode.
- Browser-flow coverage required: no; this is model/route integration coverage.

### VTE-C12-02 - Production dependency audit is red and not a blocking quality gate

- Severity: Medium
- Confidence: High
- Validation: confirmed by `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`.
- Evidence: root override pins top-level PostCSS at `package.json:7-8`, but `package-lock.json:9334-9336` still contains `node_modules/next/node_modules/postcss` at `8.4.31`; the fixed top-level PostCSS is separate at `package-lock.json:9850-9853`. CI has lint/typecheck/test/e2e/build only at `.github/workflows/quality.yml:54-80`.
- Failure scenario: release confidence reports "all quality gates green" while production audit remains red for GHSA-qx2v-qp2m-jg93 through Next's nested PostCSS copy.
- Suggested test/fix: add an audit gate with a documented allowlist/expiry if this is intentionally deferred, and close the nested dependency by upgrading Next or proving a lockfile-effective override that does not downgrade Next.
- Browser-flow coverage required: no.

### VTE-C12-03 - Browser/device e2e coverage is Chromium-only and screenshots are not visual assertions

- Severity: Medium
- Confidence: High
- Validation: confirmed
- Evidence: `apps/web/playwright.config.ts:72-77` defines only a Desktop Chrome project; CI installs only Chromium at `.github/workflows/quality.yml:72-77`; `apps/web/e2e/nav-visual-check.spec.ts:58`, `:72`, and `:85` write screenshots with `page.screenshot(...)` but never compare with `toHaveScreenshot`.
- Failure scenario: WebKit mobile touch/dialog behavior, Firefox focus/display-capability behavior, or visual nav drift breaks while desktop Chromium remains green. The nav "visual" test can produce changed PNGs without failing.
- Suggested test/fix: add a small required matrix rather than duplicating everything: mobile WebKit for nav/search/photo/lightbox/info-sheet and one Firefox/WebKit desktop smoke. Convert nav captures to `expect(page).toHaveScreenshot(...)` baselines or rename the spec as artifact-only.
- Browser-flow coverage required: yes, especially mobile WebKit and at least one non-Chromium desktop smoke.

### VTE-C12-04 - Important client interactions are still locked by source strings or permissive browser assertions

- Severity: Medium
- Confidence: High
- Validation: confirmed
- Evidence: `apps/web/src/__tests__/photo-viewer-auto-lightbox-source.test.ts:8-14` checks source strings for sessionStorage restoration order; `apps/web/e2e/hydration-photo-page.spec.ts:44-49` accepts either a restored `pinned` button or fallback `info` button; `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26` checks source strings for portal containment while the actual menu lives in `apps/web/src/components/info-bottom-sheet.tsx:558-595`.
- Failure scenario: auto-lightbox restore silently stops restoring, or the mobile info-sheet download dropdown renders outside the focus-trap subtree. Current tests can stay green because they prove code text, not actual DOM/focus/menu behavior; the hydration e2e does not require the restored state.
- Suggested test/fix: tighten the hydration spec to require the deterministic restored button state, and add a mobile Playwright flow that opens the info sheet, opens the wide-gamut download dropdown, asserts menu visibility within the dialog subtree, keyboard focus containment, and close/focus return.
- Browser-flow coverage required: yes.

### VTE-C12-05 - Admin UI e2e still covers navigation and a few flows, not first-class admin surfaces

- Severity: Medium
- Confidence: High
- Validation: confirmed
- Evidence: `apps/web/e2e/admin.spec.ts:20-43` mostly navigates to admin pages and asserts tables/inputs; behavior flows cover GPS toggle/topic create/upload at `apps/web/e2e/admin.spec.ts:73-165`. The Lightroom token UI has stateful one-time plaintext/copy/revoke behavior at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-128` and `:250-325`, while action tests cover server behavior only at `apps/web/src/__tests__/lr-tokens-action.test.ts:85-199`.
- Failure scenario: token creation fails to show one-time plaintext, copy acknowledgement fails, revoke confirmation fails, or label errors fail to bind/focus in the actual page. Unit/action/source tests can pass because they do not drive the hydrated token page.
- Suggested test/fix: add admin Playwright flows for token create -> plaintext appears once -> acknowledge/copy -> done -> list row appears -> revoke removes row. Add smaller smokes for SEO validation/save, tags create/delete, users validation, and DB backup listing/download without destructive restore.
- Browser-flow coverage required: yes.

### VTE-C12-06 - DB restore child-process failure cleanup remains source-only

- Severity: Medium
- Confidence: High
- Validation: confirmed
- Evidence: `apps/web/src/__tests__/db-restore.test.ts:47-74` asserts `failRestore` snippets exist; production cleanup behavior is in `apps/web/src/app/[locale]/admin/db-actions.ts:807-817` plus event registrations at `:818-833`. The test does not execute a fake `spawn`, fake `stdin`, fake read stream, or watchdog.
- Failure scenario: a restore spawn/stdin/read/timeout failure stops killing the child, stops destroying streams, forgets temp cleanup, or loses `keepMaintenance: true`, while source snippets remain present but unreachable or misordered.
- Suggested test/fix: extract or inject the restore import runner enough to test it with mocked `child_process.spawn`, fake streams, and fake timers. Assert response result, `kill()`, `stdin.destroy()`, read-stream destroy, temp cleanup, and maintenance retention for spawn error, stdin error, read error, timeout, nonzero close, and success.
- Browser-flow coverage required: no; this needs unit/integration behavior coverage.

### VTE-C12-07 - Lightroom upload route still has untested failure branches

- Severity: Medium
- Confidence: High
- Validation: confirmed
- Evidence: current behavior test covers success, HDR rejection, entry restore guard, missing content length, count cap, and low disk at `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`. Production route still has distinct branches for chunked transfer, total byte cap, per-file size cap, parse-slot saturation, late restore guard, lock denial, topic DB error/missing topic, settings read failure, save/raw failures, GPS-strip fail-closed, and late maintenance cleanup at `apps/web/src/app/api/admin/lr/upload/route.ts:101-158`, `:252-313`, `:346-424`.
- Failure scenario: an external Lightroom client receives the wrong status/body, quota is not settled, lock release is skipped, or an original is retained after a GPS-strip or late-maintenance failure. Existing tests prove only part of the cleanup matrix.
- Suggested test/fix: extend the route harness with table-driven cases for each branch, asserting status/body plus tracker settlement, lock release, original cleanup, DB insert/queue absence, and audit absence where appropriate.
- Browser-flow coverage required: no; handler-level route tests are sufficient.

### VTE-C12-08 - Migration reconcile parity still depends mostly on source tripwires

- Severity: Medium
- Confidence: Medium
- Validation: risk
- Evidence: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-20` explicitly says the test is a source tripwire, not a structural validator; it checks table/column/index/FK names in source at `:86-103`, `:157-172`, and `:216-225`. The real reconcile DDL lives in `apps/web/scripts/migrate.js:348-730`. CI initializes a DB at `.github/workflows/quality.yml:69-70`, but there is no committed information_schema diff gate.
- Failure scenario: reconcile names all expected columns/indexes/FKs but creates the wrong type, nullability, default, collation, FK action, or index column order. Fresh/legacy baselines can diverge from Drizzle while source-name tests stay green.
- Suggested test/fix: add an opt-in or CI disposable-MySQL parity test that applies the normal migration path and the reconcile/baseline path to separate schemas, then diffs `information_schema` columns, indexes, and foreign keys. Keep source tripwires as fast pre-checks.
- Browser-flow coverage required: no.

### VTE-C12-09 - There is no coverage report, threshold, or changed-file ratchet

- Severity: Medium
- Confidence: High
- Validation: confirmed
- Evidence: `apps/web/package.json:13` runs plain `vitest run`; `apps/web/vitest.config.ts:1-39` has include/exclude/timeouts but no coverage configuration; `.github/workflows/quality.yml:66-67` runs unit tests without coverage. A search for `coverage`, `v8`, `istanbul`, `threshold`, or `test:coverage` in package/test/CI config returned no matches.
- Failure scenario: a new public API route, server action, migration branch, queue failure path, or security helper lands with zero executed behavior coverage. The large source-contract footprint can make the suite look broad while critical lines remain unexecuted.
- Suggested test/fix: add non-blocking Vitest V8 coverage first, then enforce a changed-file ratchet for critical directories (`src/app/actions`, `src/app/api`, `src/lib`, `scripts/migrate.js`) with explicit reviewed exemptions before considering repo-wide thresholds.
- Browser-flow coverage required: no, though browser-flow coverage should be separately required for UI-facing changed files.

## Verified Non-Findings / Fixed Since Prior Reviews

- Restore background DB drain hang from the prior aggregate is fixed on current HEAD: `apps/web/src/lib/background-db-writes.ts:95-112` races the drain against a timeout, `apps/web/src/app/[locale]/admin/db-actions.ts:553-557` aborts restore on timeout, and `apps/web/src/__tests__/background-db-writes.test.ts:43-59` covers a never-settling write.
- Topic route lock release leak from cycle 11 is fixed and tested: `apps/web/src/app/actions/topics.ts:86-98` destroys the connection after `RELEASE_LOCK` failure, and `apps/web/src/__tests__/topics-actions.test.ts:582-605` verifies that behavior.
- Settings-hash config-path mapper drift is fixed: `apps/web/src/lib/settings-hash.ts:87-97` uses an exhaustive `Record` over `COLOR_IMPACTING_KEYS`, and `apps/web/src/__tests__/settings-hash.test.ts:210-230` starts the per-key flip coverage.
- No focused tests were found, and the three custom security lint gates passed in the lightweight verification run.

## Final Missed-Issue Sweep

- Rechecked current e2e scope against browser-flow candidates: token UI, mobile dropdown containment, strict photo-viewer restored state, and cross-browser/mobile coverage are the main browser-flow gaps.
- Rechecked prior LR upload finding: current HEAD added several behavior branches, so I narrowed the finding to remaining untested branches rather than carrying the old broad claim forward.
- Rechecked restore background drains and topic lock release before reporting: both prior findings are fixed and were excluded.
- Rechecked migration coverage: source tripwires are strong and CI runs `npm run init`, but structural parity diff remains absent.
- Full gates were not run; only lightweight lint/audit/focus checks were executed for this review lane.
