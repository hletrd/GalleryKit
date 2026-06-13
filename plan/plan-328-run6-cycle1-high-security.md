# Plan 328 — HIGH + security + blocking-gate fixes (Run-6 Cycle 1)

**Source:** `.context/reviews/_aggregate.md` (run-6 cycle-1 fan-out, 11 agents).
**Commit discipline:** GPG-signed (`git commit -S`), Conventional Commits + gitmoji, one commit per item, `git pull --rebase` then push after each, full gate run before cycle close. No `--no-verify`, no force-push.

These are the must-fix-this-cycle items: one blocking ESLint gate failure, one HIGH correctness regression introduced by the prior cycle's own honesty fix, and two security-class (NOT deferrable) Unicode-sanitizer findings, plus the test obligations that pin them.

---

## Item 1 — AGG-2: unblock the ESLint gate + drop dead import (HIGH gate · live-verified · 3 agents)

- **Sources:** VER-1 (verifier, confirmed via live `npm run lint` exit 1), debugger (root-caused both, empirically verified fix against the live linter), test-engineer.
- **Where:**
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:78-89` — `refreshBackfillStatus` (useCallback that calls `setBackfillStatus`) invoked synchronously as `void refreshBackfillStatus()` inside `useEffect`; `eslint-plugin-react-hooks@7.0.1` follows the call graph into the callback and flags `react-hooks/set-state-in-effect`.
  - `apps/web/src/lib/photo-title.ts:2` — `ALT_TEXT_STUB_PREFIX_RE` imported but only referenced in a comment (`stripStubPrefix` uses it internally); unused-var warning.
- **Change:**
  1. Refactor the mount-fetch so the callback is a PURE async fetcher that RETURNS `BackfillStatusResult | null` (no setState inside it). In the `useEffect`, call it and set state inside a `.then()` guarded by a `let cancelled = false` cleanup flag (`return () => { cancelled = true }`). This satisfies the rule WITHOUT changing fetch-on-mount behavior and ALSO fixes AGG-15 (the unmount setState-on-dead-tree leak). The post-trigger polls (`handleBackfill`'s two `setTimeout(refreshBackfillStatus, …)`) call the same fetcher and gate their setState on the same `cancelled` flag; collect the timeout ids and `clearTimeout` them in the effect cleanup.
  2. Remove `ALT_TEXT_STUB_PREFIX_RE` from the `photo-title.ts:2` import, keep `stripStubPrefix`.
- **NO suppression.** Root-cause fix only.
- **Acceptance:** `npm run lint --workspace=apps/web` exits 0 (no error, no warning). `npm run typecheck` stays green. Manual reasoning: status still fetched on mount + after trigger; no setState after unmount.

## Item 2 — AGG-1: backfill last-run summary must report REAL processed + surface fatal `errors` (HIGH correctness · 5 agents · regression)

- **Sources:** COR-1, CRT-1, VER-2 (HIGH), TRC-1 (MED), TRC-5 (LOW) — strongest cross-agent agreement this cycle.
- **Where:**
  - `apps/web/src/lib/admin-backfill-runner.ts` — `runBackfill` has function-local `processed`/`errors`; `errors` (fatal catch ~line 593) is NEVER mirrored to `AdminBackfillState`, and `state.lastError` is set only on the `encode-failed` branch (~line 583), not in the fatal catch.
  - `apps/web/src/app/actions/admin-backfill.ts:64-103` — `getBackfillStatus` returns the counters but not `processed`/`errors`.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:263-272` — reconstructs `processed = max(0, lastQueuedCount − encodeFailures − detectionFailures − skippedMissingOriginal − skippedLocked)`, which (a) drops `errors` and (b) uses the pre-run candidate snapshot `lastQueuedCount`.
- **Failure scenario:** a run where every row's version-bump `db.execute` UPDATE throws (deadlock / lock-timeout / conn-drop) → `errors=N`, `encodeFailures=detectionFailures=0`. UI renders the with-failures banner: "N re-encoded, 0 encode failures, 0 detection failures", no error line. Reports success AND failure at once. This is the exact dishonesty AGG-R5C3-04 (plan-325 item 1) was built to remove.
- **Change:**
  1. Add `processed: number` and `errors: number` (and keep `lastQueuedCount`) to `AdminBackfillState`; init both 0 in `getState()` + the `??=` defensive backfill + reset to 0 at run start.
  2. Mirror the runner's `processed` and `errors` locals into `state.processed` / `state.errors` in the same continuous-mirror block that already updates `state.skippedMissingOriginal` etc. (and in the final tally block).
  3. Set `state.lastError` in the fatal catch too (so a fatal-only run has an error message), not just on encode-failed.
  4. Include `errors` in the `hadFailures` computation (already does) AND expose `processed` + `errors` from `getBackfillStatus()` (extend `BackfillStatusResult`).
  5. UI: render `processed` from `backfillStatus.processed` (the REAL counter), and add `errors` to the with-failures line ("N re-encoded, E fatal errors, X encode failures, Y detection failures"); add a new `serverActions.settings.backfillLastRunWithFailures` ICU param `errors` in `messages/en.json` + `messages/ko.json`. Keep the existing skip line + error line.
- **Acceptance:** unit test (Item 5) covering a fatal-error-only run → `getBackfillStatus()` exposes non-zero `errors`, `processed` reflects the real successful count (not the candidate snapshot), and `lastError` is populated. Existing 11 backfill tests stay green. i18n key parity preserved (en/ko both gain `errors`).

## Item 3 — AGG-3: EXIF caption Unicode bidi/zero-width sanitizer at the source (MED security · 2 agents · NOT deferrable)

- **Sources:** SEC-N2 (security-reviewer), CRT-2 (critic). = plan-325 item 3 / SEC-R5C3-01, still unimplemented.
- **Where:** `apps/web/src/lib/process-image.ts` `cleanMetadataString` (~line 565, currently NUL-strip only); `apps/web/src/app/actions/images.ts` `applyAltSuggested` copy (~line 986, persists into `images.title`).
- **Change:** import `stripUnicodeFormatting` (or apply `UNICODE_FORMAT_CHARS_GLOBAL`) from `@/lib/validation`; in `cleanMetadataString`, after the NUL strip, global-replace the Unicode format chars (source defense covering ALL EXIF strings incl. `camera_model`, `lens_model`, `Model`). Belt-and-braces: run the applyAltSuggested copied string through the same strip before `tx.update()` (skip rows stripping to empty — guard already exists).
- **Acceptance:** regression fixture feeding a `Model`/title string laden with U+202E + two U+200B → stored caption stub AND the copied `images.title` contain NEITHER bidi nor zero-width chars. Per CLAUDE.md "Security … NOT deferrable" — this is SCHEDULED, not deferred.

## Item 4 — AGG-4: `sanitizeForOg` must use the GLOBAL strip (LOW security · confirmed · NOT deferrable)

- **Source:** SEC-N1 (security-reviewer, confirmed: `UNICODE_FORMAT_CHARS` at `validation.ts:58` is non-global).
- **Where:** `apps/web/src/app/api/og/photo/[id]/route.tsx:30-31` and `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:36-37` — both do `value.replace(UNICODE_FORMAT_CHARS, '')`; non-global `.replace()` strips only the FIRST bidi/zero-width char → 2nd+ survive into the public OG card text and JSON-LD structured data.
- **Change:** switch both `sanitizeForOg` bodies to `stripUnicodeFormatting(value) ?? ''` (the global twin at `validation.ts:92`); keep the OG route's additional `OG_C0_CONTROL_CHARS` strip after it. Update the cross-reference comment in `p/[id]/page.tsx:34` accordingly.
- **Acceptance:** fixture feeding a two-bidi-char + two-ZWSP string → both `sanitizeForOg` outputs strip ALL of them. Security-class — SCHEDULED.

## Item 5 — AGG-6: test obligation — `getBackfillStatus()` shape + non-zero failure path (HIGH test · 2 agents)

- **Sources:** TEST-1 (test-engineer), VER (partial). plan-325 item-1's stated test obligation, currently UNMET. (NOTE: `resolveBackfillConcurrency` IS already tested — `admin-backfill-concurrency-cap.test.ts`; do not duplicate that.)
- **Change:** add a unit test (new or extend `__tests__/admin-backfill-*.test.ts`) that:
  - asserts `getBackfillStatus()` returns the extended shape including `processed`, `errors`, `encodeFailures`, `detectionFailures`, `skippedMissingOriginal`, `skippedLocked`, `lastRunHadFailures`, `lastError` (mock `isAdmin` true + the runner state).
  - drives a runner run where the per-row UPDATE throws for every row (fatal path) → asserts `errors > 0`, `lastRunHadFailures === true`, `lastError` populated, and `processed` is the REAL count (0 here), NOT the candidate snapshot.
- **Acceptance:** new test fails against the pre-Item-2 code (reconstruction-by-subtraction) and passes after; full suite green via `npx vitest run`.

## Item 6 — AGG-7: test obligation — migration journal monotonicity + post-condition assertion (HIGH test)

- **Source:** TEST-2 (test-engineer; a real idx-7 `when` inversion exists in `_journal.json`, and CLAUDE.md documents the burned-once silent-skip footgun, but nothing pins it).
- **Where:** `apps/web/drizzle/meta/_journal.json`; `apps/web/scripts/migrate.js` post-condition logic.
- **Change:** add a fixture test (`__tests__/migration-journal-monotonicity.test.ts` or similar) asserting:
  1. journal `when` values are strictly increasing by `idx` — EXCEPT for an explicit, commented allowlist of the known historical inversions (so the test documents them rather than failing on legacy state); a NEW entry that is non-monotonic and not allowlisted FAILS.
  2. the `migrate.js` post-condition logic throws (`Drizzle silently skipped …`) when a journal hash is absent from the applied set — unit-test the pure assertion function with a synthetic "missing hash" input.
- **Acceptance:** test green at HEAD with the documented allowlist; adding a synthetic non-monotonic new entry (in the test's own fixture, not the real journal) trips the assertion; the post-condition function throws on a missing-hash fixture. Run `npm run typecheck` (test-file type errors only surface there) before commit.

---

## Progress

| # | Finding | Commit | Status |
|---|---|---|---|
| 1 | AGG-2 (lint gate + AGG-15 leak) | 5b5de9d3 | DONE (landed by concurrent run-5 c3 ralph before this cycle's impl; verified ESLint exit 0) |
| 2 | AGG-1 (backfill honesty) | 13ae79ca | DONE |
| 3 | AGG-3 (EXIF Unicode source) | (run-5 c3 commit) | DONE (both halves — cleanMetadataString + applyAltSuggested — already landed; verified at HEAD) |
| 4 | AGG-4 (sanitizeForOg global) | 170297ed | DONE |
| 5 | AGG-6 (getBackfillStatus test) | 13ae79ca | DONE (admin-backfill-runner-fatal-counters + admin-backfill-status-shape) |
| 6 | AGG-7 (migration journal test) | bb463062 | DONE |

**Cycle note:** items 1 and 3 were resolved by the concurrent run-5 cycle-3 ralph loop's commits (`5b5de9d3` for the lint gate, the EXIF source-strip for AGG-3) before this run-6 cycle-1 implementation phase began. Verified each is genuinely present at HEAD rather than assumed. Items 2, 4, 5, 6 are this cycle's work.
