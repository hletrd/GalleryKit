# Cycle 1/100 Test-Engineer Review

Reviewed HEAD: `1d29b988` (working tree has uncommitted changes to
`apps/web/src/__tests__/failed-image-retry.test.ts` and
`apps/web/src/__tests__/image-queue-permanent-failure.test.ts`).
Date: 2026-07-06.

## Scope And Inventory

- Read `CLAUDE.md` (Testing, Lint Gates, Touch-Target Audit sections),
  `.context/plans/cycle-85-2026-07-01-deferred.md`, and
  `.context/reviews/cycle-85-2026-07-01/_aggregate.md` +
  `.context/reviews/cycle-85-2026-07-01/test-engineer.md` before starting, per
  instructions, to avoid re-reporting known/deferred findings.
- Confirmed both uncommitted diffs are net-new regression coverage that
  **closes** the two findings the prior cycle (C85-02 / C85-03, filed as
  `C85-TE-01` / `C85-TE-02` in the prior test-engineer lane) recommended. See
  "Verification of in-flight diffs" below.
- Test inventory: 305 files under `apps/web/src/__tests__/**/*.test.ts` (no
  `.tsx` test files; no subdirectory test files besides fixtures/stubs).
  `apps/web/e2e/` has 4 spec files (`admin.spec.ts`, `public.spec.ts`,
  `origin-guard.spec.ts`, `test-fixes.spec.ts`) plus a visual-check spec and a
  shared `helpers.ts`.
- Built a systematic module → test-file coverage map for every file in
  `apps/web/src/lib/` (110 files) and `apps/web/src/app/actions/` (13 files) by
  grepping for direct import-path references from `src/__tests__/`, then hand-
  verified every zero/low-hit result (see Findings).
- Ran the full Vitest suite once via `npm test --workspace=apps/web` (see
  "Test run evidence"). Read 15+ safety-critical test files in full to confirm
  their assertions match their stated intent (not tautological/vacuous); see
  "Non-Findings / Adequate Contracts".
- Did not modify any source or test file. Only file written is this review.

## Findings

### TEST-01 — Smart-collection admin mutations (`collections.ts`) have zero behavior-level test coverage

- Severity: Medium.
- Confidence: High.
- Classification: Coverage gap (untested critical path).
- Citations: `apps/web/src/app/actions/collections.ts:15` (`createSmartCollection`),
  `apps/web/src/app/actions/collections.ts:64` (`updateSmartCollection`),
  `apps/web/src/app/actions/collections.ts:112` (`deleteSmartCollection`),
  `apps/web/src/__tests__/smart-collections.test.ts:1-10` (imports only
  `@/lib/smart-collections`, the AST compiler — never `@/app/actions/collections`).
- Problem: `collections.ts` is the only mutating admin actions file in the
  repo (of 13) with **no direct-import test at all**. Every sibling action
  file (`tags.ts`, `topics.ts`, `sharing.ts`, `seo.ts`, `settings.ts`,
  `admin-users.ts`, `lr-tokens.ts`, `admin-backfill.ts`, `images.ts`,
  `public.ts`, `auth.ts`) has at least one dedicated behavior test importing
  it directly; `collections.ts` has none. It is only touched by the generic
  structural scanners: `check-action-origin.test.ts` (proves the
  `requireSameOriginAdmin()` early-return shape is present) and the
  `lint:action-origin` script. Confirmed via `grep -rl
  "createSmartCollection\|updateSmartCollection\|deleteSmartCollection"
  src/__tests__/*.test.ts` → zero hits, and zero hits in `apps/web/e2e/**`
  for `smart.collection|SmartCollection`.
- Untested behavior includes: the restore-maintenance gate short-circuit
  (`getRestoreMaintenanceMessage`), slug/name validation rejection branches
  (`requireCleanInput` bidi/control-char rejection, `isValidSlug`, the 255
  code-point name cap), malformed `query_json` handling (the
  `parseSmartCollectionQuery` throw → localized `invalidCollectionQuery`
  translation, never the raw parser message), `ER_DUP_ENTRY` → localized
  `slugAlreadyExists` mapping on both create and update, the
  `affectedRows === 0` not-found branch on update/delete, and the
  `revalidateAllAppData()` call on success.
- Failure scenario: a future refactor (e.g., collapsing the three action
  bodies, or reordering the maintenance/origin/auth checks) could silently
  invert the gate order, drop the `ER_DUP_ENTRY` → localized-message mapping
  (leaking a raw driver error to an admin), or skip the not-found check on
  update/delete (silently no-op-ing instead of surfacing `invalidInput`) —
  nothing in CI would fail. The only safety net is the origin-guard structural
  scanner, which cannot see any of this.
- Suggested fix: add `apps/web/src/__tests__/collections-actions.test.ts`
  mocking `@/db`, `@/app/actions/auth`, and `@/lib/restore-maintenance` the
  same way `apps/web/src/__tests__/topics-actions.test.ts` /
  `apps/web/src/__tests__/tags-actions.test.ts` already do, covering: happy
  path create/update/delete, restore-maintenance short-circuit, invalid
  slug/name rejection, malformed `query_json`, duplicate-slug mapping, and the
  not-found branch on update/delete.

### TEST-02 — CLIP embeddings backfill action (`embeddings.ts`) has near-zero behavior coverage; the file's own tests document the gap

- Severity: Low-Medium.
- Confidence: High.
- Classification: Coverage gap (untested critical path), corroborated by an
  existing in-repo admission.
- Citations: `apps/web/src/app/actions/embeddings.ts:57`
  (`backfillClipEmbeddings`), `apps/web/src/__tests__/bounded-map-rate-limit-increment.test.ts:10-13`
  ("embeddings has NO fallback" — the file's own doc comment),
  `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:20` (only checks
  one `isAdvisoryLockAcquired` regex line, not the surrounding logic).
- Problem: the only two tests that touch `embeddings.ts` at all are narrow
  regex/shape assertions: (1) `bounded-map-rate-limit-increment.test.ts`
  checks the exact `count: entry.count + 1` write shape and absence of
  `entry.count++` in the rate-limit increment — and its own docblock states
  this file has "NO fallback" (unlike `sharing.ts` / `admin-users.ts`, whose
  rate limits are also DB-backed, so a regression there is masked by a second
  layer; a regression in `embeddings.ts`'s in-memory-only limiter would not
  be); (2) `cycle-22-source-contracts.test.ts` checks one `isAdvisoryLockAcquired`
  usage line. No test exercises the actual mode-aware branching (disabled →
  no-op, stub → stub encoder, production → real encoder +
  `PRODUCTION_MODEL_VERSION`), the advisory-lock acquire/release/finally path,
  the `notExists`-filtered candidate query, the batch/concurrency chunking, or
  the per-item try/catch skip-counting. This action previously shipped a real
  bug in exactly this file (the `entry.count++` mutate-the-copy bug, R15C15
  CR-15-01) that surfaced only because of an adjacent regex-shape test added
  after the fact — the surrounding logic remains just as exposed.
- Failure scenario: a refactor to the batch loop, the `notExists` model-version
  filter (added in AGG-C8-05 specifically to fix a stub→production upgrade
  bug), or the lock's `finally` release could silently break candidate
  selection or leak the advisory lock, and nothing would fail except by
  accident. Mitigating factor: the action is explicitly documented as
  "unwired from any UI" (the sidecar script `scripts/backfill-clip-embeddings.ts`
  is canonical), which lowers real-world blast radius but does not zero it —
  it is still an invokable `'use server'` endpoint reachable directly.
- Suggested fix: add a behavior test mocking `@/db`, `getGalleryConfig`,
  `embedImageStub`/`embedImageReal`, and the advisory-lock connection,
  covering: disabled mode no-op, stub mode processing + rate limit,
  lock-already-held → `restoreInProgress` error, and the `notExists`
  model-version selection (at least a query-shape assertion since a full DB
  mock of the notExists subquery is heavier).

### TEST-03 — `extractFnBody` substring-prefix collision hazard in the new `deleteImage`/`deleteImages` source-contract split (latent, not currently triggering)

- Severity: Low.
- Confidence: High.
- Classification: Brittleness (would silently pass a wrong assertion on
  reasonable refactor).
- Citations: `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:92-93`
  (`extractFnBody(imagesSource, 'export async function deleteImage')` /
  `extractFnBody(imagesSource, 'export async function deleteImages')`),
  `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:110-158`
  (`extractFnBody` implementation, uses `source.indexOf(header)`),
  `apps/web/src/app/actions/images.ts:648` (`deleteImage`, first),
  `apps/web/src/app/actions/images.ts:746` (`deleteImages`, second).
- Problem: this is the cycle-85 uncommitted fix for `C85-03` (strengthening
  the single source-wide regex into two separately-extracted function
  bodies) — the fix direction is correct and closes the finding as intended.
  However, the header string `'export async function deleteImage'` is a
  literal string-prefix of `'export async function deleteImages'`.
  `extractFnBody` locates the function via plain `String.indexOf(header)`,
  which returns the position of the **first textual occurrence** of the
  substring — it does not require a following `(` or word boundary. Today
  this works only because `deleteImage` (line 648) happens to be defined
  *before* `deleteImages` (line 746) in `images.ts`; `indexOf('export async
  function deleteImage')` therefore finds the real `deleteImage` header
  first. If a future reformat/reorder ever placed `deleteImages` before
  `deleteImage` in the file, `indexOf('export async function deleteImage')`
  would match inside `'export async function deleteImages'`'s own header
  (since that string literally starts with the shorter one), and the brace
  walker would extract `deleteImages`'s body while the test believes it is
  asserting about `deleteImage`. It would likely still pass in that
  scenario (both bodies currently contain a `queueState.permanentlyFailedIds.delete(id)`
  pattern), masking the mix-up rather than failing loudly — the opposite of
  the fix's stated intent ("A single source-wide regex would pass if only one
  delete path kept the cleanup").
- Failure scenario: reordering the two functions during an unrelated
  refactor, combined with a later regression that removes cleanup from the
  *real* `deleteImage` only, could have the test still pass because it is
  unknowingly asserting against `deleteImages`'s body twice.
- Suggested fix: append the opening paren to disambiguate, e.g.
  `extractFnBody(imagesSource, 'export async function deleteImage(')` /
  `'export async function deleteImages(')`. This is a one-line change to the
  two call sites in the diff; the shared helper itself doesn't need to
  change. (The same helper is duplicated, not shared, between this file and
  `data-view-count-flush.test.ts` — that file's headers are not
  prefix-colliding, so it isn't affected.)

## Verification of in-flight diffs (uncommitted changes)

Both uncommitted test diffs were read in full and traced against the source
they lock down; both are real strengthenings, not cosmetic:

- `failed-image-retry.test.ts` adds a test asserting
  `dashboard.retryImageAria` / `dashboard.retryingImageAria` contain
  `{label}` in **both** `messages/en.json` and `messages/ko.json`. This
  exactly closes `C85-02` (the prior cycle's finding that a copy edit
  dropping `{label}` would go undetected). Verified the JSON import paths
  (`../../messages/en.json` from `src/__tests__/`) resolve to the real
  `apps/web/messages/{en,ko}.json`, and both files currently contain the
  placeholder in both keys.
- `image-queue-permanent-failure.test.ts` replaces the single
  `imagesSource.toMatch(/permanentlyFailedIds\.delete\(id\)/)` (which could
  pass with only one of the two delete actions doing cleanup) with two
  separately-extracted function bodies, each asserting the
  `getProcessingQueueState()` + `.permanentlyFailedIds.delete(id)` pattern
  independently, and additionally asserts `deleteImages` iterates
  `for (const id of foundIds)`. This closes `C85-03` as intended. See
  **TEST-03** above for the one latent brittleness this introduces.
- Both diffs are included in, and pass under, the full suite run below.

## Non-Findings / Adequate Contracts

Read in full (not skimmed) to confirm assertions match their stated intent:
`auth-rate-limit.test.ts`, `session.test.ts`, `password-hashing-policy.test.ts`,
`csv-escape.test.ts`, `privacy-fields.test.ts`, `upload-paths.test.ts`,
`check-api-auth.test.ts`, `admin-tokens.test.ts`, `request-origin.test.ts`,
`og-sanitize.test.ts`, `gps-exif-strip-isobmff.test.ts` (partial),
`image-queue-permanent-failure.test.ts`, `failed-image-retry.test.ts` (partial),
`smart-collections.test.ts` (partial), `bounded-map-rate-limit-increment.test.ts`.
All of these assert genuinely meaningful, non-tautological behavior — several
(`upload-paths.test.ts`, `gps-exif-strip-isobmff.test.ts`) exercise real
filesystem/byte-level operations against synthetic malformed input rather than
mocking the interesting part away. This is a mature, well-curated test suite;
I did not find shortcut assertions (`expect(true).toBe(true)`-style padding)
in any of the above.

- `apps/web/src/lib/csp-nonce.ts` and `apps/web/src/lib/color-label.ts` have
  no direct-import test, but both are thin (3-line and 42-line) pass-through
  helpers whose only real logic (`NODE_ENV` branch; string formatting) is
  either trivial or exercised transitively by the several component tests
  that import `color-label.ts`'s consumers. Not filing as a finding —
  disproportionate to file size/risk.
- `apps/web/src/lib/feed-conditional.ts` is intentionally unused dead code
  (its own docblock, `C74-01`, states current feed routes deliberately do
  NOT import it and keep ETag-only 304 logic). Its one existing test
  (pure-function unit test) is adequate for what it is; not a coverage gap.
- `apps/web/src/lib/settings-normalization.ts` and
  `apps/web/src/lib/action-result.ts` are small (10 lines / type-only);
  the former is exercised transitively through
  `settings-submit-payload.test.ts` / `settings-backfill-warning.test.ts`
  (both import consumers that call it), the latter has no runtime behavior
  to test (a type alias).
- Did not re-open `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, or `C75-08`
  from the deferred list — no new evidence surfaced that changes their
  recorded exit criteria.

## Flaky Risk / Hygiene Notes

- No real-timer (`setTimeout` outside `vi.useFakeTimers`), unmocked network
  (`fetch`), or unbounded shared-module-state ordering-dependence patterns
  found across `src/__tests__/**`. 8 files correctly use
  `vi.useFakeTimers`.
- `clip-offline-load.test.ts` and `clip-semantic-integration.test.ts` are the
  only two files with `describe.skip` gating (env/model-weight-seeded-only
  integration tests, both with clear docblocks: `CLIP_OFFLINE_LOAD=1` +
  seeded `CLIP_MODELS_ROOT`, or CI-provisioned weights). This is why
  `npm test`'s summary line reads "301 passed | 2 skipped (303)" rather than
  305 — confirmed benign and intentional, not a flake; a plain
  `--reporter=json` re-run independently shows all 305 discovered files
  execute cleanly with zero failures.
- `apps/web/playwright.config.ts` correctly forces `workers: 1` /
  `fullyParallel: false` to protect the shared login-rate-limit budget
  (documented at the config site) — sound for this repo's single-admin-
  account E2E model.
- Admin E2E (`apps/web/e2e/admin.spec.ts`) remains opt-in
  (`E2E_ADMIN_ENABLED=true`), and neither it nor any other e2e spec covers
  smart-collection CRUD or the CLIP embeddings backfill action — the same
  two surfaces flagged as unit-test gaps in TEST-01/TEST-02 have **zero**
  coverage at any level. This corroborates rather than duplicates those
  findings (confirmed via `grep -rl "smart.collection\|embeddings" e2e/` →
  no hits).
- `vitest.config.ts` and `playwright.config.ts` are both sound; no new
  config-level findings.

## Files/Areas Examined

- `CLAUDE.md`, `.context/plans/cycle-85-2026-07-01-deferred.md`,
  `.context/reviews/cycle-85-2026-07-01/_aggregate.md` and `test-engineer.md`.
- `git diff` of `apps/web/src/__tests__/failed-image-retry.test.ts` and
  `apps/web/src/__tests__/image-queue-permanent-failure.test.ts` (full diffs
  and full resulting file contents).
- All 110 files in `apps/web/src/lib/` and 13 files in
  `apps/web/src/app/actions/` cross-referenced against `src/__tests__/` import
  hits; every zero/low-hit result individually inspected
  (`action-result.ts`, `color-label.ts`, `csp-nonce.ts`, `feed-conditional.ts`,
  `settings-normalization.ts`, `collections.ts`, `embeddings.ts`).
- Full read of 15 safety-critical test files (listed under Non-Findings) plus
  the two diffed files and `smart-collections.test.ts`.
- `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, all 4
  `apps/web/e2e/*.spec.ts` test-title inventories.
- Ran `npm test --workspace=apps/web` once (full run) plus a follow-up
  `vitest run --reporter=json` to resolve the file-count discrepancy noted
  above.

## Test Run Evidence

```
> web@0.1.0 test
> vitest run --run

 Test Files  301 passed | 2 skipped (303)
      Tests  2836 passed | 4 skipped (2840)
   Start at  18:42:34
   Duration  13.64s (transform 7.29s, setup 0ms, import 54.29s, tests 18.10s, environment 33ms)
```

Exit code 0. No failures, no errors, no unhandled rejections in output. A
second run with `--reporter=json` (to resolve the 303-vs-305-files question)
independently confirmed all 305 discovered test files report `status:
"passed"` with zero failures — the "2 skipped" files in the default reporter
summary are the two intentionally `describe.skip`-gated CLIP integration
tests (see Hygiene Notes), not flakes or errors.

## Commonly-Missed-Issues Sweep

- Checked for tautological/no-op assertions in safety-critical tests: none
  found in the 15 files read in full.
- Checked for ordering-dependent shared module state: none found (no
  `describe.sequential`/`test.sequential` needed anywhere; each test file
  resets its own mocks/maps in `beforeEach`/`afterEach` where relevant, e.g.
  `auth-rate-limit.test.ts`, `admin-tokens.test.ts`).
- Checked for real network/DB access disguised as a unit test: none found;
  the one `fetch(` hit outside mock/DB-aware files (`sw-template-contract.test.ts`)
  is a source-string assertion, not a live call.
- Checked whether the two in-flight diffs actually strengthen (vs. merely
  reformat) their targets: confirmed both close their respective cycle-85
  findings, with one new latent brittleness noted (TEST-03).
- Checked lint-gate fixture tests (`check-api-auth.test.ts`,
  `check-action-origin.test.ts`) actually exercise both pass and fail paths
  of their scanners, not just the pass path: confirmed for both.
- Did not find any test file importing from `.next/` build output or any
  path outside `src/` that could reintroduce the previously-fixed
  `ERR_MODULE_NOT_FOUND` flake documented in `vitest.config.ts`.
