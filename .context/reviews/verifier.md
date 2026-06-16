# Verifier — Deep Review (run 6 / cycle 4 / HEAD f8147868)

**HEAD:** `f814786881d91ddf4245397429d8b580c788317e`
**Date:** 2026-06-16
**Role:** evidence-based correctness verification of the repo's most load-bearing
behavioral CLAIMS (CLAUDE.md + prior-cycle fix commits) against the actual code
and tests at HEAD. Honest convergence is valid — no findings manufactured.

## Verdict

**Status**: PASS
**Confidence**: high
**Blockers**: 0

All 10 load-bearing behavioral claims VERIFIED against current code. 0 CONTRADICTED,
0 INCONCLUSIVE. One benign comment-drift NIT in `switch.tsx` (does not affect
behavior; geometry is correct). The Stripe async gap is VERIFIED-with-nuance
exactly as the prior cycle found (gap real, operationally closed by card-only pin).

### Cycle context
HEAD f8147868 is the cycle-3 wrap commit; all 8 cycle-3 scheduled fixes landed
(switch geometry `a3b8c557`, sidecar exit code `a033056d`, histogram contrast
`60c54346`, settings-hash/ETag docstrings `f603cd3f`, Stripe cross-ref `22d02262`,
color-detection re-export drop `0ef29a10`, topic-image tmpdir isolation `06a3c5e7`).
Working tree CLEAN. The two fixes the prompt calls out (`a3b8c557`, `a033056d`)
are the primary new verification targets this cycle.

## Fresh Evidence (test runs at HEAD f8147868)

| Batch | Command (cwd apps/web) | Result |
|-------|------------------------|--------|
| Batch 1 (UI/backfill/CLIP/privacy/CSV/blur) | `npx vitest run --no-file-parallelism touch-target-audit backfill-color-pipeline admin-backfill-runner-detection-failure semantic-route-production semantic-search-mode-validator privacy-fields csv-escape blur-data-url process-image-blur-wiring images-action-blur-wiring` | **11 files, 89 tests passed** |
| Batch 2 (rate-limit/locks/migrate/stripe/SQL) | `npx vitest run --no-file-parallelism auth-rate-limit advisory-locks migrate-reconcile-coverage migrate checkout-route stripe data-tag-names-sql` | **9 files, 137 tests passed** |
| Typecheck gate (compile-time privacy guards) | `npx tsc --noEmit -p tsconfig.typecheck.json` | **exit 0 (clean)** |
| **TOTAL** | 20 claim-relevant test files + full typecheck | **226 tests passed, 0 failed; typecheck clean** |

The `tsc -p tsconfig.typecheck.json` clean exit is the gating mechanism for the
three compile-time guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`)
— they are real type-level assertions, so a leak would fail this command, not a
runtime test. (stderr fixture diagnostics in the backfill batch — `[admin-backfill]
detection failed`, `[verify-avif] no NCLX colr box` — are intentional, not failures.)

---

## Claim-by-Claim Verification

| # | Claim | Verdict | Evidence (file:line + test) |
|---|-------|---------|------------------------------|
| 1 | Switch thumb travels edge-to-edge (fix `a3b8c557`) — geometry actually correct | **VERIFIED** | `ui/switch.tsx:26,36,41-49` + `touch-target-audit` green |
| 2 | Sidecar backfill exits non-zero on all-detection-failure (fix `a033056d`) | **VERIFIED** | `backfill-color-pipeline.ts:439,464,470,485` + `admin-backfill-runner-detection-failure` green |
| 3 | CLIP `semantic_search_mode` heals `production`→`disabled` unless env override | **VERIFIED** | `gallery-config.ts:129-147` + semantic tests green |
| 4 | `publicSelectFields` omits all `_PrivacySensitiveKeys`; compile-time guard holds | **VERIFIED** | `data.ts:416-421,431-433,449-451` + `tsc` exit 0 + `privacy-fields` green |
| 5 | Advisory locks serialize as documented | **VERIFIED** | `advisory-locks.ts:19,22,25,34,41,44` + `advisory-locks` green |
| 6 | Migration post-condition fails loud on skipped journal hashes | **VERIFIED** | `migrate.js:698-718` over full journal (`:750/:760`) + `migrate*` green |
| 7 | Blur-data-url contract enforced at producer + write + read | **VERIFIED** | `process-image.ts:895`, `images.ts:352`, `photo-viewer.tsx:196` + blur tests green |
| 8 | CSV escape strips formula + bidi + zero-width + C0/C1 | **VERIFIED** | `csv-escape.ts:44,54,55,60-62` + `validation.ts:58` + `csv-escape` green |
| 9 | Stripe webhook does NOT grant on async_payment_succeeded; checkout pins card-only | **VERIFIED (nuance)** | webhook `:88,105`; checkout `:207` card-only + `checkout-route`/`stripe` green |
| 10 | Touch-target audit catches multi-line tags, Badge, select | **VERIFIED** | `touch-target-audit.test.ts:396-441,561-600` + green |

### CLAIM 1 — Switch thumb edge-to-edge (fix `a3b8c557`) — VERIFIED (High)

The prompt's explicit demand: confirm geometry is *actually* correct, not "looks
fixed." Box-model math at HEAD (`ui/switch.tsx`):
- Root (hit area): `min-h-11 min-w-11` = 44px → touch-target floor preserved (audit green, `:143` declares 0 violations).
- Visible track (`:36`): `h-6 w-11` (24×44px) with `px-0.5` (2px each side) → **content box = 40px wide**.
- Thumb (`:48`): `size-5` = 20px; `translate-x-0` unchecked → `data-[state=checked]:translate-x-full` checked (`:49`).
- Tailwind `translate-x-full` = `translateX(100%)` relative to the **element's own width** (20px). Unchecked thumb occupies [0,20] (flush left padding edge); checked occupies [20,40] (flush right padding edge). **Travel is exactly edge-to-edge — no residual gap, no half-on state.** The cycle-3 defect (20px thumb + fixed 20px travel inside a 44px track → never reached either edge) is genuinely resolved.
- Inner track color keys off Root via `group-data-[state=checked]:bg-primary` (`:38`) — Root carries `group` (`:26`); Radix sets `data-state` on Root. Correct.

**NIT (cosmetic, non-blocking):** the file comment (`:14`) and commit message
describe the travel as `translate-x-[calc(100%-2px)]`, but the actual code is
`translate-x-full` (`:49`). The CODE value is the mathematically correct one
(`calc(100%-2px)` would *under*-travel by 2px); the comment is stale aspirational
text. Behavior is correct; only the comment drifted. Not a defect — recorded for
honesty.

### CLAIM 2 — Sidecar exits non-zero on all-detection-failure (fix `a033056d`) — VERIFIED (High)

`backfill-color-pipeline.ts`:
- `:439` `detectionFailures++` in the `result.derivativeOnly` branch (encode succeeded, color detection threw, `pipeline_version` deliberately NOT bumped so the row stays a backfill candidate).
- `:453` progress line includes `detectionFailures=`; `:464` Done summary includes it; `:470` emits a loud `console.warn` WARNING when `> 0`.
- `:485` `process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0)` — a run where every row's detection failed (no `pipeline_version` advanced) now returns exit 1, so a CI/cron wrapper keying on exit code no longer sees false green. The resume contract is unchanged (still no version bump on detection failure — correct for the common transient case). `reprocessRow`'s return shape is untouched, so `backfill-color-pipeline.test.ts` (column-set lock) still passes. Both the column-set test and `admin-backfill-runner-detection-failure.test.ts` are green.

### CLAIM 3 — CLIP heal (HARD GUARD honored) — VERIFIED (High)

`gallery-config.ts:129-147`: invalid/unknown → `DEFAULTS.semantic_search_mode`
('disabled', `:132`); a stored `'production'` returns `'disabled'` UNLESS
`process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] === 'true'` (`:143-145`). Exactly
the documented heal. I am verifying the disable is correct — **NOT** proposing
activation. `semantic-route-production` + `semantic-search-mode-validator` green.

### CLAIM 4 — Privacy compile-time guards hold — VERIFIED (High)

`data.ts`: canonical `PrivacySensitiveKeys` union (`:416`, 21 keys incl.
latitude/longitude/filename_original/user_filename + all color/HDR audit columns).
Three real type-level assertions:
- `_privacyGuard` (`:420-421`): `Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys> extends never ? true : [..., 'ERROR...']` assigned `= true` — a leak yields a non-`never` Extract, the conditional resolves to the error tuple, `= true` fails to assign → **tsc error**.
- `_mapPrivacyGuard` (`:431-433`): same mechanism over `Exclude<…,'latitude'|'longitude'>` (map allowed exactly GPS, nothing else).
- `_largePayloadGuard` (`:449-451`): blocks `blur_data_url` from the listing select.
`tsc -p tsconfig.typecheck.json` exits 0 → all three hold. Runtime backstop
`privacy-fields.test.ts` green (asserts GPS/filename keys absent from
`publicSelectFieldKeys`). Belt + braces both present.

### CLAIM 5 — Advisory locks serialize as documented — VERIFIED (High)

`advisory-locks.ts` exports exactly the names CLAUDE.md documents:
`gallerykit_db_restore` (`:19`), `gallerykit_upload_processing_contract` (`:22`),
`gallerykit_topic_route_segments` (`:25`), `gallerykit_admin_delete` (`:34`),
`gallerykit:image-processing:${jobId}` (`:41`), `gallerykit_color_pipeline_backfill`
(`:44`). The sidecar acquires/releases `LOCK_COLOR_PIPELINE_BACKFILL` on a dedicated
connection (`backfill-color-pipeline.ts:475` RELEASE_LOCK). `advisory-locks.test.ts`
green (lock-name pins). Note (already deferred AGG-C3-19): the per-image
processing-claim *race* has only name-pins, no runtime two-worker harness — coverage
gap, not a defect; the invariant is sound.

### CLAIM 6 — Migration post-condition fails loud — VERIFIED (High)

`migrate.js`: `runMigrations` (`:698`) calls drizzle `migrate()` then computes
`missing = expectedMigrations.filter((m) => !recordedHashes.has(m.hash))` (`:710`)
and `throw` if `missing.length > 0` (`:711-718`). `expectedMigrations` is the FULL
`journalMigrations = getAllJournalMigrations(...)` (`:750`, passed at `:760`) — one
record per journal entry with `hash = SHA256(file)`. Covers all entries, fails the
deploy loud on any silently-skipped (non-monotonic-`when`) migration.
`migrate-reconcile-coverage` + `migrate` tests green.

### CLAIM 7 — Blur-data-url 3-point contract — VERIFIED (High)

Producer `process-image.ts:895` `assertBlurDataUrl(candidate)` (import `:17`);
write `images.ts:352` `blur_data_url: assertBlurDataUrl(data.blurDataUrl)` (import
`:28`); read `photo-viewer.tsx:196` `if (!isSafeBlurDataUrl(value)) return undefined`
(import `:35`). Contract `blur-data-url.ts`: `ALLOWED_PREFIXES` (`:33`,
`data:image/{jpeg,png,webp};base64,`), `MAX_BLUR_DATA_URL_LENGTH = 4096` (`:45`),
`isSafeBlurDataUrl` checks type+length+prefix (`:47-50`). `blur-data-url`,
`process-image-blur-wiring`, `images-action-blur-wiring` all green.

### CLAIM 8 — CSV escape strips formula + bidi + zero-width + C0/C1 — VERIFIED (High)

`csv-escape.ts`: C0/C1 strip preserving CR/LF (`:44`); `UNICODE_FORMAT_CHARS_G`
strip (`:54`) — derived from `validation.ts:58`
`/[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/`
covering bidi overrides U+202A-202E, isolates U+2066-2069, ZWSP/ZWNJ/ZWJ/LRM/RLM
U+200B-200F, WJ U+2060, BOM U+FEFF, MVS U+180E, interlinear U+FFF9-FFFB; CRLF
collapse (`:55`); formula prefix `/^\s*[=+\-@]/` leading-whitespace-tolerant
(`:60-62`); quote-wrap (`:63`). The `_G` variant is built via `.source` so it does
not pollute the `.test()`-only constant's lastIndex. `csv-escape` green.

### CLAIM 9 — Stripe async gap unhandled; checkout card-only — VERIFIED with NUANCE (High)

Webhook `stripe/webhook/route.ts`: handles only `checkout.session.completed`
(`:88`); gates `if (session.payment_status !== 'paid')` and returns `{received:true}`
without minting an entitlement (`:105-117`). `async_payment_succeeded` appears ONLY
in comments (`:99` "a future cycle should add a handler") — no handler. So a delayed
method that later fires `async_payment_succeeded` is genuinely dropped → matches
CLAUDE.md "complete checkout but never receive an entitlement row."
**Nuance (operationally closed):** `checkout/[imageId]/route.ts:207` hard-pins
`payment_method_types: ['card']` (`:196-206` comment: card-only makes
completed+unpaid unreachable). Card is immediate-capture, so the mishandled path
is unreachable in production as configured. `checkout-route` + `stripe` tests green
(card-only pin asserted). The "money-taken-no-goods" risk is NOT live; the only
trigger (adding an async method) is forbidden by code + test.

### CLAIM 10 — Touch-target audit catches multi-line / Badge / select — VERIFIED (High)

`touch-target-audit.test.ts`: `FORBIDDEN` includes `<Badge asChild>` sub-44
string-literal + `cn()` composite (`:396-401`); native `<select>` literal h-8/h-9/h-10
(`:415-420`), scale-token catch-all `{min-h|h}-(1..10)` (`:428-433`), arbitrary
`min-h-[<44px]` (`:436-441`), all with `(?<!max-)` negative-lookbehind and ≥44
override lookaheads. Multi-line normalization via `findJsxTagEnd` (`:561-610`)
tracks string/template/brace depth, skips `//` `/* */` comments, and closes only at
`braceDepth === 0 && prev !== '='` (`:600`) — the documented `=>`-arrow rejection so
an inline event handler does not prematurely close the tag. Audit green; correctly
declares `ui/switch.tsx: 0` after the cycle-3 fix.

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Switch thumb edge-to-edge, audit still green | VERIFIED | switch.tsx box-model math + touch-target green |
| 2 | Sidecar exit non-zero on all-detection-failure | VERIFIED | backfill-color-pipeline.ts:485 + detection-failure test green |
| 3 | CLIP heals production→disabled unless env opt-in | VERIFIED | gallery-config.ts:143-145; semantic tests green |
| 4 | Privacy compile guard fails on leak | VERIFIED | data.ts:416-451 + tsc exit 0 + privacy-fields green |
| 5 | Advisory locks named/scoped as documented | VERIFIED | advisory-locks.ts:19-44 + advisory-locks green |
| 6 | migrate.js throws on skipped journal entries, full coverage | VERIFIED | migrate.js:710-718 over full journalMigrations |
| 7 | blur-data-url enforced at 3 points | VERIFIED | process-image.ts:895, images.ts:352, photo-viewer.tsx:196 |
| 8 | CSV strips formula+bidi+zero-width+C0/C1 | VERIFIED | csv-escape.ts:44/54/55/60-62 + validation.ts:58 |
| 9 | Stripe async gap unhandled; card-only pin | VERIFIED (nuance) | webhook:105; checkout:207 |
| 10 | Touch-target audit catches Button/Badge/select multi-line | VERIFIED | touch-target-audit.test.ts:396-441,561-600 |

## Gaps

- **None blocking.** One cosmetic NIT: `switch.tsx:14` comment + commit message
  cite `translate-x-[calc(100%-2px)]` but the code uses `translate-x-full` (the
  correct value). Comment drift only; behavior is correct. Risk: low. Suggestion:
  align the comment with the code (`translate-x-full`) on the next touch of the file
  — do NOT change the code to match the comment (that would under-travel by 2px).
- The Stripe async gap (CLAIM 9) is an explicitly documented, test-pinned,
  operationally-closed deferral (re-opens before async payment methods are enabled),
  not a defect.

## Recommendation

**APPROVE** — all 10 load-bearing behavioral claims hold against current code at
HEAD f8147868, with 226 fresh claim-relevant tests passing, a clean
`tsconfig.typecheck.json` typecheck (the gating mechanism for the compile-time
privacy guards), and concrete file:line evidence for each. 0 contradictions, 0
inconclusive. The two prior-cycle fixes the prompt called out (switch geometry
`a3b8c557`, sidecar exit code `a033056d`) are independently verified correct at the
code level — the switch fix is genuinely edge-to-edge (box-model math, not just
"looks fixed"), and the sidecar now exits 1 on an all-detection-failure run. The
HARD GUARD is honored: CLIP semantic search remains disabled-by-design and its heal
logic is verified correct; no activation proposed. Honest convergence confirmed.
