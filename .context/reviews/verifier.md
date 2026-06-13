# Verifier Report — Run-6 Cycle 1 fan-out (evidence-based)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD at verification:** `8fc403a2 fix(seo): 🐛 stop home title double-suffixing the site name`
(NOTE: HEAD is ONE commit beyond what plan-328's progress table cites; `8fc403a2` is plan-329 Item 2 / AGG-10 — see VER-DISC-1.)
**Method:** ran every gate + targeted vitest contracts myself; read code at HEAD; ignored `.context/reviews/*.md` working-tree edits as input.

---

## Verdict

**Status:** PASS (with documented plan-doc/reality discrepancies — see VER-DISC block)
**Confidence:** high
**Blockers:** 0
**VERIFIED-FALSE discrepancies:** 4 (all are stale plan-329 PROGRESS-table "TODO" markers; the underlying CODE is implemented and correct at HEAD — i.e. the docs understate completion, not overstate it. No DONE claim was found to be false.)

---

## Gate evidence (all re-run by me)

| Gate | Command | Exit | Output summary |
|------|---------|------|----------------|
| ESLint | `npm run lint --workspace=apps/web` | **0** | clean, no error/warning |
| Typecheck | `npm run typecheck --workspace=apps/web` | **0** | typecheck:app (next typegen + tsc tsconfig.typecheck.json) + typecheck:scripts (7 JS files) both clean |
| API-auth | `npm run lint:api-auth --workspace=apps/web` | **0** | 2 admin routes OK |
| Action-origin | `npm run lint:action-origin --workspace=apps/web` | **0** | 44 actions checked; all mutating return early on `requireSameOriginAdmin`; 8 read-only SKIP (exempt) |
| Public-route rate-limit | `npm run lint:public-route-rate-limit --workspace=apps/web` | **0** | 8 public routes OK |
| Full vitest | `npm test --workspace=apps/web` | 1* | 2025 passed / 1 failed (`client-server-only-boundary.test.ts` TIMEOUT only) |
| Same test, isolated | `npx vitest run src/__tests__/client-server-only-boundary.test.ts` | **0** | 2 passed in 2.20s |

\* **The single full-suite failure is an environmental flake, NOT a real failure** — see VER-FLAKE-1. The orchestrator's "lint exit 0 + typecheck exit 0" measurement is CONFIRMED.

---

## Claims × verdicts

| ID | Source claim | Verdict | Conf | Evidence (file:line) |
|----|--------------|---------|------|----------------------|
| VER-1 | p328 Item 1 (AGG-2): lint gate resolved; mount fetch has cancelled-guard, no setState-in-effect; dead import dropped | **VERIFIED-TRUE** | high | `settings-client.tsx:91-105` inline async IIFE + `let cancelled` guard before `setBackfillStatus`; `photo-title.ts:2` imports only `stripStubPrefix`; `npm run lint` exit 0 |
| VER-2 | p328 Item 2 (AGG-1): runner mirrors real `processed`+`errors` into state, sets `lastError` in fatal catch, UI/getBackfillStatus render real counters (not subtraction) | **VERIFIED-TRUE** | high | runner `admin-backfill-runner.ts:154,163,207-208,221-222,558-559,657-658,688-689`; fatal catch sets `state.lastError` `:652`; `getBackfillStatus` exposes `processed`/`errors` `admin-backfill.ts:109-110`; UI reads `backfillStatus.processed` `settings-client.tsx:286,295`; subtraction reconstruction grep = NONE |
| VER-3 | p328 Item 4 (AGG-4): both `sanitizeForOg` use the GLOBAL strip | **VERIFIED-TRUE** | high | OG route `og/photo/[id]/route.tsx:63` `stripUnicodeFormatting(value) ?? ''` + C0 strip; `p/[id]/page.tsx:43` `stripUnicodeFormatting(value) ?? ''`; helper is `/g` (`validation.ts:92` `UNICODE_FORMAT_CHARS_GLOBAL`, used at `:99`) |
| VER-4 | p328 Items 5/6: backfill-status-shape + migration-journal-monotonicity tests exist and pass | **VERIFIED-TRUE** | high | files present: `admin-backfill-runner-fatal-counters.test.ts`, `admin-backfill-status-shape.test.ts`, `migration-journal-monotonicity.test.ts`; ran all 3 → 8 passed |
| VER-5 | Working tree: admin `error.tsx` AGG-9 a11y split correct; touch-target/a11y green | **VERIFIED-TRUE** | high | `error.tsx:29` decorative `<span aria-hidden ...muted-foreground/30 block>` + `:30` `<h1 ...sr-only>`; `aria-labelledby` still points at H1 `:21`; matches public twin `[locale]/error.tsx:18-19`; touch-target-audit 11 passed |
| VER-6 | Working tree: `resolveBackfillConcurrency` new formula + updated test pass | **VERIFIED-TRUE** | high | runner `:134` `cap=max(1,floor((limit-reserved-1)/2))`, `reserved=max(3,ceil(poolLimit/2))` `:100-101`; header no longer says "1 free is sufficient" `:91-122`; `admin-backfill-concurrency-cap.test.ts` pins cap=2@limit10 `:45`; 8 passed |
| VER-7 | p329 Item 2 (AGG-10) marked TODO — is it still unimplemented? | **VERIFIED-FALSE (already DONE)** | high | `page.tsx:50` `const metadataTitle = { absolute: title } as const;` used in both returns `:67,:112`; OG titles kept plain `:117,:128`; landed in HEAD commit `8fc403a2` |
| VER-8 | p329 Item 3 (AGG-11) marked TODO — still unimplemented? | **VERIFIED-FALSE (already DONE)** | high | 8 `aria-describedby` in `settings-client.tsx` (`:368,386,402,418,532,564,592,625`); each target id defined exactly once (no dupes) |
| VER-9 | p329 Item 5 (AGG-8) marked TODO — still unimplemented? | **VERIFIED-FALSE (already DONE)** | high | `images.ts:907-913` `isTriState` shape guard; `:914-916` returns `t('invalidInput')` on malformed payload BEFORE any `.mode` deref; `bulk-update-images.test.ts` green |
| VER-10 | p329 Item 6 (AGG-16) marked TODO — still unimplemented? | **VERIFIED-FALSE (already DONE)** | high | `touch-target-audit.test.ts:59-65` `appLevelExtraFiles` (global-error/error/not-found/layout/loading); `<Link>`/`<a>` FORBIDDEN patterns `:397-428`; synthetic `<Link className="h-8">` negative fixtures `:711-718` asserted to match `:719-722`; 11 passed |
| VER-11 | p328 Item 3 (AGG-3) DONE — EXIF Unicode source strip (cleanMetadataString + applyAltSuggested) | **VERIFIED-TRUE** | medium-high | both halves present at HEAD (import + use of the strip helper in `process-image.ts cleanMetadataString` and the `images.ts applyAltSuggested` copy); existing suite green. No fresh dedicated fixture re-run beyond the suite. |
| VER-DISC-1 | plan-329 PROGRESS table: all 6 items "TODO" | **VERIFIED-FALSE (table stale)** | high | AGG-8/9/10/11/16 all implemented at HEAD; only the progress markers are stale, the work is real |
| VER-FLAKE-1 | full `npm test` shows 1 failing test | **environmental flake, not a defect** | high | `client-server-only-boundary.test.ts:120` timed out @15s under full-suite parallel load; isolated run passes in 2.20s; touches no changed file |

---

## Evidence sections

### AGG-2 (p328 Item 1) — lint gate + mount fetch + dead import — VERIFIED-TRUE
- The mount effect inlines the fetch in its own async IIFE with a `cancelled` flag and gates `setBackfillStatus` behind both the `await` and `!cancelled` (`settings-client.tsx:91-105`). The `refreshBackfillStatus` `useCallback` (`:82-90`) is NOT what the effect calls — it is invoked only in event-handler context (`handleBackfill`, `:141-143`), where direct setState is allowed. (Minor nuance vs. plan prose, which said the effect calls `refreshBackfillStatus` with a guard — the actual implementation is an independent inline fetcher. The eslint-satisfying outcome and on-mount behavior are identical → descriptive drift, not a defect; see VER-NUANCE-1.)
- `photo-title.ts:2` = `import { stripStubPrefix } from '@/lib/caption-constants';` — `ALT_TEXT_STUB_PREFIX_RE` is gone.
- `npm run lint` exit **0**.

### AGG-1 (p328 Item 2) — backfill honesty — VERIFIED-TRUE (end-to-end)
1. `AdminBackfillState` has `processed` (`:154`) and `errors` (`:163`); init 0 in `getState()` (`:207-208`); defensive `??=` backfill (`:221-222`); `_resetAdminBackfillStateForTesting` lists both (`:248-249`); reset to 0 at run start (`:558-559`).
2. Continuous-mirror block writes `state.processed = processed; state.errors = errors;` (`:657-658`) and the final flush (`:688-689`).
3. Fatal catch (`:642-654`) increments `errors++` AND sets `state.lastError = err.message` (`:652`) — fixing the exact gap (plan claim 3). The encode-failed branch sets `lastError` too (`:634-635`).
4. `hadFailures = encodeFailures>0 || detectionFailures>0 || errors>0` (`:697`). `readAdminBackfillState()` returns `processed`/`errors` (`:269-270`). `getBackfillStatus()` exposes them (`admin-backfill.ts:109-110`) on the extended `BackfillStatusResult` (`:83-84`).
5. UI renders `backfillStatus.processed` directly in both clean (`settings-client.tsx:295`) and with-failures (`:286`) lines; `errors` is in the with-failures ICU call (`:287`); `lastError` rendered (`:308-311`). The old `max(0, lastQueuedCount − encodeFailures − …)` reconstruction is GONE (grep = none).
6. i18n parity: `backfillLastRunWithFailures` carries `{errors}` in BOTH `messages/en.json:769` and `messages/ko.json:769`.

### AGG-3 (p328 Item 3) — EXIF Unicode source strip — VERIFIED-TRUE
Both halves present at HEAD (plan marked DONE "verified at HEAD" — confirmed): `process-image.ts cleanMetadataString` global-strips Unicode format chars after the NUL strip (via the `@/lib/validation` strip helper); `images.ts applyAltSuggested` runs the copied string through the same strip before `tx.update()`. Severity MED/security; evidence static + suite-backed (suite green) → VERIFIED-TRUE at medium-high confidence.

### AGG-4 (p328 Item 4) — sanitizeForOg global — VERIFIED-TRUE
Both call sites switched to `stripUnicodeFormatting(...) ?? ''`. The helper builds `new RegExp(UNICODE_FORMAT_CHARS.source, 'g')` (`validation.ts:92`) — a genuinely global twin derived from the canonical source (no drift), so it replace-alls. OG route preserves the additional `OG_C0_CONTROL_CHARS` strip (`route.tsx:63`). Cross-reference comments updated in both files.

### AGG-9 (p329 Item 1, working tree) — admin error H1 contrast — VERIFIED-TRUE
Diff replaces the single faint `<h1 ...muted-foreground/30>` with `<span aria-hidden="true" ...muted-foreground/30 block>` + `<h1 ...sr-only>`, structurally identical to the public twin. `aria-labelledby="admin-route-error-title"` resolves to the sr-only H1. The pre-existing false-parity comment was corrected to describe the real split. (NOTE: plan-329 progress marks this TODO, but the working tree implements it correctly.)

### AGG-5 / concurrency (p329 Item 4, working tree) — VERIFIED-TRUE
New formula `cap = max(1, floor((limit − reserved − 1)/2))`, `reserved = max(3, ceil(poolLimit/2))`. At limit 10 → reserved 5 → cap 2 (down from 4). Clamp-DOWN warning retained (`:585-590`). Test pins: cap=2@limit10 (`:45`), pass-through ≤cap (`:51-52`), floor≥1 on 0/neg/NaN (`:56-58`), reserved-headroom invariant `limit − (1+2·cap) ≥ reserved` (`:67-74`), small-pool floor to 1 (`:78-82`), scale-up at limit 20 → cap 4 (`:87-88`), default-limit cap 2 (`:91-92`). 8 passed.

### AGG-10 / AGG-11 / AGG-8 / AGG-16 (p329 Items 2,3,5,6) — VERIFIED-FALSE-as-TODO (i.e. DONE)
All four implemented at HEAD despite the plan-329 progress table marking them TODO:
- **AGG-10**: `metadataTitle = { absolute: title }` opts the home page out of the layout `%s | ${seo.title}` template; both branches compute the suffix once (`title = #tag | seo.title` filtered, `= seo.title` no-filter). OG/Twitter titles kept as the plain string. Committed as `8fc403a2`.
- **AGG-11**: 8 hint ids wired via `aria-describedby`; each id defined exactly once.
- **AGG-8**: `isTriState` discriminated-shape guard (`{mode:'leave'|'clear'}` or `{mode:'set', value:string}`) placed after the `ids`/tag validation and before any `.mode` deref; malformed → `invalidInput`.
- **AGG-16**: root `app/[locale]` files added via `appLevelExtraFiles`; `<Link>`/`<a>` patterns + multi-line normalization in FORBIDDEN; 7 synthetic anchor fixtures asserted to trip the regex.

---

## Acceptance Criteria (per-plan-item)

| Plan item | Acceptance criterion | Status | Evidence |
|-----------|----------------------|--------|----------|
| p328-1 (AGG-2) | lint exit 0; typecheck green; fetch-on-mount + no setState-after-unmount | VERIFIED | lint 0, typecheck 0, cancelled-guard `:91-105` |
| p328-2 (AGG-1) | fatal-only run → `errors>0`, `processed`=real, `lastError` populated; 11 backfill tests green; i18n parity | VERIFIED | fatal-counters + status-shape tests green; en/ko `{errors}` parity |
| p328-3 (AGG-3) | caption stub AND copied title contain no bidi/zero-width | VERIFIED (suite-backed) | both source strips present; suite green |
| p328-4 (AGG-4) | both sanitizeForOg strip ALL bidi+ZWSP | VERIFIED | global helper both sites |
| p328-5 (AGG-6) | getBackfillStatus shape + non-zero failure path test | VERIFIED | status-shape + fatal-counters tests present & green |
| p328-6 (AGG-7) | journal monotonicity + post-condition assertion test | VERIFIED | migration-journal-monotonicity.test.ts green |
| p329-1 (AGG-9) | one sr-only H1 + aria-hidden glyph; a11y/touch green | VERIFIED | working-tree diff + touch-target green |
| p329-2 (AGG-10) | home `<title>` single suffix both branches | VERIFIED (DONE, doc says TODO) | `{absolute}` both returns |
| p329-3 (AGG-11) | every hinted field has aria-describedby; no dup ids | VERIFIED (DONE, doc says TODO) | 8 wired, 8 unique ids |
| p329-4 (AGG-5) | new formula cap=2@limit10; floor≥1; header no false claim | VERIFIED | runner + test |
| p329-5 (AGG-8) | malformed TriState → invalidInput, no throw; existing tests green | VERIFIED (DONE, doc says TODO) | isTriState guard + bulk-update test green |
| p329-6 (AGG-16) | root files + anchor patterns scanned; synthetic fail; suite green | VERIFIED (DONE, doc says TODO) | appLevelExtraFiles + Link/a patterns + fixtures |

---

## Gaps / discrepancies (findings)

- **VER-DISC-1 (plan hygiene, not a code defect)** — Risk: medium — plan-329's PROGRESS table lists all 6 items as TODO, but AGG-8, AGG-9, AGG-10, AGG-11, AGG-16 are implemented and test-backed at HEAD. The plan doc was never updated post-implementation. The discrepancy is doc-understates-reality (safe direction), but it WILL mislead the next cycle into re-doing closed work or mis-judging coverage. Suggestion: update the plan-329 progress table (and any plan-330 coverage reference) to reflect HEAD, citing commit `8fc403a2` for AGG-10 and "working-tree" for AGG-9 + concurrency.
- **VER-FLAKE-1 (test infra)** — Risk: low — `client-server-only-boundary.test.ts:120` (a recursive `src/` import-boundary scan) intermittently times out at the 15 000 ms default under full-suite parallel load (full run took 133 s wall / 416 s cumulative import). Passes in 2.20 s in isolation. Not tied to any changed file. Suggestion: raise that test's per-test `testTimeout` (e.g. 60 000 ms) so a slow CI host doesn't flag a false failure at cycle close.
- **VER-NUANCE-1 (descriptive, not a defect)** — Risk: none — plan-328 Item 1's prose says the mount effect calls `refreshBackfillStatus()` behind a cancelled-guard; the actual code inlines a separate fetcher in the effect and reserves `refreshBackfillStatus` for event-handler use. Behavior and lint outcome are identical. No action required beyond awareness.

---

## Recommendation

**APPROVE.** Every plan-328 DONE claim (Items 1-6) is VERIFIED-TRUE against code AND fresh command output; all five blocking gates are exit 0; the working-tree partial work (admin error.tsx AGG-9 split, concurrency new-formula + test) is correct and green. The only failing full-suite test is a confirmed environmental timeout flake (passes isolated). The four "VERIFIED-FALSE" entries are stale plan-329 TODO markers where the code is in fact implemented and test-backed — a documentation-hygiene gap in the safe direction, not a correctness or completion defect. Update the plan-329 progress table before cycle close so coverage accounting stays honest.
