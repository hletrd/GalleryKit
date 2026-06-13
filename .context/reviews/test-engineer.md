# Test-Engineer Review — Run-8 Cycle-2

**Date:** 2026-06-13
**Run/cycle:** run-8 cycle-2 of the review-plan-fix loop.
**Repo:** GalleryKit (Next.js 16 / React 19 / TS6). Test surface: **213 Vitest files** in `apps/web/src/__tests__/` + Playwright e2e in `apps/web/e2e/`.
**HEAD:** `77867144` (working tree CLEAN, synced with origin/master).
**Suite health:** **1 failing test at HEAD — a deterministic timeout flake (TEST-0 below), NOT a code regression.** Full `npx vitest run` = **1 failed | 2034 passed (2035)**, 337.5 s. The one failure is `client-server-only-boundary.test.ts` timing out at the default 15000ms; it reproduces in ISOLATION (42.7 s for that single `it`), so it is a test-budget defect, not flakiness in the usual order-dependent sense, and not a real boundary violation. Everything else is GREEN: targeted run of the 7 most-relevant recently-touched files = **42/42 pass, 0 flakes** (`npx vitest run home-metadata-title error-shell-heading migration-journal-monotonicity admin-backfill-runner-fatal-counters settings-hash privacy-fields advisory-locks`, 91.5 s). The full suite is import-heavy (`import 1060.90s` cumulative across workers).

---

## Prior test obligations — verification against HEAD

| Prior ID | Obligation | Status at HEAD | Evidence |
|---|---|---|---|
| **AGG-R7-05 / TEST-1 (prior)** | AGG-9 error-shell heading regression test | **CLOSED** | `error-shell-heading.test.ts` (commit `d035de10`) — source-fixture, 6 tests across BOTH `error.tsx` shells: asserts a VISIBLE `<h1>{t('error.title')}</h1>` (not `sr-only`), the `aria-labelledby` id resolves, and no `text-muted-foreground/30` element carries the title. Matches the actual shipped shape (single visible `text-3xl font-semibold` h1, no faint glyph). |
| **AGG-R7-05 / TEST-2 (prior)** | AGG-10 home title `{absolute}` regression test | **CLOSED** | `home-metadata-title.test.ts` (commit `d035de10`, de-flaked in `61607572`) — invokes `generateMetadata` with mocked deps, asserts `title:{absolute}` on the og-image branch, the latest-photo branch, AND the filtered (`#sunset \| GalleryKit`) branch. De-flake = static top-level import instead of per-test dynamic `import()`. |
| **AGG-R7-11 / TEST-3 (prior)** — migration cursor depth | Strengthen monotonicity test to model the real `MAX(created_at)` cursor (prefix-max), not just adjacent pairs | **PARTIALLY CLOSED** | `migration-journal-monotonicity.test.ts` (commit `bb463062`) pins: adjacent-pair monotonicity (idx-7 allowlisted), the no-stale-allowlist guard, the missing-hash predicate shape, and the `migrate.js` "Drizzle silently skipped" throw + `recordedHashes.has(m.hash)` regex. **The prefix-max / globally-increasing-MAX assertion I recommended was NOT added** — see **TEST-2** below (still OPEN). |
| **AGG-R7-11 / TEST-5 (prior)** — mixed backfill run | Add a MIXED run (`processed>0 && errors>0`) regression test | **NOT CLOSED** | `admin-backfill-runner-fatal-counters.test.ts:167` still fires a **single throwing row** (asserts `processed===0`). No mixed-run case exists. See **TEST-3** below (still OPEN). |
| AGG-R7-06 / TEST-4 (prior) — withAdminAuth 403/401 branches | Correct deferral; pin 403 origin-mismatch + 401 not-admin | Not re-verified this pass (LOW, prior deferral). Carried forward as **TEST-6** (low priority). |

**Net:** the two MED prior obligations (error-shell heading, home title) are fully CLOSED. Two LOW prior obligations (migration prefix-max, mixed backfill run) were re-scheduled but landed only partially or not at all — re-stated below with sharper acceptance criteria.

---

## OPEN / NEW findings

| ID | Sev | Conf | File:line | Gap | Risk |
|---|---|---|---|---|---|
| **TEST-0** | HIGH | High | `__tests__/client-server-only-boundary.test.ts:120` | The `no 'use client' module transitively imports a server-only file` test **FAILS at HEAD** — it times out at the default 15000ms. Reproduces in ISOLATION (42.7 s for the single `it`). It is a synchronous full-`src` transitive-import-graph walk whose runtime has grown past the default budget; it sets NO explicit `timeout`. | A blocking CI gate (`npm test`) is RED right now. Worse, the failure mode is silent rot: as the codebase grows the walk slows, and once it crosses 15 s it flips from "boundary verified" to "timeout" — so a future REAL client→server-only violation would be masked behind an indistinguishable timeout. CI signal is currently meaningless for this guard. |
| **TEST-1** | MED | High | `app/[locale]/(public)/page.tsx:111` | AGG-R7-09 home OG base-JPEG fix (commit `4852bcf5`) shipped with **NO** regression test. `home-metadata-title.test.ts` asserts only `meta.title` — zero assertions on `openGraph.images` / `/uploads/jpeg/`. | A refactor re-introducing `findNearestImageSize` (→ `_2048.jpg`) silently re-breaks the social card during the backfill window / after an `image_sizes` reconfigure — the exact 404 this fix closed. The fix's intent is untested. |
| **TEST-2** | LOW | Med | `__tests__/migration-journal-monotonicity.test.ts:62-76` | Monotonicity test checks ADJACENT pairs only; does NOT model the real `MAX(created_at)` cursor. idx 8-17 all sit below idx 6's `when` (`1778304060000`) yet pass the adjacent check. (Prior TEST-3, re-scheduled in AGG-R7-11 but the prefix-max half was not added.) | A NEW migration appended with `when` above its predecessor but BELOW the historical MAX is silently skipped by drizzle — and the test passes anyway, giving false confidence that "monotonic-vs-predecessor ⟹ drizzle applies it" (FALSE for the historical block). |
| **TEST-3** | MED | High | `lib/admin-backfill-runner.ts:625-693` | No MIXED-run test (some rows succeed `processed++`, some throw `errors++`, optionally some `encode-failed`/`detection-failed`) in ONE run. `admin-backfill-runner-fatal-counters.test.ts` covers only a single `processed===0` fatal-only run. (Prior TEST-5, re-scheduled in AGG-R7-11, not landed.) | The realistic production shape (deadlock on a few rows, success on the rest) is unverified. A regression that resets `processed` in the catch, or mis-attributes a thrown row to `processed`, survives — re-opening the AGG-1 dishonesty class for mixed runs. The 6 counters are independent locals all mirrored to `state`; only their isolated single-row paths are pinned. |
| **TEST-4** | LOW | Med | `lib/settings-hash.ts:36-46` (`COLOR_IMPACTING_KEYS`) | No test locks the EXACT 9-key SET. `settings-hash.test.ts` proves each key individually changes the hash (via `_buildHashForTesting({key:…})`), but nothing asserts the membership/cardinality of `COLOR_IMPACTING_KEYS` itself. | DROPPING a key from the array (e.g. removing `image_sizes` or an `image_quality_*` during a refactor) silently stops invalidating the ETag for that setting — cached clients keep stale bytes after that admin setting changes. The per-key tests still pass because they pass the key explicitly. This is the same blind-spot class as the privacy-guard `_PrivacySensitiveKeys` symmetric contract (which IS locked) — settings-hash lacks the equivalent. |
| **TEST-5** | LOW | Med | `serve-upload.ts` ETag formula / `__tests__/serve-upload.test.ts:74` | ETag test asserts only the `^W/"v${VERSION}-` PREFIX. No test pins the full 4-component shape `W/"v{VERSION}-{mtimeMs}-{size}-{settingsHash}"` in the documented order. | A regression dropping `{size}` or reordering the components (e.g. losing the settings-hash tail) is caught only indirectly (the settings-debounce test proves the hash participates, but not its position/presence in the canonical formula). Drift in the ETag shape vs CLAUDE.md's documented contract survives. |
| **TEST-6** | LOW | Med | `lib/api-auth.ts` (cookie origin-mismatch 403 + not-admin 401 branches) | Only the token wrong-scope **401** is pinned (`api-auth-response-headers.test.ts:103`). The cookie origin-mismatch **403** (CSRF reject) and not-admin **401** branches are unpinned. (Carried from prior TEST-4; the AGG-R7-06 deferral correctly noted the lint gate enforces wrapper PRESENCE, not reject status.) | A 403→200 origin-check regression (CSRF hole) or a 403/401 status drift survives. The 403 origin-mismatch return is the CSRF defense; a missing `hasTrustedSameOrigin` guard would be silent. |
| **TEST-7** | LOW | Low | `app/[locale]/admin/(protected)/settings/settings-client.tsx` (timer cleanup, commit `f11746cd`) | AGG-R7-02 timer-cleanup fix (clear post-trigger `setTimeout`s + `mountedRef` setState gate on unmount) shipped with **no test**. No settings-client unmount/timer test exists. | A refactor dropping the `clearTimeout`/`mountedRef` cleanup re-introduces the "setState on unmounted tree" warning + wasted state write. Low because it's a dev-only warning and an RTL render+unmount+fake-timers test is comparatively expensive for the payoff. |

**Severity counts:** 0 CRITICAL · 1 HIGH (TEST-0) · 2 MEDIUM (TEST-1, TEST-3) · 5 LOW (TEST-2, TEST-4, TEST-5, TEST-6, TEST-7).

---

## Detail + concrete tests

### TEST-0 (HIGH) — blocking boundary test is RED (timeout, not a real violation)

The full suite has exactly one failure: `client-server-only-boundary.test.ts:120` times out at 15000ms. It reproduces deterministically in isolation (`npx vitest run client-server-only-boundary` → that `it` runs 42.7 s, the second cheap `it` passes). The test (line 120-148) walks every file under `src`, filters `'use client'` modules, and for each calls `findServerOnlyInClosure` — a synchronous traversal of the entire transitive import closure, reading + regex-scanning each reachable file. With 213 test files plus the full app source, that synchronous walk now exceeds the default Vitest `testTimeout` on this machine. The test sets no explicit timeout.

This is the WORST class of flake for a security/boundary guard: when it times out it neither passes nor reports a violation, so a genuine client→server-only leak (the AGG-R5C3-21 regression this guard exists to catch) would be indistinguishable from the timeout. The CI gate is currently both red AND blind.

**Fix (test-only, two parts):**
1. **Make the budget honest:** pass an explicit generous per-test timeout (e.g. `it('…', () => {…}, 120_000)`) so the existing synchronous walk completes deterministically. This unblocks CI immediately.
2. **Make it cheap + non-rotting (preferred, do alongside 1):** the dominant cost is re-reading + re-parsing the same files across overlapping closures. Memoize per-file: cache `readFileSync` results and each file's parsed import list, and memoize `findServerOnlyInClosure` per visited module (a `Map<file, boolean>` "does this module's closure touch server-only") so each file is parsed once regardless of how many client closures reach it. This collapses the O(clients × closure) re-walk to O(files) and keeps the test sub-second as the codebase grows — eliminating the silent-rot path entirely. Verify it still FAILS on a synthetic `'use client'` file that imports a `server-only` module (the guard must keep its teeth).

This is the only finding that is actionable as a CI-unblock; do it first.

### TEST-1 (MED) — home OG base-JPEG fix is unpinned

`page.tsx:109-117` builds the latest-photo OG image as:
```ts
const ogImages = latestImage
  ? [{ url: absoluteImageUrl(`/uploads/jpeg/${latestImage.filename_jpeg}`, seo.url), … }]
  : [];
```
The base `filename_jpeg` (no `_${size}` suffix) is the contract — the encoder atomic-rename guarantee makes it always-present, unlike a nearest-configured-size `_2048.jpg` mid-backfill. The fix (commit `4852bcf5`) even dropped the `getGalleryConfig()` + `findNearestImageSize` import from this path. But `home-metadata-title.test.ts` never inspects `meta.openGraph` — it asserts only `meta.title`.

**Add** to the existing `home-metadata-title.test.ts` (the `latestImage` mock with `filename_jpeg:'abc.jpg'` is ALREADY set up in the latest-photo `it`, so this is ~3 lines):
- assert `(meta.openGraph!.images as Array<{url:string}>)[0].url` ends with `/uploads/jpeg/abc.jpg` and contains NO `_` size token (`expect(url).not.toMatch(/_\d+\.jpg$/)`);
- assert `meta.twitter!.images![0]` is the same base URL.
This pins the AGG-R7-09 intent precisely against a `findNearestImageSize` reintroduction. Cheapest high-value lock in this pass.

### TEST-2 (LOW) — monotonicity test does not model the `MAX(created_at)` cursor

`migration-journal-monotonicity.test.ts:62-76` checks each entry vs its immediate predecessor. The production footgun (CLAUDE.md runbook) is the `MAX(created_at)` cursor: drizzle skips any entry whose `when` < the max already-applied `when`. The real journal has idx 8-17 (`1746576000000`-`1747156800000`) ALL below idx 6 (`1778304060000`) — they pass the adjacent check (each advances vs idx 7) yet are exactly the block a naive MAX baseline would skip. A NEW migration appended with `when` above its predecessor but below the historical MAX is the live risk; the test gives false confidence.

**Strengthen** with a prefix-max assertion: walk entries in idx order, track `runningMax = Math.max(runningMax, e.when)`, and assert every NON-allowlisted entry's `when` is `> runningMaxBeforeIt` (i.e. `e.when` strictly exceeds the max of all prior `when`s). Same idx-7 allowlist. Add a comment that idx 8-17 are protected ONLY by `migrate.js`'s per-entry-hash baselining, not the `when` cursor — and assert `migrate.js` contains `baselineAllJournalMigrations` (or the per-entry-hash baseline call) so that protection can't be dropped silently.

### TEST-3 (MED) — mixed success+fatal backfill run untested

`runBackfill` (runner.ts:625-665) increments six independent locals — `processed`, `errors`, `skippedMissingOriginal`, `skippedLocked`, `encodeFailures`, `detectionFailures` — and mirrors all six to `state` continuously (660-672) and on final flush (686-693). The fatal-counters test covers only ONE throwing row (`processed===0`). There is NO test where, say, 3 rows succeed and 2 throw, asserting final `processed===3 && errors===2 && lastRunHadFailures===true`.

**Add** a case to `admin-backfill-runner-fatal-counters.test.ts` (the harness — fake `fetchCandidateBatch` + a `reprocessOne`/UPDATE that throws conditionally — is already built):
- seed N candidate rows; make the per-row work succeed for some ids and throw `ER_LOCK_DEADLOCK` for others;
- drain via `vi.waitFor(() => !readAdminBackfillState().running)`;
- assert final `processed === <#success>`, `errors === <#throw>`, `processed + errors === N`, `lastRunHadFailures === true`, `lastError` contains `'Deadlock'`.
Optionally add a 4-way mixed run (success + encode-failed + detection-failed + fatal) asserting each counter independently and that they sum to the candidate count — this locks the "every outcome lands in exactly one bucket" invariant that the single-row tests cannot.

### TEST-4 (LOW) — COLOR_IMPACTING_KEYS exact set is unlocked

`settings-hash.test.ts` proves `image_quality_webp/avif/jpeg` and `image_sizes` each change the hash, but each test passes that key explicitly to `_buildHashForTesting`, so DROPPING a key from the `COLOR_IMPACTING_KEYS` array would not fail any of them. CLAUDE.md documents the set as authoritative ("5 color + 3 quality + 1 size = 9"). The privacy guard has a symmetric `_PrivacySensitiveKeys` contract test; settings-hash should have the equivalent.

**Add** a key-set lock: export `COLOR_IMPACTING_KEYS` for testing (or read it via a `_keysForTesting` helper) and assert `[...COLOR_IMPACTING_KEYS].sort()` equals the expected 9-key array verbatim (`toEqual`), plus `toHaveLength(9)`. Any add/remove forces a deliberate test update + the reviewer's eye on the ETag-invalidation consequence.

### TEST-5 (LOW) — full ETag shape not pinned

`serve-upload.test.ts:74` asserts `^W/"v${IMAGE_PIPELINE_VERSION}-`. CLAUDE.md documents the full formula `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`. The settings-debounce test proves the hash participates but not its position; nothing asserts `{size}` is present or the 4-component order.

**Strengthen** the existing assertion to a full-shape regex: `expect(etag).toMatch(/^W\/"v\d+-\d+-\d+-[0-9a-f]{8}"$/)` — pins 4 hyphen-separated components, the trailing 8-hex settings hash, and that none were dropped/reordered. Cheap; the test already obtains a live ETag.

### TEST-6 (LOW) — withAdminAuth cookie-path reject statuses unpinned

`api-auth.ts` has three reject branches: token wrong-scope→401 (the only one tested, `api-auth-response-headers.test.ts:103`), cookie origin-mismatch→403 (CSRF reject), not-admin→401. The 403 origin-mismatch is the CSRF defense.

**Add** two cases to `api-auth-response-headers.test.ts` (the wrapper is already imported there): (1) cookie path with `hasTrustedSameOrigin`→false (mock it) returns **403** + `no-store` + handler NOT called; (2) same-origin true but `isAdmin`→false returns **401** + `no-store` + handler NOT called. Pins both the CSRF-reject status and the auth-reject status — the lint gate enforces only wrapper PRESENCE.

### TEST-7 (LOW) — settings-client timer cleanup unpinned

The AGG-R7-02 fix (commit `f11746cd`) tracks post-trigger `setTimeout` ids in a ref, clears them in a dedicated unmount effect, and gates `refreshBackfillStatus`'s `setState` behind a `mountedRef`. No test covers it. Low priority because it's a dev-only warning and the test is comparatively expensive (RTL render → trigger backfill → unmount → advance fake timers → assert no `setBackfillStatus` after unmount). If pursued, use `vi.useFakeTimers()` + `@testing-library/react` `render`/`unmount` and spy that the status fetch's resolution post-unmount produces no state write. Acceptable to leave unpinned this cycle given the cost/payoff.

---

## What is genuinely well-covered (no action — recorded so future cycles don't re-flag)

- **Privacy guard** (`privacy-fields.test.ts`): symmetric `SENSITIVE_KEYS` contract — admin-only keys form EXACTLY the sensitive set (`toEqual` both directions), every sensitive key absent from `publicSelectFields`, present in `adminSelectFields`. A new admin-only column that isn't added to both lists fails. Strong.
- **Color-pipeline decision matrix** (`color-pipeline-decision.test.ts`): all 7 decisions covered (sRGB, srgb-from-unknown, p3-from-{displayp3,dcip3,adobergb,prophoto,rec2020}), name variants (case/space/hyphen/underscore), NCLX-signal fallback for opaque custom-monitor names (Eizo/X-Rite/BenQ), and the R7-H1 "opaque name without signal → srgb-from-unknown" path. Exhaustive.
- **Advisory locks** (`advisory-locks.test.ts`): all 5 global `LOCK_*` constants pinned to documented strings, per-image `gallerykit:image-processing:{jobId}` builder, all-distinct + per-image-namespaced-from-globals. Complete.
- **Backfill detection-failure contract** (`backfill-detection-failure-contract.test.ts`): locks the AGG2-01 invariant — detection throwing AFTER a successful encode returns `derivativeOnly` with NO color signals (`result.signals === undefined`), so `pipeline_version` stays behind and the row remains a retry candidate. Plus `admin-backfill-runner-detection-failure.test.ts` (no version bump on detection failure). Strong, matches CLAUDE.md's stated contract.
- **Unicode sanitizers** (`validation.test.ts`, `sanitize-admin-string.test.ts`): bidi-override (U+202A LRE etc.) + zero-width (U+200B, U+FEFF BOM) reject/strip cases on validation, admin-string, and EXIF-Model surfaces, plus the C17-VR-09 cross-file regex-sync guard (`sanitize.ts stripControlChars` ⟺ `validation.ts UNICODE_FORMAT_CHARS`). Negative cases present.
- **Settings-hash participation** (`serve-upload-settings-debounce.test.ts`): the 9-key hash is folded into the ETag and the 5 s debounce works (stale→re-resolve after TTL). Covers the wiring; the gaps above (TEST-4 key-set, TEST-5 full shape) are the residual edges.
- **Migration silent-skip post-condition** (`migration-journal-monotonicity.test.ts`): the `migrate.js` "Drizzle silently skipped N migration(s)" throw + `recordedHashes.has(m.hash)` predicate are source-pinned. Only the cursor-model depth (TEST-2) is missing.

---

## Final sweep — commonly-missed gaps checked

- **Tests that pass for the wrong reason:** `admin-backfill-status-shape.test.ts` is a pure forwarding test (mocks `readAdminBackfillState`, asserts `getBackfillStatus` returns the same values) — pins WIRING, cannot catch a field-VALUE transform. Acceptable today (the action is a pure forward); noted in case a future transform lands there.
- **Flaky/timeout-prone:** the home-metadata-title timeout flake (commit `61607572`, static import) is fixed, but a SECOND timeout-prone test surfaced this pass — `client-server-only-boundary.test.ts` (TEST-0, HIGH, currently RED). Both are the same root cause class: a full-source synchronous walk whose cost has grown past the default 15 s budget. TEST-0's fix should set an explicit timeout AND memoize the file-read/closure traversal so it does not re-rot. Worth a sweep for any other whole-`src`-walk tests on the default timeout (the touch-target audit, source-contract scanners, and check-* lint-fixture tests are candidates — none failed in this run, but they share the growth risk).
- **Negative/malformed-input cases:** bulk-update TriState (4 malformed cases), blur-data-url MIME contract, CSV escape, validation Unicode — all present. No obvious missing malformed-input class found this pass.
- **Over-mocking:** the backfill runner tests drive the REAL `triggerAdminBackfill`/`runBackfill` (fire-and-forget, drained via `vi.waitFor`), not a stubbed runner — good. The detection-failure contract test mocks ONLY `color-detection.detectColorSignals` to throw while using real encode — appropriately surgical.
