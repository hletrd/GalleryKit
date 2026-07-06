# Test Engineer Review — GalleryKit (apps/web)

Date: 2026-07-07
Scope: `apps/web/src/__tests__/` (Vitest unit/fixture tests) and `apps/web/e2e/` (Playwright)
Method: full inventory of `src/__tests__` (311 files) against `src/lib` (109 files), `src/app/actions` (13 files), and `src/app/api/**/route.ts` (6 files); a live `npm test -- --run` execution; targeted reads of security/correctness-critical modules and their tests; static scans for flaky-test patterns (wall-clock `setTimeout`, real network/DB, `Date.now()` races); e2e spec vs. shipped-UI cross-check; CI wiring check (`.github/workflows/quality.yml`, `playwright.config.ts`, `scripts/run-e2e-server.mjs`).

Note: this supersedes the prior "Cycle 35" review that occupied this file — that review is stale (predates the current HEAD) and has been overwritten per the task instructions. If historical continuity is needed, retrieve it from git history at this path.

## Headline

This is an unusually mature test suite for its size: 311 test files, 2,914 assertions, all passing in ~12s with zero flake-prone patterns detected (no wall-clock sleeps, no real DB/network calls, no unguarded shared module state). The security/correctness-critical modules named in the brief — session/auth, admin-tokens, rate limiters, upload flow, image-queue claim/cleanup, restore maintenance, serve-upload ETag, validation, `data.ts` privacy guards, and the migration script — all have deep, realistic coverage (e.g. `serve-upload.test.ts` uses real temp dirs and real symlinks rather than over-mocking; `privacy-fields.test.ts` has a genuinely symmetric guard that would catch an unclassified new sensitive column). The e2e suite is well-maintained, uses role-based selectors that match current source, and is properly wired into CI via `scripts/run-e2e-server.mjs` (`npm run init` → `npm run e2e:seed` → `npm run build` → serve), not just documented.

The gaps found below are narrow and mostly at the edges (a handful of untested pure/leaf modules, one confirmed gap in a security-relevant function, and one architecturally-understood-but-real gap in real-model verification). I found no evidence of tests that would pass on obviously broken code, and no stale e2e specs pinning a pre-redesign UI (two specs' comments describe *past* incidents of exactly that, both since fixed with explicit regression-guard comments).

## Findings

| ID | Severity | Confidence | Location | Title |
|----|----------|------------|----------|-------|
| TEST-01 | MED | High (confirmed) | `apps/web/src/lib/rate-limit.ts:451-474` (`checkRateLimit`) | DB-backed rate-limit read path has zero direct test — every caller mocks it away |
| TEST-02 | MED | High (confirmed) | `apps/web/src/lib/editable-target.ts:9-30` (`isEditableTarget`) | Keyboard-shortcut input guard has no direct unit test |
| TEST-03 | LOW | High (confirmed) | `apps/web/src/lib/color-label.ts:37-42` (`humanizeColorPrimariesOrLabel`) | Never-null label helper is completely untested |
| TEST-04 | LOW-MED | Medium | `apps/web/src/lib/use-restore-focus-after-pending.ts` | Shared a11y focus-restore hook has no test, used on 6 admin forms |
| TEST-05 | LOW | High (confirmed) | `apps/web/src/lib/storage/index.ts:85-127` (`switchStorageBackend` rollback) | Storage-backend singleton rollback-on-failure path untested (low real-world risk: quarantined/unwired module) |
| TEST-06 | LOW-MED | Medium | `apps/web/src/__tests__/clip-semantic-integration.test.ts`, `clip-offline-load.test.ts` | Real jina-clip-v2 encoder correctness/offline-load is only verified by tests gated behind manual env vars, never run in CI |

---

### TEST-01 — `checkRateLimit` (persistent, multi-process-safe rate limit) has zero direct test coverage

**Severity:** MED · **Confidence:** High (confirmed by grep)

`checkRateLimit` (`apps/web/src/lib/rate-limit.ts:451-474`) is the DB-backed read that decides whether an IP/account is over budget for login, password-change, search, load-more, share-write, and user-create (`apps/web/src/app/actions/auth.ts:150-151,366`, `public.ts:115,303,401`, `sharing.ts:135,257`, `admin-users.ts:143`). It is the "source of truth" half of the documented two-tier limiter (in-memory fast path + DB backup, per CLAUDE.md "Runtime topology").

`rate-limit-db.test.ts` thoroughly tests `incrementRateLimit`, `decrementRateLimit` (transaction + `GREATEST` guard), `resetRateLimit`, and `purgeOldBuckets` — but never calls or asserts on `checkRateLimit` itself. Every consumer test (`admin-users.test.ts:73`, `auth-actions-behavior.test.ts:115`, `public-actions.test.ts:73`, `sharing-actions.test.ts:106`, `smart-collection-pagination.test.ts:86`, `load-more-rate-limit.test.ts:57`, `rate-limit-saturated-fast-path.test.ts:86`) mocks `@/lib/rate-limit` wholesale and stubs `checkRateLimit` to return a canned `{ limited, count }`. `getRateLimitBucketStart` (the pure helper `checkRateLimit` defaults its `bucketStart` param from) IS directly tested in `rate-limit.test.ts:76-86` — but the actual `db.select(...).from(rateLimitBuckets).where(and(eq(ip), eq(bucketType), eq(bucketStart))).limit(1)` query shape, the `count ?? 0` default, and its composition with `isRateLimitExceeded` are not exercised anywhere against a mocked DB response.

**Failure scenario:** a refactor that selects the wrong column, drops a `WHERE` clause (e.g. matching by `ip` alone across all bucket types), or breaks the `count ?? 0` fallback (e.g. throwing on an empty result) would pass every existing test unchanged, because nothing calls the real function — yet it would silently disable or weaken the persistent half of login/search/share rate limiting in production (the in-memory fast-path Maps would still work per-process, but the documented multi-process/restart-safety net would be gone).

**Suggested fix:** add a `describe('checkRateLimit', ...)` block to `rate-limit-db.test.ts` alongside the existing increment/decrement/reset tests, mocking `db.select().from().where().limit()` to return `[{ count: N }]` and asserting the `and(eq(...), eq(...), eq(...))` clause arguments and the `{ limited, count }` composition for at least the exceeded/not-exceeded boundary.

---

### TEST-02 — `isEditableTarget` (keyboard-shortcut input guard) has no direct unit test

**Severity:** MED · **Confidence:** High (confirmed)

`isEditableTarget` (`apps/web/src/lib/editable-target.ts:9-30`) gates every keyboard shortcut in the lightbox (`lightbox.tsx:314`, arrow-nav, space-toggle, delete, etc.) and photo viewer (`photo-viewer.tsx:41`) — deciding whether a keypress should be treated as a hotkey or passed through to a focused input/textarea/contentEditable/button/role-based control. It has a 13-item `closest()` selector list (`a`, `button`, `select`, `textarea`, `summary`, `[contenteditable="true"]`, and 7 ARIA roles plus the Radix popper wrapper).

The only test that touches it is `lightbox-controls-contract.test.ts:92-96`, which does a **source-string match** confirming `isEditableTarget(e)` appears textually before `preventDefault` in the Space branch — it never imports or invokes the real function, and never constructs a DOM element to exercise any of the 13 branches, the `HTMLInputElement`/`HTMLTextAreaElement` fast path, or the `isContentEditable` check.

**Failure scenario:** a future edit to the selector list (e.g. dropping `'select'` when a new dropdown is added to the lightbox toolbar, or a typo in a role string) would ship with the existing test suite fully green, and would manifest as either keyboard shortcuts firing while a user types in a caption/search input, or real shortcuts being silently swallowed when focus is on an unlisted interactive element.

**Suggested fix:** add `apps/web/src/__tests__/editable-target.test.ts` with jsdom-constructed elements covering: bare `<div>` (false), `<input>`/`<textarea>` (true, both branches), `contentEditable` div (true), a `<button>` descendant reached via `closest()` (true), a `role="switch"` descendant (true), and an element with no matching ancestor (false).

---

### TEST-03 — `humanizeColorPrimariesOrLabel` is completely untested

**Severity:** LOW · **Confidence:** High (confirmed)

`color-label.ts:37-42` exports two functions; `humanize-color-primaries.test.ts` only tests `humanizeColorPrimaries` (imported via the `color-details-section.tsx` re-export, so that half is genuinely covered transitively). `humanizeColorPrimariesOrLabel` — the never-null variant consumed by `wide-gamut-hint.tsx` for the public-facing wide-gamut hint banner — is never called from any test, including its fallback branch (`t('viewer.colorUnknown')`).

**Failure scenario:** a regression in the fallback (e.g. returning the raw un-humanized value, or crashing when `t` throws) would surface a raw i18n key or an empty string in the public `WideGamutHint` component and go undetected.

**Suggested fix:** two extra `it()` cases in the existing test file: one asserting `humanizeColorPrimariesOrLabel('bt709', t)` returns the humanized string, one asserting the `t('viewer.colorUnknown')` fallback for an unknown value.

---

### TEST-04 — `useRestoreFocusAfterPending` a11y hook has no test

**Severity:** LOW-MED · **Confidence:** Medium

This hook (`apps/web/src/lib/use-restore-focus-after-pending.ts`) restores keyboard focus after a pending Server Action submission — used in `login-form.tsx`, `password-form.tsx`, `settings-client.tsx`, `seo-client.tsx`, `tokens-client.tsx`, and the DB admin page. Its correctness hinges on a subtle guard: only refocus when `document.activeElement` is `<body>` or `null` (i.e. don't steal focus the user already moved elsewhere). No unit test exercises the hook directly, and `e2e/admin.spec.ts` does not assert tab-focus behavior after any of the six form submissions.

**Failure scenario:** an edit that drops the `active === document.body` guard (so it *always* refocuses) would start stealing focus away from a validation message or another field the user tabbed to on purpose; an edit that inverts `wasPending`/`isPending` would break focus restoration entirely for keyboard-only admin users. Neither would be caught today.

**Suggested fix:** a small `@testing-library/react` `renderHook` test toggling `isPending` `false→true→false` with a mock ref, asserting `.focus()` is called only when `document.activeElement` is body/null at the transition, and NOT called when focus has moved elsewhere in between.

---

### TEST-05 — `storage/index.ts` singleton rollback-on-failure path untested (low real-world risk)

**Severity:** LOW · **Confidence:** High (confirmed), but risk is bounded

`switchStorageBackend` (`apps/web/src/lib/storage/index.ts:85-127`) implements a rollback: if the new backend fails to initialize, it restores `oldBackend`/`oldType`/`wasInitialized` before rethrowing. `storage-local.test.ts` tests `LocalStorageBackend` directly (not through the `index.ts` singleton), and `storage-quarantine.test.ts` is a fixture test proving no production code imports `@/lib/storage` yet (enforcing the CLAUDE.md-documented quarantine: "the product currently supports local filesystem storage only"). Neither exercises `getStorage()`'s lazy-init-promise dedup, `switchStorageBackend`'s success path, or its rollback path.

Because this module is explicitly not wired into the live pipeline, the practical exposure today is nil — but if a future feature starts calling `getStorage()`/`switchStorageBackend()` directly (bypassing the quarantine guard, or after it's deliberately lifted), the rollback logic would be shipping with zero prior verification.

**Suggested fix:** low priority; worth a short unit test (fake failing "new backend" via a temporary second class or a spy that makes `init()` reject) whenever the quarantine is lifted, not necessarily before.

---

### TEST-06 — Real CLIP encoder correctness is verified only by env-gated tests that never run in CI

**Severity:** LOW-MED · **Confidence:** Medium (architecturally understood trade-off, but a genuine coverage gap)

`clip-semantic-integration.test.ts` (proves the real jina-clip-v2 encoder produces semantically meaningful, non-random rankings) and `clip-offline-load.test.ts` (proves the offline model-load path from a seeded `CLIP_MODELS_ROOT` actually works) are both `describe.skip`-gated behind `CLIP_INTEGRATION=1` / `CLIP_OFFLINE_LOAD=1` + a pre-seeded model directory. `.github/workflows/quality.yml` sets neither variable, so both suites are permanently skipped in CI (confirmed: 2 of 311 test files skip, matching these two). Every other CLIP test (`clip-embeddings.test.ts`, `clip-model-contract.test.ts`, `clip-model-manifest.test.ts`, etc.) exercises the stub/sha256 path or a mocked encoder, not the real model.

This is a reasonable architectural call — CI has no model weights and shouldn't download hundreds of MB per run — and the CLAUDE.md operational runbook does document running a `--production --force` backfill as a required manual pre-activation step. But nothing in the codebase *enforces* that an operator actually re-runs `clip-semantic-integration.test.ts`/`clip-offline-load.test.ts` before flipping `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`; a regression in model revision pinning, preprocessing, or quantized-weight integrity would pass 100% of standard CI and only surface as silently-wrong (or randomly-ranked) search results in production.

**Suggested fix (optional, process not code):** reference these two gated test commands directly in the "Activating production" runbook section of CLAUDE.md as a required pre-flight step, so the manual gate is procedurally, not just architecturally, closed.

## Final sweep / things checked and found clean

- **Flaky-test risk:** scanned every test file using `setTimeout` (5 hits) and `Date.now()` (13 hits) without `useFakeTimers` — all are either source-string fixture assertions (checking the *shape* of code, not executing real timers) or deterministic timestamp construction. No wall-clock sleeps, no real network calls (`fetch` appears once, in `sw-template-contract.test.ts`, again as source-string matching), no real MySQL connections in unit tests.
- **e2e vs. shipped UI:** cross-checked `#strip-gps`, `#upload-topic`, `#create-topic-label`/`#create-topic-slug`, and all `/admin/*` route links referenced in `e2e/admin.spec.ts` against current component source — all present and matching. `nav-visual-check.spec.ts` and `test-fixes.spec.ts` contain explicit regression-guard comments documenting *prior* stale-UI incidents (pre-redesign mobile-nav layout) that were caught and fixed; no currently-stale specs found.
- **e2e CI wiring:** confirmed `scripts/run-e2e-server.mjs` runs `npm run init` → `npm run e2e:seed` → `npm run build` before serving, so the Playwright `webServer` lifecycle seeds fixtures (topics, share keys) even though the top-level `quality.yml` step list only shows `npm run init` — the seeding is one layer down, not missing.
- **Privacy guard:** `privacy-fields.test.ts` has a genuinely symmetric contract (`adminOnlyKeys === SENSITIVE_KEYS`, not just one-directional containment) — this is exemplary and would catch a newly-added, unclassified sensitive column.
- **Weak-assertion scan:** grepped for test files whose only assertions are `toBeDefined`/`toBeTruthy`/`not.toBeNull` — none found. Grepped for files with fewer `expect()` calls than `it()` blocks — the 4 hits (`alert-dialog-action-settle`, `focus-visible-links-scan`, `semantic-scan-limit-source`, `tracked-secrets`) were all false positives on manual check (aggregate-failures-array pattern or `it.each` loops sharing an assertion).
- **Admin-tokens scope coverage:** `tokenHasScope`/`normalizeScopes` are tested for all three scopes (`lr:upload`/`lr:read`/`lr:delete`); only `lr:upload` is wired to a live route (`allowTokenScope`) today, so `lr:read`/`lr:delete` have no route-level test only because no route consumes them yet — not a test gap, a product-scope note.
- **Migration script:** `scripts/migrate.js` (895 lines) has 4 dedicated test files (`migration-journal.test.ts`, `migration-journal-monotonicity.test.ts`, `migrate-reconcile-coverage.test.ts`, `migrate-legacy-originals.test.ts`) covering the documented non-monotonic-journal hazard and the hash-based post-condition assertion described in CLAUDE.md's runbook.
- **`similar-route.test.ts`** does cover `/api/search/similar/[id]/route.ts` (an earlier grep pass for the literal bracketed path string was a false negative — the import statement uses the real path).

## What's already excellent (worth preserving, not re-litigating)

- `serve-upload.test.ts` uses real temp directories, real file descriptors, and a real symlink-traversal attack rather than mocking `fs` wholesale — this is the right level of realism for a security-relevant path.
- `session-verify.test.ts` and `session.test.ts` cover all 8 branches of `verifySessionToken` and 6 cases of `getSessionSecret`, including the previously-unexercised INSERT-IGNORE-then-refetch race path (explicitly called out in a comment as a prior gap that was closed).
- `restore-maintenance.test.ts` covers the durable-marker/process-state dual-tracking system thoroughly, including fail-closed behavior on non-ENOENT filesystem errors and marker-removal failures.
- The e2e suite is deliberately serialized (`workers: 1`) specifically to avoid colliding with the per-IP/per-account login rate-limit budget — a subtlety many teams miss.
