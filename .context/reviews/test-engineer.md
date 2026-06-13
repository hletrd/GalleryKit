# Test-Engineer Deep Review — GalleryKit

**Date:** 2026-06-13
**HEAD:** `ce0029aa` (working tree: only `.context/reviews/*.md` edits; source clean)
**Suite baseline (measured live this review):** `npx vitest run` → **214 files / 2067 tests, all passing** (warm, exit 0). Matches the briefed baseline.
**Specialist angle:** test coverage gaps, flaky tests, vacuous/tautological tests, tests that pass for the wrong reason, missing edge-case coverage.

> **Context vs the aggregate:** `_aggregate.md` is run-8 **cycle-3** against HEAD `ada92ba5`. Several of its findings were closed in commits AFTER that (`6454c4a3`, `0017a34e`, `22387f32`, `6be638d2`, `d70c1d98`, `e9040d17`, the og-sanitize commits). I re-verified every pin claimed to have landed and re-measured the two findings the briefing said were addressed. **Two of the aggregate's findings the briefing treated as closed are NOT actually fixed at `ce0029aa`** (AGG-R8c3-09 cold-flake, AGG-R8c3-15 stale budget) — see below.

---

## FINDINGS BY SEVERITY

### MEDIUM

#### TE-1 — Backfill runner's SECOND `affectedRows===0` cleanup branch (detection-failure delete-race) is UNTESTED. **Confidence: High.**

**Source:** `apps/web/src/lib/admin-backfill-runner.ts:594-608` (the detection-failure UPDATE branch).
**Test gap:** every one of the 6 `admin-backfill-runner-*.test.ts` files plus `backfill-detection-failure-contract.test.ts` misses this branch.

The AGG-R8c3-03 fix (commit `0017a34e`, "clean up orphaned derivatives when row is deleted mid-re-encode") added the `affectedRows===0 → cleanupDeletedMidReencodeVariants() → return 'deleted-mid-reencode'` guard to **BOTH** UPDATE branches in `reprocessOne`:
- `:556-577` — the **version-bump** UPDATE (detection succeeded). Guard at `:573`.
- `:594-608` — the **detection-failure-but-encode-succeeded** UPDATE (`was_downscaled`/`avif_10bit` only, no version bump). Guard at `:605`.

The commit message explicitly says "**both** backfill UPDATE branches now read affectedRows." But the dedicated regression test `admin-backfill-runner-deleted-mid-reencode.test.ts` mocks `detectColorSignals` to **succeed** (`:89-97`, valid signals + `isHdr:false`), so it only exercises the **first** branch (`:573`). I verified the other candidates:
- `admin-backfill-runner-detection-failure.test.ts` mocks detection to throw (`:77-78`) — the right setup — but returns `affectedRows: 1` for the UPDATE (`:162`), so it lands on the normal `:609 return 'detection-failed'` path, **never** the `:605` `affectedRows:0` sub-branch.
- `backfill-detection-failure-contract.test.ts` tests the **operator script** (`reprocessRow`), not the in-app runner, and asserts `outcome:'processed'` with `derivativeOnly` columns — also not the `:605` path.

**Bug that slips through green:** a refactor that consolidates the two branches' cleanup, or drops the `:605-607` guard while keeping `:573`, leaves orphaned AVIF/WebP/JPEG derivatives on disk when a delete races a re-encode whose color **detection also failed transiently** — for a row that no longer exists, forever. The suite stays green because no test drives detection-failure + `affectedRows:0` simultaneously. This is the exact disk-leak the AGG-R8c3-03 fix exists to prevent, on its harder-to-reach half.

**Test to add:** clone `admin-backfill-runner-deleted-mid-reencode.test.ts`, mock `detectColorSignals` to **throw** (per the detection-failure test) AND make the UPDATE return `affectedRows: 0`. Assert `deleteImageVariants` fired for all 3 dirs with `sizes:[]`, `state.deletedMidReencode===1`, `state.detectionFailures===0`, `state.processed===0`, `lastRunHadFailures===false`. (One new `it` block; reuses the existing harness almost verbatim.)

---

### LOW

#### TE-2 — `KNOWN_VIOLATIONS['components/image-manager.tsx'] = 6` is stale; real count is **1** → a 5-violation silent-absorption slack. **Confidence: High (empirically measured).** = AGG-R8c3-15, **STILL OPEN.**

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:182`.

The briefing states AGG-R8c3-15 was addressed in commit `6454c4a3`. **It was not** — I confirmed `6454c4a3 --stat` touched only `admin-backfill-runner-fatal-counters.test.ts`, `migrate-reconcile-coverage.test.ts`, and `sw-template-contract.test.ts`; it never modified `touch-target-audit.test.ts`. The structural reason this can't self-fix: the stale-budget detection at `:710-714` is **explicitly informational, NOT a hard failure** ("This is informational, not a hard failure… doesn't prevent tests from passing"). The gate fires only on `issues.length > allowed` (over-budget), never on under-budget.

I measured the true counts by temporarily zeroing `KNOWN_VIOLATIONS` and running the audit (then reverted — tree is clean):

| File | Budget | **Real** | Slack |
|---|---|---|---|
| `components/image-manager.tsx` | **6** | **1** | **5** |
| `components/admin-user-manager.tsx` | 2 | 2 | 0 |
| `dashboard-client.tsx` | 5 | 5 | 0 |
| `topic-manager.tsx` | 3 | 3 | 0 |
| `tag-manager.tsx` | 3 | 3 | 0 |
| `admin-header.tsx` / `seo-client.tsx` / `settings-client.tsx` | 1 / 1 / 1 | 1 / 1 / 1 | 0 |

`image-manager.tsx` is the only mis-set entry. Its per-row `size="icon"` edit/delete buttons (`:538`,`:544`) gained explicit `h-11 w-11` overrides and the Share button (`:366-374`) gained `className="h-11"`, dropping the real count from 6 to 1 (only the `size="sm"` bulk-add-tag at `:328` remains) — but the budget was never lowered. **Up to 5 NEW sub-44px touch targets** could be added to `image-manager.tsx` before the gate fires.

(I also confirmed the multi-line normalizer is working correctly — the Share button at `:366-374` is correctly excluded because its collapsed form carries `h-11`, so this is genuine budget staleness, not a normalizer regression.)

**Fix:** lower the entry to `1` and update the enumerating comment (`:168-181`) to reflect the single remaining `size="sm"` violation. Optionally promote stale-budget detection (`:710-714`) from informational to a hard failure so future over-budgets surface as a reviewed diff rather than silent slack.

#### TE-3 — Encode-heavy real-AVIF tests still share `public/uploads`; AGG-R8c3-09 cold-flake mechanism is UNADDRESSED. **Confidence: High (mechanism); could NOT trigger warm.** = AGG-R8c3-09, **STILL OPEN.**

The briefing asked whether the flake was "isolated to a per-test temp dir or still shares `public/uploads`." **Still shares it.** Commit `6454c4a3` (the pin batch) did not touch either flaking file. I verified:
- `process-image-color-roundtrip.test.ts:31` and `backfill-color-pipeline.test.ts:27` `mkdtemp` only the **source** fixtures; the derivative **outputs** still write into the real `UPLOAD_DIR_AVIF/WEBP/JPEG` (= `public/uploads/{avif,webp,jpeg}` via `upload-paths.ts:42-46`) through `processImageFormats` / `reprocessRow`. The `afterAll` cleanup confirms this ("Clean up any test-generated derivatives so we don't pollute public/uploads").
- **At least 7 test files do REAL sharp/libheif encoding** (no `vi.mock('sharp')`): `process-image-color-roundtrip`, `backfill-color-pipeline`, `process-image-p3-icc`, `process-image-post-encode-verification`, `process-image-variant-scan`, `color-fixtures`, `process-image-icc-options-lockin`. Of these, FOUR (`-color-roundtrip`, `backfill-color-pipeline`, `process-image-orientation`, `process-image-exif-strip`) write derivatives into the **shared** `public/uploads` tree (others mock `UPLOAD_DIR` to `/tmp/test/...` or `mkdtemp` their outputs).
- No `describe.sequential`, no serial pool, no per-test upload-dir override in `vitest.config.ts`.

I could NOT reproduce the flake in 4 rounds of the 10 encode-heavy files together (78/78 each) — consistent with the aggregate's finding that it only surfaces under FULL-suite parallelism (~214 files contending for encoder threads), not a 10-file subset with spare cores. RED on a cold/contended CI run remains indistinguishable from a real encode regression.

**Fix (unchanged from AGG-R8c3-09):** give each real-encode test a unique temp upload dir (env-override `UPLOAD_ROOT` per test, since `upload-paths.ts` already reads `UPLOAD_ORIGINAL_ROOT`/cwd), OR pin the encode-heavy files to a serial vitest project / `--no-file-parallelism` glob. The cleanest is a per-test `UPLOAD_ROOT`.

#### TE-4 — `getLatestImageForOg` source-shape test cannot catch a dropped `processed=true` filter or a wrong sort. **Confidence: Medium.**

**Source:** `apps/web/src/lib/data.ts:874-882` (freshly landed, AGG-R8c3-05, commit `e9040d17`). **Test:** `data-tag-names-sql.test.ts:130-146`.

The test is a **source-text** assertion: it greps the function body for `id: images.id`, `buildImageConditions(`, `.limit(1)`, and the absence of `GROUP_CONCAT`/joins/`groupBy`. It does NOT verify runtime behavior. Two real regressions slip through green:
1. **Processed-filter leak:** the source is `buildImageConditions(undefined, tagSlugs, false)` — the `false` (3rd arg = `includeUnprocessed`) is what pushes `eq(images.processed, true)` (verified in `buildImageConditions` at `data.ts:578-589`). If someone flipped it to `true`, the text `buildImageConditions(` still matches → the test passes while the home OG card starts surfacing **unprocessed** images (no derivatives yet → the `/api/og/photo/${id}` card 302s/blanks).
2. **Wrong sort:** no assertion on `desc(images.capture_date)` / `desc(created_at)`. A refactor to `asc` would serve the OLDEST image as "latest" — green suite.

The consumer test `home-metadata-title.test.ts` fully mocks `getLatestImageForOgCached`, so neither test exercises the real query path. This is LOW (simple function, args explicit in source), but the source-text guard gives false confidence that "the OG path filters correctly."

**Test to add:** a runtime `.toSQL()` inspection (the sibling masonry test already uses the mysql-proxy driver pattern at `data-tag-names-sql.test.ts:159+`) asserting the compiled SQL contains `` `processed` = ? `` (param `true`) and `order by ... desc`.

#### TE-5 — Home-OG-route sanitize pin asserts the IMPORT, not the CALL site. **Confidence: Medium.** (Residual of AGG-R8c3-11a / TEST-1.)

**Test:** `sanitize-for-og-global.test.ts:57-76`. The `it.each` now correctly covers all three consuming files including `src/app/api/og/route.tsx` (home/site OG) and the JSON-LD page — a real improvement that closes most of the gap. But each case asserts only (a) `from '@/lib/og-sanitize'` import presence and (b) absence of `.replace(UNICODE_FORMAT_CHARS,`.

It does NOT assert the home route actually **calls** `sanitizeForOg(...)` on `topicLabel`/`siteTitle`/`tagList` (the values at `api/og/route.tsx:82-88`). A refactor that keeps the import but drops the call on one value (e.g. `topicLabel = clampDisplayText(...)` with the `sanitizeForOg` wrap accidentally removed) leaves that value un-stripped and passes both assertions — the exact "refactor silently re-opens the gap" failure mode AGG-R8c3-11a named. LOW because (i) not exploitable (`JSON.stringify`/`safeJsonLd` escape downstream), (ii) the import guard catches the wholesale-drop case.

**Stronger pin:** assert the route source matches each value being wrapped, e.g. `/sanitizeForOg\(clampDisplayText\(topicRecord\.label/` and `/sanitizeForOg\(seo\.title/`.

#### TE-6 — `retryFailedImage` localized invalid-id branch has no behavioral test. **Confidence: Low.**

**Source:** `apps/web/src/app/actions/images.ts:1087` (commit `6be638d2` switched the hardcoded `'Invalid image ID'` → `t('invalidImageId')`). The three retry-related test files don't assert it: `failed-image-retry.test.ts` is a source-shape test (query forms), `retry-failed-image-auth.test.ts` covers only the unauthorized path, `bulk-update-images.test.ts` is unrelated. The invalid-id branch (`!Number.isInteger(id) || id <= 0`) is untested for the new key. Trivial branch, now consistent with siblings — note only.

#### TE-7 — No automated contrast-ratio guard for the new dark-mode color tokens. **Confidence: Low (test-infra opportunity, not a defect).**

The a11y batch landed `--destructive-text` (`globals.css:40,67,95`) and amber `dark:` variants (AGG-R8c3-04/07/08). The repo enforces touch-targets (`touch-target-audit.test.ts`) and headings (`error-shell-heading.test.ts`) as blocking tests, but **no test computes WCAG contrast ratios** from the CSS tokens — I grepped: zero `contrast`/`wcag`/`getContrastRatio`/`--destructive-text` assertions in `__tests__/`. A future token edit could silently regress these freshly-fixed ratios. Hard to automate (requires HSL→sRGB→relative-luminance→ratio over the token pairs), and it's a designer-owned finding, so this is a forward-looking suggestion, not a new gap.

---

## VERIFIED-CLEAN (pins I confirmed non-vacuous this review)

- **TEST-2 width≤0 backfill skip (`admin-backfill-runner-fatal-counters.test.ts:315-386`):** asserts `encodeFailures===1`, `processed===0`, `processImageFormats` **NOT** called, and zero `UPDATE images SET` calls for a `width:0` row. Genuinely drives the `:430-436` guard before any encode. **Solid.**
- **TEST-3 SW bounded HEAD (`sw-template-contract.test.ts:118-135`):** asserts `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` within the `method:'HEAD'` options window in BOTH `sw.template.js` AND the generated `sw.js`, plus the constant definition. Since the reference `sw-cache.ts` has no HEAD probing, this is the only copy and the pin is load-bearing. **Solid.**
- **COR-3/CRT-5 comment-stripped migrate tripwire (`migrate-reconcile-coverage.test.ts:42-50,100,166`):** `MIGRATE_SRC_CODE = stripJsComments(...)` strips block + line comments before the column/index `.includes()` check, so a name in a comment can no longer satisfy the mirror requirement. Scanner-sanity guard (`:147-155`) requires ≥10 indexes + spot-checks two known names so it can't pass vacuously. **Solid, non-vacuous.**
- **AGG-R8c3-03 first branch (`admin-backfill-runner-deleted-mid-reencode.test.ts`):** asserts `deleteImageVariants` fired for all 3 format dirs with `sizes:[]`, `processImageFormats` ran (real post-encode path), and the full counter partition (`deletedMidReencode===1`, `processed/encodeFailures/detectionFailures/errors===0`, `lastRunHadFailures===false`). Strongly non-vacuous — but only the **success** branch (see TE-1 for the uncovered sibling).
- **AGG-R8c3-01 NCLX code-2 isHdr (`color-detection.test.ts:259`):** real `detectColorSignals` run; asserts `colorPrimaries==='p3-d65'`, `transferFunction==='pq'`, `isHdr===true`. Directionally complete — bracketed by the negative cases at `:235` (code-2, no ICC → `isHdr:false`) and `:246` (code-2 + sRGB ICC → `isHdr:false`). **Solid.**
- **TEST-1 home-OG-route sanitize (`sanitize-for-og-global.test.ts:57-69`):** the `it.each` now covers all 3 consuming files (both OG image routes + JSON-LD page) for import presence + non-global-`.replace` absence. Substantially closes AGG-R8c3-11a (residual call-site gap noted as TE-5).
- **Touch-target scale-token regex (`touch-target-audit.test.ts:341-356`, AGG-R8c3-06 / d70c1d98):** I stress-tested the new `(?:min-h|min-w|size|h|w)-(?:[1-9]|10)` patterns against 13 concrete className cases. The `\b` word boundaries correctly REJECT larger compliant tokens (`h-14`, `size-16`, `min-h-20`, `h-20`) as non-matches even though they're absent from the `h-1[12]` override list — because the body pattern itself never matches them. Catches `min-h-6`/`size-6`/`h-7` (the closed bug), respects co-present `h-11` overrides, and ignores `px-10`. **Robust, no false positives.**
- **Checkbox blind-spot closure (`scanRawCheckboxes`, `:636-665` + self-test `:864-886`):** requires the input's own tag OR a wrapping `<label>` within 4 lines to clear 44px; self-test proves it catches a sub-44 checkbox AND radio and accepts a `min-h-11` label. (Minor: only `<label>` wrappers detected, back-scan only goes upward — both cause over-reporting, never under-reporting, so no real violation slips through.) **Non-vacuous.**
- **Login-form vacuity fix (`:730-748`):** the historical silent `if(!exists) return` no-op was replaced with `expect(fs.existsSync(...)).toBe(true)` so a rename is now a hard failure. **Correct.**
- **No tautologies / disabled-test rot:** suite-wide scan found zero `expect(true).toBe(true)`-class assertions; the only `.skip()` calls are environment-conditional e2e gates (CI-only / credential-gated admin + origin-guard specs) — appropriate posture, not vacuity. The 16 bare `toBeDefined()` instances I sampled are all paired with downstream value assertions.
- **Full suite:** 214 files / 2067 tests pass warm (exit 0).

---

## TOP COVERAGE GAPS (priority order)

1. **TE-1 (MED):** backfill detection-failure + delete-race cleanup branch (`admin-backfill-runner.ts:605`) untested — orphaned-file leak slips through green. One `it` block fixes it.
2. **TE-2 (LOW, but the most concrete regression-detection hole):** `image-manager.tsx` touch-target budget stale at 6 vs real 1 → 5 silent NEW violations allowed. = AGG-R8c3-15, **not fixed** despite the briefing's claim.
3. **TE-3 (LOW):** encode-heavy real-AVIF tests still contend on shared `public/uploads` → AGG-R8c3-09 cold-flake mechanism intact, **not fixed**. Per-test `UPLOAD_ROOT` isolation.
4. **TE-4 (LOW):** `getLatestImageForOg` source-text test can't catch a dropped `processed` filter or reversed sort — needs a `.toSQL()` runtime assertion.
5. **TE-5 (LOW):** home-OG-route sanitize pin asserts import, not call site.
