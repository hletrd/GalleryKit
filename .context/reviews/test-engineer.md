# Test-Engineer Deep Review — GalleryKit

**Date:** 2026-06-13
**HEAD:** `1dde9b1e` (working tree: only `.context/reviews/*.md` + `plan/*.md` edits; source clean)
**Suite baseline (measured live this review):** `npx vitest run` → **215 files / 2068 tests, all passing** (warm, exit 0, 173 s). Count grew 2067 → 2068 (+1), matching the single new test from `2251b122`. The documented libheif cold-flake did NOT reproduce this run.
**Specialist angle:** test coverage gaps (esp. on recently-landed fixes + security-critical invariants), vacuous/tautological tests, flaky tests, tests that pass for the wrong reason, missing edge-case coverage.

> **Cycle context.** This is run-9 **cycle-2** (orchestrator "cycle 5"). The prior aggregate (`_aggregate.md`, cycle 4 / HEAD `ce0029aa`) scheduled 3 MED + 3 LOW; 7 commits landed since (`8ce8f914`..`1dde9b1e`). I re-verified every scheduled fix at `1dde9b1e` — running the new tests, **independently neutering guards to confirm RED**, and re-measuring the two items the prior aggregate deferred. **The prior cycle's TE-1 (AGG-C4-05) is now genuinely CLOSED with a proven-non-vacuous test.** But the sidecar's twin of that same guard (`AGG-C4-02`) landed code-only with **zero test coverage**, and three prior-deferred test items remain open and unaddressed.

---

## FINDINGS BY SEVERITY

### MEDIUM

#### TE-1 — Sidecar `flushBatch` delete-race orphan-cleanup (the AGG-C4-02 PRODUCTION fix) has ZERO test coverage. **Confidence: High (mechanism + export-surface verified).** NET-NEW.

**Source:** `apps/web/scripts/backfill-color-pipeline.ts:337-391` (`flushBatch`), specifically the `affectedRows===0 → deletedMidReencodeFiles.push → cleanupDeletedMidReencode(files)` logic at `:362-364`, `:373-375`, `:378-388`, and `cleanupDeletedMidReencode` at `:329-335` (the `deleteImageVariants(dir, fn, [])` dir-scan calls).
**Test gap:** the sidecar's two test files import and exercise ONLY `reprocessRow` (the per-row encode), never `flushBatch`:
- `backfill-color-pipeline.test.ts:20` — `import { reprocessRow, type ImageRow }`. All 7 `it` blocks call `reprocessRow(...)` and assert its returned `outcome`/`signals`. The AGG-02 column-set test (`:146-198`) asserts `Object.keys(outcome.signals)` — the **shape of the value `reprocessRow` returns**, NOT the UPDATE SQL `flushBatch` emits, and NOT the `affectedRows` cleanup.
- `backfill-detection-failure-contract.test.ts` — also `reprocessRow`-only (the operator-script detection-failure outcome).

`flushBatch` is **not exported** (`scripts/backfill-color-pipeline.ts:129` exports `reprocessRow`; `:64` exports `ImageRow`; `grep -n export` shows nothing else). So the entire AGG-C4-02 fix — captured `ResultSetHeader`, the two `affectedRows===0` branches, the post-commit `cleanupDeletedMidReencode([])`, the `processed -= ...` / `deletedMidReencode += ...` tally — is exercised by no test at all.

**Why this matters disproportionately.** This is the asymmetric twin of the prior cycle's TE-1 (AGG-C4-05). That finding existed *because* a delete-race cleanup guard was untested; it was closed by a dedicated, proven-RED test for the **in-app runner** (`admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts`, commit `2251b122`). The **sidecar** is documented in CLAUDE.md as the canonical PRODUCTION backfill path (the prod container lacks `tsx`, so the `--rm` sidecar IS how prod re-encodes). Its delete-race cleanup just landed (`300009d4`) and got **no test** — the commit stat is script + CLAUDE.md + plan only. The aggregate's equivalence claim ("both paths now share the guard", CLAUDE.md backfill prose) is asserted only in prose; the runner's half is pinned, the production half is not. A refactor that drops the sidecar's `:362` / `:373` `affectedRows===0` check, or the `[]` in `cleanupDeletedMidReencode` (`:331-333`), or the post-commit cleanup call (`:386`), leaves orphaned AVIF/WebP/JPEG derivatives on the PRODUCTION path for a deleted image — forever, with a green suite. This is the exact disk-leak the fix exists to prevent, on the path that actually runs in prod.

**Concrete regression that slips through:** admin runs the sidecar backfill; concurrently deletes a photo whose re-encode is in-flight (the sidecar UPDATE matches 0 rows). A future maintainer "simplifies" `flushBatch` to drop the `affectedRows` capture (it looks like dead bookkeeping). The freshly-re-materialized derivative files for the deleted row are never unlinked → permanent orphans accumulating on every prod backfill. Suite stays green.

**Test to add (one new file, ~1 `it`):** the cleanest path is to **export `flushBatch`** (or a thin `flushReprocessBatch(items, derivativeItems)` seam) for unit testing, then mock `db.transaction`/`tx.execute` to return `[{ affectedRows: 0 }]` and `deleteImageVariants` as a spy, and assert: cleanup fired for webp/avif/jpeg with `[]` sizes, `deletedMidReencode` incremented, `processed` decremented, the run-summary line printed. Mirror `admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` almost verbatim. If exporting `flushBatch` is unwanted, drive the whole `runBackfill` loop with a mocked `db`/`queue` and one candidate row whose UPDATE returns `affectedRows:0` — heavier but keeps the seam private. **Prove non-vacuous** by deleting the `:362` guard and confirming RED (exactly as `2251b122`'s message documents for the runner).

---

### LOW

#### TE-2 — `KNOWN_VIOLATIONS['components/image-manager.tsx'] = 6` is stale; real count is **1** → a 5-violation silent-absorption slack. **Confidence: High (empirically re-measured at `1dde9b1e`).** = AGG-C4-09 / AGG-R8c3-15, **STILL OPEN.**

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:182`.

The prior aggregate DEFERRED this to plan-336 ("re-affirm"); it was not tightened this cycle. I re-measured at current HEAD by temporarily zeroing the budget and running the audit (then reverted — tree clean):

```
components/image-manager.tsx: found 1 violation(s), allowed 0
   components/image-manager.tsx:328  shadcn <Button size="sm"> without explicit ≥44 px override
```

True count is **1** (only the `size="sm"` bulk-add-tag at `:328`), budget is **6** → **5 slack**. The structural reason it can't self-correct: the stale-budget detector at `:710-714` is explicitly informational ("not a hard failure… doesn't prevent tests from passing"); the gate fires only on over-budget (`issues.length > allowed`), never under-budget. **Up to 5 NEW sub-44 px touch targets** can land in `image-manager.tsx` before the gate fires.

**Fix:** lower the entry to `1`, update the enumerating comment (`:168-181`) to the single remaining `size="sm"` violation. (Optional hardening: promote the `:710-714` detector to a hard failure so future over-budget drops surface as a reviewed diff. NOTE: that change is risky — it would couple the test to the *exact* count of legitimately-budgeted violations across 8 files, so any deliberate budget add would also have to update the detector; document the tradeoff if taken.)

#### TE-3 — Encode-heavy real-AVIF tests still share `public/uploads`; the AGG-R8c3-09 cold-flake mechanism is UNADDRESSED. **Confidence: High (mechanism); could NOT trigger warm.** = AGG-C4-T2 / AGG-R8c3-09, **STILL OPEN.**

The prior aggregate DEFERRED this ("re-open when the cold-flake reproduces"). No isolation landed this cycle. I re-verified at `1dde9b1e`: four real-encode tests `mkdtemp` only their **source** fixtures (`tmpDir`) and write **derivative outputs** into the real shared `UPLOAD_DIR_AVIF/WEBP/JPEG` (= `public/uploads/{avif,webp,jpeg}`), relying on `afterAll` unlink:
- `process-image-color-roundtrip.test.ts:31,37-42`
- `backfill-color-pipeline.test.ts:27,34-38`
- `process-image-orientation.test.ts:29,36-40`
- `process-image-exif-strip.test.ts:29,36-40`

None mock `@/lib/upload-paths`, none set a `UPLOAD_ROOT` env-override; no `describe.sequential` / serial pool / `--no-file-parallelism` glob in `vitest.config.ts`. (Cross-check: `process-image-p3-icc`, `-variant-scan` correctly `mkdtemp` their output dir; `-post-encode-verification`, `-icc-options-lockin` don't write derivatives to `UPLOAD_DIR` — so the contended set is exactly these 4.) Two same-`id`-collision risks remain across the full-suite parallel run plus encoder-thread contention. I could not reproduce the flake warm (consistent with the aggregate — it only surfaces under full ~215-file parallelism). RED on a cold/contended CI run remains indistinguishable from a real encode regression.

**Fix (unchanged):** give each real-encode test a unique temp upload dir via a per-test `UPLOAD_ROOT` env-override (`upload-paths.ts` already reads `UPLOAD_ORIGINAL_ROOT`/cwd), OR pin the 4 files to a serial vitest project.

#### TE-4 — `getLatestImageForOg` source-shape test still cannot catch a dropped `processed=true` filter or a reversed sort. **Confidence: Medium.** = AGG-C4-T1 (partial), **STILL OPEN.**

**Source:** `apps/web/src/lib/data.ts` (`getLatestImageForOg`, AGG-R8c3-05, commit `e9040d17`). **Test:** `data-tag-names-sql.test.ts:130-146`.

The prior aggregate dispositioned this "schedule-cheap or defer — currently behaving"; it was not addressed. The test remains a **source-text** assertion: it greps the function body for `id: images.id`, `buildImageConditions(`, `.limit(1)`, and the absence of `GROUP_CONCAT`/joins/`groupBy`. Two real regressions slip through green:
1. **Processed-filter leak:** the source is `buildImageConditions(undefined, tagSlugs, false)` — the `false` (3rd arg = `includeUnprocessed`) is what pushes `eq(images.processed, true)`. Flip it to `true` and the text `buildImageConditions(` still matches → green while the home OG card surfaces **unprocessed** images (no derivatives → `/api/og/photo/${id}` card 302s/blanks).
2. **Wrong sort:** no assertion on `desc(capture_date)`/`desc(created_at)`. A flip to `asc` serves the OLDEST image as "latest" → green.

The consumer test `home-metadata-title.test.ts` fully mocks `getLatestImageForOgCached`, so neither test exercises the real query. LOW (simple function, args explicit in source). Notably the SAME file already uses the robust `.toSQL()` runtime-inspection pattern (`:244-259`, with a no-op proxy DB) for the masonry lite query — the technique is in-repo; the OG query just didn't get it.

**Test to add:** a `.toSQL()` inspection asserting the compiled SQL contains `` `processed` = ? `` (param `true`) and `order by ... desc`, reusing the `:244` driver pattern.

#### TE-5 — No committed test asserts FULL en.json ↔ ko.json leaf-key parity. **Confidence: High (absence verified).** NET-NEW.

**Gap:** the `_aggregate.md` "837 = 837, 0 drift" parity figure is an **orchestrator-side manual measurement**, not a committed regression gate. I searched every `__tests__` file: the only test that flattens both locales is `humanize-transfer-function-i18n.test.ts:20-36`, and its `flatten()` output is used solely to look up specific transfer-function keys via `makeT` — it does NOT assert `Object.keys(flatten(en))` equals `Object.keys(flatten(ko))`. `color-pipeline-decision-i18n.test.ts` and the `cycle{4,5}-rpf-source-contracts.test.ts` files pin only **specific newly-added keys** in both locales, not the full set. No script under `apps/web/scripts/` performs the check either (`check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`, `check-js-scripts` — none touch i18n).

**Concrete regression:** a hand-edit drops a pre-existing key from `ko.json` (e.g. during a refactor of a nested namespace). next-intl renders the key string verbatim to Korean users at that surface. No test fails; the leak surfaces only when someone navigates to that string in the `ko` locale. The cycle source-contract tests catch *intentionally-added* keys but not *accidentally-dropped* ones.

**Test to add (one small file):** flatten both message objects to leaf-key sets and assert set equality (`expect(enKeys.sort()).toEqual(koKeys.sort())`). **Critical:** assert on KEYS only, never values — per CLAUDE.md DOC-R5C3-07, en uses ICU `plural` blocks and ko uses a single fixed form, so the VALUE shapes legitimately differ. A key-set equality is exactly right and is the missing gate.

#### TE-6 — Upload-queue delete-race `[]`-sizes cleanup (AGG-C4-04 fix) has no direct call-path test. **Confidence: Medium.** Author-acknowledged residual.

**Source:** `apps/web/src/lib/image-queue.ts` (the `affectedRows===0` cleanup, now passing `[]` as the 3rd `deleteImageVariants` arg per `18de78eb`). The commit message itself states: *"the queue-worker call path is hard to isolate in a unit test, so the contract test stands."* The fix relies on the **indirect** `process-image-variant-scan.test.ts` proving that `deleteImageVariants(dir, fn, [])` triggers a full directory scan — but no test asserts the **queue worker actually passes `[]`** at the call site (`image-queue.ts:375-379`).

This is a weaker version of the TE-1 sidecar gap (here at least the dir-scan contract is pinned and the queue path is genuinely harder to unit-isolate than the sidecar's batch function). A regression to the queue passing default sizes again would re-open the original non-default-size orphan leak with a green suite. LOW because: (a) admin-only + low-prob + disk-leak-only, (b) the dir-scan contract is solid. A cheap source-shape pin (assert `image-queue.ts` source matches `deleteImageVariants\([^,]+,[^,]+,\s*\[\]\)` in the deletion block, or `not.toMatch` the default-sizes 2-arg form) would close it at near-zero cost, consistent with the blur-wiring call-site pin pattern already in the repo.

---

## RE-VERIFIED CLOSED THIS CYCLE (scheduled fixes confirmed BEHAVING + non-vacuous, not trusted on the commit's word)

- **AGG-C4-05 (prior TE-1) — runner detection-failure delete-race cleanup: CLOSED, INDEPENDENTLY PROVEN NON-VACUOUS.** New test `admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` (`2251b122`). It mocks `detectColorSignals` to throw (forcing the derivative-only `:594-608` branch) AND the UPDATE to return `affectedRows:0`, then asserts `deleteImageVariants` fired for webp/avif/jpeg with `[]` sizes, `deletedMidReencode===1`, `processed/encodeFailures/detectionFailures/errors===0`, `lastRunHadFailures===false`. **I verified RED myself:** temporarily neutering the `:605-608` guard (replacing the `affectedRows===0 → cleanup → return 'deleted-mid-reencode'` with a fall-through to `'detection-failed'`) turned the test RED with `expected [] to include '/uploads/webp'` and the runner log `WITH FAILURES … detectionFailures=1 deletedMidReencode=0`. Restored clean. **Genuinely load-bearing.**
- **AGG-C4-01 — touch-target `max-h`/`max-w` ceiling false positive: CLOSED, self-check pins it BIDIRECTIONALLY.** `40a65aef` added `(?<!max-)` to every bare `h`/`w` branch (string-literal, `cn()` composite, HTML `<button>`, and the scale-token catch-all), leaving `min-h`/`min-w`/`size` unguarded (true floors). I empirically verified the **exact committed regexes** in Node: `<Button className="h-8">` and `min-h-6` → flagged (correct), `max-h-8`/`max-h-10`/`max-w-9` → NOT flagged (correct), `h-14` → NOT flagged (correct). The self-check has BOTH directions: the positive block (`:768-810`, `toBe(true)`) still catches `h-8`/`h-9`/`h-10`/`size-10`/scale-tokens (proving the lookbehind didn't over-neuter), and the new negative block (`:938-983`, `toBe(false)`) adds **9 regression pins** — `max-h-10`, `max-w-9`, `max-h-8`, `max-w-10`, `max-h-screen`, `max-w-full`, `cn("max-h-10")`, HTML `<button max-h-9>`, HTML `cn("max-w-10")`. **Robust; pins against future drift.**
- **AGG-C4-02 sidecar code fix — present + correct** (`300009d4`): `flushBatch` now captures `ResultSetHeader` from each `tx.execute`, collects `affectedRows===0` rows, and runs `cleanupDeletedMidReencode(files)` (dir-scan, `[]` sizes) AFTER commit. Code is correct; the **test** is the gap (TE-1 above).
- **AGG-C4-04 queue code fix — present + correct** (`18de78eb`): `image-queue.ts` now passes `[]` to the delete-race `deleteImageVariants` calls. Code correct; direct call-path test is the residual (TE-6).
- **AGG-C4-03 sales StatusBadge contrast** (`fd708c1e`): designer-owned a11y fix, out of test-engineer scope; no test regression introduced (no contrast-ratio test exists — see the standing note below).
- **AGG-C4-06/07 doc honesty** (`1dde9b1e`): doc-only; no test impact.

## VERIFIED-CLEAN (security-invariant + recently-landed tests confirmed non-vacuous this review)

- **`privacy-fields.test.ts` — STRONGEST security-invariant test in the suite.** The symmetric guard (`:83-90`) derives `adminOnlyKeys` from the ACTUAL code (`adminSelectFieldKeys` minus `publicSelectFieldKeys`) and asserts it equals exactly the 22-key `SENSITIVE_KEYS` contract — so a NEW admin field added without a disposition decision fails loudly, AND a sensitive key leaking into public fails. The timeline mirror (`:101-114`, `data-timeline.ts`) and subset guard close the public-page drift (`color_space`/`bit_depth` previously leaked there). Non-vacuous, derives from code not hardcode.
- **`check-api-auth.test.ts` / `check-action-origin.test.ts` / `check-public-route-rate-limit.test.ts` — all three import the REAL scanner** (`checkRouteSource` / `checkActionSource`+`walkForActionFiles` / `checkPublicRouteSource`) and feed BAD fixtures asserting `report.failed` is non-empty (`MISSING requireSameOriginAdmin` / `MISSING RATE LIMIT` + `POST` / unwrapped handler). They also cover the subtle bypass cases — dead branch, uncalled nested helper, aliased export, `as`-assertion wrap. RED if a route/action/public-handler drops its guard. **Solid.**
- **`validation.test.ts`** — `containsUnicodeFormatting` tested against actual RLO/LRE/LRO/LRI/zero-width chars (not the function name); topic-alias/tag-name validators reject bidi + zero-width formatting. Real-function, semantic.
- **`csv-escape.test.ts`** — real `escapeCsvField`; asserts neutralization of `=`/`+`/`-`/`@` (formula injection), C0/C1 controls, CR/LF. Behavioral, not source-shape.
- **`color-detection.test.ts`** — real `detectColorSignals` per branch with explicit expected values (`p3-d65`/`bt709`/`unknown` transfer, `isHdr` true/false). The NCLX code-2 isHdr case is bracketed by negative cases. Semantic.
- **`process-image-blur-wiring.test.ts` / `images-action-blur-wiring.test.ts`** — source-shape but assert the **CALL SITE** (`blur_data_url\s*:\s*assertBlurDataUrl\s*\(`) AND the absence of the un-wrapped form (`not.toMatch(/blur_data_url\s*:\s*data\.blurDataUrl\b/)`). The call-site + negative-form combination is the stronger pattern TE-4 wishes the OG sanitize pin had — already present here. Adequate.
- **`sw-template-contract.test.ts`** — pins the template AND the generated `sw.js` against drift: bounded HEAD probe (`AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` in both), `x-gk-admin-render !== '1'` offline-cache gate, LRU accounting parity vs `lib/sw-cache.ts`. Load-bearing (the template has no unit-tested twin).
- **`data-tag-names-sql.test.ts` lite-query `.toSQL()` (`:244-259`)** — compiles the masonry query and asserts `GROUP_CONCAT(DISTINCT … ORDER BY …)` + LEFT JOIN + GROUP BY in the emitted SQL. Genuinely semantic (catches the NULL-correlated-subquery regression that broke production). Only `getLatestImageForOg` (TE-4) lacks the same treatment.
- **`backfill-color-pipeline.test.ts` AGG-02 column-set (`:146-198`)** — locks the full 9-key `signals` set returned by `reprocessRow` so a column drop fails the gate. Non-vacuous for what it covers (the per-row encode signal set); does NOT cover `flushBatch` (TE-1).
- **No tautologies / disabled-test rot:** suite-wide scan found zero `expect(true).toBe(true)`-class assertions; the only `.skip()` calls are environment-conditional e2e gates. Full suite **215 files / 2068 tests pass warm (exit 0)**; libheif cold-flake did not reproduce.

## Standing note (forward-looking, not a new gap)

- **No automated WCAG contrast-ratio guard for the dark-mode color tokens** (`--destructive-text`, amber `dark:` variants, and now the sales StatusBadge light-mode values from `fd708c1e`). Touch-targets and error-shell headings are blocking tests, but no test computes contrast ratios from the CSS tokens (`grep` over `__tests__/` finds zero `contrast`/`wcag`/`getContrastRatio` assertions). A future token edit could silently regress these freshly-fixed ratios. Hard to automate (HSL→sRGB→relative-luminance→ratio over token pairs) and designer-owned — a suggestion, not a test-engineer finding. Unchanged from prior cycles.

---

## TOP COVERAGE GAPS (priority order)

1. **TE-1 (MED, NET-NEW):** sidecar `flushBatch` delete-race orphan-cleanup — the PRODUCTION backfill path — has ZERO test coverage, while its in-app twin just got a dedicated proven-RED test. Export `flushBatch` and clone the runner test. Highest-signal gap this cycle.
2. **TE-5 (LOW, NET-NEW):** no committed full en/ko leaf-key parity test; the 837=837 figure is a manual orchestrator count. One small `Object.keys` set-equality test (keys only, per DOC-R5C3-07).
3. **TE-2 (LOW):** `image-manager.tsx` touch-target budget stale at 6 vs real 1 → 5 silent NEW violations allowed. Re-measured, = AGG-C4-09, prior-deferred, still open.
4. **TE-3 (LOW):** 4 encode-heavy real-AVIF tests still contend on shared `public/uploads` → AGG-R8c3-09 cold-flake mechanism intact. Per-test `UPLOAD_ROOT`. Prior-deferred, still open.
5. **TE-4 (LOW):** `getLatestImageForOg` source-text test can't catch a dropped `processed` filter or reversed sort — needs the `.toSQL()` pattern already in the same file. Prior-deferred, still open.
6. **TE-6 (LOW):** upload-queue `[]`-sizes cleanup call site untested (author-acknowledged); cheap source-shape call-site pin closes it.

NET-NEW TEST FINDINGS THIS CYCLE: 2
