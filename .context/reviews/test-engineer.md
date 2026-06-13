# Test-Engineer Review — Run-6 Cycle 1 fan-out

Repo: GalleryKit (Next.js 16 / React 19 / TS6). Test surface: 193 Vitest files in `apps/web/src/__tests__/`, Playwright e2e in `apps/web/e2e/`. Reviewed at HEAD (`bb463062`) + uncommitted working tree.

## Verdict on the plan obligations

The plan progress tables are **STALE**. plan-329 marks all 6 items TODO and plan-330 defers AGG-18, but at HEAD almost all are already implemented (some committed, some in the working tree). The plan-328 "DONE" claims are **all genuine and well-tested** — I ran the 9 plan-targeted test files: **69 tests, 9 files, all pass** (`npx vitest run` on admin-backfill-runner-fatal-counters, admin-backfill-status-shape, admin-backfill-concurrency-cap, migration-journal-monotonicity, bulk-update-images, advisory-locks, upload-paths, api-auth-response-headers, touch-target-audit).

| Plan item | Claimed | Reality at HEAD | Test obligation met? |
|---|---|---|---|
| 328-5 AGG-6 (getBackfillStatus shape + fatal path) | DONE | DONE | **YES** — both files genuine (see TEST-VERIFY-1) |
| 328-6 AGG-7 (migration journal monotonicity) | DONE | DONE | **YES** — passes; weak in one respect (TEST-3) |
| 329-1 AGG-9 (admin error H1 contrast) | TODO | **DONE (uncommitted)** | **NO test** (TEST-1, real gap) |
| 329-2 AGG-10 (home title doubling) | TODO | **DONE (committed)** | **NO test** (TEST-2, real gap) |
| 329-4 AGG-5 (pool-budget formula) | TODO | **DONE (working tree)** | **YES** — concurrency-cap test updated to new formula |
| 329-5 AGG-8 (bulkUpdate TriState guard) | TODO | **DONE (committed) + tested** | **YES** — 4 malformed cases (TEST-VERIFY-2). Plan TODO is wrong. |
| 329-6 AGG-16 (touch-target Link/anchor gate) | TODO | **DONE (committed)** | **YES** — Link/`<a>` patterns + root files scanned (TEST-VERIFY-3). Plan TODO is wrong. |
| 330-d5 AGG-18 (advisory-lock constants + upload-paths) | DEFERRED | **DONE (committed)** | **YES** — all 5 + per-image builder pinned; non-mocked tmpdir upload-paths test. Plan deferral is wrong. |
| 330-d4 AGG-17 (withAdminAuth wrong-scope 403) | DEFERRED | partial | **partial** (TEST-4, deferral justified but imprecise) |

---

## Findings table

| ID | Sev | Conf | File:line | Gap | Risk |
|---|---|---|---|---|---|
| TEST-1 | MED | High | `app/[locale]/admin/(protected)/error.tsx:31-32` | AGG-9 admin error H1 contrast split (sr-only H1 + aria-hidden glyph) has NO regression test; `error-shell.test.ts` only covers global-error helpers | Silent revert of the H1 back to `text-muted-foreground/30` (~1.5:1) accessible name; the exact pre-fix WCAG 1.4.3 defect re-ships unnoticed |
| TEST-2 | MED | High | `app/[locale]/(public)/page.tsx:50,67,112` | AGG-10 `title:{absolute}` fix has NO metadata test; nothing pins single-suffix home title | Layout `title.template` re-doubling (`GalleryKit \| GalleryKit`) regresses silently on any metadata refactor |
| TEST-3 | LOW | Med | `__tests__/migration-journal-monotonicity.test.ts:63-76` | Monotonicity test checks ADJACENT pairs only; does NOT model the real `MAX(created_at)` cursor-poison (idx 8-17 all sit below idx 6's `when` yet pass the adjacent check) | A NEW migration with `when` above its predecessor but below the historical MAX(1778304060000) still gets silently skipped by drizzle; the test passes anyway |
| TEST-4 | LOW | Med | `lib/api-auth.ts:93-98` | Cookie-path origin-mismatch **403** branch + not-admin **401** branch (line 100-106) unpinned; only the token wrong-scope **401** (line 84) is tested | 403→200 origin-check regression (CSRF hole) or 403/401 status drift survives; lint gate only enforces wrapper PRESENCE, not the reject status |
| TEST-5 | MED | High | `lib/admin-backfill-runner.ts:640-665` | No test for a MIXED run (some rows succeed `processed>0` AND some throw `errors>0`); fatal-counters test only covers single-row `processed===0` | A regression overwriting/zeroing `processed` on a fatal, or double-counting a fatal row as processed, survives — re-opening the exact AGG-1 dishonesty class for mixed runs |
| TEST-6 | LOW | Med | `app/actions/admin-backfill.ts:94-102` | `getBackfillStatus()` try/catch (candidate-count throw → which shape?) is unpinned; status-shape test only drives the happy path | A DB error in `getAdminBackfillCandidateCount` could surface an unhandled shape or leak; admin status UI behavior on infra error is unverified |
| TEST-7 | LOW | Med | `app/[locale]/admin/(protected)/settings/settings-client.tsx` (AGG-11) | 8 `aria-describedby` present but no test asserts each settings hint is wired exactly once / no duplicate ids | The 8 newly-wired hints can silently lose `aria-describedby` (WCAG 1.3.1/3.3.2) on refactor; the same blind-spot class as the Badge/select touch-target incidents |
| TEST-8 | LOW | Low | `__tests__/admin-backfill-status-shape.test.ts:27-66` | Forwarding test mocks `readAdminBackfillState` → asserts `getBackfillStatus` returns the same values: pins WIRING (catches a dropped field) but cannot catch a field-VALUE transform bug in the action | A future `getBackfillStatus` that, e.g., clamps `processed` or renames `errors` would pass if it kept the key; low because the action is currently a pure forward |

**Severity counts:** 0 CRITICAL · 0 HIGH · 3 MEDIUM (TEST-1, TEST-2, TEST-5) · 5 LOW (TEST-3, TEST-4, TEST-6, TEST-7, TEST-8).

---

## Detail

### TEST-VERIFY-1 — plan-328 item 5/6 (AGG-6, AGG-7): genuinely met, NOT tautologies
- `admin-backfill-runner-fatal-counters.test.ts:167-203` drives a **real** `triggerAdminBackfill()` through the fire-and-forget runner, makes the per-row `UPDATE images SET` throw `ER_LOCK_DEADLOCK`, drains via `vi.waitFor(() => !readAdminBackfillState().running)`, then asserts `errors>0`, `lastRunHadFailures===true`, `lastError` contains `'Deadlock'`, **`processed===0`**, `encodeFailures===0`, `detectionFailures===0`, `completedRuns>0`. This exercises the real `runBackfill` catch→`errors++`→`state.lastError=` path (runner.ts:646-655) and the final-flush mirror (runner.ts:686-693). It would FAIL against the pre-AGG-1 reconstruction-by-subtraction. Strong.
- `migration-journal-monotonicity.test.ts` passes; allowlists only idx 7, and the real journal data confirms idx 6→7 (`1778304060000`→`1746144000000`) is the sole adjacent inversion. It also source-pins the `migrate.js` throw string `'Drizzle silently skipped'` and the `expectedMigrations.filter((m) => !recordedHashes.has(m.hash))` predicate shape (line 113-119). Good.
- i18n parity for the new `errors` ICU param confirmed: `messages/en.json:769` + `messages/ko.json:769` both carry `{processed}…{errors}…{encodeFailures}…{detectionFailures}`.

### TEST-VERIFY-2 — plan-329 item 5 (AGG-8) is DONE + tested (plan TODO is wrong)
Source `isTriState` helper landed at `app/actions/images.ts:912-919`; `bulk-update-images.test.ts:244-271` has **4** malformed-payload cases against the real action: missing field (`delete input.topic`), non-object (`titlePrefix='oops'`), unknown mode (`{mode:'destroy'}`), set-without-string (`{mode:'set',value:42}`), each asserting `{error:'invalidInput'}` (no throw). Obligation fully met. **Do not re-schedule.**

### TEST-VERIFY-3 — plan-329 item 6 (AGG-16) is DONE (plan TODO is wrong)
`touch-target-audit.test.ts`: `appLevelExtraFiles` (line 59-65) lists `global-error.tsx`, `[locale]/error.tsx`, `not-found.tsx`, `layout.tsx`, `loading.tsx`; the count loop pushes them (`files.push(...appLevelExtraFiles.filter(exists))`, line 613). FORBIDDEN has 8 `<Link>`/`<a>` patterns (line 397-428, string + cn() + arbitrary-`min-h-[<44px]`), and `normalizeMultilineButtonTags` covers `Link|a` (line 545). The admin `error.tsx` `<Link>` carries `min-h-11` so it clears the floor. Verified passing. **Do not re-schedule.**

### TEST-1 (MED) — admin error H1 contrast split is unpinned
The AGG-9 fix in `error.tsx:31-32` (uncommitted) splits the heading into an `aria-hidden` decorative `<span>` + `sr-only <h1 id="admin-route-error-title">`. **No test asserts this structure.** `error-shell.test.ts` exercises only `resolveErrorShellBrand`/`resolveErrorShellThemeClass` (global-error.tsx helpers), not the admin route error component. The plan's own acceptance criterion ("admin error shell has one sr-only H1 ... visible faint glyph is aria-hidden") is unverified.

**Add** `__tests__/admin-error-shell-a11y.test.ts` — source-inspection lock (repo convention, cf. `error-shell.test.ts` global-error block and `wide-gamut-predicate-wiring.test.ts`):
- read `app/[locale]/admin/(protected)/error.tsx`;
- assert the `text-muted-foreground/30` glyph carries `aria-hidden="true"` (regex: `<span[^>]*aria-hidden="true"[^>]*text-muted-foreground\/30`);
- assert exactly one `<h1` with `className="sr-only"` (and NOT `<h1[^>]*text-muted-foreground\/30` — the accessible name must not ride the faint fill);
- assert `aria-labelledby="admin-route-error-title"` still points at the H1 id.
Mirror the same three assertions for the public twin `[locale]/error.tsx` so the parity the comment claims is actually pinned.

### TEST-2 (MED) — home `<title>` single-suffix is unpinned
`page.tsx:50` `const metadataTitle = { absolute: title }` applied at line 67 (og_image early return) + 112 (main). Layout sets `title.template='%s | ${seo.title}'` (`layout.tsx:26`). Nothing tests that the home page opts out of the template. A refactor dropping `absolute` re-doubles to `GalleryKit | GalleryKit` / `#tag | GalleryKit | GalleryKit`.

**Add** `__tests__/home-metadata-title.test.ts`: call the page's `generateMetadata` with (a) no `tag` searchParam and (b) a `tag` searchParam (mock `getSeoSettings`→`{title:'GalleryKit',…}`, `getImagesLite`/data deps). Assert `metadata.title` is `{ absolute: 'GalleryKit' }` (no-filter) and `{ absolute: '#tag | GalleryKit' }` (filtered) — NOT a bare string (which Next would template). Assert `metadata.openGraph.title` / `metadata.twitter.title` remain the plain string (those are not templated). This is the only place the template-doubling is observable without a browser.

### TEST-3 (LOW) — monotonicity test does not model the real cursor bug
`migration-journal-monotonicity.test.ts:63-76` checks each entry vs its **immediate predecessor**. But the production footgun (CLAUDE.md runbook) is the `MAX(created_at)` cursor: drizzle skips any entry whose `when` < the max already-applied `when`. The real journal has idx 8-17 (`1746576000000`-`1747156800000`) ALL below idx 6 (`1778304060000`) — they pass the adjacent-pair check (each advances vs idx 7) yet are exactly the block that would be skipped by a naive MAX baseline. A NEW migration appended with `when` above its predecessor (idx 21 = `1781183604120`) is safe today, but the test gives false confidence that "monotonic vs predecessor" ⟹ "drizzle will apply it", which is FALSE for the historical block.

**Strengthen**: add an assertion that every entry's `when` is also `>` the running `MAX(when)` of all prior entries (a stricter "globally increasing prefix-max" check), with the SAME idx-7 allowlist. This models the actual cursor. Document that idx 8-17 are protected ONLY by the per-entry-hash baselining in `migrate.js`, not by the `when` cursor — and assert `migrate.js` contains the hash-baselining (`baselineAllJournalMigrations` / per-entry hash) so that protection cannot be dropped silently.

### TEST-4 (LOW) — withAdminAuth cookie-path reject statuses unpinned
`api-auth.ts` has THREE reject branches: token wrong-scope→**401** (line 84, the only one tested at `api-auth-response-headers.test.ts:103-123`), cookie origin-mismatch→**403** (line 93-98), not-admin→**401** (line 100-106). The plan-330 deferral ("some prior plan text said 401") conflates these — there genuinely ARE two codes. The deferral reasoning (lint gate enforces wrapper presence) is sound for PRESENCE, but the **403 origin-mismatch return is the CSRF defense** and a regression to 200 / a missing `hasTrustedSameOrigin` guard would be silent.

**Add** two cases to `api-auth-response-headers.test.ts`: (1) cookie path with `hasTrustedSameOrigin`→false (mock it) returns **403** + no-store + handler NOT called; (2) same-origin true but `isAdmin`→false returns **401** + no-store + handler NOT called. Pins both the CSRF-reject status and the auth-reject status. Cheap; the wrapper is already imported in that file.

### TEST-5 (MED) — mixed success+fatal backfill run untested
`runBackfill` mirrors `processed`/`errors` continuously (runner.ts:660-661) and on final flush (686-687). The fatal-counters test covers only ONE row that throws (`processed===0`). There is NO test where, say, 3 rows succeed and 2 throw, asserting final `processed===3 && errors===2 && lastRunHadFailures===true`. This is the realistic production shape (a deadlock on some rows, success on others). A regression that resets `processed` in the catch, or that mis-attributes a thrown row to `processed`, passes the current single-row test.

**Add** to `admin-backfill-runner-fatal-counters.test.ts` (same mock harness): SELECT returns 5 rows; `executeMock` throws on the UPDATE for ids {2,4} and returns `affectedRows:1` for {1,3,5}. After drain assert `s.processed===3`, `s.errors===2`, `s.lastRunHadFailures===true`, `s.lastError` truthy, `s.processed + s.errors === 5`. Drive the runner via `triggerAdminBackfill()` exactly as the existing test does.

### TEST-6 (LOW) — getBackfillStatus infra-error path unpinned
`getBackfillStatus` wraps `getAdminBackfillCandidateCount()` + `readAdminBackfillState()` in try/catch (admin-backfill.ts try at ~line 93). The status-shape test only mocks the happy path. If candidate-count throws (DB down), the catch's return shape is unverified — the admin status disclosure on infra error is untested.

**Add** to `admin-backfill-status-shape.test.ts`: mock `getAdminBackfillCandidateCount` to reject; assert `getBackfillStatus()` returns `{ok:false, …}` with a localized `error` and does NOT throw / leak the raw DB message.

### TEST-7 (LOW) — settings aria-describedby wiring unpinned (AGG-11)
8 `aria-describedby` attributes exist in `settings-client.tsx`, but no test asserts each hint `<p>` has a stable unique id referenced exactly once. This is the identical blind-spot class that drove the Badge (R4C15) and native-select (R4C16) touch-target incidents — a string-attribute association that silently breaks on refactor with no compile error.

**Add** `__tests__/settings-aria-describedby.test.ts` (source-scan, no JSDOM needed): read `settings-client.tsx`, collect every `aria-describedby={…}` value and every `id="…-hint"` (or the project's hint-id convention); assert each referenced id is defined exactly once and each hint id is referenced exactly once (bijection). Mirrors the existing source-inspection test style.

### TEST-8 (LOW) — status-shape forwarding test is value-transparent
`admin-backfill-status-shape.test.ts:27-66` mocks `readAdminBackfillState`→`{processed:2,errors:1,…}` and asserts `getBackfillStatus().processed===2`. This catches a DROPPED field (real value), but cannot catch a value-transform bug because the action is a pure forward today. Acceptable as-is; flagged so a future reader knows it does not guard against a transform regression. No action required unless `getBackfillStatus` gains computation — then add a case where input ≠ output.

---

## Final sweep — no further high-signal gaps found

I cross-checked the broader suite for the anti-patterns in my mandate:
- **No-assert / self-comparison tests**: none found in the reviewed files. The migration, backfill, bulk-update, advisory-lock, upload-paths, and touch-target tests all assert against the real SUT or real fixture data.
- **Over-mocking**: the backfill fatal-counters test mocks heavy deps (sharp, process-image, db) but still drives the real `runBackfill` control flow — the SUT logic (counter mirroring, catch handling) is genuinely exercised, not mocked away.
- **upload-paths non-mocked branch** (plan-330 AGG-18 concern): `upload-paths.test.ts` is a real tmpdir test exercising primary/legacy/both/neither resolution + the warn-vs-throw legacy policy. The deferral's "only mocked" claim is stale — it's now non-mocked. **Do not re-schedule.**
- **advisory-lock constants** (plan-330 AGG-18): all 5 + `getImageProcessingLockName` pinned in `advisory-locks.test.ts`, plus distinctness + namespacing assertions. **Do not re-schedule.**

The strongest residual gaps are the two MED render-contract gaps (TEST-1 admin error H1, TEST-2 home title) — both are fixes that LANDED this cycle with NO test, and both are silent-regression-prone string/structure contracts. TEST-5 (mixed-run backfill) is the third MED: it guards the AGG-1 honesty fix against the realistic mixed-failure shape the single-row test does not cover.
